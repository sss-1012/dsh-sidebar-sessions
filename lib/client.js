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
.dsg-ws-row{display:flex;align-items:center;height:28px;padding:0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-consent{margin:0 2px 8px;padding:8px 10px;border:1px solid var(--dsw-alias-state-business-primary,#4d6bfe);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#1a1d21);display:flex;flex-direction:column;gap:6px}
.dsg-consent-title{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary,#e5e7eb)}
.dsg-consent-group{color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
.dsg-consent-note{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-consent-actions{display:flex;flex-wrap:wrap;gap:6px}
.dsg-btn{height:26px;padding:0 10px;font-size:12px;line-height:1;border-radius:var(--dsw-radius-s,8px);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:transparent;color:var(--dsw-alias-label-primary,#e5e7eb);cursor:pointer}
.dsg-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsg-btn[data-tone="primary"]{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsg-btn[data-tone="ghost"]{border-color:transparent;color:var(--dsw-alias-label-secondary,#6b7280)}
.dsg-panel{position:fixed;z-index:10000;left:8px;bottom:8px;width:min(380px,calc(100vw - 16px));max-height:min(72vh,600px);overflow:auto;box-sizing:border-box;padding:10px;background:var(--dsw-alias-bg-layer-2,#24272c);border:1px solid var(--dsw-alias-border-l4,rgba(127,127,127,.3));border-radius:var(--dsw-radius-md,12px);box-shadow:0 12px 32px rgba(0,0,0,.32);font-size:12px;color:var(--dsw-alias-label-primary,#e5e7eb);display:flex;flex-direction:column;gap:8px}
.dsg-panel-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.dsg-panel-title .dsg-spacer{flex:1}
.dsg-field{display:flex;flex-direction:column;gap:4px}
.dsg-field-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#9ca3af)}
.dsg-input,.dsg-select{height:28px;box-sizing:border-box;padding:0 8px;border-radius:var(--dsw-radius-s,8px);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));background:var(--dsw-alias-bg-layer-1,#1a1d21);color:var(--dsw-alias-label-primary,#e5e7eb);font-size:12px}
.dsg-sched{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);height:22px}
.dsg-rule{padding:6px 8px;border-radius:var(--dsw-radius-s,8px);background:var(--dsw-alias-bg-layer-1,#1a1d21);display:flex;flex-direction:column;gap:4px}
.dsg-rule-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.dsg-rule-meta{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9ca3af);word-break:break-all}
.dsg-rule-actions{display:flex;gap:4px;margin-left:auto}
.dsg-warn{font-size:11px;line-height:15px;padding:6px 8px;border-radius:var(--dsw-radius-s,8px);background:var(--dsw-alias-state-warning-bg,rgba(247,173,49,.12));color:var(--dsw-alias-state-warning-primary,#f7ad31)}
.dsg-dialog-mask{position:fixed;inset:0;z-index:9999;background:transparent}
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

    /* ── 状态由宿主侧持有 ───────────────────────────────────────────────
     * 分组/规则/待确认建议存在宿主的一份 JSON 里（~/.dsh/sidebar-sessions/
     * state.json），Web GUI 与桌面端（dsh-app://app）读同一份：桌面壳把同源
     * 相对路径的请求原样转发给宿主 HTTP 服务，所以这里只发相对 URL。
     * localStorage 只当首屏缓存，以及宿主没注册路由时（老版本）的降级。 */
    const API = "/dsh-sidebar-sessions/api";
    const CACHE_KEY = "dsh-session-groups.cache.v2";
    const LEGACY_KEY = "dsh-session-groups.v1";

    const EMPTY_STATE = {
      version: 2,
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
      online: false,
    };

    function asObject(value) {
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function mergeState(raw, online) {
      const source = asObject(raw);
      const settings = asObject(source.settings);
      const classifier = asObject(settings.classifier);
      return {
        ...EMPTY_STATE,
        groups: asArray(source.groups)
          .filter((group) => group && group.id && group.name)
          .map((group) => ({ id: String(group.id), name: String(group.name) })),
        assign: { ...asObject(source.assign) },
        autoDone: { ...asObject(source.autoDone) },
        autoAllow: { ...asObject(source.autoAllow) },
        pending: { ...asObject(source.pending) },
        rules: asArray(source.rules)
          .filter((rule) => rule && rule.groupName)
          .map((rule) => ({
            id: String(rule.id || ""),
            groupName: String(rule.groupName),
            any: asArray(rule.any).map(String),
            none: asArray(rule.none).map(String),
            scheduleIds: asArray(rule.scheduleIds).map(String),
            scheduleTitles: asArray(rule.scheduleTitles).map(String),
          })),
        settings: {
          classifier: {
            mode: classifier.mode === "llm" ? "llm" : "off",
            provider: String(classifier.provider || ""),
            model: String(classifier.model || ""),
          },
        },
        order: { ...asObject(source.order) },
        collapsed: { ...asObject(source.collapsed) },
        hiddenWorkspaces: asArray(source.hiddenWorkspaces).map(String),
        activeWorkspace:
          source.activeWorkspace === null || source.activeWorkspace === undefined ? null : String(source.activeWorkspace),
        imported: source.imported === true,
        online: online === undefined ? false : online === true,
      };
    }

    function readCache() {
      try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (!raw) return { ...EMPTY_STATE };
        return mergeState(JSON.parse(raw), false);
      } catch {
        return { ...EMPTY_STATE };
      }
    }

    function writeCache(state) {
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...state, online: false }));
      } catch {}
    }

    function readLegacy() {
      try {
        const raw = window.localStorage.getItem(LEGACY_KEY);
        return raw ? JSON.parse(raw) : undefined;
      } catch {
        return undefined;
      }
    }

    async function request(path, init) {
      const response = await fetch(API + path, { credentials: "same-origin", cache: "no-store", ...init });
      const text = await response.text();
      let value = {};
      try {
        value = text ? JSON.parse(text) : {};
      } catch {}
      if (!response.ok || value.ok === false) throw new Error(String((value && value.error) || "HTTP " + response.status));
      return value;
    }

    async function apiOp(payload) {
      return request("/op", {
        method: "POST",
        headers: { "content-type": "application/json", "x-dsg-request": "1" },
        body: JSON.stringify(payload),
      });
    }

    const store = (() => {
      let state = readCache();
      const listeners = new Set();
      let lastSyncAt = 0;
      let lastDigest = "";
      let legacyTried = false;
      let meta = { statePath: "" };
      const emit = () => {
        for (const fn of listeners) fn();
      };
      const commit = (next, online) => {
        state = { ...next, online: online === undefined ? state.online : online === true };
        writeCache(state);
        emit();
      };
      return {
        get: () => state,
        meta: () => meta,
        commit,
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async load() {
          try {
            const result = await request("/state");
            meta = { statePath: String((result.meta && result.meta.statePath) || "") };
            commit(mergeState(result.state), true);
            return true;
          } catch {
            if (state.online) commit({ ...state }, false);
            return false;
          }
        },
        /** 把会话/定时任务快照交给宿主：判定与写入只有宿主一处。 */
        async sync(sessions, schedules) {
          const digest =
            sessions.map((row) => row.id + "\u0001" + row.title).join("\u0002") +
            "\u0003" +
            schedules.map((row) => row.id + ":" + (row.targetSessionId || "") + ":" + (row.deliveredAt || "")).join("\u0002");
          if (digest === lastDigest && Date.now() - lastSyncAt < 15000) return;
          lastDigest = digest;
          lastSyncAt = Date.now();
          try {
            const result = await request("/sync", {
              method: "POST",
              headers: { "content-type": "application/json", "x-dsg-request": "1" },
              body: JSON.stringify({ sessions, schedules }),
            });
            meta = { statePath: String((result.meta && result.meta.statePath) || meta.statePath) };
            commit(mergeState(result.state), true);
          } catch {
            if (state.online) commit({ ...state }, false);
          }
        },
        async op(payload) {
          const result = await apiOp(payload);
          commit(mergeState(result.state), true);
          return result;
        },
        /** v1（纯 localStorage 时代）的分组只在第一次接上宿主时导入一次。 */
        async importLegacy() {
          if (legacyTried || state.imported) return;
          legacyTried = true;
          const legacy = readLegacy();
          if (!legacy || !asArray(legacy.groups).length) return;
          try {
            const result = await apiOp({ op: "import", state: legacy });
            commit(mergeState(result.state), true);
          } catch {}
        },
        async models() {
          try {
            const result = await request("/models");
            return asArray(result.providers);
          } catch {
            return [];
          }
        },
      };
    })();

    function useGroups() {
      return useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /* 分组判定（规则匹配、定时任务绑定、许可状态）全在宿主侧：客户端只
     * 负责把那批会话/定时任务的快照送过去，并渲染宿主返回的待确认建议。 */


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

    /* 许可条：自动分类永远先问人。四个选项就是产品约定：
     * 是 / 否 / 始终允许该组别（以后同组不再问）/ 让我自己决定（手选）。 */
    function ConsentBar(props) {
      const { title, proposal, pendingCount, onAnswer, onPick } = props;
      const reason = proposal.reason === "llm" ? "模型判断" : proposal.reason === "agent" ? "agent 建议" : "命中规则";
      return h(
        "div",
        { className: "dsg-consent", "data-dsg": "consent" },
        h(
          "div",
          { className: "dsg-consent-title" },
          "「",
          title,
          "」建议归入 ",
          h("span", { className: "dsg-consent-group" }, "「" + proposal.groupName + "」"),
          h("span", { className: "dsg-consent-note" }, " · " + reason)
        ),
        pendingCount > 1 ? h("div", { className: "dsg-consent-note" }, `另有 ${pendingCount - 1} 条待确认，先处理这一条`) : null,
        h(
          "div",
          { className: "dsg-consent-actions" },
          h("button", { className: "dsg-btn", "data-tone": "primary", onClick: () => onAnswer("yes") }, "是"),
          h("button", { className: "dsg-btn", onClick: () => onAnswer("no") }, "否"),
          h("button", { className: "dsg-btn", onClick: () => onAnswer("always") }, "始终允许该组别"),
          h("button", { className: "dsg-btn", "data-tone": "ghost", onClick: onPick }, "让我自己决定")
        )
      );
    }

    /* Electron 没有 window.prompt，桌面端里它直接抛错——所以文本输入也必须自绘。 */
    function TextDialog(props) {
      const { state, onCancel } = props;
      const [value, setValue] = useState(state.value || "");
      const inputRef = useRef(null);
      useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        try {
          el.select();
        } catch {}
      }, []);
      const submit = () => {
        const text = String(value || "").trim();
        if (!text) return;
        onCancel();
        state.onOk(text);
      };
      return h(
        "div",
        { className: "dsg-dialog-mask", onClick: onCancel },
        h(
          "div",
          { className: "dsg-panel", role: "dialog", "aria-label": state.title, onClick: (e) => e.stopPropagation() },
          h("div", { className: "dsg-panel-title" }, state.title),
          h("input", {
            ref: inputRef,
            className: "dsg-input",
            value,
            placeholder: state.placeholder,
            onChange: (e) => setValue(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            },
          }),
          h(
            "div",
            { className: "dsg-consent-actions" },
            h("button", { className: "dsg-btn", "data-tone": "primary", onClick: submit }, "确定"),
            h("button", { className: "dsg-btn", "data-tone": "ghost", onClick: onCancel }, "取消")
          )
        )
      );
    }

    function ConfirmDialog(props) {
      const { state, onCancel } = props;
      return h(
        "div",
        { className: "dsg-dialog-mask", onClick: onCancel },
        h(
          "div",
          { className: "dsg-panel", role: "dialog", "aria-label": state.title, onClick: (e) => e.stopPropagation() },
          h("div", { className: "dsg-panel-title" }, state.title),
          h("div", { className: "dsg-consent-note" }, state.body),
          h(
            "div",
            { className: "dsg-consent-actions" },
            h(
              "button",
              {
                className: "dsg-btn",
                "data-tone": "primary",
                onClick: () => {
                  onCancel();
                  state.onOk();
                },
              },
              "删除"
            ),
            h("button", { className: "dsg-btn", "data-tone": "ghost", onClick: onCancel }, "取消")
          )
        )
      );
    }

    function GroupPickerPanel(props) {
      const { title, groups, onPick, onNew, onCancel } = props;
      return h(
        "div",
        { className: "dsg-dialog-mask", onClick: onCancel },
        h(
          "div",
          { className: "dsg-panel", role: "dialog", "aria-label": "选择分组", onClick: (e) => e.stopPropagation() },
          h("div", { className: "dsg-panel-title" }, "把「" + title + "」放到："),
          h(
            "div",
            { className: "dsg-consent-actions", style: { flexDirection: "column", alignItems: "stretch" } },
            groups.map((group) =>
              h("button", { key: group.id, className: "dsg-btn", style: { textAlign: "left" }, onClick: () => onPick(group.id) }, group.name)),
            h("button", { className: "dsg-btn", style: { textAlign: "left" }, onClick: () => onPick(null) }, "未分组"),
            h("button", { className: "dsg-btn", "data-tone": "ghost", style: { textAlign: "left" }, onClick: onNew }, "+ 新建分组…")
          ),
          h("div", { className: "dsg-consent-actions" },
            h("button", { className: "dsg-btn", "data-tone": "ghost", onClick: onCancel }, "取消"))
        )
      );
    }
    /*
     * 规则面板：定时任务可以按任务绑定（按 id，不再靠标题猜），关键词只是兜底。
     * “始终允许”白名单也在这里撤销；状态文件路径直接显示，方便备份。
     */
    function RulesPanel(props) {
      const { groups, rules, schedules, autoAllow, classifier, statePath, online, onOp, onClose, loadModels } = props;
      const [draft, setDraft] = useState({ id: "", groupName: "", keywords: "", scheduleIds: [] });
      const [mode, setMode] = useState(classifier.mode);
      const [provider, setProvider] = useState(classifier.provider);
      const [model, setModel] = useState(classifier.model);
      const [providers, setProviders] = useState([]);

      useEffect(() => {
        let alive = true;
        void Promise.resolve(loadModels()).then((rows) => {
          if (alive) setProviders(Array.isArray(rows) ? rows : []);
        });
        return () => {
          alive = false;
        };
      }, [loadModels]);

      const providerRow = providers.find((row) => row.id === provider);
      const modelRows = providerRow ? providerRow.models || [] : [];
      const scheduled = (schedules || []).filter((row) => row.id);
      const canSaveRule = draft.groupName.trim().length > 0 && (draft.keywords.trim().length > 0 || draft.scheduleIds.length > 0);

      const startEdit = (rule) =>
        setDraft({
          id: rule.id,
          groupName: rule.groupName,
          keywords: (rule.any || []).join("，"),
          scheduleIds: [...(rule.scheduleIds || [])],
        });
      const resetDraft = () => setDraft({ id: "", groupName: "", keywords: "", scheduleIds: [] });
      const saveRule = () => {
        if (!canSaveRule) return;
        onOp({
          op: "rule.upsert",
          rule: {
            id: draft.id,
            groupName: draft.groupName.trim(),
            any: draft.keywords.split(/[,，\n]/),
            scheduleIds: draft.scheduleIds,
          },
        });
        resetDraft();
      };
      const toggleSchedule = (id) =>
        setDraft((current) => ({
          ...current,
          scheduleIds: current.scheduleIds.includes(id)
            ? current.scheduleIds.filter((entry) => entry !== id)
            : current.scheduleIds.concat([id]),
        }));

      return h(
        "div",
        { className: "dsg-panel", role: "dialog", "aria-label": "自动归组设置", "data-dsg": "rules" },
        h(
          "div",
          { className: "dsg-panel-title" },
          "自动归组",
          h("span", { className: "dsg-spacer" }),
          h("button", { className: "dsg-icon", title: "关闭", onClick: onClose }, "✕")
        ),
        online
          ? null
          : h("div", { className: "dsg-warn" }, "宿主端未连接：本次改动只进浏览器缓存，不会跨端同步。"),

        h(
          "div",
          { className: "dsg-field" },
          h("div", { className: "dsg-field-label" }, "规则（定时任务绑定优先于关键词；命中后先问再归组）"),
          rules.length === 0
            ? h("div", { className: "dsg-consent-note" }, "还没有规则。新会话就只能靠模型兜底或手动分组。")
            : rules.map((rule) =>
                h(
                  "div",
                  { key: rule.id, className: "dsg-rule" },
                  h(
                    "div",
                    { className: "dsg-rule-head" },
                    rule.groupName,
                    h(
                      "span",
                      { className: "dsg-rule-actions" },
                      h("button", { className: "dsg-btn", style: { height: 22, fontSize: 11 }, onClick: () => startEdit(rule) }, "改"),
                      h("button", { className: "dsg-btn", style: { height: 22, fontSize: 11 }, onClick: () => onOp({ op: "rule.delete", ruleId: rule.id }) }, "删")
                    )
                  ),
                  h(
                    "div",
                    { className: "dsg-rule-meta" },
                    (rule.any || []).length ? "关键词：" + rule.any.join("、") : "无关键词",
                    (rule.scheduleIds || []).length
                      ? " · 定时任务：" +
                        rule.scheduleIds
                          .map((id) => {
                            const found = scheduled.find((row) => row.id === id);
                            return found && found.title ? found.title : id;
                          })
                          .join("、")
                      : ""
                  )
                )
              )
        ),

        h(
          "div",
          { className: "dsg-field" },
          h("div", { className: "dsg-field-label" }, draft.id ? "编辑规则" : "新增规则"),
          h("input", {
            className: "dsg-input",
            list: "dsg-group-names",
            value: draft.groupName,
            placeholder: "分组名（可选已有或新建）",
            onChange: (e) => setDraft({ ...draft, groupName: e.target.value }),
          }),
          h("datalist", { id: "dsg-group-names" }, groups.map((group) => h("option", { key: group.id, value: group.name }))),
          h("input", {
            className: "dsg-input",
            value: draft.keywords,
            placeholder: "关键词，逗号分隔（可留空）",
            onChange: (e) => setDraft({ ...draft, keywords: e.target.value }),
          }),
          scheduled.length
            ? h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 132, overflow: "auto" } },
                scheduled.map((row) =>
                  h(
                    "label",
                    { key: row.id, className: "dsg-sched" },
                    h("input", {
                      type: "checkbox",
                      checked: draft.scheduleIds.includes(row.id),
                      onChange: () => toggleSchedule(row.id),
                    }),
                    row.title || row.id
                  )
                )
              )
            : null,
          h(
            "div",
            { className: "dsg-consent-actions" },
            h("button", { className: "dsg-btn", "data-tone": "primary", disabled: !canSaveRule, onClick: saveRule }, draft.id ? "保存修改" : "添加规则"),
            draft.id ? h("button", { className: "dsg-btn", "data-tone": "ghost", onClick: resetDraft }, "取消编辑") : null
          )
        ),

        h(
          "div",
          { className: "dsg-field" },
          h("div", { className: "dsg-field-label" }, "规则没命中时让模型判断（默认关，每次最多 3 个新会话）"),
          h(
            "div",
            { className: "dsg-consent-actions" },
            h("button", { className: "dsg-btn", "data-tone": mode === "off" ? "primary" : undefined, onClick: () => setMode("off") }, "关闭"),
            h("button", { className: "dsg-btn", "data-tone": mode === "llm" ? "primary" : undefined, onClick: () => setMode("llm") }, "模型判断")
          ),
          mode === "llm"
            ? h(
                React.Fragment,
                null,
                h(
                  "select",
                  {
                    className: "dsg-select",
                    value: provider,
                    onChange: (e) => {
                      setProvider(e.target.value);
                      setModel("");
                    },
                  },
                  h("option", { value: "" }, "选择提供方"),
                  providers.map((row) => h("option", { key: row.id, value: row.id }, row.name || row.id))
                ),
                h(
                  "select",
                  { className: "dsg-select", value: model, onChange: (e) => setModel(e.target.value) },
                  h("option", { value: "" }, "选择模型"),
                  modelRows.map((row) => h("option", { key: row.id, value: row.id }, row.name || row.id))
                )
              )
            : null,
          h(
            "div",
            { className: "dsg-consent-actions" },
            h(
              "button",
              {
                className: "dsg-btn",
                "data-tone": "primary",
                disabled: mode === "llm" && (!provider || !model),
                onClick: () => onOp({ op: "setting", classifier: { mode, provider, model } }),
              },
              "保存分类方式"
            )
          )
        ),

        h(
          "div",
          { className: "dsg-field" },
          h("div", { className: "dsg-field-label" }, "始终允许（不再询问）的组别"),
          Object.keys(autoAllow).length === 0
            ? h("div", { className: "dsg-consent-note" }, "暂无。在许可条上点「始终允许该组别」就会加进来。")
            : h(
                "div",
                { className: "dsg-consent-actions" },
                Object.keys(autoAllow).map((groupId) => {
                  const group = groups.find((entry) => entry.id === groupId);
                  if (!group) return null;
                  return h(
                    "button",
                    { key: groupId, className: "dsg-btn", title: "撤销，恢复逐次询问", onClick: () => onOp({ op: "autoAllow.revoke", groupId }) },
                    group.name + " ×"
                  );
                })
              )
        ),

        h("div", { className: "dsg-consent-note" }, "状态文件：" + (statePath || "（未连接）"))
      );
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
      const hidden = groups.hiddenWorkspaces || [];

      const ids = useMemo(() => (list?.ids || []).filter((id) => byId[id] && !isSubagent(byId[id])), [list, byId]);
      const archived = useMemo(() => ids.filter((id) => archivedSet.has(id)), [ids, archivedSet]);
      const live = useMemo(() => ids.filter((id) => !archivedSet.has(id)), [ids, archivedSet]);

      /* 会话/定时任务快照交给宿主。判定、许可状态与落盘都在宿主侧，
       * 客户端只报数并渲染返回的待确认建议。 */
      const scheduleDigest = useMemo(
        () =>
          (Array.isArray(schedules) ? schedules : []).map((row) => ({
            /* 目录行有两种形状：存储里的 {record, target, lastDelivery}
             * 与客户端目录拍扁后的同名行，两种都认。 */
            id: String((row && ((row.record && row.record.id) || row.id)) || ""),
            title: String((row && ((row.record && row.record.title) || row.title)) || ""),
            targetSessionId: String((row && row.lastDelivery && row.lastDelivery.targetSessionId) || ""),
            deliveredAt: String((row && row.lastDelivery && row.lastDelivery.deliveredAt) || ""),
          })),
        [schedules]
      );
      const sessionDigest = useMemo(
        () =>
          live.map((id) => ({
            id,
            title: titleOf(byId[id], id),
            createdAt: Number(byId[id] && byId[id].createdAt) || undefined,
            updatedAt: Number(byId[id] && byId[id].updatedAt) || undefined,
          })),
        [live, byId]
      );

      useEffect(() => {
        void (async () => {
          const reachable = await store.load();
          if (!reachable) return;
          await store.importLegacy();
          await store.sync(sessionDigest, scheduleDigest);
        })();
        // 只在挂载时跑一次；后续靠下面的 digest 变化与轮询。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      useEffect(() => {
        if (sessionDigest.length === 0 && scheduleDigest.length === 0) return undefined;
        const timer = setTimeout(() => {
          void store.sync(sessionDigest, scheduleDigest);
        }, 400);
        return () => clearTimeout(timer);
      }, [sessionDigest, scheduleDigest]);

      /* 另一扇窗、或桌面端刚 accept 过许可时让本窗跟上；页面隐藏时不跑。 */
      useEffect(() => {
        const timer = setInterval(() => {
          try {
            if (document.visibilityState === "hidden") return;
          } catch {}
          void store.load();
        }, 20000);
        return () => clearInterval(timer);
      }, []);
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
            if (revealed.length > 0) {
              void store.op({ op: "order.set", key: "recent", ids: saved.concat(revealed) }).catch(() => {});
            }
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

      /* 所有写操作都发给宿主：宿主是唯一写入方，返回的整份状态直接替换本地。 */
      const op = useCallback((payload) => {
        void store.op(payload).catch((err) => console.error("[dsh-sidebar-sessions] op failed", err));
      }, []);

      /* 自绘输入/确认框：Electron 不实现 window.prompt，桌面端里它直接抛错，
       * 以前新建分组、重命名分组、重命名对话在桌面端全是静的。 */
      const [promptState, setPromptState] = useState(null);
      const [confirmState, setConfirmState] = useState(null);
      const [rulesOpen, setRulesOpen] = useState(false);
      const [picker, setPicker] = useState(null);

      const askText = useCallback((title, value, placeholder, onOk) => {
        setPromptState({ title, value: value || "", placeholder: placeholder || "", onOk });
      }, []);
      const askConfirm = useCallback((title, body, onOk) => setConfirmState({ title, body: body || "", onOk }), []);

      const toggle = useCallback((key) => op({ op: "collapsed", key, value: !(collapsed || {})[key] }), [collapsed, op]);
      const assignTo = useCallback((id, gid) => op({ op: "assign", sessionId: id, groupId: gid || null }), [op]);
      const consent = useCallback((sessionId, choice) => op({ op: "consent", sessionId, choice }), [op]);

      const createGroup = useCallback((sessionId) => {
        askText("新建分组", "", "分组名称", (name) => op({ op: "group.create", name, sessionId }));
      }, [askText, op]);

      const renameGroup = useCallback((g) => {
        askText("重命名分组", g.name, "分组名称", (name) => op({ op: "group.rename", groupId: g.id, name }));
      }, [askText, op]);

      const deleteGroup = useCallback((g) => {
        askConfirm(`删除分组「${g.name}」`, "组内会话会回到未分组，绑定该组的规则也会一起删掉。", () =>
          op({ op: "group.delete", groupId: g.id }));
      }, [askConfirm, op]);

      const switchWorkspace = useCallback((item) => {
        op({ op: "workspace.active", id: String(item.workspaceId) });
        try {
          if (openWorkspace) Promise.resolve(openWorkspace(item.workspaceId)).catch((err) => console.error("[dsh-sidebar-sessions] switch workspace failed", err));
        } catch (err) {
          console.error("[dsh-sidebar-sessions] switch workspace failed", err);
        }
      }, [openWorkspace, op]);

      const hideWorkspace = useCallback((item) => {
        op({ op: "workspaces.hidden", ids: [...new Set([...(hidden || []), String(item.workspaceId)])] });
      }, [hidden, op]);

      const unhideWorkspace = useCallback((item) => {
        op({ op: "workspaces.hidden", ids: (hidden || []).filter((id) => id !== String(item.workspaceId)) });
      }, [hidden, op]);

      const closeMenu = useCallback(() => setMenu(null), []);
      const openMenu = useCallback((id, el) => {
        const r = el.getBoundingClientRect();
        setMenu({ id, x: Math.min(r.right - 190, Math.max(8, window.innerWidth - 210)), y: Math.min(r.bottom + 2, window.innerHeight - 280) });
      }, []);

      const renameRow = useCallback((id) => {
        askText("重命名对话", titleOf(byId[id], id), "对话标题", async (name) => {
          if (!renameSession) return;
          try {
            await renameSession(id, name);
          } catch (err) {
            console.error("[dsh-sidebar-sessions] rename failed", err);
          }
        });
      }, [askText, byId, renameSession]);

      const copy = useCallback((text) => {
        try {
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
        } catch {}
      }, []);

      const commitSectionOrder = useCallback((sectionKey, next) => {
        if (!next || sectionKey === "search") return;
        op({ op: "order.set", key: sectionKey, ids: next });
      }, [op]);

      const clearSectionOrder = useCallback((sectionKey) => op({ op: "order.clear", key: sectionKey }), [op]);

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
      /* 待确认建议：一次只问一条，其余条数在许可条里提示。 */
      const loadModels = useCallback(() => store.models(), []);
      const statePath = store.meta().statePath || "";
      const consentEntries = Object.entries(groups.pending || {}).filter(([id]) => byId[id]);
      const consentEntry = consentEntries[0];
      const consentTitle = consentEntry ? titleOf(byId[consentEntry[0]], consentEntry[0]) : "";

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
            (() => {
              const current = groups.groups.find((g) => g.id === assign[menu.id]);
              if (!current) return null;
              const via = (Array.isArray(schedules) ? schedules : []).find(
                (row) => row && row.lastDelivery && row.lastDelivery.targetSessionId === menu.id
              );
              const viaId = via ? (via.record && via.record.id) || via.id : undefined;
              if (!viaId) return null;
              const scheduleId = String(viaId);
              return h(
                "div",
                {
                  className: "dsg-menu-item",
                  title: "为这个定时任务建规则：以后它新建的会话直接进这个组",
                  onClick: () => {
                    op({ op: "rule.upsert", rule: { groupName: current.name, scheduleIds: [scheduleId] } });
                    closeMenu();
                  },
                },
                "记住：该定时任务归这里"
              );
            })(),
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
        h("div", { className: "dsg-consent-actions", style: { margin: "0 2px 6px" } },
          h(
            "button",
            {
              className: "dsg-btn",
              "data-tone": "ghost",
              style: { height: 24, fontSize: 11, padding: "0 8px" },
              title: "自动归组规则 / 模型分类 / 始终允许白名单",
              onClick: () => setRulesOpen(true),
            },
            "⚙ 自动归组" + (groups.rules.length ? `（${groups.rules.length}）` : "")
          ),
          groups.online ? null : h("span", { className: "dsg-consent-note" }, "宿主未连接")),
        consentEntry
          ? h(ConsentBar, {
              title: consentTitle,
              proposal: consentEntry[1],
              pendingCount: consentEntries.length,
              onAnswer: (choice) => consent(consentEntry[0], choice),
              onPick: () => {
                setPicker({ sessionId: consentEntry[0], title: consentTitle });
                consent(consentEntry[0], "later");
              },
            })
          : null,
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
        rulesOpen
          ? h(RulesPanel, {
              groups: groups.groups,
              rules: groups.rules,
              schedules: scheduleDigest,
              autoAllow: groups.autoAllow,
              classifier: groups.settings.classifier,
              statePath: statePath,
              online: groups.online,
              onOp: op,
              onClose: () => setRulesOpen(false),
              loadModels: loadModels,
            })
          : null,
        picker
          ? h(GroupPickerPanel, {
              title: picker.title,
              groups: groups.groups,
              onPick: (gid) => {
                assignTo(picker.sessionId, gid);
                setPicker(null);
              },
              onNew: () => {
                const sessionId = picker.sessionId;
                setPicker(null);
                createGroup(sessionId);
              },
              onCancel: () => setPicker(null),
            })
          : null,
        promptState ? h(TextDialog, { key: "prompt", state: promptState, onCancel: () => setPromptState(null) }) : null,
        confirmState ? h(ConfirmDialog, { key: "confirm", state: confirmState, onCancel: () => setConfirmState(null) }) : null,
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
