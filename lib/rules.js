/* dsh-sidebar-sessions — shared, side-effect-free state rules.
 *
 * One authority for grouping state lives here so the host route, the agent
 * tool, and the tests all reduce the same operations the same way. Nothing in
 * this module touches the filesystem, the network, or a clock of its own: the
 * caller passes `now` whenever a decision depends on time.
 */

/** Bumped whenever the persisted shape changes incompatibly. */
export const STORE_VERSION = 2;

/**
 * How long after a scheduled delivery its target session is still considered
 * "created by that task". Wide enough for a task that runs while the GUI is
 * closed, narrow enough that a twenty-day-old session is never pulled in.
 */
export const FRESH_DELIVERY_MS = 24 * 60 * 60 * 1000;

/**
 * How old a conversation may be and still get a suggestion. Without this,
 * switching on a keyword rule would ask about every historical conversation
 * that ever matched it; the point is the newest chat, not a re-sort of history.
 */
export const PROPOSAL_MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** Longest group name / title fragment we persist. */
export const MAX_NAME_LENGTH = 30;

/** A rule with no keywords and no schedule binding would swallow every session. */
const MAX_KEYWORDS = 24;
const MAX_KEYWORD_LENGTH = 40;

export function emptyState() {
  return {
    version: STORE_VERSION,
    groups: [],
    assign: {},
    autoDone: {},
    autoAllow: {},
    pending: {},
    rules: [],
    settings: { classifier: { mode: "off", provider: "", model: "" } },
    order: {},
    collapsed: {},
    hiddenWorkspaces: [],
    activeWorkspace: null,
    imported: false,
    updatedAt: null,
  };
}

export function newGroupId() {
  return "g_" + Math.random().toString(36).slice(2, 9);
}

export function newRuleId() {
  return "r_" + Math.random().toString(36).slice(2, 9);
}

export function cleanName(value) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, MAX_NAME_LENGTH);
}

function keywordList(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item === undefined || item === null ? "" : item).trim().slice(0, MAX_KEYWORD_LENGTH);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function idList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => String(item)).filter(Boolean))];
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** A rule as persisted: at least one of `any` / `scheduleIds` must be present. */
export function normalizeRule(raw, fallbackId) {
  const source = plainObject(raw);
  const groupName = cleanName(source.groupName || source.name);
  const any = keywordList(source.any || source.keywords);
  const none = keywordList(source.none || source.exclude);
  const scheduleIds = idList(source.scheduleIds);
  const scheduleTitles = keywordList(source.scheduleTitles);
  if (!groupName) return undefined;
  if (any.length === 0 && scheduleIds.length === 0 && scheduleTitles.length === 0) return undefined;
  return {
    id: String(source.id || fallbackId || newRuleId()),
    groupName,
    any,
    none,
    scheduleIds,
    scheduleTitles,
  };
}

/**
 * Bring any persisted or imported payload up to the current shape. Unknown
 * fields are dropped; missing ones get defaults, so a state file written by an
 * older release keeps working after an upgrade.
 */
