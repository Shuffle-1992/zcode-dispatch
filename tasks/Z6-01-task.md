---
round: Z6
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T10:20:00+08:00
---

# Z6 任务包：通道切换 + 额度耗尽暂停 + 交接续跑

> 派发方 DSH。用户诉求原话：**"面板上能切换模型/套餐；用免费 Start Plan 用完额度后子代理暂停，我切到默认套餐后重跑任务；默认套餐 5h/周额度用完也暂停，我切到自己接入的 API 继续，而不是等额度刷新。"**
> 本单把这个能力做实。**下面的机制事实都已由 DSH 实测，直接按它实现，不要再自己试错。**

## 一、机制事实（DSH 实测，2026-09-30；违反会直接失败）

| # | 事实 | 证据 |
|---|---|---|
| F1 | **同一通道 `--resume <sess>` 可用**（不传 `--model`） | T1/T4 实测 `exit=0`（用与会话相同的 providerId+模型配置） |
| F2 | **`--resume` + `--model` 一定失败** | T2/T3 实测 `exit=1`，日志 cause = `Select a model before continuing`（`CONFIGURATION_ERROR`）；会话里存的模型与当前配置对不上 |
| F3 | ⇒ **换通道不能续同一会话**，只能**交接重跑**（新会话 + 交接提示词） | 由 F1/F2 推出 |
| F4 | 通道可用性来自 `~/.zcode/v2/config.json` 的 `provider[*].enabled` + `systemDisabledReason`；权益另有缓存 `~/.zcode/v2/coding-plan-cache.json` | 实测：`builtin:bigmodel-coding-plan`=enabled；`builtin:bigmodel-start-plan`=`coding_plan_not_entitled`；`builtin:zai-*`=`oauth_provider_inactive`；个人 DeepSeek=enabled |
| F5 | 未开通的 Start Plan 端点要**签名凭证**，拿裸 Key 会被拒 | 实测报 `ClientRequestSigningV4Error: Client signing credential must contain one separator` |
| F6 | 个人 API 通道可用 | 实测 `--provider personal --model deepseek-flash` exit 0 |
| F7 | 派发器的现成能力（**只读调用，不许改**） | `scripts/collab/zcode-run.mjs`：`--provider plan\|personal\|<id>`、`--model`、`--resume`、`--list-providers`（逐通道打印 enabled/reason/端点/模型）、退出码透传 |

> ⚠️ **Start Plan 在本账号当前不可用**（未开通 + 需签名）。UI 必须把它列出来但标"不可用+原因"，**不要**假装能切过去。

## 二、交付物

### 1. `core/dispatch-core.mjs`（改造，保持向后兼容）

1. **暂停态**：新增 job 状态 `paused`；从子进程 stdout/stderr/result 里识别暂停原因，写入 `pauseReason`（枚举）与 `pauseDetail`（原文一行）：
   - `quota-exhausted`：`quota_exceeded` / `coding_plan_required` / `rate_limited` / `insufficient` / `429` / `balance`
   - `plan-not-entitled`：`not_entitled` / `plan-not-entitled` / `coding_plan_not_entitled`
   - `provider-signing`：`ClientRequestSigningV4Error`
   - `config-error`：`Select a model before continuing` / `CONFIGURATION_ERROR`
   - `unknown`：其余非 0 退出
   （识别不到就 `failed`，保持现状）
2. **通道**：`setChannel({provider, model})` / `getChannel()` / `listChannels()`（后者解析 `zcode-run.mjs --list-providers` 的输出 + `coding-plan-cache.json`，返回 `[{id,name,enabled,reason,endpoint,models[]}]`，**不许猜**：解析失败返回空数组 + warning）
3. **续跑语义（关键）**：
   - `retry(jobId, { provider?, model? })`：
     - 目标通道 == 原通道 且 `sessionId` 存在 → **同会话续跑**：`--resume <sessionId>`，**不传 `--model`**（F2）
     - 目标通道 != 原通道（或原通道无 sessionId）→ **交接重跑**：新会话，提示词由 `buildHandoffPrompt(job)` 生成
   - `buildHandoffPrompt(job)`：结构化交接提示，必须含
     ① 原任务（`spec.task` 文件内容或 `spec.prompt` 原文）
     ② 上次中断点：`pauseReason/pauseDetail` + 最后一段 `tailLines`
     ③ 新通道说明："你现在运行在 `<provider>/<model>` 通道上；这是**交接重跑**，不是原会话续跑"
     ④ 硬约束："**先核对仓库/工作区当前状态**（`git status`、已存在的交付物），已完成的部分不要重做；只做剩余部分；完成后按原任务包要求交付"
     ⑤ 禁止："不要回滚已完成改动、不要重复已完成交付"
   - 新 job 记录 `parentJobId` + `attempts[]`（`[{jobId, provider, model, reason, at}]`），旧 job 标 `handedOffTo`
