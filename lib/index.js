/* dsh-sidebar-sessions — host half.
 *
 * Grouping state used to live in the browser's localStorage, which meant the
 * Web GUI (http://127.0.0.1:3080) and the Desktop app (dsh-app://app) saw two
 * unrelated copies, and a scheduled task that ran while the GUI was closed left
 * its session ungrouped until someone opened the sidebar.
 *
 * This half owns one JSON file instead, and the client reaches it over the
 * host webserver. Both shells serve that file from the same origin-independent
 * path: Desktop forwards every `dsh-app://app/<path>` request to the same HTTP
 * host, so a plain relative `fetch('/dsh-sidebar-sessions/api/...')` works in
 * both without an extra bridge.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyOp, emptyState, normalizeRule, normalizeState, planProposals } from "./rules.js";

export const name = "dsh-sidebar-sessions";

/** Route prefix owned by this plugin; the client hard-codes the same base. */
const API_BASE = "/dsh-sidebar-sessions/api";

/** Marker header on writes: a cross-origin page cannot add it without a preflight. */
const WRITE_HEADER = "x-dsg-request";

const MAX_BODY_BYTES = 256 * 1024;

/** Hosts we answer for: the request must name this machine (kills DNS rebinding). */
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0", "[::]"]);
/** Names the Desktop shell presents when it forwards a request. */
const DESKTOP_HOSTS = new Set(["app", "dsh-app"]);

const LLM_TIMEOUT_MS = 25_000;
const LLM_MAX_PER_SYNC = 3;
const LLM_MIN_TITLE_LENGTH = 4;

function isLocalHost(hostHeader) {
  const host = String(hostHeader || "").toLowerCase().trim();
  if (!host) return false;
  if (DESKTOP_HOSTS.has(host)) return true;
  const bare = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOCAL_HOSTNAMES.has(bare);
}

function sendJson(res, status, value) {
  const payload = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求体必须是 JSON 对象");
  return value;
}

/** Atomic replace so a crash mid-write never truncates the state file. */
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function defaultStatePath() {
  const home = (process.env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
  return path.join(home, "sidebar-sessions", "state.json");
}

/**
 * The state file is the single authority: every read re-parses it and every
 * write is a read-modify-write. Two shells (Web and Desktop) may be open at
 * once, and a long-lived in-memory copy would clobber the other one.
 */
class Store {
  constructor(file) {
    this.file = file;
  }

  read() {
    try {
      const text = fs.readFileSync(this.file, "utf8");
      return normalizeState(JSON.parse(text));
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        try {
          console.warn("[dsh-sidebar-sessions] state unreadable, starting empty:", error.message);
        } catch {}
      }
      return normalizeState(emptyState());
    }
  }

  write(state) {
    try {
      writeFileAtomic(this.file, JSON.stringify(state, null, 2));
    } catch (error) {
      try {
        console.warn("[dsh-sidebar-sessions] state write failed:", error.message);
      } catch {}
      throw error;
    }
    return state;
  }

  /** Read-modify-write through a reducer. */
  update(reducer) {
    const outcome = reducer(this.read());
    if (outcome && outcome.state && outcome.changed !== false) this.write(outcome.state);
    return outcome;
  }
}

let warnedNoWebServer = false;

