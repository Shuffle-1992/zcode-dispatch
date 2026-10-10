# ZB-33 探索 + 实现：把「免费额度通道（Start Plan / app-server 托管）」搬进派发台

> 状态：**已实现并真机跑通**（2026-10-11）；未提交。
> 来源：`dsh-connect-zcode` 的 `zcode-appserver` 通道（已验证可用）+ 本仓库现有 runner/面板/台账流水线。

## 0. 一句话结论

**可行，而且比放在 DSH 的 provider 位更合理。**

派发台的语义本来就是「独立 ZCode 进程 + 它自己的工具 + 独立额度 + 面板可监视」；
「工具是 ZCode 的」在派发台**不是缺陷，而是设计**（在 DSH provider 位上才是缺陷，因为宿主期待
工具回传）。而派发台已经有的 timeout / 暂停分类 / 重试 / 回退 / 台账 / 面板，正好补上桥接缺的那一圈工程化。

## 1. 现状（本仓库已有的东西）

| 资产 | 位置 | 与免费额度的关系 |
|---|---|---|
| app-server **传输层** | `core/appserver-rpc.mjs` | spawn + NDJSON RPC + 树杀，**只有传输**；目前只给 `usage/stats` 用 |
| 配额聚合 | `core/quota.mjs` | 经 app-server `usage/stats` 取引擎本地聚合 |
| 通道清单 | `core/dispatch-core.mjs :: listChannels()` | 解析 runner 的 `--list-providers`（读 `~/.zcode/v2/config.json`） |
| 执行 | `collab-kit/zcode-run.mjs` | **print 模式**（`zcode.cjs -p`），plan 路径 = 把 Key 塞进个人 provider 配置走**直连 HTTP** |
| 工程化 | dispatch-core / client.js | 暂停分类（`quota-exhausted` / `plan-not-entitled`）· 重试/交接 · 台账 billing · 面板 |

## 2. 为什么今天的派发台**用不到**免费额度（三条硬阻塞，实测）

1. `~/.zcode/v2/config.json` 里 `builtin:bigmodel-start-plan` 是 **`enabled: false`**
   （本机实测；`builtin:bigmodel-coding-plan` 是 `true`）⇒ `--provider plan` 按
   「先 coding-plan 再 start-plan」排序，**永远挑到付费套餐**；显式指定 start-plan 会被
   runner 的 `entry.enabled` 守卫拒绝（`zcode-run.mjs:538`）。
2. 即便绕过守卫，runner 的 plan 路径是**直连 HTTP**（`access:{type:'api-key', apiKey}` + baseUrl）。
   start-plan 的端点是 `https://zcode.z.ai/api/v1/zcode-plan/anthropic`，**要求逐请求的官方
   客户端证明**：社区/我们实测直连返回 `405 / {"code":3012,"msg":"request has been blocked due to
   unusual activity"}`（见 dsh-connect-zcode 的 TROUBLESHOOTING §1.5）。直连路走不通。
3. 唯一可行路线 = **托管官方 agent 本体**（`zcode.cjs app-server`），由它自己签发签名。
   这就是 `dsh-connect-zcode` 的 `zcode-appserver` 通道的原理；**派发台缺的是"回合驱动 + 账户注入"
   这一层**（传输层已有）。

## 3. 可行性实证（零额度，本次已跑通）

探针：`%TEMP%\probe-gift-over-dispatch-args.mjs`（用**派发台同款 spawn 参数**，不发任何模型请求）

```
builtin  : 3.14.5 → ~/.zcode/v2/runtime/provider/windows-x86_64/3.14.5/endpoint-…/zcode-builtin.json
修订号   : zcode-builtin:30:0d7aa736…
账户家族 : activeProvider=bigmodel → 注入 account:bigmodel-start-plan（token 204 字符，不打印）
会话     : sess_66ca8b9f-…
注入     : providerCount=1 status=received
setModel : ok（account:bigmodel-start-plan / GLM-5.3-Flash / reasoningLevel=max）
读投影   : contextUsed=0 window=200000 status=idle
应答次数 : 3 次服务端请求
✅ 注入链路在「派发台同款 spawn 参数」下成立（零额度消耗）
```

