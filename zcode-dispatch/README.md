# @local/zcode-dispatch —— ZCode 派发台（cordis bundle）

在 DSH Harness 里派发/监视多个 ZCode 无头进程（`zcode-run.mjs`）：单写者互斥、用量与上下文、套餐通道。
Host 半边（`index.js` + `wire.host.mjs` + `core/*`）跑进程调度并暴露 agent 工具 `zcode_dispatch`；
Client 半边（`client.js` + `wire.client.mjs`）在 Web 页面渲染右下角悬浮窗（拖拽 / 折叠 / 最小化胶囊）。

> ⚠ **标准模式不可安装**：标准模式 DSH 会话没有 `plugin_manager` / `cordis_inspect_query`，
> 本包只能被写出、不能被安装验证。安装由**创造模式（creator preset）会话**执行（见下）。
>
> 槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核。

## 目录结构

```
zcode-dispatch/
├─ package.json          bundle 清单（dsh.bundle.patch + dsh.client + meta/icon/locale）
├─ cordis.patch.yml      插入一行 id=zcode-dispatch 的 config（demo/maxConcurrent/runnerPath/ledgerPath/workRoot）
├─ index.js              Host 半边：apply(ctx, config)；创建 dispatcher 单例、卸载清理、注册 agent 工具
├─ notify.mjs            ZB-22 落地自动唤醒（job 落地 → 唤醒发起会话；零 @deepseek-ai 依赖）
├─ wire.host.mjs         Host 接线适配器＋动作唯一实现 createActionHandler（creator TODO 已于 Z8-01 清偿）
├─ wire.client.mjs       Client 接线适配器＋轮询/demo 降级
├─ client.js             UI 半边：悬浮窗（React.createElement，无构建）；内嵌降级 wire
├─ core/                 Z1 交付的派发核心（dispatch-core.mjs / quota.mjs，Z3 增 appserver-rpc.mjs）——只 import，不改
├─ bin/zcd.mjs           Z1 的独立 CLI（与插件同 core，可做对照排查）
├─ locale/{zh,en}.json   meta + 界面文案（ui 段与 client.js 内嵌 STRINGS 同源）
├─ icon.svg              插件图标（几何图形，≤256KiB）
└─ test/                 可复跑自测与验收（清单见「可复跑自测清单」一节）
```

## 运行期数据（不随包分发）

`work/`（`bin/zcd.mjs` 默认工作根：`state/jobs.json`、`logs/*.out|err.log`、`locks/`）与插件安装后
patch 默认指向的 `.data/`（同结构，见 config 说明）都是**运行期数据**：不进 `package.json` 的
`files`、不随 bundle 分发，可随时整体删除重建（删除后进程列表清空；用量以 `config.ledgerPath`
指向的台账为准，不受影响）。`state/dismissed.json` 同属运行期数据（Z11：UI「关闭」掉的
paused/终态 job 的 id 集合，`snapshot`/`list` 据此过滤；删掉即恢复显示）。
`test/` 下的验收输出物（如 `*.output.txt`）同样不入包。

## 安装（创造模式会话执行）

1. `plugin_manager` → `install_bundle`，`target` = `<本仓库>\zcode-dispatch`（绝对路径）。
2. **读返回的 `application` 与 `warnings`**（不是看日志）：`applied` 才算生效；`restart-required` /
   `failed` / `overridden` 分别处置。若报 pending build scripts，**先问用户**再传 `approvedBuilds`。
3. 本包无构建步骤、无 npm 依赖；替换已安装包需要重启才加载新 JS（新装 bundle 可走 HMR）。

## config 说明（cordis.patch.yml 可改；用户 patch 层升级存活）

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `demo` | boolean / `false` | UI 演示模式：客户端用内置假数据渲染悬浮窗，不触达 dispatcher |
| `maxConcurrent` | integer / `1` | 同时运行的 run 上限。**注意：它与单写者锁是两道独立的闸，实际并发 = min(两者)**，见下节 |
| `runnerPath` | string / `''` | runner 绝对路径（通用工具仓库 `<本仓库>/collab-kit/zcode-run.mjs`，只读使用）。**与 `workRoot` 任一为空则不创建 dispatcher**（UI 走 demo 降级，工具动作返回可读错误） |
| `runnerCwd` | string / `''` | runner 子进程的工作目录（通常设为宿主项目根）。runner 已迁出通用工具仓库、无法从自身位置推项目根，故它与「从绝对 `--task` 反推」构成**双保险**；留空 = 用 DSH 进程 cwd |
| `ledgerPath` | string / `''` | 台账 `zcode-runs.jsonl` 绝对路径；留空则跳过台账回读与用量聚合 |
| `workRoot` | string / `''` | 派发器工作根目录（`locks/`、`state/jobs.json`、`logs/` 落在这里）。留空即落到本包 `.data/` |
| `switchPath` | string / `''` | Z12：派发总开关真值文件（宿主项目 `collab/zcode-dispatch.switch.json`）。文件缺失/损坏=开启；留空则开关不可写；测试可指向临时文件密封 |
| `notifyOnSettle` | boolean / `true` | **ZB-22**：job 落地（`done`/`failed`/`killed`/`interrupted`/`paused`）时自动唤醒**发起它的那个会话**（与 DSH 后台任务同款，见下节）。`false` = 只派发不唤醒 |
| `maxConsecutiveWakes` | integer / `0` | **ZB-22**：用户没说话期间允许的**连续**唤醒次数上限；`0`=不限。超出后该次通知改为注入下一步（等用户说话后预算清零） |
| `systemPromptHint` | boolean / `true` | **ZB-22**：往 system prompt 注入一段「派发台优先、别退回 DSH 自带 subagent」提示（新会话的 agent 因此不易用错工具）。`false` = 不注入 |

