/*
 * Host-half integration test: mounts the real route handler from lib/index.js
 * on a throwaway HTTP server and talks to it the way the sidebar does.
 * Run with `node test/host-api.test.mjs`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { apply } from "../lib/index.js";

const MARKER = { "content-type": "application/json", "x-dsg-request": "1" };

function mount(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsg-test-"));
  const statePath = path.join(dir, "state.json");
  const routes = [];
  const tools = [];
  const services = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    llm: options.llm,
  };
  const base = {
    effect(fn) {
      return fn();
    },
    /* Mirrors cordis: a sub-plugin whose required service is absent never runs. */
    inject(names, callback) {
      if (!names.every((name) => services[name] !== undefined)) return undefined;
      const sub = { effect: (fn) => fn() };
      for (const name of names) sub[name] = services[name];
      return callback(sub);
    },
  };
  apply(base, { statePath });
  assert.equal(routes.length, 1, "the host half must register exactly one route");
  assert.equal(routes[0].path, "/dsh-sidebar-sessions");

  const server = http.createServer((req, res) => routes[0].handler(req, res));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        statePath,
        tools,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

test("state, rules, sync and consent work end to end", async () => {
  const host = await mount();
  try {
    const empty = await getJson(`${host.base}/dsh-sidebar-sessions/api/state`);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.ok, true);
    assert.equal(empty.body.state.version, 2);
    assert.equal(empty.body.meta.statePath, host.statePath);

    const rule = await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({ op: "rule.upsert", rule: { groupName: "简报", any: ["简报"], scheduleIds: ["schedule-1"] } }),
    });
    assert.equal(rule.status, 200);
    assert.equal(rule.body.state.rules.length, 1);
    assert.equal(fs.existsSync(host.statePath), true, "state must be written to disk");

    const synced = await getJson(`${host.base}/dsh-sidebar-sessions/api/sync`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({
        sessions: [{ id: "s1", title: "每日简报 · 2026-11-20" }],
        schedules: [{ id: "schedule-1", title: "每日 19:00 新闻简报", targetSessionId: "s1", deliveredAt: new Date().toISOString() }],
      }),
    });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.state.pending.s1.groupName, "简报");
    assert.equal(synced.body.state.assign.s1, undefined, "a proposal must not move the session yet");

    const accepted = await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({ op: "consent", sessionId: "s1", choice: "always" }),
    });
    const group = accepted.body.state.groups[0];
    assert.equal(accepted.body.state.assign.s1, group.id);
    assert.equal(accepted.body.state.autoAllow[group.id], 1);

    // The next session from the same task is grouped without asking.
    const second = await getJson(`${host.base}/dsh-sidebar-sessions/api/sync`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({
        sessions: [{ id: "s1", title: "每日简报 · 2026-11-20" }, { id: "s2", title: "每日简报 · 2026-11-21" }],
        schedules: [],
      }),
    });
    assert.equal(second.body.state.assign.s2, group.id);
    assert.equal(second.body.state.pending.s2, undefined);
  } finally {
    await host.close();
  }
});

test("writes without the marker header are refused", async () => {
  const host = await mount();
  try {
    const refused = await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "group.create", name: "x" }),
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.ok, false);

    const ok = await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({ op: "group.create", name: "x" }),
    });
    assert.equal(ok.status, 200);
  } finally {
    await host.close();
  }
});

test("a non-local Host header is refused", async () => {
  const host = await mount();
  try {
    // `fetch` refuses to override Host, so send a raw request the way a
    // DNS-rebinding page would.
    const status = await new Promise((resolve, reject) => {
      const url = new URL(`${host.base}/dsh-sidebar-sessions/api/state`);
      const request = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        }
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);

    const desktop = await new Promise((resolve, reject) => {
      const url = new URL(`${host.base}/dsh-sidebar-sessions/api/state`);
      const request = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: "app" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        }
      );
      request.on("error", reject);
      request.end();
    });
    assert.equal(desktop, 200, "the Desktop shell's forwarded requests must pass");
  } finally {
    await host.close();
  }
});

test("bad input comes back as a readable 400, not a crash", async () => {
  const host = await mount();
  try {
    const bad = await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({ op: "group.rename", groupId: "nope", name: "x" }),
    });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /分组不存在/);

    const notFound = await getJson(`${host.base}/dsh-sidebar-sessions/api/nope`);
    assert.equal(notFound.status, 404);
  } finally {
    await host.close();
  }
});

test("the session_group tool proposes but never assigns without consent", async () => {
  const host = await mount();
  try {
    await getJson(`${host.base}/dsh-sidebar-sessions/api/op`, {
      method: "POST",
      headers: MARKER,
      body: JSON.stringify({ op: "group.create", name: "In Falsus" }),
    });
    const tool = host.tools.find((definition) => definition.name === "session_group");
    assert.ok(tool, "the agent tool must be registered");

    const proposed = await tool.execute({ action: "propose", sessionId: "s9", groupName: "In Falsus" }, {});
    assert.equal(proposed.ok, true);
    assert.match(proposed.message, /确认/);

    const state = await getJson(`${host.base}/dsh-sidebar-sessions/api/state`);
    assert.equal(state.body.state.pending.s9.groupName, "In Falsus");
    assert.equal(state.body.state.assign.s9, undefined);

    const status = await tool.execute({ action: "status", sessionId: "s9" }, {});
    assert.match(status.message, /待用户确认/);
  } finally {
    await host.close();
  }
});