过程中踩到并确认的 4 个**必须照抄**的细节（都是"静默失效"型）：

1. **env 五件套**（少一个就落到别的 configSource，注入被静默丢弃）：
   `ZCODE_APP_VERSION`(=builtin version) · `ZCODE_SERVICE_AUTHORITY_MODE=desktop-local` ·
   `ZCODE_BASE_URL=https://zcode.z.ai` · `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` ·
   `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`。
2. **服务端→客户端请求必须应答**（传输层现在只有 `onNotification`，需要新增 `respond(id,result)`）：
   - `session/requestRuntimePreferences` → 固定偏好对象（**不回就卡死**：探针第一版被它 20s 超时打死）；
   - `interaction/requestProviderRuntimeHeaders` → `{headersApplied:true,requestAuth:{apiKey:<zcodejwttoken>,headers:{…}}}`，
     **agent 自己算签名**，我们只递 token；
   - 权限类 → `{decision:'allow'|'deny'}`（对应 yolo/build）。
3. **账户注入**：`provider/updateAccountConfig`，`basedOnZCodeBuiltinRevision` 必须**逐字符等于**
   `zcode-builtin:<release.revision>:<sha256(resolve(builtinFile))>`，且该文件与 spawn 给 CLI 的
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` **是同一个**（差一字 ⇒ registry 静默跳过）；
   注入后**必须等 ~2s** 再 `setModel`（异步注册；否则报 `Provider Registry 中不存在 Model`）。
4. **usage 口径**：`turn.completed.usage` 是**整回合 N 次调用之和**，直接记进台账会**虚高 N 倍**
   （dsh-connect-zcode TROUBLESHOOTING §2.10 有完整取证）。派发台要按"单次调用口径"折算
   （多调用回合读 `session/read → projection.contextUsed`）。

## 4. 方案（推荐 A：给 runner 加一个 transport，其余全复用）

### A. runner 增加 app-server 执行模式
- `zcode-run.mjs --transport appserver --provider start-plan`（或 `--channel gift`）：
  - 走 §3 的四步；把事件流翻译成**现有 `[zcode-run]` 日志行**（provider/model/usage/pause 原因），
    这样派发台的解析、台账 billing、暂停分类、面板、重试/交接、回退**一行都不用改**；
  - 任务即一段 prompt（派发台的输入形态天然是"任务书"），不需要 DSH 那种整段历史拍平；
  - 单任务一进程 ⇒ app-server 的"单会话单在途回合"约束天然满足。
- `--list-providers` 增加一行：`account:bigmodel-start-plan  true|false  <endpoint> | <models>`
  （可用性 = 注入探测结果，缓存 N 分钟）。派发台 `listChannels()` 会**自动**把它列进 `action=channels`，
  面板与 `action=channel` 设默认通道即刻可用。
- 免费额度窗口到期 ⇒ 走既有 `pauseReason=quota-exhausted` 暂停签名；窗口恢复后 `retry` 续跑。

### B. 共享模块（可选，后续）
把桥接的「注入 + 鉴权应答 + 事件翻译 + usage 折算」抽成零依赖模块，两边共用
（dsh-connect-zcode 继续做 DSH provider 位，派发台做独立 process 位）。
成本高、收益是免双份维护；**建议先做 A，稳定后再抽**。

## 5. 工作量与风险

| 项 | 估计 |
|---|---|
| runner 侧（transport + 注入 + 应答 + 事件→日志 + usage 折算） | ~350 行，多数可从 `lib/app-server.js` 移植 |
| 派发台侧（通道清单 + 面板 billing 展示 + 默认通道） | ~80 行 |
| 测试（假 transport 起 CLI 的替身，自检式） | ~200 行 |
| 首次可跑版本 | ≈1 次专注会话（2–3h） |

**已知限制（照实带上，不掩盖）**
- 官方 MCP 服务器在托管进程里**连不上**（拿不到桌面端签名头）⇒ agent 可能在其上打转；
  依赖派发台已有的 timeout + 我们的"卡死恢复阶梯"（stop×2 → 硬重启 CLI → 重建会话）。
- 免费额度是**时间窗口型**（本次窗口 10/10 23:00 → 10/12 09:00）：窗口内跑、窗口外
  `pauseReason=quota-exhausted`，不要把长时间任务排在窗口尾部。
- 并发 = app-server 进程数；建议由派发台 `maxConcurrent` 先限 1–2（额度与风控都更稳）。
- 不要把这条通道当"通用并发"用：它是**独立 agent 进程**，每个进程有自己的 MCP/工具初始化开销。

## 6. 验收判据（建议）

1. `zcd dispatch --provider account:bigmodel-start-plan --prompt "只回复：就绪"` 成功，
   台账 `billing` 标为免费额度通道，且 `usage.input` 与 CLI rollout 的**按次值**同量级（不虚高）。
2. `action=channels` 能看到免费额度通道且 `enabled=true`（窗口内）。
3. 窗口外派发 ⇒ `paused / quota-exhausted`（不静默失败、不自动改烧付费额度）。
4. 同一 job 的 `retry` 能在窗口恢复后续跑（沿用现有 resume 语义）。

---

## 7. 实现记录（2026-10-11，已完成并跑通）

### 7.1 改了什么

| 文件 | 改动 |
|---|---|
| `collab-kit/appserver-gift.mjs` | **新增**（~620 行）：运行时定位 · 凭据解密 · builtin 修订号 · stdio RPC 客户端（**含 `respond` 服务端请求应答**）· 回合驱动（create→subscribe→setMode→注入→setModel→send→事件收集→usage 折算） |
| `collab-kit/appserver-gift-job.mjs` | **新增**（~200 行）：产物（`.out/.err/.result.json`）· `[zcode-run]` 输出行（严格对齐 `parseRunnerLine` 的八种正则）· 暂停指纹 · 台账（`billing=zcode-plan-gift`） |
| `collab-kit/zcode-run.mjs` | ① 新增 `--transport auto\|print\|appserver`；② `--provider start-plan\|gift\|account:*-start-plan` → 走 app-server；③ 派发总开关**提到文件最前**（第一道闸）；④ provider 解析加 `!GIFT_MODE` 守卫；⑤ `--list-providers` 增补免费额度通道行 |

### 7.2 真机证据（三次冒烟，各 1 次小额调用）

```
[zcode-run] provider=account:bigmodel-start-plan model=GLM-5.3-Flash (免费额度 Start Plan)
[gift] 运行时=3.14.5 账户=account:bigmodel-start-plan 模型=GLM-5.3-Flash 思考档=max（token 204 字符，不打印）
[gift] 账户注入 providerCount=1 status=received
[zcode-run] done exit=0 elapsed=9.8s session=sess_4de7df0b-… provider=account:bigmodel-start-plan model=GLM-5.3-Flash responseChars=3
[zcode-run] endpoint=https://zcode.z.ai/api/v1/zcode-plan/anthropic
[zcode-run] usage requests=1 in=18130 out=35 cacheRead=10176
[zcode-run] context used=18165 (9.1% of 200000) turnCount=1
```

集成验收（三个独立脚本/套件，全部 PASS）：

| 验收 | 结果 |
|---|---|
| `parseRunnerLine` 逐行解析 | 10 行**全部识别**（0 unknown），合并出 exitCode/sessionId/provider/model/usage/context/endpoint/runnerOut |
| `classifyPause` | 三个签名全命中：`quota-exhausted` / `plan-not-entitled` / `provider-signing` |
| 台账 | `billing=zcode-plan-gift`、`requests=1`、`inputTokens=18130`、`usageBasis=cli-single`、`channel=appserver-gift`（**未虚高**） |
| `--list-providers` → `parseProviderTable` | 解析出 8 条通道（0 warning），含 `account:bigmodel-start-plan enabled=true` |
| 本仓库测试套件 | **27/27 通过**（runner 改动未破坏既有行为） |
| **插件路径端到端**（`zcd dispatch --provider account:bigmodel-start-plan`） | `state=done exit=0 elapsed=10.9s`、`billing=zcode-plan-gift`、`usage requests=1 in=18208 out=105`、`responseChars=7`（正好 7 个汉字）✓ |
| `zcd channels` | 免费额度通道在列：`account:bigmodel-start-plan  true  https://zcode.z.ai/… | GLM-5.3, GLM-5.3-Flash (免费额度 Start Plan；--provider start-plan)`（面板/`action=channels` 同源） |
| **真实任务包**（`--kind task`，5 次模型调用 / 130.1s） | `state=done exit=0`；agent 在指定工作目录**写出** `zb33-e2e-proof.md`（3 行、UTF-8 校验通过）—— 任务包内联 + 落盘全链路成立 ✓ |