> **路径都是机器专有配置，仓库里不写死。** 本包的 `cordis.patch.yml` 只插入 `demo` / `maxConcurrent`；
> 上述四个路径请在 **profile patch**（`~/.dsh/profiles/<profile>/cordis.patch.yml`）里按 id 覆盖：
>
> ```yaml
> - id: zcode-dispatch
>   name: "@local/zcode-dispatch"
>   config:
>     runnerPath: '<宿主项目>\scripts\collab\zcode-run.mjs'
>     ledgerPath: '<宿主项目>\collab\logs\zcode-runs.jsonl'
>     workRoot:   '<本插件目录>\.data'
>     switchPath: '<宿主项目>\collab\zcode-dispatch.switch.json'
> ```
>
> 三个路径全空时插件照常激活，只是不创建 dispatcher（面板 demo 降级、工具动作返回可读错误）——
> 不会猜一个位置静默跑错。

## ⚠️ 凭据从哪来 + 报「身份验证失败 / 401」怎么办

本插件的凭据**不自己存**：它和宿主 runner（`zcode-run.mjs`）一样，读 **ZCode 自己的配置文件**：

| 位置 | 内容 |
|---|---|
| `~/.zcode/v2/config.json` → `provider["builtin:bigmodel-coding-plan"].options.apiKey` | **明文** Key（本插件与 ZCode CLI 都读它） |
| `~/.zcode/v2/credentials.json` → `account-provider:coding-plan:…:api-key` | **加密**（`enc:v1`）凭据库，随 OAuth 登录更新 |

### 最常见的故障：OAuth 重新登录后 `config.json` 失配

**这是 ZCode 的上游缺陷，不是本插件的问题**：

> ZCode 在 **OAuth 重新登录 / 重新授权**后，把**新 Key 只写进加密凭据库
> `credentials.json`**，**不回写 `config.json`**；而 `config.json` 里留着**已失效的旧 Key**。
> ⇒ **一切读 `config.json` 的程序集体 401**，**连 ZCode 自己的 Agent CLI（`zcode.cjs -p …`）也一样**。

**判断**（最快）：比对两个文件的修改时间 —— 若 `credentials.json` 很新、`config.json` 停在很久以前，
基本就是失配。

**💡 解决：把有效 Key 保存（写回）到 `config.json`** —— 这是**一次修好所有工具**的做法：

1. 从凭据库解出有效 Key（`credentials.json` 里的值是 `enc:v1:<iv>.<tag>.<data>`
   AES-256-GCM 加密，密钥 = `sha256(secret)`，secret 见下方参考实现）；
2. **先验活**（见下方陷阱，**不能只看状态码**）；
3. **备份** `config.json` 后，把有效 Key 填回
   `provider["builtin:bigmodel-coding-plan"].options.apiKey`；
4. 回读校验；必要时重启 ZCode / DSH。