function installRoutes(webServer, deps) {
  if (!webServer || typeof webServer.register !== "function") {
    if (!warnedNoWebServer) {
      warnedNoWebServer = true;
      try {
        console.warn("[dsh-sidebar-sessions] no webServer service; the sidebar falls back to localStorage");
      } catch {}
    }
    return () => {};
  }
  const collapse = (state) => ({
    ...state,
    // Virtual groups are a display concern; keep the wire payload honest.
    virtualGroups: undefined,
  });
  const statePayload = (state, extra) => ({ ok: true, state: collapse(state), ...extra });

  const dispose = webServer.register({
    kind: "prefix",
    path: "/dsh-sidebar-sessions",
    handler: async (req, res) => {
      try {
        const store = deps.store;
        if (!isLocalHost(req.headers && req.headers.host)) return sendJson(res, 403, { ok: false, error: "forbidden" });
        const pathname = new URL(req.url || "/", "http://local").pathname;
        if (req.method === "POST") {
          const marker = req.headers && req.headers[WRITE_HEADER];
          if (marker !== "1") return sendJson(res, 403, { ok: false, error: "missing request marker" });
          const origin = String((req.headers && req.headers.origin) || "");
          if (origin && !isLocalHost(origin.replace(/^https?:\/\//, ""))) {
            return sendJson(res, 403, { ok: false, error: "bad origin" });
          }
        }

        if (pathname === `${API_BASE}/state` && req.method === "GET") {
          const state = store.read();
          return sendJson(res, 200, statePayload(state, { meta: { statePath: store.file } }));
        }

        if (pathname === `${API_BASE}/models` && req.method === "GET") {
          return sendJson(res, 200, { ok: true, ...(await collectModels(deps.llmRef.current)) });
        }

        if (pathname === `${API_BASE}/sync` && req.method === "POST") {
          const body = await readJson(req);
          const sessions = Array.isArray(body.sessions) ? body.sessions : [];
          const schedules = Array.isArray(body.schedules) ? body.schedules : [];
          const outcome = store.update((current) => {
            const planned = planProposals(current, { sessions, schedules });
            return { state: planned.state, changed: planned.changed, planned };
          });
          scheduleLlmSuggestions(deps, sessions);
          const state = store.read();
          return sendJson(res, 200, statePayload(state, {
            meta: { statePath: store.file, proposed: outcome.planned ? outcome.planned.proposed : [], applied: outcome.planned ? outcome.planned.applied : [] },
          }));
        }

        if (pathname === `${API_BASE}/op` && req.method === "POST") {
          const body = await readJson(req);
          const result = deps.store.update((current) => applyOp(current, body));
          return sendJson(res, 200, statePayload(result.state, { applied: result.applied === true }));
        }

        return sendJson(res, 404, { ok: false, error: "not found" });
      } catch (error) {
        const message = error && error.message ? error.message : "request failed";
        try {
          console.warn("[dsh-sidebar-sessions] route error:", message);
        } catch {}
        if (!res.headersSent) sendJson(res, 400, { ok: false, error: message });
        else {
          try {
            res.end();
          } catch {}
        }
      }
    },
  });
  return typeof dispose === "function" ? dispose : () => {};
}

async function collectModels(llm) {
  if (!llm || typeof llm.listProviders !== "function") return { providers: [] };
  try {
    const providers = await llm.listProviders();
    const rows = [];
    for (const provider of Array.isArray(providers) ? providers : []) {
      const id = String((provider && (provider.id || provider.name || provider.provider)) || "");
      if (!id) continue;
      let models = [];
      try {
        if (typeof llm.listModels === "function") models = await llm.listModels(id);
      } catch {}
      rows.push({
        id,
        name: String((provider && provider.name) || id),
        models: (Array.isArray(models) ? models : []).map((model) => ({
          id: String((model && (model.id || model.name)) || ""),
          name: String((model && (model.name || model.id)) || ""),
        })).filter((model) => model.id),
      });
    }
    return { providers: rows };
  } catch {
    return { providers: [] };
  }
}

/* ------------------------------------------------------------------ *
 * Optional LLM fallback: when no rule explains a new session, ask a
 * small model once. Its answer is only ever a proposal — the human still
 * answers the consent bar, unless the group is on the "always allow" list.
 * ------------------------------------------------------------------ */

const llmInFlight = new Set();
let llmLastCallAt = 0;

function llmPrompt(groups, sessions) {
  const groupList = groups.map((group) => `- ${group.name}`).join("\n");
  const sessionList = sessions.map((session) => `- ${session.id} :: ${session.title}`).join("\n");
  return [
    "你在给对话列表归组。下面给出已有分组和若干新会话标题。",
    "对每个会话判断它最像哪个分组；拿不准就不要选。",
    "",
    "分组：",
    groupList,
    "",
    "会话：",
    sessionList,
    "",
    '只输出一行 JSON，形如 {"<sessionId>":"<分组名>"}；不要输出任何解释或代码块。',
  ].join("\n");
}

function parseLlmAnswer(text, groups, sessions) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const names = new Set(groups.map((group) => group.name));
  const ids = new Set(sessions.map((session) => session.id));
  const out = [];
  for (const [sessionId, groupName] of Object.entries(parsed)) {
    if (!ids.has(sessionId)) continue;
    const name = String(groupName || "").trim();
    if (!names.has(name)) continue;
    out.push({ sessionId, groupName: name });
  }
  return out;
}

function scheduleLlmSuggestions(deps, sessions) {
  const llm = deps.llmRef.current;
  const store = deps.store;
  const state = store.read();
  if (!llm || typeof llm.stream !== "function") return;
  const classifier = state.settings.classifier;
  if (classifier.mode !== "llm" || !classifier.provider || !classifier.model) return;
  if (state.groups.length === 0) return;
  if (Date.now() - llmLastCallAt < 20_000) return;
  const candidates = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = session && session.id ? String(session.id) : "";
    const title = String((session && session.title) || "").trim();
    if (!id || title.length < LLM_MIN_TITLE_LENGTH) continue;
    if (state.assign[id] || state.autoDone[id] || state.pending[id]) continue;
    if (llmInFlight.has(id)) continue;
    candidates.push({ id, title });
    if (candidates.length >= LLM_MAX_PER_SYNC) break;
  }
  if (candidates.length === 0) return;
  llmLastCallAt = Date.now();
  for (const candidate of candidates) llmInFlight.add(candidate.id);
  const finish = () => {
    for (const candidate of candidates) llmInFlight.delete(candidate.id);
  };
  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      let text = "";
      const stream = llm.stream({
        provider: classifier.provider,
        model: classifier.model,
        messages: [{ role: "user", content: [{ type: "text", text: llmPrompt(state.groups, candidates) }] }],
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (!chunk) continue;
        if (chunk.type === "text-delta") text += String(chunk.text ?? chunk.delta ?? "");
        else if (chunk.type === "text" && chunk.text) text += String(chunk.text);
      }
      for (const suggestion of parseLlmAnswer(text, state.groups, candidates)) {
        try {
          store.update((current) => applyOp(current, { op: "llm.proposal", sessionId: suggestion.sessionId, groupName: suggestion.groupName }));
        } catch {}
      }
    } catch (error) {
      try {
        console.warn("[dsh-sidebar-sessions] llm classifier failed:", error && error.message);
      } catch {}
    } finally {
      clearTimeout(timer);
      finish();
    }
  })();
}