export function normalizeState(raw) {
  const base = emptyState();
  const source = plainObject(raw);
  const groups = [];
  const groupIds = new Set();
  for (const entry of Array.isArray(source.groups) ? source.groups : []) {
    const name = cleanName(plainObject(entry).name);
    const id = String(plainObject(entry).id || "");
    if (!name || !id || groupIds.has(id)) continue;
    groupIds.add(id);
    groups.push({ id, name });
  }
  const assign = {};
  const rawAssign = plainObject(source.assign);
  for (const [sessionId, groupId] of Object.entries(rawAssign)) {
    const gid = String(groupId);
    if (groupIds.has(gid)) assign[String(sessionId)] = gid;
  }
  const autoDone = {};
  for (const [sessionId, value] of Object.entries(plainObject(source.autoDone))) {
    const text = typeof value === "string" ? value : value ? "applied" : "";
    if (text) autoDone[String(sessionId)] = text;
  }
  const autoAllow = {};
  for (const [groupId, value] of Object.entries(plainObject(source.autoAllow))) {
    if (value && groupIds.has(String(groupId))) autoAllow[String(groupId)] = 1;
  }
  const pending = {};
  for (const [sessionId, value] of Object.entries(plainObject(source.pending))) {
    const entry = plainObject(value);
    const groupId = entry.groupId && groupIds.has(String(entry.groupId)) ? String(entry.groupId) : undefined;
    const groupName = cleanName(entry.groupName);
    if (!groupId && !groupName) continue;
    if (assign[String(sessionId)] || autoDone[String(sessionId)]) continue;
    pending[String(sessionId)] = {
      groupId,
      groupName: groupId ? baseGroupName(groups, groupId) || groupName : groupName,
      reason: ["rule", "llm", "agent"].includes(entry.reason) ? entry.reason : "rule",
      at: typeof entry.at === "string" ? entry.at : null,
    };
  }
  const rules = [];
  const ruleIds = new Set();
  for (const entry of Array.isArray(source.rules) ? source.rules : []) {
    const rule = normalizeRule(entry);
    if (!rule || ruleIds.has(rule.id)) continue;
    ruleIds.add(rule.id);
    rules.push(rule);
  }
  const settings = plainObject(source.settings);
  const classifier = plainObject(settings.classifier);
  const order = {};
  for (const [key, value] of Object.entries(plainObject(source.order))) {
    if (Array.isArray(value)) order[String(key)] = value.map((id) => String(id));
  }
  const collapsed = {};
  for (const [key, value] of Object.entries(plainObject(source.collapsed))) {
    if (value) collapsed[String(key)] = true;
  }
  return {
    version: STORE_VERSION,
    groups,
    assign,
    autoDone,
    autoAllow,
    pending,
    rules,
    settings: {
      classifier: {
        mode: classifier.mode === "llm" ? "llm" : "off",
        provider: String(classifier.provider || ""),
        model: String(classifier.model || ""),
      },
    },
    order,
    collapsed,
    hiddenWorkspaces: Array.isArray(source.hiddenWorkspaces) ? idList(source.hiddenWorkspaces) : [],
    activeWorkspace:
      source.activeWorkspace === null || source.activeWorkspace === undefined ? null : String(source.activeWorkspace),
    imported: source.imported === true,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
  };
}

function baseGroupName(groups, groupId) {
  const found = groups.find((group) => group.id === groupId);
  return found ? found.name : "";
}

export function groupByName(state, name) {
  const wanted = cleanName(name);
  if (!wanted) return undefined;
  return state.groups.find((group) => group.name === wanted);
}

function ensureGroup(state, name) {
  const wanted = cleanName(name);
  if (!wanted) return undefined;
  const existing = state.groups.find((group) => group.name === wanted);
  if (existing) return existing;
  const created = { id: newGroupId(), name: wanted };
  state.groups.push(created);
  return created;
}

/**
 * True when `text` satisfies a rule's keyword lists. A rule with no keywords
 * never matches by text: it is bound to a scheduled task, and letting an empty
 * `any` mean "everything" would pull every conversation into that group.
 */
export function ruleMatches(rule, text) {
  if (!rule) return false;
  const any = Array.isArray(rule.any) ? rule.any : [];
  if (any.length === 0) return false;
  const hay = String(text || "").toLowerCase();
  if (!hay) return false;
  const none = Array.isArray(rule.none) ? rule.none : [];
  if (none.some((word) => hay.includes(String(word).toLowerCase()))) return false;
  return any.some((word) => hay.includes(String(word).toLowerCase()));
}

/**
 * Pick the rule that explains a session. A schedule binding wins over title
 * keywords: the delivery record is a fact, a title is a guess.
 * @param state - normalized state.
 * @param session - `{ id, title }` as the client reported it.
 * @param schedule - optional `{ id, title, deliveredAt }` of the delivery that
 *   created this session, already filtered to a fresh delivery.
 */
export function pickRule(state, session, schedule) {
  const rules = state.rules || [];
  const title = String((session && session.title) || "");
  if (schedule) {
    const byId = rules.find((rule) => (rule.scheduleIds || []).includes(String(schedule.id)));
    if (byId) return byId;
    const byTitle = rules.find((rule) => ruleMatches(rule, schedule.title));
    if (byTitle) return byTitle;
  }
  return rules.find((rule) => ruleMatches(rule, title));
}

