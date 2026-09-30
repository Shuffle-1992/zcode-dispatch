---
round: Z3
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T06:00:00+08:00
---

# Z3 任务包：接入「ZCode 套餐真实额度」（5h / 1w 剩余与重置）

> 派发方 DSH。这是插件目前**唯一的功能缺口**：用量面板现在只有本地台账聚合，没有"套餐剩余额度"。
> 写入范围：`F:\My Code\dsh-plugins\zcode-dispatch\core\` 与 `test\`、`tasks\`。**不要改 UI**（`client.js`/`index.js` 不在本单范围）。

## 一、已知线索（都已由 DSH 实证，直接用，别重复摸索）

1. ZCode Agent CLI 有 app-server 模式（与桌面端同一引擎）：
   `node "F:\Program Files\ZCode\resources\glm\zcode.cjs" app-server --stdio --surface terminal`
   需两个环境变量（否则起不来）：
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=F:\Program Files\ZCode\resources\config\provider\zcode-builtin.json`
   `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=C:\Users\Administrator\.zcode\v2\provider_config.json`
2. 协议是「ZCode Protocol stdio」（CLI 自述），bundle 里存在方法名映射：
   `usageStats: "usage/stats"`、`sessionUsage: "session/usage"`、`processChildProcesses: "process/childProcesses"` 等
3. 客户端里看到的套餐字段（来自 app.asar 反查，仅供理解语义）：
   - 文案：`settings.modelProvider.planCard.usage.fiveHour` = "5h 用量"、`.week` = "1w 用量"、`sidebar.usage.plan.remainingValue` = "剩余"、`.resetAt` = "{time} 重置"
   - 结构：`{ available_five_hour_resets: [{expire_at}], available_week_resets: [{expire_at}], latest_five_hour_reset_history, latest_week_reset_history, has_unread_history }`
   - 接口：`GET https://zcode.z.ai/api/v1/coding-plan/reset/status` —— **DSH 已试过裸 Key/OAuth token + 6 种 header 形态，全部 401**，说明需要客户端那套签名/头。别再走这条 HTTP 路。
4. 本机凭证位置（**只读，禁止打印/落盘/入库**）：`C:\Users\Administrator\.zcode\v2\credentials.json`、`C:\Users\Administrator\.zcode\v2\config.json`（后者含 `builtin:bigmodel-coding-plan.options.apiKey`）。
5. 已有实现：`core/quota.mjs` 的 `fetchPlanQuota(options)` 目前返回 `{ available:false, reason:'pending-app-server-rpc' }` —— 本单把它换成真实实现（保持"任何失败都返回 available:false + reason，绝不抛错"）。

## 二、交付物

### 1. `core/appserver-rpc.mjs`（新）
- `export async function createAppServerClient({ cliPath?, env?, timeoutMs = 20000, spawnImpl? })` → 返回 `{ call(method, params), close(), stderrTail() }`，内部：
  - 用 `spawn` 起 `node <zcode.cjs> app-server --stdio --surface terminal`，**逐行 NDJSON** 收发（自己摸索握手：先发候选 `initialize` / 直接发业务请求，两条路都试，把**原始收发报文**记下来）
  - 请求带自增 `id`，按 `id` 匹配响应；超时/进程退出要有明确错误
  - 关闭时杀进程（含 Windows 下子进程树）；泄露检测：`close()` 后不得有残留 node 进程（用 pid 记录 + `taskkill /T` 兜底）
- 单测用 `spawnImpl` 注入假进程（不需要真 CLI）

### 2. `core/quota.mjs`（改 `fetchPlanQuota`）
- 真实调用 app-server，返回统一形状：
  `{ available:true, plan:'bigmodel-coding-plan', windows:[{id:'5h',used,limit,remaining,percentUsed,resetAt},{id:'week',...}], source:'app-server:usage/stats', raw }`
- 字段对不上时**尽量映射**，映射不了就放 `raw` 并标 `mapped:false`；任何异常 → `{available:false, reason:'<短因>'}`
- **必须**保留原有 `aggregate()` 行为不变（向后兼容）

### 3. `test/quota-rpc.test.mjs`（新）
- 假 app-server 进程：给定请求报文回固定响应 → 断言解析与字段映射
- 超时、进程异常退出、JSON 坏行、方法不存在 → 断言返回 `available:false` 且**不抛**
- `close()` 后无残留进程（可断言 kill 被调用）

### 4. `tasks/Z3-delivery.md`
必须含：**逐条原始收发报文**（脱敏：任何 ≥32 字符的疑似令牌替换为 `<redacted>`）、`usage/stats` 真实返回样例（若打通）、失败路径证据（若未打通）、以及"打通/未打通"的明确结论与复现命令。

## 三、禁止

- ❌ 打印、复制、提交任何令牌/密钥；临时文件只放 `%TEMP%` 且跑完即删
- ❌ 改 宿主仓库、改插件 `client.js`/`index.js`、安装插件、写 `$DSH_HOME`
- ❌ npm 依赖
- ❌ 长时间挂 app-server（每次调用 ≤30s，收尾必杀干净）

## 四、验收（DSH）

1. `node test/quota-rpc.test.mjs` + 既有 `node test/core.test.mjs` 全绿（不得回归）
2. `node bin/zcd.mjs quota --json` 仍正常（本地聚合不回归）；新增 `node bin/zcd.mjs plan-quota --json`（若你实现）能给出真实数字或明确的 `available:false + reason`
3. 我独立复跑并核对交付文档里的原始报文；**进程泄露检查**：跑完 `Get-Process node` 无本单残留
4. 越界：宿主仓库零改动

## 五、完成后

最终回复：交付清单 / 复现命令 / 原始报文摘要 / **结论（打通或未打通 + 原因）** / 未决。
