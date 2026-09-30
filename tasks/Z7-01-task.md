---
round: Z7
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T11:55:00+08:00
---

# Z7 任务包：把 `wire.*` 接成真实通道（静态证据驱动；**小步、别通读大文件**）

> 背景：插件已可在 DSH GUI「设置/侧栏 → 插件 → 添加插件」用**本地目录路径**手动安装（官方入口，源码文案实证）；装完能立刻看到悬浮窗，但 `wire.host.mjs` / `wire.client.mjs` 目前是 TODO 适配器 → **只显示 demo 数据**。
> 本单目标：按官方插件的既有形态，把"客户端 ↔ 宿主"的数据通道接上。**只动这两个文件 + 必要时 package.json；不要改 UI 结构、不要改 core。**

## 一、证据材料（已备好，直接读）

1. `F:\My Code\dsh-plugins\refs\dsh-plugin-manager\` —— 官方「插件管理页」整包（它自己就用 Remote 与宿主通信）：
   - `README.zh.md`（22KB）：搜「Remote」「typert」「Host 入口」段落，讲清了 Remote BFF 面的定位
   - `lib/typert.host.js`（2.4KB）与 `lib/typert.remote-client.js`（1.2KB）：**生成产物样例**（`TYPERT` / `TYPERT_REMOTE` 描述符是纯数据）
   - `lib/index.js`（5.5KB）：宿主半边怎么写出这个"face"
   - `lib/client.js`（184KB）：客户端怎么调用（**只搜关键片段，别通读**）
2. `F:\My Code\dsh-plugins\refs\SKILL.md` + `refs/references/practices.md`（`wire.view`）、`refs/references/user-actions.md`（「UI 动作调用 Host 入口，如 `ctx.remote.commands.execute()`」）
3. `F:\My Code\dsh-plugins\refs\dsh-plugin-manager\dsh-cli-plugin-command.js`：DSH CLI 的 `plugin` 子命令实现（说明装包与 bundle 注册是两件事，供你理解安装路径，不必改）

## 二、要产出的东西

1. **`wire.host.mjs`**：宿主侧把一个 Remote 面暴露出来，至少这些方法（参数/返回都要 JSON 可序列化）：
   - `snapshot()` → `{ generatedAt, counts, locks, queue, jobs, channels }`（直接复用 `dispatcher.snapshot()` + `listChannels()`；channels 可缓存 5s）
   - `dispatch(spec)` → `{ ok, job }` 或 `{ ok:false, error }`
   - `kill(id)` → `{ ok }` / `retry(id, {provider, model})` → `{ ok, job }`
   - `tail(id, n)` → `string[]`
   - `setChannel({provider, model})` / `setFallbackChain(list|null)`
2. **`wire.client.mjs`**：客户端侧通过 Remote 代理调用上述方法：
   - `subscribe(cb)` → 若官方 Remote 支持推送就用推送；**不支持就用 1s 轮询 `snapshot()`**（简单优先）
   - `dispatch/kill/retry/tail/setChannel/setFallbackChain` 一一对应
   - **保留现有 demo 回退**：Remote 不可用（未接上/加载失败）时继续用假数据渲染，绝不白屏、不抛到组件外
3. **（仅在必要时）`package.json`**：若官方形态要求声明 face/远程条目，就按其字段加；**必须保留现有全部字段**（`dsh.bundle.patch`、`dsh.client`、`exports`、`meta`、`icon`、`files`）。

## 三、硬约束

- ❌ 不改 `client.js` 的组件树/样式/文案；❌ 不改 `core/*`、`index.js` 的既有导出语义（可加行）；❌ 不安装、不写 `$DSH_HOME`、不改 宿主仓库、不 npm 依赖、不 git
- ❌ 不要把 `@deepseek-ai/dsh-client-ui-primitives` 或任何 DSH 客户端包当模块 import（官方技能明确禁止）
- ✅ 一切注册/订阅用 `ctx.effect`/`ctx.on` 包裹并返回清理函数
- ✅ **无法确定就如实写"未确定 + 你看到的证据"**，不要编 API；宁可保留 demo 回退

## 四、自检（必须贴原始输出）

1. `node --check wire.host.mjs` / `node --check wire.client.mjs` / `node --check client.js` / `node --check index.js`
2. **DSH 侧探针**：`node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` → 必须仍 **18/18**（它用桩 ModuleLoader 加载 client.js、检查槽位注册与纪律）
3. 既有测试：`node test/core.test.mjs`、`node test/channel-retry.test.mjs` 必须不回归（你没动 core，但要求证）
4. `package.json` 可 `JSON.parse` 且字段齐全（逐条列出）

## 五、交付

`tasks/Z7-delivery.md`：改动清单 / **你确定下来的 Remote 形态**（贴关键代码片段与来源文件行号）/ 复现命令 + 原始输出 / 未确定项（若有）。最终回复同样简短给出这四段。