/* ------------------------------------------------------------------ *
 * Agent tool: the agent may propose a group, but never outvote the human.
 * ------------------------------------------------------------------ */

function registerTool(tools, store) {
  if (!tools || typeof tools.register !== "function") return () => {};
  const definition = {
    name: "session_group",
    description:
      "Manage conversation groups in the sidebar. `list` shows groups, rules and pending proposals; `propose` suggests putting a conversation into a group (the human answers a consent bar, unless that group is already on the always-allow list); `status` reports where one conversation stands. Use it after finishing a scheduled task whose new conversation belongs in a fixed group.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "propose", "status"], description: "Operation to perform." },
        sessionId: {
          type: "string",
          description: "Target conversation id. Omit to use the current conversation (DSH_SESSION_ID).",
        },
        groupName: { type: "string", description: "Group to propose. Created on consent if it does not exist yet." },
        reason: { type: "string", description: "Optional one-line reason shown in the consent bar." },
      },
      required: ["action"],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          message: { type: "string" },
          groups: { type: "array", items: { type: "string" } },
          pending: { type: "array", items: { type: "string" } },
        },
      },
      render: (_args, value) => [{ type: "text", text: String((value && value.message) || "完成") }],
    },
    async execute(args, exec) {
      const state = store.read();
      const action = String(args.action || "");
      const sessionId = String(args.sessionId || (exec && exec.agent && exec.agent.sessionId) || "");
      if (action === "list") {
        return {
          ok: true,
          groups: state.groups.map((group) => group.name),
          rules: state.rules.map((rule) => ({ id: rule.id, groupName: rule.groupName, any: rule.any, schedules: rule.scheduleIds.length })),
          pending: Object.entries(state.pending).map(([id, proposal]) => `${id} → ${proposal.groupName}`),
          message:
            `分组：${state.groups.map((group) => group.name).join("、") || "（无）"}；` +
            `规则 ${state.rules.length} 条；待确认 ${Object.keys(state.pending).length} 条。`,
        };
      }
      if (action === "status") {
        if (!sessionId) return { ok: false, message: "需要 sessionId" };
        const groupId = state.assign[sessionId];
        const group = state.groups.find((entry) => entry.id === groupId);
        const proposal = state.pending[sessionId];
        const done = state.autoDone[sessionId];
        return {
          ok: true,
          groups: group ? [group.name] : [],
          pending: proposal ? [proposal.groupName] : [],
          message: group
            ? `已在分组「${group.name}」`
            : proposal
              ? `待用户确认：是否归入「${proposal.groupName}」`
              : done
                ? `用户已处理过（${done}），不再自动归类`
                : "未分组，也没有待确认建议",
        };
      }
      if (action === "propose") {
        if (!sessionId) return { ok: false, message: "需要 sessionId" };
        const groupName = String(args.groupName || "").trim();
        if (!groupName) return { ok: false, message: "需要 groupName" };
        const result = store.update((current) => applyOp(current, { op: "propose", sessionId, groupName }));
        if (result && result.skipped === "assigned") return { ok: true, message: "该会话已经在分组里，未改动。" };
        if (result && result.applied === true) return { ok: true, message: `已归入「${groupName}」（该组已在白名单，无需确认）。` };
        return { ok: true, message: `已提交建议：把该会话归入「${groupName}」。等用户在侧栏许可条上确认后才生效。` };
      }
      return { ok: false, message: `未知 action：${action}` };
    },
  };
  const dispose = tools.register(definition);
  return typeof dispose === "function" ? dispose : () => {};
}

export function apply(ctx, config) {
  const file = (config && config.statePath) || process.env.DSH_SIDEBAR_SESSIONS_STATE || defaultStatePath();
  const deps = { store: new Store(file), llmRef: { current: undefined } };

  /* Services must be injected before use: cordis raises "cannot get property
   * without inject" on an undeclared access, and a headless profile may have
   * no webServer or llm at all. Each sub-plugin simply waits for its service. */
  ctx.inject(["llm"], (llmCtx) => {
    deps.llmRef.current = llmCtx.llm;
    llmCtx.effect(() => () => {
      deps.llmRef.current = undefined;
    }, "dsh-sidebar-sessions: llm handle");
  });

  ctx.inject(["webServer"], (webCtx) => {
    webCtx.effect(() => installRoutes(webCtx.webServer, deps), "dsh-sidebar-sessions: grouping api");
  });

  ctx.inject(["tools"], (toolCtx) => {
    toolCtx.effect(() => registerTool(toolCtx.tools, deps.store), "dsh-sidebar-sessions: session_group tool");
  });
}