> ⚠️ 手工改之前**先退出 ZCode**（运行中修改可能被覆盖），并**务必先备份**。
>
> 姊妹项目 [`dsh-connect-zcode`](https://github.com/Shuffle-1992/dsh-connect-zcode) 提供了
> 现成工具做这件事（自动备份 + 验活 + 原子替换 + 回读校验）：
> `node scripts/sync-key-to-config.mjs --dry-run` 先诊断，去掉 `--dry-run` 即执行。
> 其 README 与 `TROUBLESHOOTING.md` 有完整的踩坑记录。

### ⚠️ 验活陷阱：网关对**失效 Key** 也返回 HTTP 200

```
HTTP 200
{"code":1000,"msg":"身份验证失败。","success":false}      ← 这是失效 Key！
```

**只看 `res.ok` / 状态码会把无效 Key 判为有效**。正确判定（三者同时满足）：

```js
const res = await fetch(`${baseURL}/v1/models`, {
  headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
});
if (!res.ok) return false;                        // 401 等
const body = await res.json();
if (body?.success === false) return false;        // ← 关键：200 也可能是认证失败
if (body?.code !== undefined && body.code !== 200) return false;
return Array.isArray(body?.data) && body.data.length > 0;
```

> 本仓库 `test/` 下的假 runner 不触网，故该判定属于**宿主持有凭据**的范畴；
> 此处记录是为了让排查者知道「为什么工具说正常、实际仍 401」。

## agent 工具 `zcode_dispatch`

一个工具 + `action` 参数：`dispatch | list | kill | dismiss | tail | quota | status | switch | channels | channel | retry | fallback | wait`，
与 UI 悬浮窗操作一一对应
（同一实现：`wire.host.mjs` 的 `createActionHandler`，references/user-actions.md「一个操作两个调用方」）。

- `dispatch`：`kind=prompt|task|target` + 对应内容字段；可选 `model(GLM-5.3|GLM-5.3-Flash)`、
  `provider(plan|personal)`、`mode(build|edit|plan|yolo，默认 edit)`、`timeoutMin(>0)`、
  `memoryBench(仅 kind=prompt)`、`tag`、`lock(repo|none，**默认 repo**；none=明确不取锁)`、`write(预计写入的文件列表)`、`cwd`、`resume`。
- `list` / `kill(id)` / `dismiss(id)` / `tail(id, n=30)` / `quota`（本地台账 5h 滚动 / 本周 / 今日聚合 +
  引擎本周已用；`bin/zcd.mjs quota --json` 同时含 `local` 与 `planQuota` 两段，
  任一失败不互相影响）。`dismiss`（Z11）：把 paused/终态 job 从列表移除并落盘
  `state/dismissed.json`（queued/running 必须先 kill）；core 的 `kill` 对 paused 是空操作
  （子进程已退出），UI「关闭」按钮因此先 `kill`、kill 无效时退回 `dismiss`。
- `channels` / `channel set` / `retry(jobId, {provider?, model?})` / `fallback`：Z6 通道与续跑，见下节。
- 限制：仓库写锁互斥（同锁 FIFO 排队，不报错；**文件锁任务优先放行**，见「锁与并发语义」）；`memoryBench` 仅 prompt；工具不授予/确认任何权限。

## 锁与并发语义（ZB-16 锁模型）

**并发数 = min(`maxConcurrent`, 锁闸)**。锁闸按**文件集**判定 —— 这是 ZB-16 的核心：

| 任务的 `lock` / `write` | 行为 |
|---|---|
| **声明 `write: [...]`** | **只锁这些文件** ⇒ 与写**其它文件**的任务**可并发**；写同一文件的后排队 |
| 不声明 `write`（默认 `lock=repo`） | 锁**整个仓库** ⇒ 与任何任务互斥（单写者纪律本义） |
| `lock='none'` | 明确不取锁（确认无竞写关系时用） |

> **怎么让多个任务真正并发**：给每个任务声明它**要写的文件**（`write`）。
> 派发面板上就是「仓库文件锁」勾选 + 「要写的文件」输入框（逗号/换行分隔，留空=锁整个仓库）。
> 实测：三个任务分别写 `a.ts`/`b.ts`/`c.ts` ⇒ **三路同时 running**。

> **memory 锁已删除（ZB-16）**：它保护的是 ZCode 自己的记忆库（`~/.zcode`），与仓库写入互不相干。
> ZCode 记忆写入改由**默认注入的提示词禁令**约束（派发时自动要求子代理不写记忆库）。
> ⚠️ 该禁令只覆盖 `kind=prompt`/`target`；**`kind=task` 的任务包内容由宿主 runner 读取内联，
> 插件注入不进去** ⇒ 该任务 `memoryBanApplied=false`（如实标记，未受禁令保护）。

> **跨层级互斥（ZB-16 修的真实缺口）**：`repo.lock`（整仓库）与 `files/*.lock`（某几个文件）
> 曾是两套互不知情的锁 —— 一个持整仓库锁时，另一个锁某文件却照常 running。
> 但"整仓库写"涵盖所有文件 ⇒ 必然竞写。现已加 `crossLevelBlocked`：
> 文件锁任务会检查整仓库锁，反之亦然（保守：无法证明无交集即视为冲突）。

> **调度优先级（ZB-17 用户要求）：文件锁任务优先放行**。
> 旧实现是严格 FIFO + 队头阻塞（队头拿不到锁就 `break`）—— 后果是一个整仓库锁任务排在
> 队头时，**后面本可并行的文件锁任务全被堵住**（实测：反向验证时旧实现"实际跑的是 WHOLE"）。
> 现改为**按优先级扫描队列**取第一个能拿到锁的：
>
> | 规则 | 说明 |
> |---|---|
> | 优先级 | **文件锁任务 > 整仓库锁任务** |
> | 同类内 | 保持 **FIFO**（按队列原始顺序，不互相插队） |
> | 整仓库锁执行时 | 文件锁任务**都等待**（这是 `crossLevelBlocked` 的职责，与优先级无关） |
>
> ⚠️ 已知取舍：若文件锁任务持续不断到来，队里的整仓库锁任务可能被长期推后（**饥饿**）。
> 本轮按用户明确要求只做优先级、**未加 aging**；若实际出现饥饿，再加"等待超时后提升优先级"。

> 实测（2026-09-30）：T18（`lock=both`）跑 27 分钟期间，一个只要 `repo`、
> 一个只要 `memory` 的任务全程干等，三者 `started`/`finished` 首尾相接、**无一毫秒重叠** ——
> 因为 `maxConcurrent=1` 是总闸。故 `maxConcurrent` 已提到 4（profile 配置）。


### 细粒度文件锁（`write`）

派发时声明「这个任务预计写哪些文件」，core 就只为这些路径加锁：

```
dispatch(write: ['F:\\proj\\src\\a.ts'])   # 只锁 a.ts
```

- **写不同文件 ⇒ 可并行**（这是本机制的全部收益）
- **写同一文件 ⇒ 后者排队**（细粒度互斥仍成立）
- **路径归一化**：Windows 上大小写不敏感，`F:\proj\src\a.ts` 与 `F:\PROJ\SRC\A.TS`
  视为**同一文件**（否则会产出多把锁、同一文件被并发写 —— 这是开发中实测抓到并修掉的 bug）
- **防死锁**：多文件按归一化路径**排序后**依次加锁，所有任务加锁顺序一致
- **加锁留痕**：锁体回存 `paths`，UI「**仓库文件锁**」分区展示**哪个文件被哪个进程锁着、锁了多久**

> ⚠️ **安全底线**：**未声明 `write` 的任务一律锁整个仓库**（`repo.lock`）。
> 细粒度是「声明了才生效的可选优化」，**不是默认放宽** —— 否则不声明的任务会失去互斥保护，
> 多个 ZCode 进程同时改同一个仓库，那正是单写者语义要防的事故。
> 测试 `test/file-lock.test.mjs` 的第一条就是这个底线。

### `wait`：让会话不必轮询

`dispatch` 是 **fire-and-forget**（实测：返回时 `state=queued`、无回调），会话拿结果得自己轮询。
`wait` 补上这个缺口：

```
dispatch(...)            → { ok:true, job:{ id, state:'queued' } }
wait(id, timeoutSec)     → { ok:true, job:{…终态…}, waitedSec, timedOut:false }
```

语义取舍（与 CLI 的 `awaitJob` 一致）：

- **终态返回** `done|failed|killed|interrupted`
- **`paused` 也返回** —— 不干等：paused 需要调用方决定 `retry` 续跑还是换通道交接
- **超时返回 `timedOut:true` + 当前状态 + `note`**，**绝不谎报完成**
- `timeoutSec` 缺省取该任务 `timeoutMin` 的秒数（再缺省 600s）

- 注册方式（Z13）：官方契约 `ctx.tools.register(defineTool({...}))`（`index.js` 导出
  `inject = ['tools']` 取得服务；`defineTool` 来自随 dsh 出货的 `@deepseek-ai/dsh-tools`，
  动态 import，缺包时降级为不注册 + warn，不影响激活与 UI）。

### 任务落地自动唤醒（ZB-22，默认开）

**现场问题**：派发之后会话**不等待**（这是 fire-and-forget，本身没错），但任务跑完
**没有任何东西叫醒它** —— 用户得自己再发一句话「继续」。DSH 自带的后台任务不是这样：
它落地时会把通知投进发起它的会话，会话自动被拉起。

**现在派发台也一样**（实现与 `@deepseek-ai/dsh-tool-jobs` 同源契约）：

| 环节 | 做法 | 依据 |
|---|---|---|
| 归属 | 工具 `execute(args, exec)` 取 `exec.agent.id`；`dispatch`/`retry` 成功后登记 `jobId → 会话 id` | `dsh-tool-jobs` 的 `exec.agent?.id` 用法 |
| 触发 | `dispatcher.subscribe` 的 `job-updated` 事件里判落地：`done`/`failed`/`killed`/`interrupted`/**`paused`** | 与 `action=wait` 的落地判据同源（paused 也要人来决定） |
| 投递 | `ctx.get('agents').get(会话id)` → `status==='idle' ? agent.followup(msg) : agent.inject(msg)` | `Agent.followup = send(next-turn, wakeup)`；`inject = send(next-step, no-wakeup)` |
| 消息 | `{role:'user', content:[{type:'text',text}], source:{kind:'zcode-dispatch', form:'notice', summary}}` | 客户端据此渲染「本轮由通知触发」的可展开卡片；`form:'notice'` 是客户端已认识的形态（换别的字符串会抛 `unreachable context form`） |

**抑制**（避免「自己做的事又叫醒自己」，与 `dsh-tool-jobs` 的 `killedByModel` / `awaited` 同语义）：

- 自己 `action=kill` 掉的 job → 不发通知；
- 自己 `action=wait` **已等到**落地的 job → 不发通知（结果已由那次工具调用返回）；
- `wait` 超时**不**抑制（job 还在跑，落地时仍应唤醒）。

**注册与降级**：`agents` 服务**既不用静态 `inject`、也不用 `ctx.inject` 等它就绪** —— 投递那一刻
才 `ctx.get('agents')` 懒解析（cordis 对未注册/未激活的服务返回 `undefined` 而不抛）。
理由：唤醒是「有就更好」的增强，不能让它的成立与否取决于服务解析时机是否恰好赶上 `apply`。
服务缺席时插件照常激活，只是不唤醒（派发/面板/工具一字不变）。
`ctx.inject(['systemPrompt'], …)` 同理注入「派发台优先」提示段（名 `tool:zcode-dispatch`，
顺序 1605，紧随 `tool:jobs` 1600）。

**排障一眼看**：`.data/state/activation.json` 里有
`notifyOnSettle / wakeActive / wakeNote / agentsVisible / systemPromptHint / systemPromptHintActive`。
`wakeActive:false` = 唤醒器没建起来（看 `wakeNote`）；`agentsVisible:false` = apply 那一刻
解析不到 agents 服务（投递时仍会再试，只是要留意 DSH 日志里的「会话已不在」warn）。

**证据**：`test/notify.test.mjs`（17 条：形态/幂等/抑制/预算/卸载/工具层译码）；
`test/wake-integration.test.mjs`（3 条：`apply()` 全链路 —— 派发→落地→唤醒 + systemPrompt 段落 + 信标）。
**真机验收（2026-10-05）**：job `j-muuw3axj-0-f43f`（tag `wake-smoke`）06:49:27Z 派发 → 06:49:41Z 落地
（`done`/exit 0/14.1s）——**派发它的会话当时已结束本轮且未做任何等待**，落地瞬间被自动拉起并收到通知，只收到一次。
同刻信标 `wakeActive:true / agentsVisible:true / systemPromptHintActive:true`。

> ⚠️ **改 host 代码（`index.js` / `notify.mjs` / `wire.host.mjs`）后必须重启 DSH 才生效**：
> HMR 的模块监听根是 profile 目录且默认忽略 `**/node_modules`，本插件在仓库路径 + 经
> `profiles/<p>/node_modules/@local/...` 软链装配 —— 两头都不在监听面内；只改 profile patch
> 会「重新 apply 已缓存的模块」。判据：信标里没出现你这次新增的字段 = 跑的还是旧模块。
> （也别把插件目录塞进 `hmr.root`：卸载清理会 kill 所有 running job。）

## 其他会话如何发现并调用（Z13）

任何 DSH 会话（包括新开的）只要宿主加载了本插件，agent 工具列表里就有 `zcode_dispatch`
——工具名固定，模型侧可直接调用，无需额外发现步骤：

1. **开工先查开关**：`zcode_dispatch({ action: 'status' })` → 返回
   `switch={enabled, updatedAt, updatedBy, note, source}`；文件缺失/损坏视为开启。
   工具描述首行也带注册时刻的开关快照，但运行期以 `status` 实时返回为准。
2. **开关关闭时先切换**：`zcode_dispatch({ action: 'switch', enabled: true, by: '<会话标识>', note: '<原因>' })`
   （原子写真值文件，格式与 CLI `zcode-switch.mjs` 相同；`enabled` 必填布尔）。
   任何会话都可切换，也可主动关闭（`enabled: false`）。
3. **总开关关闭时派发会被拒**：`dispatch` 与 `retry` 在关闭态直接返回
   `ok:false` + 当前 switch 状态，不创建 job（runner 侧 `zcode-run.mjs` 还有第二道门）。
4. **派发**：`zcode_dispatch({ action: 'dispatch', kind: 'prompt', prompt: '…', mode: 'edit' })`，
   其余参数见上节；`list/kill/tail/quota/channels/channel/retry/fallback` 同理，
   全部动作与 UI 悬浮窗共用同一实现（`createActionHandler`）。
5. 工具未出现在列表里 = 注册降级了（宿主缺 `@deepseek-ai/dsh-tools` 或 `ctx.tools` 不可用），
   看 DSH 日志里的 `[zcode-dispatch]` warn；UI 悬浮窗与派发核心不受影响。

## 通道切换 / 暂停 / 续跑（Z6）

**用户可见语义（一句话）**：换通道 = 交接重跑（新会话 + 未完成部分交接），同通道 = 真 `--resume` 续跑；
CLI 硬限制：`--resume` + `--model` 必失败（ZCode 机制实测 F2），因此同通道续跑绝不带 `--model`。

- **通道切换器**（面板顶部）：provider 下拉 + model 下拉，数据来自 `listChannels()`（runner
  `--list-providers` 真实输出 + 权益缓存 + 个人 provider 配置，解析不出就空清单 + warning，
  **绝不猜测可用性**）；不可用项置灰并显示原因（如 `未开通：coding_plan_not_entitled`）；
  切换后显示「新任务将使用：<通道>/<模型>」。个人通道的模型列表以个人配置
  （`provider_config.json` 的 `personalModelIds`）实际声明为准。
- **暂停态**：run 非 0 退出且输出命中暂停签名 → `paused` + 原因徽章（`额度耗尽` / `未开通` /
  `需签名` / `配置错误`）。paused **不占锁、不占并发、不自动重试**，队列继续跑其他任务；
  未命中签名保持 `failed`（Z1 语义不变），仅记 `pauseReason: unknown` 作信息字段。
- **两个续跑按钮**（paused 行内）：
  - 「同通道续跑」：有 sessionId 时可用 → 真 `--resume <sessionId>` 续跑（绝不带 `--model`）；
  - 「换通道重跑」：选目标通道 → **交接重跑**（新会话），确认提示明示语义后执行；交接提示词
    含五要素：① 原任务原文 ② 上次中断点（pauseReason + 最后输出）③ 新通道说明（交接重跑 ≠
    原会话续跑）④ 先核对现状、只做剩余、按原要求交付 ⑤ 不回滚、不重复交付。
  - 「关闭」（Z11）：把该 paused 行从列表移除（wire 层 `dismiss` 动作，落盘
    `state/dismissed.json`；UI 先试 `kill`、core 对 paused 是空操作故退回 `dismiss`）。
  - 交接链路全程簿记：新 job 记 `parentJobId / attempts[] / hopCount`，旧 job 标 `handedOffTo`
    （同通道续跑标 `resumedBy`）；从 `list/get` 与 `state/jobs.json` 均可读回。
- **进程行展开**（Z11）：点击行头（非按钮区）展开该 job 的派发要素——kind、prompt/task/target
  原文（截 1200 字符）、provider/model、mode、cwd、timeoutMin、createdAt、sessionId、
  pauseReason（中文标签）与「输出」tail 子块；多进程靠它区分「谁在跑什么」。
- **自动降级链**（默认关）：面板开关或 `zcd fallback set <a,b,c>` 开启（二次确认）；仅当暂停
  原因属于 {额度耗尽 / 未开通 / 需签名} 时，按交接语义自动跳到链上下一个**可用**通道，
  最多 `chain.length` 跳；链耗尽或某一跳失败即停在 `paused`。⚠ 开启即授权**自动消耗下游通道额度**。
- CLI 对照：`zcd channels [--json]` / `zcd channel set <provider> [--model]` /
  `zcd retry <jobId> [--provider --model]` / `zcd fallback [list|set a,b,c|off]`；
  agent 工具 `zcode_dispatch` 同名 action 一一对应。

## 真数据 vs demo 判据（Z8 接线后）

面板标题栏徽标（`connLabel`）直接标明当前数据来源，逐级降级、绝不白屏：

| 徽标 | conn 值 | 数据来源 | 含义 |
| --- | --- | --- | --- |
| **已连接** | `live` | `ctx.remote.zcodeDispatch` 远端面 | **真数据**：真 ZCode 子进程 + 真用量台账（宿主 face 已注册） |
| 外部数据 | `ext` | `window.__zcodeDispatchDemo` | 宿主/creator 注入的外部数据源（测试用） |
| **未连接** | `offline` | — | 诚实空态（Z11）：远端与外部源都没有——无假行，进程区明示「真数据需完成 Remote 接线」 |
| **演示数据** | `demo` | 内置演示引擎 | 纯前端假数据（默认**不启用**，仅 `window.__zcodeDispatchDemo === 'builtin'` 时，可交互） |
| 连接中 | `connecting` | — | 尚未收到任何数据包（首帧渲染前） |

降级链：`apply` 捕获 ctx → `resolveRemote()` 探测 `ctx.remote.zcodeDispatch`（有 `snapshot()` 即可用）
→ 命中走 1s 轮询 + `$on('zcode-dispatch/changed')` 抢答；未命中（远端缺席 / `$mount` 失败 /
无 ctx）→ 外部源 → 诚实空态（内置 demo 引擎仅 `'builtin'` 显式开启）。**看到「未连接」即表示
远端面未接通**，排查顺序：宿主侧 `wire.host.mjs` 的 face 注册（日志 `attachHostWire`）→
客户端 `$mount` 贡献项 → 探测判据。

接线两侧（Z8 落地，原「wire TODO 清单」已清偿）：
- 宿主侧：`wire.host.mjs` 的 `attachHostWire()` 把 face 经 `ctx.provide('zcodeDispatch', face)`
  注册为 cordis 服务，`index.js` 用 `ctx.effect` 包裹 dispose 清理；导出 `TYPERT` 清单经
  `package.json` 的 `exports["./typert"]` 由 typert-loader 自动注册（loader 形状校验已本地复核）。
- 客户端侧：`client.js` 模块 `inject` 声明 `remote` 与 `remote.zcodeDispatch`，`apply` 里
  `ctx.remote.$mount({package, descriptors})` 自挂子服务（第三方本地包不被构建期内联进
  api-remotes，须自挂），内嵌同源传输层（`wire.client.mjs` 的镜像）调用远端面。

## 派发总开关（Z12）

**用户可见语义（一句话）**：一个跨会话的「能否把任务派发给 ZCode」总开关，面板、agent 工具、CLI 三处看到的都是同一个文件。

- **真值文件**：`<宿主项目>/collab/zcode-dispatch.switch.json`（`{enabled, updatedAt, updatedBy, note, contract}`；契约全文见宿主项目 `collab/PROTOCOL.md` §7）。路径由 `config.switchPath` 给出（机器专有，见上文「config 说明」）。
  语义：`enabled:false` = **拒绝对 ZCode 的任何派发**；文件缺失/损坏 = 视为开启（不误锁）。
- **查询/切换 CLI**：`node "<本仓库>/collab-kit/zcode-switch.mjs" --project "<宿主项目>" status|on|off [--by …] [--note "…"]`（status 退出码 0=开、2=关）。
- **遵守的三个入口**（缺一不可）：① runner `zcode-run.mjs`（关闭时 exit 3，不启动进程）② 本插件 Host 动作层（`dispatch`/`retry` 关闭时返回 `{ok:false, error, switch}`，不创建 job、不 spawn）③ `<本仓库>/tools/bridge.mjs`（关闭时 exit 3，拒绝投放）。
- **插件侧读写只此一处**：`wire.host.mjs` 的 `readSwitch()`（mtime 缓存、永不抛）/ `writeSwitch()`（tmp+rename 原子写，格式与 CLI 逐字段一致）。UI 与工具都经 `createActionHandler` 的 `switch` 动作写，杜绝第二个写文件方。
- **config**：`switchPath`（string，默认空 = 未接入宿主项目；由 profile patch 指定；测试可指向临时文件密封）。字段清单见上文「config 说明」表（代码里 DEFAULTS / fallbackConfig / schema 三处同源）。
- **面板（UI）**：标题栏徽标「派发：开 / 关」——`conn='live'` 时可点击切换（成功后 1s 轮询带回新快照；真实点击效果需刷新页面后确认）；远端不可用（ext/demo/offline/连接中）时显示为**只读**，tooltip 提示「未连接宿主：请在终端执行 zcode-switch.mjs 切换」，状态未知时如实显示「派发：未知」（浏览器读不到宿主文件，不谎报）。关闭态下派发按钮禁用并显示原因（`switchOffBlocked`）。
- **agent 工具**：`zcode_dispatch` 描述首行动态携带当前状态（注册时生成）；`action=status` 查实时状态、`action=switch`（`enabled` 必填，`by`/`note` 可选）切换、`action=dispatch` 派发（关闭时被拒）。其他会话开工先 `status` 一次即知。
- **重载提示**：本节属宿主半边（`wire.host.mjs`/`index.js`）改动——完全退出 DSH 再启动才生效（pitfalls：cordis `_reload` 不重新 import）；客户端半边（`client.js`）刷新页面即可。

## 验证步骤（creator 会话，安装后）

1. `cordis_inspect_query`：确认新行已挂（`Config.listConfigs` 过滤本包名 → 查 `entry`；插槽注册）。
2. 页面出现右下角悬浮窗：可拖拽（标题栏按住）、可折叠、可最小化成胶囊；五个分区
   （通道 / 派发栏 / 进程列表 / 用量卡片 / 单写者状态）可折叠（通道/派发/单写者默认收起）；浅色/深色主题各看一眼。
3. 双调用方一致性：agent 跑工具 `zcode_dispatch` `action: list`，与 UI 列表一致；
   `action: quota` 的三窗口数字与 `node bin/zcd.mjs quota` 一致。
4. 端到端：`action: dispatch`（`kind: prompt`、`model: GLM-5.3-Flash`、内容 `只回答 OK`）→
   UI 出现 queued→running→done，5h 窗口 run 数 +1。
5. 控制台不得有 `slot entry crashed in '<slot>'`；跑完恢复动过的任何设置/状态。
6. 安装前可先跑本地静态验收（无需安装）：
   `node tools/verify-plugin.mjs`（21 项：manifest / 静态纪律 / Config 是 Standard Schema / 客户端模块加载与槽位注册 / Host e2e）。
   > `test/z2-verify.mjs` 是**历史遗留脚本、当前在 HEAD 上就有红灯**（断言过时 + React 桩缺 Component），
   > 已不在门禁内，仅在排查历史问题时参考。

### 可复跑自测清单

| 脚本 | 项数 | 覆盖 |
|---|---|---|
| `node test/core.test.mjs` | 12 | 派发核心：调度/锁/状态/持久化/淘汰回收 |
| `node test/channel-retry.test.mjs` | 9 | 通道切换、续跑（含 `--resume` 不得带 `--model` 的 F2 回归） |
| `node test/quota-rpc.test.mjs` | 16 | 额度 RPC 与聚合 |
| `node test/tail-scroll.test.mjs` | 13 | 输出框滚动决策（ZB-05：不闪烁、不弹回、底部跟随） |
| `node test/pill.test.mjs` | 16 | 最小化胶囊（ZB-06：保留标题字样、locale 对称） |
| `node test/pill-position.test.mjs` | 16 | 胶囊定位与面板位置视口钳制（ZB-07：胶囊固定右下角、脏 pos 不出屏） |
| `node test/file-lock.test.mjs` | 9 | 细粒度文件锁（ZB-08：声明 write 才生效、未声明回退粗粒度、路径归一化、防死锁、无泄漏） |
| `node test/wait-action.test.mjs` | 6 | `wait` 动作（ZB-08：等终态 / paused 也返回 / 超时不谎报 / 参数校验） |
| `node test/section-order.test.mjs` | 9 | 面板分区渲染顺序（ZB-09：单写者/文件锁紧跟进程、用量置末） |
| `node test/panel-reclamp.test.mjs` | 9 | 任意视口下位置可见（ZB-10 初衷；ZB-11 改锚定后仍保证） |
| `node test/panel-anchor.test.mjs` | 22 | 面板锚定语义（ZB-11：贴边跟随，缩窗不挤到中间、放大回原位） |
| `node test/elapsed-format.test.mjs` | 15 | 耗时展示格式（ZB-13：恒定三段 XX时XX分XX秒；数据层仍为秒数） |
| `node test/ctx-format.test.mjs` | 23 | 上下文占用展示（ZB-14：`180.9k / 200k`，截断非四舍五入） |
| `node test/lock-model.test.mjs` | 8 | 锁模型（ZB-16：删除 memory 锁；不同文件集可并发；同文件排队；跨层级互斥） |
| `node test/lock-ui.test.mjs` | 26 | 派发区锁控件与中文锁名（ZB-16/17：仓库文件锁开关 + 要写的文件 + 分区名「仓库文件锁」） |
| `node test/lock-priority.test.mjs` | 4 | 调度优先级（ZB-17：文件锁任务优先放行；同类内 FIFO；整仓库锁执行时文件锁等待） |
| `node test/lock-badge.test.mjs` | 34 | 进程行锁徽标（ZB-18：区分整仓库锁 / 文件锁 N / 不取锁 / 旧版记录）+ **全仓防复发扫描**（ZB-19） |
| `node test/memory-ban.test.mjs` | 4 | 记忆禁令注入（ZB-20：prompt/target 注入；**task 注入不进去 ⇒ memoryBanApplied=false**） |
| `node test/panel-style.test.mjs` | 24 | 面板样式注入（ZB-21：样式只注入 head 一次，重渲染不再触碰 ⇒ 不透明/不塌左上角） |
| `node test/notify.test.mjs` | 21 | 落地自动唤醒（ZB-22：空闲 followup / 忙碌 inject、幂等、自己 kill/wait 的抑制、唤醒预算、卸载退订、工具层译码） |
| `node test/wake-integration.test.mjs` | 3 | 落地唤醒**全链路接线**（ZB-22：`apply()` → inject agents/systemPrompt → 派发 → 落地 → 唤醒 + 信标 `wakeActive`；关配置 / 无服务时降级） |
| `node test/header-entry.test.mjs` | 29 | 会话标题行入口（ZB-24：槽位/id/order、入口不建 wire、真点击切共享 store、文案双侧） |
| `node test/single-source.test.mjs` | 31 | **单源哨兵**（ZB-25：动作清单 ≡ switch、状态集合引用同一性、三表方法集相等、协议常量逐字相等、STRINGS ↔ locale 逐值） |
| `node test/hardening.test.mjs` | 5 | **核对硬化**（ZB-26：B1 锁 realpath / B2 ownerPid 不改写活 job / B3 多进程不丢更新 / B4 tail 不读越界 / A2 非法 config 只 warn 不阻断激活） |
| `node test/z2-verify.mjs` | — | 端到端验收（越界检查需 `Z2_HOST_REPO`，未设则 SKIP 并如实标注） |

> `file-lock` 与 `wait-action` 用 `node:test` 语义（`node --test test/xxx.test.mjs`），
> 退出码 0 = 全过；其余为自实现的极简断言框架。

## 已知限制

1. **套餐剩余额度未接入**：用量区拆成两段展示——「本地用量（可核对）」= 台账聚合（5h 滚动 /
   本周 / 今日）+ 引擎本周已用（`core/quota.mjs` 的 `fetchPlanQuota()` 经 ZCode app-server
   `usage/stats`，Z3 实装；语义是引擎本地库「已用」合计）；「套餐剩余额度：未接入」明示
   limit/remaining/resetAt 不在 CLI RPC 面（方法表全枚举 + 候选方法实测 -32601；桌面端走签名
   HTTP，裸 Key/OAuth 均 401），以 ZCode 客户端显示为准。三类证据见 `tasks/Z3-delivery.md` §四。
   引擎本地用量**不得**呈现为「套餐已用」。
2. **标准模式不可安装**：无 `plugin_manager`，也不写 `$DSH_HOME`（`C:\Users\Administrator\.dsh`）。
3. **远端面接通但未见真数据的场景**：Z8 已全接线（宿主 face 注册 + 客户端 `$mount` 自挂），
   但若宿主侧 `ctx.provide` 缺席或 typert-loader 未注册本包 TYPERT，客户端会安静降级到
   demo（徽标「演示数据」）；安装后以徽标为准判断（见「真数据 vs demo 判据」一节）。
   宿主→客户端的 `$on` 推送依赖装配级事件源，未接通时以 1s 轮询兜底（功能不受影响，仅刷新及时性）。
5. **Config 形态**：`index.js` 的 `Config` 是 Standard Schema v1——cordis 的 `resolveConfig`
   只认 `Config['~standard'].validate`，裸 JSON Schema 会在激活时报
   `Cannot read properties of undefined (reading 'validate')`（Z10-01 已修）。首选宿主随包
   出货的 schemastery（官方插件同款），解析不到时自动降级为手写 Standard Schema
   （`fallbackConfig()`），激活永不因 schema 崩；字段与默认值不变。
6. **与任务包给定 manifest 的偏离**：`package.json` 的 `files` 数组在任务包给定内容之上补了
   `wire.host.mjs` / `wire.client.mjs` 两项——否则 install_bundle 按 `files` 打包时
   `index.js` 的相对 import 会缺文件。其余字段与任务包逐字一致。
7. 界面文案在 `client.js` 内嵌 `STRINGS` 与 `locale/*.json` 的 `ui` 段**双份同源**（浏览器模块表
   取不到本包 locale 文件）；接线后可改走宿主 locale 服务并删内嵌。

## 接线结论（creator 会话回收处）

> Z8 接线已落地，实际确认值回写如下（升级时对照）：
>
> - 槽位（SLOT 实际取值）：`shell.overlay`（list 型，id=`zcode-dispatch.console`，order=20；
>   证据见 `refs/dsh-slots.md`，与 chat / plugin-manager / workspace 官方先例同槽）
> - Host 入口（Service/Event）：远端面 face `zcodeDispatch`（`ctx.provide` 注册，15 方法；
>   typert-loader 经 `exports["./typert"]` 自动注册 TYPERT 清单 + typertGateway SRC 接收器兜底：
>   实例 `typertRemote` 绑定 + 原型协议标记键）；Host→客户端推送事件名 `zcode-dispatch/changed`
> - TOKENS 实际令牌名：已按 `refs/dsh-theme-tokens.md` 核对（文本族 `--dsw-alias-label-*`、
>   边框 `-border-l1..l4`、状态 `-state-*-primary`、阴影 `--dsw-shadow-lv3`、代码字体
>   `--ds-font-family-code`）