/**
 * Compute the proposals the current session list deserves.
 *
 * Applied silently when the target group is on the "always allow" list;
 * otherwise the proposal waits for a human answer. A session is proposed at
 * most once: `autoDone` records every session we acted on or dismissed, so a
 * manually moved session is never dragged back.
 */
export function planProposals(state, input, now = Date.now()) {
  const sessions = Array.isArray(input && input.sessions) ? input.sessions : [];
  const schedules = Array.isArray(input && input.schedules) ? input.schedules : [];
  const fresh = new Map();
  for (const entry of schedules) {
    const sessionId = entry && entry.targetSessionId ? String(entry.targetSessionId) : "";
    if (!sessionId) continue;
    const at = Date.parse(entry.deliveredAt || "");
    if (!Number.isFinite(at) || now - at > FRESH_DELIVERY_MS) continue;
    fresh.set(sessionId, { id: String(entry.id || ""), title: String(entry.title || ""), deliveredAt: entry.deliveredAt });
  }
  const next = { ...state, groups: [...state.groups], assign: { ...state.assign }, autoDone: { ...state.autoDone }, pending: { ...state.pending } };
  const applied = [];
  const proposed = [];
  for (const session of sessions) {
    const id = session && session.id ? String(session.id) : "";
    if (!id) continue;
    if (next.assign[id] || next.autoDone[id] || next.pending[id]) continue;
    const created = Number(session.createdAt ?? session.updatedAt);
    if (Number.isFinite(created) && created > 0 && now - created > PROPOSAL_MAX_AGE_MS) continue;
    const rule = pickRule(next, session, fresh.get(id));
    if (!rule) continue;
    const group = next.groups.find((entry) => entry.name === rule.groupName);
    if (group && next.autoAllow[group.id]) {
      next.assign[id] = group.id;
      next.autoDone[id] = "applied";
      applied.push({ sessionId: id, groupId: group.id, groupName: group.name, ruleId: rule.id });
      continue;
    }
    next.pending[id] = {
      groupId: group ? group.id : undefined,
      groupName: rule.groupName,
      reason: "rule",
      at: new Date(now).toISOString(),
    };
    proposed.push({ sessionId: id, groupName: rule.groupName, ruleId: rule.id });
  }
  const changed = applied.length > 0 || proposed.length > 0;
  return { state: changed ? next : state, applied, proposed, changed };
}

function requireSessionId(op) {
  const sessionId = op && op.sessionId ? String(op.sessionId) : "";
  if (!sessionId) throw new Error("缺少 sessionId");
  return sessionId;
}

function touch(state, now) {
  return { ...state, updatedAt: new Date(now).toISOString() };
}

/**
 * Reduce one UI/agent operation into the next state.
 *
 * Pure: the caller persists what comes back. A rejected operation returns the
 * unchanged state plus an error, never a half-applied change.
 */