4. **暂停后的队列语义**：`paused` 的 job **不占锁**（锁必须释放），队列继续跑其他 job；`paused` 不自动重试（除用户开启自动降级链，见 5）
5. **自动降级链（可选，默认关）**：`setFallbackChain(['<channelId>', ...])`；仅当 `pauseReason ∈ {quota-exhausted, plan-not-entitled, provider-signing}` 且链上有下一个**可用**通道时，自动按 `retry` 语义接续（交接重跑）；每跳记 `attempts`，最多跳 `chain.length` 次；任何一跳失败即停并标 `paused`

### 2. `bin/zcd.mjs`（加命令，不改既有语义）
```
node bin/zcd.mjs channels [--json]                 # 通道清单（含可用性与原因）
node bin/zcd.mjs channel set <provider> [--model]  # 设默认通道
node bin/zcd.mjs retry <jobId> [--provider --model] # 同通道续跑 / 换通道交接重跑
node bin/zcd.mjs fallback [list|set a,b,c|off]
```

### 3. `client.js`（UI；组件树可扩但**守纪律**：仅 `--dsw-alias-*` 真实令牌、无字面色值、无 `@deepseek-ai` import、无 `document.body`）
- **通道切换器**（面板顶部）：provider 下拉 + model 下拉（来自 `listChannels()`），不可用项置灰并显示原因（如 `未开通：coding_plan_not_entitled`）；切换后显示"新任务将使用：<通道>/<模型>"
- **暂停态展示**：job 行状态点新增 `paused` 颜色 + 原因徽章（`额度耗尽` / `未开通` / `需签名` / `配置错误`）；行内按钮：**「同通道续跑」**（有 sessionId 时可用）与**「换通道重跑」**（弹/展开通道选择，走交接重跑）
- **交接重跑提示**：点击后先显示将采用的语义（"换通道=交接重跑，会新开会话并把未完成部分交接过去"），确认后执行
- **自动降级链**：一个开关 + 有序通道列表（默认关，开启需二次确认，并提示"会自动消耗下游通道额度"）

### 4. 测试 `test/channel-retry.test.mjs`（新，零依赖）
- 假 runner 造出各 `pauseReason` 签名 → 断言分类正确、锁已释放、队列继续
- `retry` 同通道 → 断言命令行含 `--resume` 且**不含** `--model`
- `retry` 换通道 → 断言命令行**不含** `--resume`，且 prompt 含交接五要素（逐条断言关键字）
- 降级链：可用→不可用→可用 的跳过逻辑；链耗尽即停；`attempts` 完整
- `listChannels` 解析：给固定样例文本 → 字段正确；解析失败 → 空数组 + warning，不抛

### 5. `tasks/Z6-delivery.md`
清单 / 复现命令 + 原始输出 / 未决。**必须**贴：`zcd channels --json`、一次真实的"额度耗尽→暂停"演练（可用假 runner 造签名；如能真造更好）、一次真实的"换通道交接重跑"（可用两个真通道：`plan`+`GLM-5.3-Flash` → `personal`+`deepseek-flash`，任务用"把 `F:\My Code\dsh-plugins\tasks\_z6-canary.md` 里的一行字改掉"这种极小任务）

## 三、禁止

- ❌ 改 宿主仓库、`wire.*` 的既有导出语义（可加字段）、`core/appserver-rpc.mjs` 契约、安装插件、写 `$DSH_HOME`、npm 依赖、git 操作
- ❌ 在 `--resume` 时传 `--model`（F2）
- ❌ 伪造通道可用性：不可用通道必须如实标注

## 四、验收（DSH）

1. `node test/channel-retry.test.mjs` + 既有 `core.test.mjs` / `quota-rpc.test.mjs` / `z4-token-check.mjs` 全绿
2. 我独立复跑：`channels --json` 字段与 `--list-providers` 真值一致；**反向控制**：我用假 runner 造 `quota_exceeded` → 必须 `paused` 且锁释放、队列继续；造 `--resume` 场景断言无 `--model`
3. **真实换通道演练**：`plan/GLM-5.3-Flash` 派一个小任务 → 人为 `retry --provider personal --model deepseek-flash` → 新 job 必须：新 sessionId、prompt 含交接五要素、`parentJobId` 指向旧 job、`attempts` 两条
4. 我方 Z2 探针 18/18（UI 纪律不回归）；宿主仓库零改动；`$DSH_HOME` 零写入

## 五、完成后

最终回复：机制实现点 / 复现命令 / 原始输出 / 未决 + **明确说明"换通道=交接重跑"的用户可见语义**（这句会写进 README）。