### 7.3 实现中**新踩到**的坑（比探索阶段更多）

**5. 派发台的 `--reasoning-level agent` 是伪值，不能直接当档位下发**（真机端到端才发现）：
插件默认传 `agent`（=「Agent决定/不覆盖」），我第一版直接转给 `session/setModel` ⇒
`-32603 Reasoning effort "agent" is not supported by account:…/GLM-5.3-Flash`，job 4.9s 失败。
⇒ 在 gift 路径把 `agent`（含空串）视为"未指定"，回落到官方 `defaultVariant` 链。

**6. 台账归属跟着 `--cwd`/`--runner-cwd` 走**（真实任务包那次暴露）：runner 的台账固定在
`<PROJECT>/collab/logs/zcode-runs.jsonl`（`--project` 缺省 = runner 自身 cwd），而派发台聚合
读的是插件 config 的 `ledgerPath`。两者指到**不同项目**时：job 能跑通，但面板/job 行显示
`billing=-`、用量统计看不到这一单（本次用 `%TEMP%` 当 cwd 就复现了）。
⇒ **部署约定**：`--cwd` / `--runner-cwd` 必须落在宿主项目内（与 `ledgerPath` 同项目）。

**usage 口径（本次定型）**：多调用回合 `input` 取**按次上下文**（CLI 聚合是 N 次之和，直接记会
虚高 N 倍，见 dsh-connect-zcode §2.10），`output` 取**回合累计**（生成总量本来就是各次之和，
记 0 会丢信息）；台账同时带 `usageBasis` 与 `requests` 说明口径。