export function applyOp(state, op, now = Date.now()) {
  const base = normalizeState(state);
  const action = op && op.op;
  const next = {
    ...base,
    groups: [...base.groups],
    assign: { ...base.assign },
    autoDone: { ...base.autoDone },
    autoAllow: { ...base.autoAllow },
    pending: { ...base.pending },
    rules: [...base.rules],
    settings: { classifier: { ...base.settings.classifier } },
    order: { ...base.order },
    collapsed: { ...base.collapsed },
    hiddenWorkspaces: [...base.hiddenWorkspaces],
  };
  switch (action) {
    case "assign": {
      const sessionId = requireSessionId(op);
      const groupId = op.groupId ? String(op.groupId) : "";
      if (groupId && !next.groups.some((group) => group.id === groupId)) throw new Error("分组不存在");
      if (groupId) next.assign[sessionId] = groupId;
      else delete next.assign[sessionId];
      delete next.pending[sessionId];
      next.autoDone[sessionId] = "manual";
      return { state: touch(next, now) };
    }
    case "consent": {
      const sessionId = requireSessionId(op);
      const proposal = next.pending[sessionId];
      const choice = String(op.choice || "");
      if (!proposal) {
        // Nothing pending: a stale click after another window applied it.
        return { state: touch(next, now) };
      }
      if (choice === "no") {
        delete next.pending[sessionId];
        next.autoDone[sessionId] = "rejected";
        return { state: touch(next, now) };
      }
      if (choice === "later") {
        delete next.pending[sessionId];
        next.autoDone[sessionId] = "deferred";
        return { state: touch(next, now) };
      }
      if (choice !== "yes" && choice !== "always") throw new Error("未知的许可选项");
      const group = ensureGroup(next, proposal.groupName);
      if (!group) throw new Error("分组名为空");
      next.assign[sessionId] = group.id;
      delete next.pending[sessionId];
      next.autoDone[sessionId] = "applied";
      if (choice === "always") next.autoAllow[group.id] = 1;
      return { state: touch(next, now) };
    }
    case "group.create": {
      const name = cleanName(op.name);
      if (!name) throw new Error("分组名不能为空");
      if (next.groups.some((group) => group.name === name)) throw new Error("分组已存在");
      const group = { id: newGroupId(), name };
      next.groups.push(group);
      if (op.sessionId) {
        next.assign[String(op.sessionId)] = group.id;
        delete next.pending[String(op.sessionId)];
        next.autoDone[String(op.sessionId)] = "manual";
      }
      return { state: touch(next, now) };
    }
    case "group.rename": {
      const name = cleanName(op.name);
      if (!name) throw new Error("分组名不能为空");
      const group = next.groups.find((entry) => entry.id === String(op.groupId));
      if (!group) throw new Error("分组不存在");
      if (next.groups.some((entry) => entry.name === name && entry.id !== group.id)) throw new Error("分组名重复");
      const previous = group.name;
      group.name = name;
      for (const rule of next.rules) if (rule.groupName === previous) rule.groupName = name;
      return { state: touch(next, now) };
    }
    case "group.delete": {
      const groupId = String(op.groupId || "");
      const group = next.groups.find((entry) => entry.id === groupId);
      if (!group) throw new Error("分组不存在");
      next.groups = next.groups.filter((entry) => entry.id !== groupId);
      for (const [sessionId, assigned] of Object.entries(next.assign)) if (assigned === groupId) delete next.assign[sessionId];
      delete next.autoAllow[groupId];
      for (const [sessionId, proposal] of Object.entries(next.pending)) if (proposal.groupId === groupId) delete next.pending[sessionId];
      next.rules = next.rules.filter((rule) => rule.groupName !== group.name);
      for (const key of ["g:" + groupId]) delete next.order[key];
      return { state: touch(next, now) };
    }
    case "rule.upsert": {
      const rule = normalizeRule(op.rule);
      if (!rule) throw new Error("规则至少需要一个关键词或一条定时任务");
      /* One rule per scheduled task: a second binding for the same task would
       * make which group wins depend on array order. */
      if (rule.scheduleIds.length > 0) {
        next.rules = next.rules.filter(
          (entry) => entry.id === rule.id || !entry.scheduleIds.some((id) => rule.scheduleIds.includes(id))
        );
      }
      const at = next.rules.findIndex((entry) => entry.id === rule.id);
      if (at >= 0) next.rules[at] = rule;
      else next.rules.push(rule);
      return { state: touch(next, now) };
    }
    case "rule.delete": {
      const ruleId = String(op.ruleId || "");
      next.rules = next.rules.filter((rule) => rule.id !== ruleId);
      return { state: touch(next, now) };
    }
    case "setting": {
      const classifier = plainObject(op.classifier);
      const mode = classifier.mode === "llm" ? "llm" : "off";
      const provider = String(classifier.provider || "");
      const model = String(classifier.model || "");
      if (mode === "llm" && (!provider || !model)) throw new Error("开启 LLM 兜底需要先选模型");
      next.settings.classifier = { mode, provider, model };
      return { state: touch(next, now) };
    }
    case "autoAllow.revoke": {
      const groupId = String(op.groupId || "");
      if (!groupId) throw new Error("缺少 groupId");
      delete next.autoAllow[groupId];
      return { state: touch(next, now) };
    }
    case "forget": {
      const sessionId = requireSessionId(op);
      delete next.autoDone[sessionId];
      delete next.pending[sessionId];
      return { state: touch(next, now) };
    }
    case "order.set": {
      const key = String(op.key || "");
      if (!key) throw new Error("缺少排序键");
      next.order[key] = idList(op.ids);
      return { state: touch(next, now) };
    }
    case "order.clear": {
      delete next.order[String(op.key || "")];
      return { state: touch(next, now) };
    }
    case "collapsed": {
      const key = String(op.key || "");
      if (!key) throw new Error("缺少折叠键");
      if (op.value) next.collapsed[key] = true;
      else delete next.collapsed[key];
      return { state: touch(next, now) };
    }
    case "workspaces.hidden": {
      next.hiddenWorkspaces = idList(op.ids);
      return { state: touch(next, now) };
    }
    case "workspace.active": {
      next.activeWorkspace = op.id === null || op.id === undefined ? null : String(op.id);
      return { state: touch(next, now) };
    }
    case "import": {
      if (next.imported) return { state: base, skipped: true };
      const legacy = plainObject(op.state);
      const merged = normalizeState({
        ...next,
        groups: Array.isArray(legacy.groups) ? legacy.groups : next.groups,
        assign: { ...(plainObject(legacy.assign) || {}), ...next.assign },
        order: { ...(plainObject(legacy.order) || {}), ...next.order },
        collapsed: { ...(plainObject(legacy.collapsed) || {}), ...next.collapsed },
        hiddenWorkspaces: Array.isArray(legacy.hiddenWorkspaces) ? legacy.hiddenWorkspaces : next.hiddenWorkspaces,
        activeWorkspace: legacy.activeWorkspace === undefined ? next.activeWorkspace : legacy.activeWorkspace,
        autoDone: { ...(plainObject(legacy.autoDone) || {}), ...next.autoDone },
        rules: next.rules.length > 0 ? next.rules : legacyRules(legacy),
      });
      merged.imported = true;
      return { state: touch(merged, now) };
    }
    case "llm.proposal": {
      // Produced by the host when the classifier answered; the human still has
      // to consent, so this only fills the pending slot.
      const sessionId = requireSessionId(op);
      const groupName = cleanName(op.groupName);
      if (!groupName) throw new Error("分组名为空");
      const group = groupByName(next, groupName);
      if (group && next.autoAllow[group.id]) {
        next.assign[sessionId] = group.id;
        next.autoDone[sessionId] = "applied";
        delete next.pending[sessionId];
        return { state: touch(next, now), applied: true };
      }
      next.pending[sessionId] = { groupId: group ? group.id : undefined, groupName, reason: "llm", at: new Date(now).toISOString() };
      return { state: touch(next, now) };
    }
    case "propose": {
      const sessionId = requireSessionId(op);
      const groupName = cleanName(op.groupName);
      if (!groupName) throw new Error("分组名为空");
      if (next.assign[sessionId]) return { state: base, skipped: "assigned" };
      const group = groupByName(next, groupName);
      if (group && next.autoAllow[group.id]) {
        next.assign[sessionId] = group.id;
        next.autoDone[sessionId] = "applied";
        delete next.pending[sessionId];
        return { state: touch(next, now), applied: true, groupId: group.id };
      }
      next.pending[sessionId] = { groupId: group ? group.id : undefined, groupName, reason: "agent", at: new Date(now).toISOString() };
      return { state: touch(next, now), applied: false };
    }
    default:
      throw new Error("未知操作：" + String(action));
  }
}

/** Legacy `autoRules` (v1, keyword only) mapped onto the v2 rule shape. */
export function legacyRules(legacy) {
  const source = Array.isArray(legacy && legacy.autoRules) ? legacy.autoRules : [];
  const out = [];
  for (const entry of source) {
    const rule = normalizeRule({ groupName: entry && entry.groupName, any: entry && entry.any, none: entry && entry.none });
    if (rule) out.push(rule);
  }
  return out;
}

/** Group rows for display, including groups that only exist as rule targets. */
export function displayGroups(state) {
  const groups = [...state.groups];
  const names = new Set(groups.map((group) => group.name));
  for (const rule of state.rules) {
    if (names.has(rule.groupName)) continue;
    names.add(rule.groupName);
    groups.push({ id: "pending:" + rule.groupName, name: rule.groupName, virtual: true });
  }
  return groups;
}
