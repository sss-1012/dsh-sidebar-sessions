# dsh-sidebar-sessions

DeepSeek Harness 的会话侧边栏增强插件：**最近优先 + 自定义分组 + 工作区树 + 归档 + 状态点 + 拖动排序**。

它接管 Web 端 `sidebar.workspaces` 插槽，把原本按工作区平铺的会话列表换成一条以「最近使用」为先的清单。

> **建议使用暗黑模式（深色主题）以获得最佳体验**：配色全部取自 DSH 主题变量（`--dsw-alias-*`），暗色下状态点、hover 行背景与拖动落点线的对比最清楚；浅色主题同样能用，只是侧栏与主区域的明度差小一些。

## 功能

- **最近优先**：顶部「最近」区按最近活跃时间排序（默认 20 条）。
- **置顶**：手动置顶的会话单独一组。
- **自定义分组**：新建 / 重命名 / 删除分组，任意会话可移入分组（数据存 localStorage）。
- **工作区树**：📁 工作区节点可折叠，展开列出各工作区；📌 标记当前工作区，点击工作区名即可切换（调用宿主 `openWorkspace`）。
- **归档**：已归档会话收进「已归档」分组，可展开查看 / 取消归档。
- **搜索**：顶部搜索框按标题过滤，`Esc` 清空。
- **状态点**（官方 StateDot 同源数据）：
  - 待审批 → 琥珀圆点
  - 运行中 → 蓝色转圈
  - 已完成未读 → 绿色圆点
  - 空闲但设置了定时任务 → 线性时钟图标（代替灰点）
  - 空闲 → 灰点
- **拖动排序**：会话行可拖动。落点在目标行的**上半 → 插到它前面**、**下半 → 插到它后面**（蓝线标出落点），松手即生效；向下拖一格也能直接换位。工作区树内拖动写入宿主 `insertSessionBefore`（宿主拒绝时退回本地视图顺序）；「最近 / 置顶 / 分组 / 未分组 / 已归档」区的拖动记在视图顺序里（随会话组一起存 localStorage，刷新保持）。「最近」标题上的 ↺ 恢复按活跃时间排序。
- **行内操作**（悬停「⋯」）：置顶、重命名、分叉、复制 Session ID、复制工作目录、移动到分组、归档。

## 安装

尚未发布到 npm，用 GitHub Release 里的 tarball 安装：

```bash
dsh plugin --profile web add https://github.com/sss-1012/dsh-sidebar-sessions/releases/download/v0.1.2/dsh-sidebar-sessions-0.1.2.tgz
```

装完重启 `dsh web`（已开着的话按 Ctrl+R 刷新页面）。

本地开发（符号链接，改代码即时生效）：

```bash
dsh plugin --profile web add link:E:\Work\tools\dsh-sidebar-sessions
```

## 开发

无构建步骤：`lib/index.js` 是空的 host 半边，`lib/client.js` 是浏览器 bundle（`window.__ModuleLoader__.load` 格式，直接以 ESM 加载）。

```bash
node --check lib/client.js
node test/order.test.mjs
```

## 数据与限制

- 分组、折叠状态、隐藏工作区、当前工作区存在浏览器 `localStorage`（key `dsh-session-groups.v1`，兼容早期版本）；各视图的拖动顺序也存在同一个 key 的 `order` 字段里。
- 宿主拥有会话、置顶、归档、工作区与宿主顺序的最终状态；插件只做展示与写入调用。
- **接管式**：`sidebar.workspaces` 是独占插槽，安装后官方 WorkspaceBrowser 不再渲染，其逐项能力由本插件自行实现。
- 工作区「隐藏」是本地显示开关（DSH 0.2.1 客户端未暴露工作区归档 API），不是官方归档。
- 工作区树里跨工作区拖动会被忽略（宿主只接受同一工作区内的移动）；平铺区（最近 / 分组等）的拖动只改本视图顺序，不会把会话搬进别的分组或工作区。

## License

MIT
