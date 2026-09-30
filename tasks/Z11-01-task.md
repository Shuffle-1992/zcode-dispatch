---
round: Z11
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T14:22:00+08:00
---

# Z11 任务包：派发台 UI 第二轮（用户实测反馈四项）

> 背景：面板**已能在页面上显示**（用户确认）。当前显示的是内置**演示数据**（宿主 Remote 最后一跳未接，属已知，由创造模式处理，**不在本单**）。
> 本单只做用户明确提的四件事，**只改 `zcode-dispatch/client.js` + `locale/{zh,en}.json`，必要时 `wire.host.mjs` 的 `slimJob` 与 `README.md`。**

## 一、四项需求（用户原话 → 落地要求）

### 1. 去掉内置演示数据，改为**诚实的空态**
- 现状：`legacyWire()` 自带 3 条假进程（`j-demo-run` / `j-demo-done` / `j-demo-wait`），用户明确说"演示数据可以删除了"。
- 要求：默认**不再渲染任何假行**。
  - 远端（`ctx.remote.zcodeDispatch`）可用 → `conn='live'`（不变）；
  - `window.__zcodeDispatchDemo` 外部源存在 → `conn='ext'`（不变，调试用）；
  - 两者都没有 → **空态**：`conn` 用新的 `'offline'`，`snapshot` 为 `{counts:{running:0,queued:0,done:0,failed:0}, jobs:[], locks:{}, queue:0}`，并在进程区显示一行说明（新文案 key `emptyOffline`）：**「未连接宿主：无进程数据（真数据需完成 Remote 接线）」**；
  - 徽标映射补一档：`offline → 「未连接」`（新 key `connOffline`；`demo/ext/live` 三档保持）。
- 保留内置 demo 引擎代码但**默认不启用**（便于排查）：仅当 `window.__zcodeDispatchDemo === 'builtin'` 时使用。

### 2. 分区可折叠（通道 / 派发默认折叠）
- `Section` 组件加折叠能力：`h(Section, { title, id, collapsible: true, defaultOpen: false }, ...)`。
- **通道（`secChannel`）与 派发（`secDispatch`）默认折叠**；**进程（`secJobs`）与 用量（`secQuota`）默认展开**，`secLocks`（单写者）默认折叠。
- 折叠态存 `localStorage['zcode-dispatch:section:<id>']`（复用现有 `loadJson/saveJson`，已带 try/catch）。
- 折叠时只留标题一行（标题右侧倒三角指示），**点击整条标题栏都可切换**；⚠️ 沿用 Z9 教训：标题栏若挂拖拽类手势，必须先 `closest('button,...')` 守卫，且按钮 `onPointerDown` 停冒泡。
- 新增 section id 常量集中一处，勿散落魔法字符串。

### 3. 暂停（paused）的进程要能"关掉"
- 进程行在 `state === 'paused'` 时，除现有「同通道续跑 / 换通道重跑」外，加一个 **「关闭」** 按钮（新 key `kill`/`closeJob`，用 `zcd-btn2` 样式），点击调用 `wire.kill(job.id)`。
- **先核对 core 语义**：`core/dispatch-core.mjs` 的 `kill(id)` 对 `paused` 状态是否有效（paused 时子进程已退出、锁已释放）。若 `kill` 对 paused 是空操作，则在 `wire.host.mjs` 的 `createActionHandler` 增加 `dismiss` 动作（把 job 从列表移除并落盘；**不许**改动 core 的既有语义），并在 UI 的关闭按钮里优先 `kill`、失败/无效时退回 `dismiss`。
- 关闭后该行应变为 `killed` 或从列表消失（二选一，选实现更稳的并在交付文档写明）。

### 4. 点击进程行 → 看到"派发了什么"（多进程区分）
- 现状：`JobList` 的行只有 head（tag/状态/模型/用量）+ 操作按钮 + 可展开的 tail；用户抱怨"多个进程无法区分"，要求**点击进程能看到派发内容**。
- 要求：
  - **点击行头（非按钮区域）切换展开**；展开区显示该 job 的派发要素：
    `kind`（prompt/task/target）、`prompt` 或 `task` 路径或 `target` 目标、`provider`/`model`、`mode`、`cwd`、`timeoutMin`、`createdAt`、`sessionId`（有则显示）、`pauseReason`（有则显示中文标签）；
  - 长文本截断显示（prompt 最多 1200 字符 + 「…」），并保留「输出」子块（现有 tail 能力，标题用 `tail`）；
  - 展开态用现有 `useState` 局部管理即可（不必持久化）；
  - 若 `slimJob`（`wire.host.mjs`）没把 `spec` 带出来 → 在 `slimJob` 里补一个**裁剪过的** `spec`（prompt/task/target 截断 2000 字符、去掉绝对 capture 路径，保持既有的"capture 不出网"纪律），并在交付文档说明；
  - demo wire 的假 job 也要带 `spec.prompt`（保持形状一致，便于 `window.__zcodeDispatchDemo` 调试）。

## 二、硬约束

- ❌ 不改 `core/*` 既有语义（只允许在 wire 层加动作）；❌ 不改宿主 `index.js` 的 Config 字段；❌ 不碰启动路径（**客户端 `inject` 保持 `['slots','remote']`，不许出现自家 `remote.*`**；`apply` 的 try/catch 不许拆）
- ❌ 不安装、不写 `$DSH_HOME`、不改 宿主仓库、不 npm 依赖、不 git
- ✅ 文案一律走 locale（`locale/zh.json` + `locale/en.json` 同步加 key，不许硬编码中文到组件里）
- ✅ 主题令牌纪律不变（`T` 常量是唯一出口，零字面色值）
- ✅ 每改一处立刻落盘；不通读大文件（用行号/函数名定位）

## 三、自检（贴原始输出）

1. `node --check client.js`、`node --check wire.host.mjs`
2. `Z2_ALLOW_PROFILE_WRITE=1 node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"` → **20/20**
3. `cd zcode-dispatch && node test/core.test.mjs`（11/11）、`node test/channel-retry.test.mjs`（8/8）不回归
4. **新增本地桩测试（跑完即删）**：
   - 默认（无 remote / 无 `__zcodeDispatchDemo`）→ **无任何 `j-demo-*` 行**，且渲染出空态文案；
   - 点击 Section 标题 → 折叠态切换（回调被调用、localStorage 写入）；
   - 点击 job 行头 → 展开且渲染出 `spec.prompt` 文本；点击行内按钮**不**切换展开；
   - 点击关闭按钮 → 调用 `wire.kill(id)`（或 fallback `dismiss`）；
   - 浅渲染仍不抛错。
5. **明确写一句**：真实点击行为需用户刷新页面后确认（本环境无法点浏览器）。

## 四、交付

`tasks/Z11-delivery.md`：改动清单（逐条对着上面四项）/ 复现命令 + 原始输出 / 未确定项。最终回复简短给出同四段。
