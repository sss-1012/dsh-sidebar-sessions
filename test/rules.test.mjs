/*
 * Rules/ops tests for the host half. Run with `node test/rules.test.mjs`.
 * These cover the parts that decide what happens to a conversation, so a
 * regression here is the kind that silently moves someone's history.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOp,
  emptyState,
  normalizeRule,
  normalizeState,
  planProposals,
  pickRule,
  ruleMatches,
} from "../lib/rules.js";

const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function stateWith(overrides = {}) {
  return normalizeState({
    ...emptyState(),
    groups: [{ id: "g_a", name: "简报" }],
    ...overrides,
  });
}

test("normalizeRule rejects rules that would match everything", () => {
  assert.equal(normalizeRule({ groupName: "空" }), undefined);
  assert.equal(normalizeRule({ any: ["关键词"] }), undefined);
  const rule = normalizeRule({ groupName: " 组 ", any: "A，b\nA" });
  assert.equal(rule.groupName, "组");
  assert.deepEqual(rule.any, ["A", "b"]);
});

test("normalizeState drops dangling assignments and unknown groups", () => {
  const state = normalizeState({
    groups: [{ id: "g_1", name: "One" }, { id: "g_1", name: "dup" }],
    assign: { s1: "g_1", s2: "g_missing" },
    hiddenWorkspaces: ["w1", "w1"],
  });
  assert.deepEqual(state.groups, [{ id: "g_1", name: "One" }]);
  assert.deepEqual(state.assign, { s1: "g_1" });
  assert.deepEqual(state.hiddenWorkspaces, ["w1"]);
});

test("ruleMatches honours keywords and exclusions", () => {
  const rule = { any: ["日报", "简报"], none: ["广告"] };
  assert.equal(ruleMatches(rule, "每日简报 · 2026-11-20"), true);
  assert.equal(ruleMatches(rule, "日报里有广告"), false);
  assert.equal(ruleMatches(rule, "无关标题"), false);
  assert.equal(ruleMatches({ any: [] }, "任意标题"), false, "a schedule-only rule must not match every title");
});

test("pickRule prefers the schedule binding over the title", () => {
  const state = normalizeState({
    groups: [{ id: "g_a", name: "简报" }, { id: "g_b", name: "雷达" }],
    rules: [
      { id: "r_title", groupName: "简报", any: ["项目"] },
      { id: "r_sched", groupName: "雷达", scheduleIds: ["schedule-1"] },
    ],
  });
  const picked = pickRule(state, { id: "s1", title: "项目数据" }, { id: "schedule-1", title: "别的任务" });
  assert.equal(picked.id, "r_sched");
  assert.equal(pickRule(state, { id: "s2", title: "项目数据" }).id, "r_title");
});

test("planProposals asks before moving, unless the group is always-allowed", () => {
  const base = stateWith({
    rules: [{ id: "r1", groupName: "简报", any: ["简报"] }],
  });
  const sessions = [{ id: "s1", title: "每日简报 · 2026-11-20" }];

  const asked = planProposals(base, { sessions, schedules: [] }, T0);
  assert.equal(asked.changed, true);
  assert.equal(asked.state.assign.s1, undefined);
  assert.equal(asked.state.pending.s1.groupName, "简报");
  assert.equal(asked.applied.length, 0);

  const allowed = planProposals(stateWith({ ...base, autoAllow: { g_a: 1 } }), { sessions, schedules: [] }, T0);
  assert.equal(allowed.state.assign.s1, "g_a");
  assert.equal(allowed.state.pending.s1, undefined);
  assert.equal(allowed.applied.length, 1);
});

test("planProposals never revisits a session the human already handled", () => {
  const state = stateWith({ rules: [{ id: "r1", groupName: "简报", any: ["简报"] }] });
  for (const done of ["rejected", "deferred", "manual", "applied"]) {
    const once = planProposals({ ...state, autoDone: { s1: done } }, { sessions: [{ id: "s1", title: "简报" }] }, T0);
    assert.equal(once.changed, false, `autoDone=${done} must stay untouched`);
  }
});

test("planProposals only trusts a fresh scheduled delivery", () => {
  const state = stateWith({ rules: [{ id: "r1", groupName: "简报", scheduleIds: ["schedule-1"] }] });
  const sessions = [{ id: "s1", title: "分析 npm 与 GitHub 项目数据" }];
  const schedules = [{ id: "schedule-1", title: "每日 19:00 新闻简报", targetSessionId: "s1", deliveredAt: new Date(T0 - 1000).toISOString() }];
  const fresh = planProposals(state, { sessions, schedules }, T0);
  assert.equal(fresh.state.pending.s1.groupName, "简报");

  const stale = planProposals(state, { sessions }, T0);
  assert.equal(stale.changed, false, "an old delivery must not drag a session into a group");
});

test("consent: yes assigns, no rejects, always allow-lists, later defers", () => {
  const pending = { s1: { groupName: "简报", reason: "rule", at: null } };
  const base = stateWith({ pending });

  const yes = applyOp(base, { op: "consent", sessionId: "s1", choice: "yes" }, T0);
  assert.equal(yes.state.assign.s1, "g_a");
  assert.deepEqual(yes.state.pending, {});
  assert.equal(yes.state.autoDone.s1, "applied");

  const no = applyOp(base, { op: "consent", sessionId: "s1", choice: "no" }, T0);
  assert.equal(no.state.assign.s1, undefined);
  assert.equal(no.state.autoDone.s1, "rejected");

  const always = applyOp(base, { op: "consent", sessionId: "s1", choice: "always" }, T0);
  assert.equal(always.state.autoAllow.g_a, 1);
  assert.equal(always.state.assign.s1, "g_a");

  const later = applyOp(base, { op: "consent", sessionId: "s1", choice: "later" }, T0);
  assert.deepEqual(later.state.pending, {});
  assert.equal(later.state.autoDone.s1, "deferred");
});

test("consent creates the group when the rule only named one", () => {
  const base = stateWith({ pending: { s9: { groupName: "新组", reason: "llm", at: null } } });
  const result = applyOp(base, { op: "consent", sessionId: "s9", choice: "yes" }, T0);
  const group = result.state.groups.find((entry) => entry.name === "新组");
  assert.ok(group);
  assert.equal(result.state.assign.s9, group.id);
});

test("a stale consent click is a no-op instead of an error", () => {
  const base = stateWith({});
  const result = applyOp(base, { op: "consent", sessionId: "gone", choice: "yes" }, T0);
  assert.equal(result.state.assign.gone, undefined);
});

test("manual assignment wins and marks the session handled", () => {
  const base = stateWith({ pending: { s1: { groupName: "简报", reason: "rule", at: null } } });
  const result = applyOp(base, { op: "assign", sessionId: "s1", groupId: null }, T0);
  assert.equal(result.state.assign.s1, undefined);
  assert.deepEqual(result.state.pending, {});
  assert.equal(result.state.autoDone.s1, "manual");
});

test("deleting a group clears its sessions, allow-list entry and rules", () => {
  const base = stateWith({
    assign: { s1: "g_a" },
    autoAllow: { g_a: 1 },
    rules: [{ id: "r1", groupName: "简报", any: ["简报"] }],
  });
  const result = applyOp(base, { op: "group.delete", groupId: "g_a" }, T0);
  assert.deepEqual(result.state.groups, []);
  assert.deepEqual(result.state.assign, {});
  assert.deepEqual(result.state.autoAllow, {});
  assert.deepEqual(result.state.rules, []);
});

test("renaming a group renames the rules that target it", () => {
  const base = stateWith({ rules: [{ id: "r1", groupName: "简报", any: ["简报"] }] });
  const result = applyOp(base, { op: "group.rename", groupId: "g_a", name: "每日简报" }, T0);
  assert.equal(result.state.groups[0].name, "每日简报");
  assert.equal(result.state.rules[0].groupName, "每日简报");
});

test("LLM fallback needs a model, and its answer is only a proposal", () => {
  const base = stateWith({});
  assert.throws(() => applyOp(base, { op: "setting", classifier: { mode: "llm" } }, T0));
  const saved = applyOp(base, { op: "setting", classifier: { mode: "llm", provider: "p", model: "m" } }, T0);
  assert.equal(saved.state.settings.classifier.mode, "llm");

  const proposed = applyOp(saved.state, { op: "llm.proposal", sessionId: "s1", groupName: "简报" }, T0);
  assert.equal(proposed.state.pending.s1.reason, "llm");
  assert.equal(proposed.state.assign.s1, undefined);
});

test("import from the localStorage era runs once and keeps the user's groups", () => {
  const legacy = {
    groups: [{ id: "g_old", name: "旧组" }],
    assign: { s1: "g_old" },
    autoRules: [{ groupName: "旧组", any: ["旧"] }],
    order: { recent: ["s1"] },
  };
  const fresh = normalizeState(emptyState());
  const imported = applyOp(fresh, { op: "import", state: legacy }, T0);
  assert.equal(imported.state.imported, true);
  assert.equal(imported.state.assign.s1, "g_old");
  assert.equal(imported.state.rules[0].any[0], "旧");

  const again = applyOp({ ...imported.state, assign: {} }, { op: "import", state: legacy }, T0);
  assert.equal(again.skipped, true, "a second import must not resurrect old assignments");
});

test("only fresh conversations get a suggestion", () => {
  const state = stateWith({ rules: [{ id: "r1", groupName: "简报", any: ["简报"] }] });
  const old = planProposals(
    state,
    { sessions: [{ id: "s_old", title: "旧简报归档", createdAt: T0 - 5 * DAY }] },
    T0
  );
  assert.equal(old.changed, false, "history must not be re-sorted on upgrade");

  const fresh = planProposals(
    state,
    { sessions: [{ id: "s_new", title: "今天的简报", createdAt: T0 - 60_000 }] },
    T0
  );
  assert.equal(fresh.state.pending.s_new.groupName, "简报");
});

test("one rule per scheduled task: rebinding replaces the old rule", () => {
  const base = stateWith({
    rules: [{ id: "r_old", groupName: "简报", scheduleIds: ["schedule-1"] }],
  });
  const result = applyOp(base, { op: "rule.upsert", rule: { groupName: "雷达", scheduleIds: ["schedule-1"] } }, T0);
  assert.equal(result.state.rules.length, 1);
  assert.equal(result.state.rules[0].groupName, "雷达");
});