1. **`session/setModel` 强制要求思考档**：不传报 `-32603 Reasoning level is required for
   account:bigmodel-start-plan/GLM-5.3-Flash`。桥接总是传，所以没暴露。
   ⇒ 官方默认档在 **`~/.zcode/v2/config.json` 的 provider 条目**里
   （`models['GLM-5.3-Flash'].reasoning.defaultVariant = 'max'`），**不在** builtin 运行时文件里
   （实测 builtin 里 `variants`/`defaultVariant` 各 0 处）。兜底链：显式 `--reasoning-level` > 官方 defaultVariant > `'max'`。
2. **总开关必须前置**：原实现在临时配置生成之后（≈795 行），而免费额度分支要**绕过** provider
   解析（否则 `--provider start-plan` 会先撞 `provider 不存在` 并 exit 1）。把开关块整体提到
   文件前部当第一道闸 —— 顺带修掉"开关关闭时仍去读 config.json/凭据库"的浪费。
3. **输出行纪律**：`parseRunnerLine` 对带 `[zcode-run]` 前缀但形状不认识的行返回 `null`（调用方记
   warning）。故诊断一律用 `[gift] …` 前缀，只有八种已知形状用 `[zcode-run] …`。
4. **`--list-providers` 必须 async**：为了不静态 import 新模块（否则新模块的任何问题会拖垮既有
   print 路径），改成 `await import()` + 顶层 `await listProviders()`。

### 7.4 本次**未做**（明确边界）

- `--resume` / `--target` / `--memory-bench` 在免费额度通道**明确拒绝**（都是 print 模式 CLI 的能力；
  该后端每次新建 CLI 会话）。
- `--attach` 忽略（agent 有自己的文件工具，可直接读工作目录）。
- 面板尚未加"免费额度"专属展示（通道已能在 `action=channels` 里选到，`billing` 也已分账；
  面板文案/额度进度条留待下一步）。
- 并发未限流：一个 job 一个 app-server 进程，建议先由派发台 `maxConcurrent` 限 1–2。
