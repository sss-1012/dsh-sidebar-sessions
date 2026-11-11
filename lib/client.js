/* dsh-sidebar-sessions client bundle — plain ESM, no build step.
 *
 * sidebar.workspaces implementation:
 *  - recent-first session list, user groups, archive bucket
 *  - workspace node styled like a group, marked as a workspace: expanding it
 *    lists the workspaces (not sessions), each with its own fold state
 *  - drag-to-reorder: a drop moves the dragged row before the row it lands
 *    on. The workspace tree writes host order (insertSessionBefore); the
 *    recency sections (最近/置顶/分组/未分组/已归档) keep a local manual order,
 *    because re-sorting them by updatedAt would erase every drop
 *  - hidden entirely when the sidebar collapses to a narrow rail (CSS container
 *    query — no JS measurement, so no flicker)
 */
window.__ModuleLoader__.load({
  id: "dsh-sidebar-sessions",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
    const inject = ["slots", "sessions", "workspaces", "uiWorkspace", "uiSession", "remote", "remote.schedule"];

    const STORE_KEY = "dsh-session-groups.v1";
    const RECENT_LIMIT = 20;

    const CSS = `
.dsg-root{container-type:inline-size;display:flex;flex-direction:column;gap:1px;padding:4px 6px 8px;flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
@container (max-width:150px){.dsg-root > *{display:none}}
.dsg-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;height:32px;padding:0 8px;box-sizing:border-box;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;font-weight:600;cursor:pointer;user-select:none;background:var(--dsw-alias-bg-base,transparent)}
.dsg-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsg-caret{width:14px;flex:none;color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:10px}
.dsg-head-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsg-count{font-size:10px;color:var(--dsw-alias-label-tertiary,#9ca3af);flex:none;margin-left:6px}
.dsg-row{position:relative;display:flex;align-items:center;box-sizing:border-box;width:100%;height:32px;padding:0 4px 0 10px;border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-primary,#111827);cursor:pointer;user-select:none}
.dsg-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsg-row:focus-visible{outline:2px solid var(--dsw-alias-focus-ring,#4d6bfe);outline-offset:-2px}
.dsg-row[data-over="before"]{box-shadow:inset 0 2px 0 0 var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsg-row[data-over="after"]{box-shadow:inset 0 -2px 0 0 var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsg-row[data-dragging="true"]{opacity:.45}
.dsg-dot{flex:none;width:8px;height:8px;border-radius:50%;margin-right:8px;background:var(--dsw-alias-label-tertiary,#9ca3af);box-sizing:border-box}
.dsg-dot[data-state="running"]{background:transparent;border:1.5px solid var(--dsw-alias-state-business-primary,#4d6bfe);border-top-color:transparent;animation:dsg-spin .8s linear infinite}
.dsg-dot[data-state="pending"]{background:var(--dsw-alias-state-warning-primary,#f7ad31)}
.dsg-dot[data-state="unread"]{background:var(--dsw-alias-state-success-primary,#22c55e)}
@keyframes dsg-spin{to{transform:rotate(360deg)}}
.dsg-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;margin:0 4px 0 0;text-align:left}
.dsg-time{flex:0 0 4.5em;width:4.5em;margin-left:6px;text-align:right;white-space:nowrap;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-actions{display:flex;flex:none;gap:2px;opacity:0;margin-left:4px}
.dsg-row:hover .dsg-actions,.dsg-row:focus-within .dsg-actions{opacity:1}
.dsg-icon{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:22px;height:22px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;font-size:13px;line-height:1;padding:0;border-radius:var(--dsw-radius-s,8px)}
.dsg-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#111827)}
.dsg-pin{flex:none;color:var(--dsw-alias-state-business-primary,#4d6bfe);font-size:11px;margin-right:4px}
.dsg-dot-clock{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;margin-right:6px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-menu{position:fixed;z-index:9999;min-width:190px;padding:4px;background:var(--dsw-alias-bg-layer-2,#24272c);border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));border-radius:var(--dsw-radius-md,12px);box-shadow:0 8px 24px rgba(0,0,0,.28)}
.dsg-menu-item{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;font-size:13px;color:var(--dsw-alias-label-primary,#111827);cursor:pointer;border-radius:var(--dsw-radius-s,8px);white-space:nowrap}
.dsg-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsg-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.dsg-menu-label{display:flex;align-items:center;height:24px;padding:0 10px;font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af);cursor:default}
.dsg-dot-sm{color:var(--dsw-alias-state-business-primary,#4d6bfe);font-size:10px}
.dsg-search{display:flex;align-items:center;gap:6px;margin:0 2px 8px;padding:0 10px;height:34px;box-sizing:border-box;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,#1a1d21);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.15))}
.dsg-search input{flex:1;min-width:0;height:32px;line-height:32px;background:transparent;border:none;outline:none;color:var(--dsw-alias-label-primary,#e5e7eb);font-size:13px}
.dsg-search input::placeholder{color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-empty{padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af);line-height:18px}
.dsg-more{display:flex;align-items:center;justify-content:center;height:30px;margin:2px 2px 4px;border-radius:var(--dsw-radius-s,8px);color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:12px;line-height:1;cursor:pointer;user-select:none}
.dsg-more:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary,#6b7280)}
.dsg-more:focus-visible{outline:2px solid var(--dsw-alias-focus-ring,#4d6bfe);outline-offset:-2px}
.dsg-more-end{cursor:default;font-size:11px}
.dsg-more-end:hover{background:transparent;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-ws{display:flex;align-items:center;gap:4px;padding:2px 8px 8px}
.dsg-ws-btn{flex:1;display:flex;align-items:center;justify-content:center;height:34px;box-sizing:border-box;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px;line-height:1;border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.dsg-ws-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsg-ws-row{display:flex;align-items:center;height:28px;padding:0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
`;

    function injectStyles() {
      const id = "dsh-sidebar-sessions-style";
      if (document.getElementById(id)) return () => {};
      const style = document.createElement("style");
      style.id = id;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => style.remove();
    }

    const EMPTY = { groups: [], assign: {}, collapsed: {}, hiddenWorkspaces: [], activeWorkspace: null, order: {}, autoRules: [], autoDone: {} };

    function readStore() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (!raw) return { ...EMPTY };
        const parsed = JSON.parse(raw);
        return {
          groups: Array.isArray(parsed.groups) ? parsed.groups : [],
          assign: parsed.assign && typeof parsed.assign === "object" ? parsed.assign : {},
          collapsed: parsed.collapsed && typeof parsed.collapsed === "object" ? parsed.collapsed : {},
          hiddenWorkspaces: Array.isArray(parsed.hiddenWorkspaces) ? parsed.hiddenWorkspaces : [],
          activeWorkspace: typeof parsed.activeWorkspace === "string" ? parsed.activeWorkspace : null,
          order: parsed.order && typeof parsed.order === "object" ? parsed.order : {},
          autoRules: Array.isArray(parsed.autoRules) ? parsed.autoRules : [],
          autoDone: parsed.autoDone && typeof parsed.autoDone === "object" ? parsed.autoDone : {},
        };
      } catch {
        return { ...EMPTY };
      }
    }

    function writeStore(next) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {}
    }

    const store = (() => {
      let state = readStore();
      const listeners = new Set();
      const emit = () => {
        for (const fn of listeners) fn();
      };
      return {
        get: () => state,
        set(next) {
          state = next;
          writeStore(state);
          emit();
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    })();

    function useGroups() {
      return useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /* 自动分组：定时任务现在每次投递到新会话，新会话标题由投递词生成。
     * 命中规则的新会话自动放进指定分组（分组不存在则创建）。
     * 处理过一次就记进 autoDone，之后你手动挪走也不会被拉回来。
     * 想改规则：localStorage 里 dsh-session-groups.v1 的 autoRules 字段
     * （[{ groupName, any: [关键词...], none: [排除词...] }]），留空用默认值。 */
    const DEFAULT_AUTO_RULES = [
      { id: "r_brief", groupName: "每日简报", any: ["新闻简报", "每日简报"], schedules: ["新闻简报", "每日简报"] },
      { id: "r_radar", groupName: "个人开发工具", any: ["项目数据雷达", "数据雷达", "npm 与 GitHub 项目数据"], schedules: ["项目数据雷达", "数据雷达"] },
    ];

    function matchAutoRule(rule, text) {
      if (!rule || !text) return false;
      const hay = String(text).toLowerCase();
      const any = Array.isArray(rule.any) ? rule.any : [];
      const none = Array.isArray(rule.none) ? rule.none : [];
      if (none.some((k) => hay.includes(String(k).toLowerCase()))) return false;
      return any.length === 0 || any.some((k) => hay.includes(String(k).toLowerCase()));
    }

    function newGroupId() {
      return "g_" + Math.random().toString(36).slice(2, 9);
    }

    function titleOf(row, id) {
      return String(row?.displayTitle || row?.title || id);
    }

    function updatedAt(row) {
      const n = Number(row?.updatedAt);
      return Number.isFinite(n) ? n : 0;
    }

    function sortRecent(ids, byId) {
      return [...ids].sort((a, b) => {
        const d = updatedAt(byId[b]) - updatedAt(byId[a]);
        if (d !== 0) return d;
        return String(a).localeCompare(String(b));
      });
    }

    /**
     * Layer a section's saved manual order over its base order. Ids the saved
     * order never saw (a new session, or one that just entered the section)
     * come first, newest first, so fresh activity stays on top; the ids it did
     * see keep the order the user dragged them into. Only display order: the
     * caller still decides what belongs in the section.
     */
    function applyManualOrder(ids, saved) {
      if (!Array.isArray(saved) || saved.length === 0) return ids;
      const present = new Set(ids);
      const kept = saved.filter((id) => present.has(id));
      if (kept.length === 0) return ids;
      const keptSet = new Set(kept);
      const fresh = ids.filter((id) => !keptSet.has(id));
      return fresh.concat(kept);
    }

    /**
     * Move `src` to the dropped row: `half` is the pointer's half of that row,
     * so dropping on the lower half lands the row after the target and the
     * upper half lands it before. A move that changes nothing returns undefined.
     */
    function moveTo(ids, src, targetId, half) {
      if (src === targetId) return undefined;
      if (!ids.includes(src) || !ids.includes(targetId)) return undefined;
      const without = ids.filter((id) => id !== src);
      const at = without.indexOf(targetId);
      const insertAt = half === "after" ? at + 1 : at;
      const next = without.slice(0, insertAt).concat([src], without.slice(insertAt));
      return next.every((id, index) => id === ids[index]) ? undefined : next;
    }

    /** Anchor for host `insertSessionBefore`: the id that must follow `src`. */
    function anchorAfter(ids, src, targetId) {
      const without = ids.filter((id) => id !== src);
      return without[without.indexOf(targetId) + 1];
    }

    /** Which half of the row the pointer is in: "before" (top) or "after". */
    function rowHalf(event) {
      const el = event.currentTarget;
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rect) return "before";
      return event.clientY - rect.top > rect.height / 2 ? "after" : "before";
    }

    /**
     * Viewport-relative bottom of the list's scrolling ancestor (or the window
     * when the page itself scrolls): paging measures against the box the user
     * actually sees, so a short sidebar loads one screen at a time.
     */
    function scrollBottom(el) {
      if (!el || typeof getComputedStyle !== "function") return (window.innerHeight || 0);
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (!/(auto|scroll|overlay)/.test(style.overflowY || "")) continue;
        if (node.scrollHeight > node.clientHeight) return node.getBoundingClientRect().bottom;
      }
      return (window.innerHeight || 0);
    }

    /** Whether one schedule catalog row targets or involves this session. */
    function taskInvolvesSession(row, id) {
      if (!row) return false;
      if (row.sessionId === id) return true;
      if (Array.isArray(row.involvedSessionIds) && row.involvedSessionIds.indexOf(id) !== -1) return true;
      const target = row.target;
      if (!target) return false;
      if (target.kind === "new") return row.lastDelivery?.targetSessionId === id;
      return target.sessionId === id;
    }

    function isSubagent(row) {
      return row?.origin === "subagent";
    }

    function pendingKind(value) {
      if (value === undefined || value === null) return undefined;
      if (typeof value === "string") return value;
      return value.kind || "pending";
    }

    function dotState(status) {
      if (pendingKind(status?.pendingInteraction) !== undefined) return "pending";
      if (status?.running === true) return "running";
      if (status?.completionUnread === true) return "unread";
      return "idle";
    }

    function fmtTime(ms) {
      if (!ms) return "";
      const now = Date.now();
      const diff = now - ms;
      if (diff < 60_000) return "刚刚";
      if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分";
      if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 时";
      if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + " 天";
      const d = new Date(ms);
      return d.getMonth() + 1 + "/" + d.getDate();
    }

    const Row = memo(function Row(props) {
      const { id, section, row, pinned, archived, status, scheduled, dragging, over, onOpen, onMenu, onDragStart, onDragOver, onDrop } = props;
      const label = titleOf(row, id);
      return h(
        "div",
        {
          className: "dsg-row",
          "data-section": section || "recent",
          "data-dragging": dragging ? "true" : undefined,
          "data-over": over || undefined,
          draggable: true,
          onClick: () => onOpen(id),
          title: label,
          onDragStart: (e) => {
            try { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; } catch {}
            onDragStart(id);
          },
          onDragOver: (e) => {
            e.preventDefault();
            try { e.dataTransfer.dropEffect = "move"; } catch {}
            onDragOver(section || "recent", id, rowHalf(e));
          },
          onDragLeave: () => onDragOver(null, null, null),
          onDrop: (e) => {
            e.preventDefault();
            onDrop(section || "recent", id, rowHalf(e));
          },
        },
        scheduled && dotState(status) === "idle"
          ? h("span", { className: "dsg-dot-clock", title: "已设置定时任务", "aria-label": "已设置定时任务" },
              h("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none" },
                h("circle", { cx: 8, cy: 8, r: 6.25, stroke: "currentColor", strokeWidth: 1.5 }),
                h("path", { d: "M8 4.5V8l2.5 1.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })))
          : h("span", { className: "dsg-dot", "data-state": dotState(status) }),
        h("span", { className: "dsg-title" }, label),
        pinned ? h("span", { className: "dsg-pin" }, "★") : null,
        h("span", { className: "dsg-time" }, fmtTime(updatedAt(row))),
        h(
          "span",
          { className: "dsg-actions" },
          h("button", {
            className: "dsg-icon",
            title: "更多操作",
            onClick: (e) => {
              e.stopPropagation();
              onMenu(id, e.currentTarget);
            },
          }, "⋯")
        )
      );
    });

    class RegionBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try {
          console.error("[dsh-sidebar-sessions] region failed", error);
        } catch {}
      }
      render() {
        if (this.state.error) {
          return h("div", { className: "dsg-empty" }, "会话分组暂不可用（", String(this.state.error?.message || this.state.error), "）");
        }
        return this.props.children;
      }
    }

    function GuardedRegion(props) {
      return h(RegionBoundary, null, h(Region, props));
    }

    function Region(props) {
      const {
        useSessions, useWorkspaces, useSessionStatus, useScheduleCatalog, open,
        pinSession, unpinSession, archiveSession, unarchiveSession,
        renameSession, forkSession, createWorkspace, pickDirectory, insertSessionBefore, openWorkspace,
      } = props;
      const list = useSessions((s) => s);
      const ws = useWorkspaces((s) => s);
      const useStatus = typeof useSessionStatus === "function" ? useSessionStatus : () => ({});
      const statuses = useStatus((s) => s);
      const useSchedules = typeof useScheduleCatalog === "function" ? useScheduleCatalog : () => [];
      const schedules = useSchedules();
      /* A scheduler row belongs to a session when it targets it (the target
       * session, or the reserved `new_once` id / last delivered id for a `new`
       * target) or lists it among the involved sessions. Older Host builds put
       * a bare `sessionId` on the row, so that shape is honoured too. */
      const scheduledOf = useCallback((id) => {
        if (!Array.isArray(schedules)) return false;
        return schedules.some((row) => row && row.status === "active" && taskInvolvesSession(row, id));
      }, [schedules]);
      const groups = useGroups();
      const [showArchived, setShowArchived] = useState(false);
      const [showHidden, setShowHidden] = useState(false);
      const [menu, setMenu] = useState(null);
      const [query, setQuery] = useState("");
      const [dragId, setDragId] = useState(null);
      const [dragOver, setDragOver] = useState(null);
      const [compact, setCompact] = useState(false);
      const rootRef = useRef(null);
      /* Current rendered order per section key, read by the drop handler. */
      const sectionIdsRef = useRef({});

      /* Paging: the 最近 list and the search results grow one screen at a time. */
      const [recentLimit, setRecentLimit] = useState(RECENT_LIMIT);
      const [searchLimit, setSearchLimit] = useState(RECENT_LIMIT);
      const [loadingMore, setLoadingMore] = useState(null);
      const moreRef = useRef(null);
      const searchMoreRef = useRef(null);
      const loadGuard = useRef(false);
      const loadTimer = useRef(null);
      /* One automatic batch per scroll burst: appending rows makes the browser
       * anchor the scroll position, which would otherwise keep the footer in
       * range and quietly load the whole history in one gesture. */
      const autoPagerAt = useRef(0);
      const liveSortedRef = useRef([]);
      const recentLimitRef = useRef(RECENT_LIMIT);

      useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return undefined;
        const measure = () => {
          const w = el.getBoundingClientRect().width;
          setCompact(w > 0 && w < 150);
        };
        measure();
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
        if (ro) ro.observe(el);
        else window.addEventListener("resize", measure);
        return () => {
          if (ro) ro.disconnect();
          else window.removeEventListener("resize", measure);
        };
      }, []);
      const searching = query.trim().length > 0;

      const byId = list?.byId || {};
      const pinnedSet = useMemo(() => new Set(ws?.pinnedSessionIds || []), [ws]);
      const archivedSet = useMemo(() => new Set(ws?.archivedSessionIds || []), [ws]);
      const assign = groups.assign || {};
      const collapsed = groups.collapsed || {};
      const orders = groups.order || {};
      const hidden = store.get().hiddenWorkspaces || [];

      const ids = useMemo(() => (list?.ids || []).filter((id) => byId[id] && !isSubagent(byId[id])), [list, byId]);
      const archived = useMemo(() => ids.filter((id) => archivedSet.has(id)), [ids, archivedSet]);
      const live = useMemo(() => ids.filter((id) => !archivedSet.has(id)), [ids, archivedSet]);

      /* 自动分组落地：只处理既没手动分过、也没被自动处理过的会话。 */
      useEffect(() => {
        if (!live.length) return;
        const cur = store.get();
        const rules = Array.isArray(cur.autoRules) && cur.autoRules.length > 0 ? cur.autoRules : DEFAULT_AUTO_RULES;
        const done = cur.autoDone || {};
        const groupsNext = [...(cur.groups || [])];
        const assignNext = { ...(cur.assign || {}) };
        const doneNext = { ...done };
        /* 判定优先级：先看「这个会话是不是某个定时任务刚创建的」——宿主会把新会话记在
         * schedule.lastDelivery.targetSessionId；这比标题可靠得多。其次才看会话标题。 */
        const bySchedule = new Map();
        const FRESH_MS = 12 * 60 * 60 * 1000;
        const now = Date.now();
        for (const row of Array.isArray(schedules) ? schedules : []) {
          const sid = row && row.lastDelivery && row.lastDelivery.targetSessionId;
          if (!sid) continue;
          /* 只认最近的投递：旧配置曾把任务投到已有会话，那些会话不该被动搬家。 */
          const at = Date.parse((row.lastDelivery && row.lastDelivery.deliveredAt) || "");
          if (!Number.isFinite(at) || now - at > FRESH_MS) continue;
          bySchedule.set(sid, [row.title, row.prompt].filter(Boolean).join(" \n "));
        }
        let changed = false;
        for (const id of live) {
          if (assignNext[id] || doneNext[id]) continue;
          const row = byId[id];
          /* 标题匹配只认标题：预览/摘要里提到「简报」的老会话不该被拖进新分组。 */
          const sessionText = titleOf(row, id);
          const schText = bySchedule.get(id) || "";
          let rule = rules.find((r) => schText && matchAutoRule(r, schText));
          if (!rule) rule = rules.find((r) => matchAutoRule(r, sessionText));
          if (!rule) continue;
          const name = String(rule.groupName || "").trim();
          if (!name) continue;
          let g = groupsNext.find((x) => x.name === name);
          if (!g) {
            g = { id: newGroupId(), name: name.slice(0, 20) };
            groupsNext.push(g);
          }
          assignNext[id] = g.id;
          doneNext[id] = 1;
          changed = true;
        }
        if (changed) store.set({ ...cur, groups: groupsNext, assign: assignNext, autoDone: doneNext });
      }, [live, byId, schedules]);
      const archivedOrdered = useMemo(() => applyManualOrder(archived, orders["archived"]), [archived, orders]);
      const liveSorted = useMemo(() => sortRecent(live, byId), [live, byId]);
      const recentBase = useMemo(() => liveSorted.slice(0, recentLimit), [liveSorted, recentLimit]);
      const recent = useMemo(() => applyManualOrder(recentBase, orders.recent), [recentBase, orders]);
      const remainingRecent = Math.max(0, live.length - recent.length);
      liveSortedRef.current = liveSorted;
      recentLimitRef.current = recentLimit;
      const pinned = useMemo(() => applyManualOrder(sortRecent(live.filter((id) => pinnedSet.has(id)), byId), orders.pinned), [live, byId, pinnedSet, orders]);

      const accountOf = useCallback((id) => {
        for (const item of ws?.items || []) {
          if ((item.sessionIds || []).includes(id)) return item.workspaceId;
        }
        return undefined;
      }, [ws]);

      const visibleWorkspaces = useMemo(
        () => (ws?.items || []).filter((it) => !hidden.includes(String(it.workspaceId))),
        [ws, hidden]
      );
      const hiddenWorkspaces = useMemo(
        () => (ws?.items || []).filter((it) => hidden.includes(String(it.workspaceId))),
        [ws, hidden]
      );

      const groupRows = useMemo(() => {
        const byGroup = new Map();
        for (const g of groups.groups) byGroup.set(g.id, []);
        const rest = [];
        const shownInWorkspaces = new Set();
        for (const item of visibleWorkspaces) for (const id of item.sessionIds || []) shownInWorkspaces.add(id);
        for (const id of live) {
          if (pinnedSet.has(id)) continue;
          /* 分组优先：明确分组的会话只出现在它所属分组里，不在工作区树重复一份。 */
          const gid = assign[id];
          const grouped = gid && byGroup.has(gid);
          if (!grouped && shownInWorkspaces.has(id)) continue;
          if (grouped) byGroup.get(gid).push(id);
          else rest.push(id);
        }
        for (const [gid, arr] of byGroup) byGroup.set(gid, applyManualOrder(sortRecent(arr, byId), orders["g:" + gid]));
        return { byGroup, rest: applyManualOrder(sortRecent(rest, byId), orders.ungrouped) };
      }, [live, byId, groups.groups, assign, pinnedSet, visibleWorkspaces, orders]);

      const filteredAll = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return null;
        return sortRecent(ids.filter((id) => titleOf(byId[id], id).toLowerCase().includes(needle)), byId);
      }, [query, ids, byId]);
      const filtered = useMemo(() => (filteredAll ? filteredAll.slice(0, searchLimit) : null), [filteredAll, searchLimit]);
      const remainingSearch = filteredAll ? Math.max(0, filteredAll.length - (filtered ? filtered.length : 0)) : 0;

      /* Grow one batch; a drag suppresses it so a list never reflows under the
       * pointer. The 140ms window is the "加载中…" state, not a wait. */
      const growRecent = useCallback(() => {
        if (loadGuard.current || dragId) return;
        loadGuard.current = true;
        setLoadingMore("recent");
        loadTimer.current = setTimeout(() => {
          loadGuard.current = false;
          setLoadingMore(null);
          const limit = recentLimitRef.current;
          const next = limit + RECENT_LIMIT;
          /* A manual order must absorb the newly revealed rows, or the ones it
           * never saw would jump above it (fresh rows render first). */
          const cur = store.get();
          const saved = cur.order && cur.order.recent;
          if (Array.isArray(saved) && saved.length > 0) {
            const seen = new Set(saved);
            const revealed = liveSortedRef.current.slice(limit, next).filter((id) => !seen.has(id));
            if (revealed.length > 0) store.set({ ...cur, order: { ...cur.order, recent: saved.concat(revealed) } });
          }
          setRecentLimit(next);
        }, 140);
      }, [dragId]);

      const growSearch = useCallback(() => {
        if (loadGuard.current || dragId) return;
        loadGuard.current = true;
        setLoadingMore("search");
        loadTimer.current = setTimeout(() => {
          loadGuard.current = false;
          setLoadingMore(null);
          setSearchLimit((n) => n + RECENT_LIMIT);
        }, 140);
      }, [dragId]);

      useEffect(() => () => { if (loadTimer.current) clearTimeout(loadTimer.current); }, []);
      useEffect(() => { setSearchLimit(RECENT_LIMIT); }, [query]);

      /* Auto-grow when the footer nears the bottom of the visible box; clicking
       * it does the same, so a fast scroll and a deliberate click agree. */
      useEffect(() => {
        const el = moreRef.current;
        if (!el || remainingRecent <= 0) return undefined;
        let ticking = false;
        const check = () => {
          ticking = false;
          if (Date.now() - autoPagerAt.current < 900) return;
          if (el.getBoundingClientRect().top < scrollBottom(el) + 240) {
            autoPagerAt.current = Date.now();
            growRecent();
          }
        };
        const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
        check();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        return () => {
          window.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onScroll);
        };
      }, [remainingRecent, recentLimit, growRecent, searching]);

      useEffect(() => {
        const el = searchMoreRef.current;
        if (!el || remainingSearch <= 0) return undefined;
        let ticking = false;
        const check = () => {
          ticking = false;
          if (Date.now() - autoPagerAt.current < 900) return;
          if (el.getBoundingClientRect().top < scrollBottom(el) + 240) {
            autoPagerAt.current = Date.now();
            growSearch();
          }
        };
        const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
        check();
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onScroll);
        return () => {
          window.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onScroll);
        };
      }, [remainingSearch, searchLimit, growSearch]);

      /* Default workspace = the one holding the most recent live session. */
      const currentWsId = useMemo(() => {
        if (groups.activeWorkspace) return groups.activeWorkspace;
        for (const id of recent) {
          const found = (ws?.items || []).find((it) => (it.sessionIds || []).includes(id));
          if (found) return found.workspaceId;
        }
        return visibleWorkspaces[0]?.workspaceId;
      }, [groups.activeWorkspace, recent, ws, visibleWorkspaces]);

      const toggle = useCallback((key) => {
        const cur = store.get();
        store.set({ ...cur, collapsed: { ...cur.collapsed, [key]: !(cur.collapsed || {})[key] } });
      }, []);

      const assignTo = useCallback((id, gid) => {
        const cur = store.get();
        const nextAssign = { ...cur.assign };
        if (gid) nextAssign[id] = gid;
        else delete nextAssign[id];
        store.set({ ...cur, assign: nextAssign });
      }, []);

      const createGroup = useCallback((sessionId) => {
        const name = window.prompt("新分组名称");
        if (!name || !name.trim()) return;
        const g = { id: newGroupId(), name: name.trim().slice(0, 20) };
        const cur = store.get();
        const next = { ...cur, groups: [...cur.groups, g] };
        if (sessionId) next.assign = { ...cur.assign, [sessionId]: g.id };
        store.set(next);
      }, []);

      const renameGroup = useCallback((g) => {
        const name = window.prompt("分组名称", g.name);
        if (!name || !name.trim()) return;
        const cur = store.get();
        store.set({ ...cur, groups: cur.groups.map((x) => (x.id === g.id ? { ...x, name: name.trim().slice(0, 20) } : x)) });
      }, []);

      const deleteGroup = useCallback((g) => {
        if (!window.confirm(`删除分组「${g.name}」？组内会话会回到未分组。`)) return;
        const cur = store.get();
        const nextAssign = { ...cur.assign };
        for (const [sid, gid] of Object.entries(nextAssign)) if (gid === g.id) delete nextAssign[sid];
        store.set({ ...cur, groups: cur.groups.filter((x) => x.id !== g.id), assign: nextAssign });
      }, []);

      const switchWorkspace = useCallback((item) => {
        const cur = store.get();
        store.set({ ...cur, activeWorkspace: String(item.workspaceId) });
        try {
          if (openWorkspace) Promise.resolve(openWorkspace(item.workspaceId)).catch((err) => console.error("[dsh-sidebar-sessions] switch workspace failed", err));
        } catch (err) {
          console.error("[dsh-sidebar-sessions] switch workspace failed", err);
        }
      }, [openWorkspace]);

      const hideWorkspace = useCallback((item) => {
        const cur = store.get();
        const id = String(item.workspaceId);
        store.set({ ...cur, hiddenWorkspaces: [...new Set([...(cur.hiddenWorkspaces || []), id])] });
      }, []);

      const unhideWorkspace = useCallback((item) => {
        const cur = store.get();
        const id = String(item.workspaceId);
        store.set({ ...cur, hiddenWorkspaces: (cur.hiddenWorkspaces || []).filter((x) => x !== id) });
      }, []);

      const closeMenu = useCallback(() => setMenu(null), []);
      const openMenu = useCallback((id, el) => {
        const r = el.getBoundingClientRect();
        setMenu({ id, x: Math.min(r.right - 190, Math.max(8, window.innerWidth - 210)), y: Math.min(r.bottom + 2, window.innerHeight - 280) });
      }, []);

      const renameRow = useCallback(async (id) => {
        const name = window.prompt("重命名对话", titleOf(byId[id], id));
        if (!name || !name.trim() || !renameSession) return;
        try {
          await renameSession(id, name.trim());
        } catch (err) {
          console.error("[dsh-sidebar-sessions] rename failed", err);
        }
      }, [byId, renameSession]);

      const copy = useCallback((text) => {
        try {
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
        } catch {}
      }, []);

      const commitSectionOrder = useCallback((sectionKey, next) => {
        if (!next || sectionKey === "search") return;
        const cur = store.get();
        store.set({ ...cur, order: { ...(cur.order || {}), [sectionKey]: next } });
      }, []);

      const clearSectionOrder = useCallback((sectionKey) => {
        const cur = store.get();
        const order = { ...(cur.order || {}) };
        if (!(sectionKey in order)) return;
        delete order[sectionKey];
        store.set({ ...cur, order });
      }, []);

      const handleDragOver = useCallback((section, id, half) => {
        if (!id) {
          setDragOver(null);
          return;
        }
        /* No marker when the dragged row is not part of that list: a drop there
         * cannot move anything, so promising a landing line would lie. */
        const ids = sectionIdsRef.current[section];
        if (!dragId || !ids || !ids.includes(dragId)) {
          setDragOver(null);
          return;
        }
        setDragOver({ section, id, half: half || "before" });
      }, [dragId]);

      /** End of any drag: no row may stay in its "being dragged" state. */
      const handleDragEnd = useCallback(() => {
        setDragId(null);
        setDragOver(null);
      }, []);

      const onDropRow = useCallback((sectionKey, targetId, half) => {
        const src = dragId;
        setDragId(null);
        setDragOver(null);
        if (!src || src === targetId) return;
        const ids = sectionIdsRef.current[sectionKey] || [];
        const next = moveTo(ids, src, targetId, half);
        /* Workspace tree: the host owns the order, so write it durably and
         * fall back to the local view order only when the host refuses. */
        if (typeof sectionKey === "string" && sectionKey.indexOf("ws:") === 0) {
          if (!next) return;
          const a = accountOf(src);
          const b = accountOf(targetId);
          if (a === undefined || a !== b) return;
          /* A local order means the view already overrides the host; keep it local. */
          if (orders[sectionKey]) {
            commitSectionOrder(sectionKey, next);
            return;
          }
          /* insertSessionBefore takes the id that must FOLLOW the moved row. */
          const anchor = half === "after" ? anchorAfter(ids, src, targetId) : targetId;
          if (anchor === src) return;
          const keepLocal = () => commitSectionOrder(sectionKey, next);
          if (!insertSessionBefore) return;
          try {
            Promise.resolve(insertSessionBefore(a, src, anchor))
              .then((result) => {
                if (result && result.ok === false) {
                  console.error("[dsh-sidebar-sessions] reorder rejected, keeping view order", result.error);
                  keepLocal();
                } else clearSectionOrder(sectionKey);
              })
              .catch((err) => {
                console.error("[dsh-sidebar-sessions] reorder failed", err);
                keepLocal();
              });
          } catch (err) {
            console.error("[dsh-sidebar-sessions] reorder failed", err);
            keepLocal();
          }
          return;
        }
        /* Every other list is view order: keep it locally, or the recency
         * sort would put the row straight back where it was. */
        commitSectionOrder(sectionKey, next);
      }, [dragId, accountOf, insertSessionBefore, commitSectionOrder, clearSectionOrder, orders]);

      const sections = { recent, pinned, archived: archivedOrdered, search: filtered || [], ungrouped: groupRows.rest };
      for (const g of groups.groups) sections["g:" + g.id] = groupRows.byGroup.get(g.id) || [];
      const isGrouped = (id) => { const gid = assign[id]; return !!(gid && (groups.groups || []).some((g) => g.id === gid)); };
      for (const item of visibleWorkspaces) sections["ws:" + String(item.workspaceId)] = applyManualOrder((item.sessionIds || []).filter((id) => byId[id] && !archivedSet.has(id) && !isGrouped(id)), orders["ws:" + String(item.workspaceId)]);
      sectionIdsRef.current = sections;

      const renderRow = useCallback(
        (id, opts) =>
          h(Row, {
            key: id,
            id,
            section: (opts && opts.section) || "recent",
            row: byId[id],
            pinned: pinnedSet.has(id),
            archived: archivedSet.has(id),
            status: statuses?.get?.(id),
            scheduled: scheduledOf(id),
            dragging: dragId === id,
            over: dragOver !== null && dragOver.id === id && dragOver.section === ((opts && opts.section) || "recent") && dragId !== null && dragId !== id ? dragOver.half : null,
            onOpen: open,
            onMenu: openMenu,
            onDragStart: setDragId,
            onDragOver: handleDragOver,
            onDrop: onDropRow,
            ...(opts || {}),
          }),
        [byId, pinnedSet, archivedSet, statuses, scheduledOf, dragId, dragOver, open, openMenu, onDropRow, handleDragOver]
      );

      const head = (label, count, onToggle, caret, extra) =>
        h(
          "div",
          { className: "dsg-head", onClick: onToggle },
          h("span", { className: "dsg-caret" }, caret),
          h("span", { className: "dsg-head-label" }, label),
          h("span", { className: "dsg-count" }, String(count)),
          extra || null
        );

      const section = (key, label, count, body, extra) =>
        h(
          "div",
          { key },
          head(label, count, () => toggle(key), collapsed[key] ? "▸" : "▾", extra),
          collapsed[key] ? null : body
        );

      /* Footer of a paged list: 还能翻 / 加载中 / 到底了. */
      const moreButton = (onClick) => ({
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          onClick();
        },
      });

      const recentFooter = (() => {
        if (loadingMore === "recent") return h("div", { className: "dsg-more", "data-pager": "recent", ref: moreRef }, "加载中…");
        if (remainingRecent > 0) {
          return h("div", { ...moreButton(growRecent), ref: moreRef, className: "dsg-more", "data-pager": "recent", title: "加载更多对话" },
            `显示更多（还有 ${remainingRecent} 条）`);
        }
        if (live.length > RECENT_LIMIT) {
          return h("div", { className: "dsg-more dsg-more-end", "data-pager": "recent" }, `已经是最早的对话了 · 共 ${live.length} 条`);
        }
        return null;
      })();

      const searchFooter = (() => {
        if (!filteredAll || filteredAll.length === 0) return null;
        if (loadingMore === "search") return h("div", { className: "dsg-more", "data-pager": "search", ref: searchMoreRef }, "加载中…");
        if (remainingSearch > 0) {
          return h("div", { ...moreButton(growSearch), ref: searchMoreRef, className: "dsg-more", "data-pager": "search", title: "加载更多匹配" },
            `还有 ${remainingSearch} 条匹配`);
        }
        if (filteredAll.length > RECENT_LIMIT) {
          return h("div", { className: "dsg-more dsg-more-end", "data-pager": "search" }, `全部 ${filteredAll.length} 条匹配都在这了`);
        }
        return null;
      })();
      const menuEl = menu
        ? h(
            "div",
            { className: "dsg-menu", style: { left: menu.x, top: menu.y }, onMouseLeave: closeMenu },
            h("div", { className: "dsg-menu-item", onClick: () => { pinnedSet.has(menu.id) ? unpinSession(menu.id) : pinSession(menu.id); closeMenu(); } },
              pinnedSet.has(menu.id) ? "取消置顶" : "置顶"),
            h("div", { className: "dsg-menu-item", onClick: () => { renameRow(menu.id); closeMenu(); } }, "重命名"),
            h("div", { className: "dsg-menu-item", onClick: () => { if (forkSession) forkSession(menu.id); closeMenu(); } }, "分叉会话"),
            h("div", { className: "dsg-menu-item", onClick: () => { copy(menu.id); closeMenu(); } }, "复制 Session ID"),
            h("div", { className: "dsg-menu-item", onClick: () => { const item = (ws?.items || []).find((x) => (x.sessionIds || []).includes(menu.id)); if (item?.path) copy(item.path); closeMenu(); } }, "复制工作目录"),
            h("div", { className: "dsg-menu-sep" }),
            h("div", { className: "dsg-menu-label" }, "移动到分组"),
            h("div", { className: "dsg-menu-item", onClick: () => { assignTo(menu.id, null); closeMenu(); } }, "未分组"),
            groups.groups.map((g) =>
              h("div", { key: g.id, className: "dsg-menu-item", onClick: () => { assignTo(menu.id, g.id); closeMenu(); } },
                h("span", { className: "dsg-dot-sm" }, "●"), g.name)
            ),
            h("div", { className: "dsg-menu-item", onClick: () => { createGroup(menu.id); closeMenu(); } }, "+ 新建分组…"),
            h("div", { className: "dsg-menu-sep" }),
            h("div", { className: "dsg-menu-item", onClick: () => { archivedSet.has(menu.id) ? unarchiveSession(menu.id) : archiveSession(menu.id); closeMenu(); } },
              archivedSet.has(menu.id) ? "取消归档" : "归档")
          )
        : null;

      return h(
        "div",
        {
          className: "dsg-root",
          ref: rootRef,
          onClick: menu ? closeMenu : undefined,
          /* A drag can end without a drop on a row (released on a header, the
           * gap between sections, or cancelled with Esc); dragend is the only
           * event that always fires, and without it that row keeps the 45%
           * "being dragged" dimming until the next drop or a reload. */
          onDragEnd: handleDragEnd,
          onDrop: (e) => { e.preventDefault(); handleDragEnd(); },
        },
        compact ? null : h(React.Fragment, null,
        h("div", { className: "dsg-ws" },
          h("button", { className: "dsg-ws-btn", onClick: async () => {
            try {
              if (pickDirectory && createWorkspace) {
                const dir = await pickDirectory();
                if (dir) await createWorkspace(dir);
              }
            } catch (err) {
              console.error("[dsh-sidebar-sessions] create workspace failed", err);
            }
          } }, "+ 新建工作区")),
        h("div", { className: "dsg-search" },
          h("input", {
            value: query,
            placeholder: "搜索对话",
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => { if (e.key === "Escape") setQuery(""); },
          }),
          query ? h("button", { className: "dsg-icon", title: "清除", onClick: () => setQuery("") }, "✕") : null),
        searching
          ? h("div", null,
              head("搜索结果", (filtered || []).length, () => {}, "▾"),
              (filtered || []).length
                ? h("div", null, filtered.map((id) => renderRow(id, { section: "search" })), searchFooter)
                : h("div", { className: "dsg-empty" }, "没有匹配的对话"))
          : h(React.Fragment, null,
              pinned.length ? section("pinned", "置顶", pinned.length, h("div", null, pinned.map((id) => renderRow(id, { section: "pinned" })))) : null,
              section("recent", "最近", recent.length, h("div", null, recent.map((id) => renderRow(id, { section: "recent" })), recentFooter),
                Array.isArray(orders.recent) && orders.recent.length
                  ? h("button", { className: "dsg-icon", style: { width: 18, height: 18, fontSize: 11, flex: "none" }, title: "恢复最近排序", onClick: (e) => { e.stopPropagation(); clearSectionOrder("recent"); } }, "↺")
                  : null),
              groups.groups.map((g) => {
                const rows = groupRows.byGroup.get(g.id) || [];
                return h("div", { key: g.id },
                  h("div", { className: "dsg-head", onClick: () => toggle("g:" + g.id) },
                    h("span", { className: "dsg-caret" }, collapsed["g:" + g.id] ? "▸" : "▾"),
                    h("span", { className: "dsg-head-label" }, g.name),
                    h("span", { className: "dsg-count" }, String(rows.length)),
                    h("span", { style: { display: "flex", gap: 2, flex: "none" }, onClick: (e) => e.stopPropagation() },
                      h("button", { className: "dsg-icon", style: { width: 18, height: 18, fontSize: 11 }, title: "重命名", onClick: () => renameGroup(g) }, "✎"),
                      h("button", { className: "dsg-icon", style: { width: 18, height: 18, fontSize: 11 }, title: "删除分组", onClick: () => deleteGroup(g) }, "✕"))),
                  collapsed["g:" + g.id] ? null : h("div", null, rows.map((id) => renderRow(id, { section: "g:" + g.id }))));
              }),
              section("ungrouped", "未分组", groupRows.rest.length, h("div", null, groupRows.rest.map((id) => renderRow(id, { section: "ungrouped" })))),
              archivedOrdered.length
                ? h("div", { key: "archived" },
                    head("已归档", archivedOrdered.length, () => setShowArchived((v) => !v), showArchived ? "▾" : "▸"),
                    showArchived ? h("div", null, archivedOrdered.map((id) => renderRow(id, { archived: true, section: "archived" }))) : null)
                : null,
              /* Workspace block: same shape as a group, marked as a workspace. */
              h("div", { key: "wsroot" },
                h("div", { className: "dsg-head", onClick: () => toggle("ws:root") },
                  h("span", { className: "dsg-caret" }, collapsed["ws:root"] ? "▸" : "▾"),
                  h("span", { className: "dsg-head-label" }, "📁 工作区"),
                  h("span", { className: "dsg-count" }, String(visibleWorkspaces.length))),
                collapsed["ws:root"] ? null : h("div", null,
                  visibleWorkspaces.length === 0
                    ? h("div", { className: "dsg-empty" }, "还没有工作区，点上方「+ 新建工作区」")
                    : visibleWorkspaces.map((item) => {
                        const key = "ws:" + String(item.workspaceId);
                        const members = applyManualOrder((item.sessionIds || []).filter((id) => byId[id] && !archivedSet.has(id) && !isGrouped(id)), orders[key]);
                        const isCurrent = String(currentWsId) === String(item.workspaceId);
                        const label = item.title || item.path || String(item.workspaceId);
                        return h("div", { key },
                          h("div", { className: "dsg-head", onClick: () => { switchWorkspace(item); if (collapsed[key]) toggle(key); } },
                            h("span", { className: "dsg-caret", onClick: (e) => { e.stopPropagation(); toggle(key); } }, collapsed[key] ? "▸" : "▾"),
                            h("span", { className: "dsg-head-label" }, (isCurrent ? "📌 " : "📁 ") + label),
                            h("span", { className: "dsg-count" }, String(members.length)),
                            h("button", { className: "dsg-icon", style: { width: 18, height: 18, fontSize: 11 }, title: "隐藏工作区", onClick: (e) => { e.stopPropagation(); hideWorkspace(item); } }, "✕")),
                          collapsed[key] ? null : h("div", null, members.map((id) => renderRow(id, { section: key }))));
                      }))),
              hiddenWorkspaces.length
                ? h("div", { key: "hiddenws" },
                    head("已隐藏的工作区", hiddenWorkspaces.length, () => setShowHidden((v) => !v), showHidden ? "▾" : "▸"),
                    showHidden
                      ? h("div", null, hiddenWorkspaces.map((item) =>
                          h("div", { key: String(item.workspaceId), className: "dsg-ws-row" },
                            h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.title || item.path || String(item.workspaceId)),
                            h("button", { className: "dsg-icon", style: { width: 18, height: 18, fontSize: 11 }, title: "恢复显示", onClick: () => unhideWorkspace(item) }, "↩"))))
                      : null)
                : null),
        ),
        menuEl
      );
    }

    function apply(ctx) {
      ctx.effect(() => injectStyles(), "dsh-sidebar-sessions: styles");

      /* Schedule catalog: active (not yet fired) reminders, refreshed on change. */
      const scheduleStore = (() => {
        let state = [];
        const listeners = new Set();
        return {
          get: () => state,
          set(next) {
            state = next;
            for (const fn of listeners) fn();
          },
          subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
        };
      })();

      const reloadSchedules = () => {
        try {
          const remote = ctx.remote && ctx.remote.schedule;
          if (!remote || typeof remote.catalog !== "function") return;
          Promise.resolve(remote.catalog())
            .then((result) => {
              const rows = Array.isArray(result) ? result : (result && Array.isArray(result.value) ? result.value : []);
              scheduleStore.set(rows);
            })
            .catch((err) => console.error("[dsh-sidebar-sessions] schedule catalog failed", err));
        } catch {}
      };

      ctx.effect(() => {
        reloadSchedules();
        const off = typeof ctx.on === "function" ? ctx.on("schedule/changed", reloadSchedules) : undefined;
        return () => {
          if (typeof off === "function") off();
        };
      }, "dsh-sidebar-sessions: schedules");
      ctx.slots.inject("sidebar.workspaces", () =>
        ctx.slots.register(
          {
            name: "sidebar.workspaces",
            id: "dsh-sidebar-sessions",
            priority: -2,
            registrant: "dsh-sidebar-sessions",
            inject: () => ({
              open: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
              pinSession: (sessionId) => ctx.uiWorkspace.pinSession(sessionId),
              unpinSession: (sessionId) => ctx.uiWorkspace.unpinSession(sessionId),
              archiveSession: (sessionId) => ctx.uiWorkspace.archiveSession(sessionId),
              unarchiveSession: (sessionId) => ctx.uiWorkspace.unarchiveSession(sessionId),
              forkSession: (sessionId) => ctx.uiWorkspace.forkSession(sessionId),
              pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
              openWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
              createWorkspace: (input) => ctx.workspaces.create(input),
              insertSessionBefore: (accountId, sessionId, anchor) => ctx.workspaces.insertSessionBefore(accountId, sessionId, anchor),
              useScheduleCatalog: () => useSyncExternalStore(scheduleStore.subscribe, scheduleStore.get, scheduleStore.get),
              renameSession: (sessionId, title) =>
                ctx.sessions.using(sessionId, { source: "workspaceOperation" }, (ref) =>
                  ref.binding.session.rename(title)
                ).then((result) => {
                  if (result?.ok === false) throw new Error(result.error?.message || "rename failed");
                }),
            }),
          },
          GuardedRegion
        )
      );
    }

    return { inject, apply };
  },
});
