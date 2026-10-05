# ZB-23 五维审计：ZCode 派发台（2026-10-05）

> **方法**：5 路并行**只读**审计 + Lead 跨文件复核。
> 5 路分工：① Host 半边与落地唤醒（`index.js`/`notify.mjs`/manifest）② 派发核心（`core/*`+`bin/zcd.mjs`）
> ③ UI 半边与 wire（`client.js`/`wire.*.mjs`/locale）④ 测试与门禁（`test/*`+`tools/verify-*.mjs`）
> ⑤ 文档与配置一致性（README/patch/manifest/部署 patch）。
> **维度**：review（找问题）/ simplify（简化）/ 强制性优化（必改）/ 解耦（职责与单点）/ 测试验收（门禁与盲区）。
> **每条格式**：严重度 + 维度 + 证据（`文件:行号` + 原文）+ 改法 + 回归风险 + 验证方式。
> 严重度：**P0** 正确性/数据丢失/安全（真机会炸或已炸过）；**P1** 必然出错的维护性/解耦/门禁盲区；**P2** 可读性/一致性。

## 0. 结论摘要

- **审计规模**：5 路并行只读审计 + Lead 跨文件复核，共 **62 条**发现（含 6×P0、20×P1、36×P2），
  每条都有 `文件:行号` + 原文 + 触发条件 + 最小改法。
- **门禁基线（审计前）**：`node --test test/*.test.mjs` **99/99**；`tools/verify-plugin.mjs` 21 项但
  **本机不加 `Z2_ALLOW_PROFILE_WRITE=1` 就是红的**（环境依赖判定）；`tools/verify-switch.mjs` **8/8**。
- **本轮已修 13 组**（§3）：kill 抑制顺序（审计 A 抓到的真 bug）、状态集合单源、remote 方法表补齐
  `dismiss`、两个门禁 P0（假红 + 恒真断言）、文档 P0 族（lock 取值 / 40+ 处旧路径 / 配置表 / quota 文案）、
  文案双份同源、动作清单单源（修掉漏列 `wait`）、`files` 补 `bin`+`cordis.patch.yml`，
  以及**核心 4 条 P0 + 配置语义**（B1 锁 realpath / B2 ownerPid / B3 持久化合并 / B4 越界读取 / A2 warn+安全默认）。
- **门禁（修后，全部无条件绿、无 env 依赖）**：测试 **110/110**、verify-plugin **21/21**、
  verify-switch **8/8**、新增单源哨兵 **31/31**、会话头入口 **29/29**。
- **未修的部分**已分级写入 §4：core 的 B5–B7（锁心跳/缺省看门狗、stdout 缓冲无上限、写放大与膨胀）
  与 UI/测试族的 P1/P2（C1 legacy lock 回灌、C3 中文硬编码、D3 可移植性、D4–D8 覆盖盲区）。
  其中「配置语义」已按用户选择（warn + 安全默认）落地；「中文硬编码」仍需与共享 harness 一起排期。
- **UI 需求（用户当轮要求）**：新增「会话标题行入口」（与「N 个子智能体 / 智能体团队 / 创造模式」同一行、
  点击开合面板），见 §1.9。

## 1. Lead 跨文件复核（已确认，证据在手）

### 1.1 [P1｜解耦/一致性] 未知 action 的报错漏列 `wait`，且动作清单被手抄 4 份

**证据**：
- `index.js:218` `const ACTIONS = ['dispatch','list','kill','dismiss','tail','quota','status','switch','channels','channel','retry','fallback','wait']`（13 个）
- `wire.host.mjs` 的 `switch` 有 13 个 `case`：`dispatch:246 / list:266 / kill:268 / wait:280 / dismiss:324 / tail:336 / quota:343 / channels:354 / channel:358 / status:366 / switch:368 / retry:382 / fallback:392`
- `wire.host.mjs:400` 报错串：``可用 dispatch|list|kill|dismiss|tail|quota|status|switch|channels|channel|retry|fallback`` ← **只有 12 个，缺 `wait`**

**为什么是问题**：这条错误是**模型唯一能拿到的纠正信息**。ZB-08 加 `wait` 时漏改此处，于是模型收到
「可用动作」清单里没有 `wait`，会放弃「派发后等结果」这条正路（正是 ZB-22 要解决的场景）。
`ACTIONS`（工具 schema enum）与 `switch` 分支目前恰好一致，但**靠人眼维持**：加动作要同步 4 处
（`ACTIONS` / `TOOL_PARAMETERS.action.enum` / `switch` / 报错串），任一漏改就是静默漂移。

**改法（最小且根治）**：把动作清单收敛到**单一源** `wire.host.mjs` 的 `export const ACTIONS`（它持有 switch，
是动作的唯一实现点），`index.js` 改为 import 它生成工具 schema enum；报错串由 `ACTIONS.join('|')` 生成。
**回归风险**：低（枚举值不变，仅来源改变）。**验证**：新增门禁测试 —— 断言
`ACTIONS` ≡ `switch` 实际分支集（或用「对每个 action 调一次，返回值不得为『未知 action』」的穷举断言）+ 报错串包含全部动作。

### 1.2 [P1｜一致性] 「落地/终态」状态集合被定义 4 份，其中两份完全相同

**证据**：
- `core/dispatch-core.mjs:286` `const TERMINAL_STATES = new Set(['done','failed','killed','interrupted'])`（未导出）
- `wire.host.mjs:285` `const DONE = ['done','failed','killed','interrupted']`
- `wire.host.mjs:133` `const DISMISSABLE = new Set(['paused','done','failed','killed','interrupted'])`
- `notify.mjs:36` `export const SETTLE_STATES = new Set(['done','failed','killed','interrupted','paused'])` ← 与 `DISMISSABLE` **逐元素相同**

**为什么是问题**：`paused` 是否算「落地」这件事在 core/wire/notify 三处各写一遍；将来加状态（如 `cancelled`）
或改判据（如 paused 不再算落地）必然漏改一处，表现是「wait 返回了但唤醒没发」这类**跨模块静默不一致**。
（坦白：第 4 份就是 ZB-22 我自己新加的。）

**改法**：`core/dispatch-core.mjs` 把两个集合改为 `export`（**零语义改动**，只加 `export` 关键字）：
`TERMINAL_STATES` 与 `SETTLED_STATES = new Set([...TERMINAL_STATES, 'paused'])`；
`wire.host.mjs` 的 `DONE`/`DISMISSABLE` 与 `notify.mjs` 的 `SETTLE_STATES` 改为 import（`SETTLE_STATES` 保留
同名再导出以免破坏既有 import）。
**回归风险**：低（值不变）。**验证**：新增测试断言**对象同一性**（`DISMISSABLE === SETTLED_STATES`、
`DONE === TERMINAL_STATES`）——引用级断言能在有人重新内联字面量时立刻红。

### 1.3 [P1｜一致性] 活体 Config 描述里仍写着改名前的仓库路径（会显示在 DSH 设置界面）

**证据**：
- `index.js:85` `runnerPath: z.string()...description('runner 脚本绝对路径（通用工具仓库 dsh-plugins/collab-kit/zcode-run.mjs，只读使用）...')`
- 活体取证：`cordis_inspect_query {platform:'host',provider:'Config',method:'listConfigs',input:{entry:'include:zcode-dispatch'}}`
  返回的 schema 里就是这句含 `dsh-plugins` 的描述 ← **证明它现在是用户可见文本**
- `index.js:38` 注释、`index.js:104` 注释同样残留旧名

**改法**：三处统一为 `zcode-dispatch/collab-kit/zcode-run.mjs`（并在描述里去掉绝对路径口味，只留仓库内相对位置）。
**验证**：`grep -n 'dsh-plugins' index.js` 归零；复跑 `verify-plugin.mjs`。

### 1.4 [P1｜一致性] README 里指向协作工具的路径**全部是迁移前的旧位置**（照做必失败）

**证据**（`zcode-dispatch/README.md`）：
- `:41` 安装命令 `install_bundle` 的 target 写成 `F:\My Code\dsh-plugins\zcode-dispatch`
- `:52` 配置表 `runnerPath` 写成「宿主项目 `scripts/collab/zcode-run.mjs`」
- `:364` `node "<宿主项目>/scripts/collab/zcode-switch.mjs" status|on|off`
- `:19–21` 目录结构里仍写 `wire.host.mjs`「含 creator 三步 TODO 注释块」—— **实测 TODO 已清偿**（`grep TODO wire.*.mjs` 零命中）

**为什么是问题**：T24 已把通用协作工具迁到 `zcode-dispatch/collab-kit/`，README 未同步 ⇒ 用户/new session
按文档操作会得到「文件不存在」；`:41` 的安装路径更是直接失败。

**改法**：README 内所有协作者路径统一改为 `zcode-dispatch/collab-kit/<tool>.mjs`（或写成 `<本仓库>/collab-kit/...` 以免再次随目录名漂移）；
删掉「creator 三步 TODO」的描述。**验证**：`grep -n 'scripts/collab' README.md` 归零 + 逐条路径实际存在性检查。

### 1.5 [P1｜一致性] 其它**活文档**里的旧路径（copy-paste 即坏）

**证据**：
- `collab-kit/README.md:152–160` —— profile patch **YAML 示例**里 `runnerPath: 'F:\My Code\dsh-plugins\collab-kit\zcode-run.mjs'`、`workRoot: 'F:\My Code\dsh-plugins\zcode-dispatch\.data'`
  ⇒ 照抄会得到「插件指向不存在的 runner」（正是 §10.12 那类事故的成因），且**旧路径已不存在**
- 根 `README.md:29` 目录树仍写 `dsh-plugins/`
- `bridge/README.md:20,24,26,46,47,48` 六处旧路径
- `CREATOR-HANDOFF.md:13,14,107,140,142,157` 六处旧路径（含要执行的命令）

**改法**：活文档里的路径全部更新（`tasks/Z*.md` 属历史交付记录，**按既定决议不动**）；
`collab-kit/README.md` 与 `bridge/README.md` 的示例改为相对占位（`<本仓库>/...`），从根上避免再漂移。
**验证**：对活文档跑一次 `dsh-plugins` 扫描并逐条确认剩余命中都在 `tasks/`（历史）之内。

### 1.6 [P2｜一致性] README 配置表漏了 `runnerCwd`（真机 profile 正在用）

**证据**：确定性比对（脚本解析三处代码定义 + README 表 + patch 键）：
`DEFAULTS=10 / fallback=10 / schema=10 / README 表=9`，**唯一缺口 = `runnerCwd`**（README 全文 0 次出现）；
而部署配置里它是有值且 load-bearing 的：`profiles/desktop/cordis.patch.yml` 的
`runnerCwd: 'F:\My Code\keysion dac vue'`（runner 迁出后无法从自身位置推项目根，靠它 + 绝对 `--task` 双保险）。
**改法**：README 配置表补一行；顺带把「三处代码定义」收敛为字段表驱动（见 1.2 同族、待与审计 A 结论合并）。
**验证**：把上面那个比对脚本固化成门禁（字段集合四处一致 + README 覆盖全部字段）。

### 1.7 [P1｜测试验收/解耦] host 与 client 的**协议常量各写一份，且没有任何门禁守着**

**证据**（跨文件重复扫描）：
- `wire.host.mjs:110` `export const FACE_NAME = 'zcodeDispatch'` ↔ `wire.client.mjs:43` `const FACE_NAME = 'zcodeDispatch'`
- `wire.host.mjs:112` `export const EVENT_NAME = 'zcode-dispatch/changed'` ↔ `wire.client.mjs:44` 同名同值
- `wire.host.mjs:589` `JSON_ANY` ↔ `wire.client.mjs:47` 同名同值
- `wire.client.mjs:32` `REMOTE_POLL_MS = 1000` ↔ `client.js:616` 同名同值
- `tools/verify-plugin.mjs` 对这四组常量**零断言**（`grep FACE_NAME|EVENT_NAME|JSON_ANY|REMOTE_POLL_MS` 无命中）

**为什么是 P1**：host/client 是两个 runtime，不能互相 import，所以「两份」是必要代价 —— 但**必须用门禁锁住相等**。
一旦漂移：`EVENT_NAME` 不一致 ⇒ 宿主推送的事件客户端永远收不到 ⇒ **静默退回轮询**（README 自己写「功能不受影响，
仅刷新及时性」）；`FACE_NAME` 不一致 ⇒ 面板悄悄退回「演示数据」降级。两者都**不会报错**，是最难发现的一类回归。
**改法**：`tools/verify-plugin.mjs` 增加一条常驻哨兵：从两个文件里抽出这四个常量并断言逐字相等
（解析用正则即可，不必 import —— 两文件运行环境不同）。**回归风险**：零（只加断言）。
**验证**：反向验证 —— 临时改一处常量，哨兵必须红。

### 1.8 [P1｜解耦/简化] 客户端侧存在重复实现：`resolveRemote` 同时定义在 wire.client.mjs 与 client.js

**证据**：跨文件声明扫描 → 唯一「同名函数出现在 2 个文件」的就是 `resolveRemote`（`wire.client.mjs`、`client.js`）；
另有 `REMOTE_POLL_MS`（见 1.7）与 `client.js` 内嵌的「降级 wire」与 `wire.client.mjs` 职责重叠。

**状态**：**待审计 C 给出细节**（是否真为重复语义、能否让 `client.js` 只依赖注入的 wire、可删多少行）。
→ 审计 C 结论：内嵌 wire（`client.js:616-1405`，790 行）与 `wire.client.mjs`（779 行）**确已分叉**
（少 `pollTimer == null` 守卫、demo 引擎 4 条 vs 3 条、`locks.memory` 死数据）；收敛为单一来源可 **−780 行**，
列为 §5.1 第一优先（但建议在 D3 可移植化之后做）。

### 1.9 [用户当轮要求｜功能] 派发台加「会话标题行入口」（与子智能体同一行）

**要求**：「把派发台面板改成与子智能体一样的位置，在那一行显示 ZCode 派发台，点击弹出面板。」

**槽位实证**（`cordis_inspect_query` client/Slots，`requestedRoot` 查占用者）：
`conversation.session.header.actions`（list / session 作用域）现有占用者
`subagent-catalog`(-30) / `agent-team`(-20) / `agent-preset`(-10) / `job-list`(20) —— 正是截图那一行。
我们取 **order 10**（排在「创造模式」之后、DSH 自带「后台任务」之前）。

**实现**（`client.js`）：新增 `HEADER_SLOT` 常量、模块级共享 store `panelUi` + `usePanelUi()`、
`HeaderEntry` 组件（胶囊：状态点 + 「ZCode 派发台」+ 有任务时的计数徽标），并注册第二条槽位。
**解耦点**：入口**不建 wire**（若各自 `useWire()`，每开一个会话就多一条 1s 轮询）；面板是唯一 writer，
把 `running/queued/conn` 发布进 store，入口零网络成本显示计数。面板的「最小化」状态也迁进同一 store
（否则会出现「入口显示已打开、面板却是胶囊」的不一致）。

**验收**：`test/header-entry.test.mjs` **29/29** —— 注册契约（槽位/id/order）、入口体内无 `useWire`、
共享 store 去重、真渲染 + **真点击**（`aria-expanded` 翻转）、无任务时不渲染徽标、locale 双侧键齐。
**生效方式**：客户端 → 刷新页面；host 侧改动 → 需重启 DSH（见 pitfalls「host 代码改动必须重启」）。


## 2. 五路审计明细（回收后压缩；逐条原始证据见各审计回复）

### 2.1 Host 半边与落地唤醒（审计 A：0×P0 / 3×P1 / 5×P2）
| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| A1 | P1 | `kill` 抑制登记在 `await handleAction` **之后**，而 queued job 的落地事件在 `dispatcher.kill()` 内**同步** emit ⇒ 自己 kill 的排队任务仍被唤醒一次（实测复现：queued-kill wakes=1 / running-kill wakes=0） | ✅ **已修**（见 §3.1） |
| A2 | P1 | 两条 Config 路径失败语义相反却自称「语义对齐」：走 schemastery 时 `maxConcurrent:0` 让**整插件不激活**，`maxConsecutiveWakes:2.5` 被静默当「不限」 | ✅ **已修**（用户选定 warn+安全默认；见 §3.9） |
| A3 | P1 | 落地判据三处各自定义、core 的 `TERMINAL_STATES` 私有 | ✅ **已修**（见 §3.2） |
| A4 | P2 | `owners/notified/suppressed/spentWakes` 只增不减；`markKilled/markAwaited` 不查 `disposed` | ✅ **已修**（容量上限 + 投递后释放 + disposed 守卫） |
| A5 | P2 | 工具 description 承诺的 `timeoutSec` 不在 `TOOL_PARAMETERS` 里 | ⏳ 未修（低风险，见 §4.2） |
| A6 | P2 | 配了降级链时 paused 通知文案误导；交接出的新 job 无 owner ⇒ 终局不唤醒 | ⏳ 未修（设计取舍，见 §4.2） |
| A7 | P2 | `.data` 兜底只作用于信标却被文档说成 workRoot 兜底；信标合并写留陈旧键且非原子 | ⏳ 未修（见 §4.2） |
| A8 | P2 | `D:/DeepSeek` 硬编码候选真机从未走到；注销回退 `remove/unregister/undefine/dispose` 是死代码 | ⏳ 未修（简洁性，见 §4.3） |

### 2.2 派发核心（审计 B：3×P0 / 3×P1 / 3×P2 + 1 领域）
| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| B1 | P0 | 锁路径只 `resolve`+小写、不做 realpath ⇒ 8.3 短名/符号链接/`\\?\` 指向同一文件却生成两把锁（**实测** `DISPAT~1.MJS` 与长路径 distinct keys=2）⇒ 单写者语义可绕过 | ✅ **已修**（realpath 最长已存在祖先；见 §3.9） |
| B2 | P0 | 任何进程构造 dispatcher 就把**别进程**在跑的 running/queued 改写成 interrupted ⇒ `zcd kill <running>` 永远失败、`zcd retry` 绕过守卫重复派发 | ✅ **已修**（`ownerPid` 判活；见 §3.9） |
| B3 | P0 | `persist()` 只采纳「未知 id」、从不合并盘上更新版本 ⇒ 本进程旧副本会覆盖别进程写的终态（丢失更新），并跨进程删对方捕获日志 | ✅ **已修**（`updatedAt` 合并 + 淘汰只动自己的记录；见 §3.9） |
| B4 | P1 | `tail()` 直接读 `job.outLog/captureOut`，而 `captureOut` 来自可手改的 `jobs.json` ⇒ **任意文件读取**（删除路径有越界校验、读取路径没有） | ✅ **已修**（读取路径同套越界判定；见 §3.9） |
| B5 | P1 | 锁体 `at` 无心跳 + `>2h` 即判过期 ⇒ 长任务锁被夺；未给 `timeoutMin` 则完全没看门狗 | ⏳ 未修（见 §4.1） |
| B6 | P1 | stdout 行缓冲无上限（同仓 appserver-rpc 有 4MB 上限）⇒ 单条超长行 OOM | ⏳ 未修（见 §4.1） |
| B7 | P1 | 每解析一行就全量重写 `jobs.json` + tailLines/parseWarnings 无界 ⇒ 写放大、文件膨胀 | ⏳ 未修（见 §4.1） |
| B8 | P2 | `kill(paused)` 静默空操作却返回 true；终态集合四处硬编码；`bin/zcd.mjs` 仍读已删除的 `locks.memory`、帮助仍写 `--lock memory\|both` | 🟡 **部分已修**（集合单源 ✅ 见 §3.2；`kill(paused)→false` 与 zcd 僵尸字段 ⏳） |
| B9 | P2 | 损坏/半写的文件锁永不被 sweep，且 `lockBlockersFor` 把它当「无阻塞」⇒ 排队但报「没人挡你」 | ⏳ 未修（见 §4.3） |
| B10 | P2 | `mondayYmdInTz` 在 UTC+13/+14 偏移一天（实测 Auckland → 本周漏掉周一） | ⏳ 未修（改法一行，见 §4.3） |

### 2.3 UI 半边与 wire（审计 C：0×P0 / 3×P1 / 7×P2；体量校正 client.js 2622 行）
| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| C1 | P1 | 旧 job 的 `spec.lock ∈ {both,memory}` 被 `slimJob` 原样透传、UI 又逐字回灌 ⇒ 「重跑/续接」必被 core 白名单拒（`jobs.json` 实测 4 条 legacy；今天恰被 dismissed 掩盖） | ⏳ 未修（见 §4.2） |
| C2 | P1 | `wire.client.mjs` 描述符表自称与 host 一一对应，实际**缺 `dismiss`**（15/14/15 三份表已漂移） | ✅ **已修**（补齐 + 三表相等哨兵，见 §3.3） |
| C3 | P1 | 锁文案与耗时格式中文硬编码 ⇒ EN 界面混排（locale 里根本没这些键） | ⏳ 未修（要动 4 份文件 + 20+ 条中文断言的测试，见 §4.2） |
| C4 | P2 | 11 个 UI 测试只有 2 个真渲染；事件处理器从不被调用；`client.js` 的 remoteWire/extWire 从未执行 | ⏳ 未修（§4.3） |
| C5 | P2 | 内嵌 wire 与 `wire.client.mjs` 已分叉（少了 `pollTimer == null` 守卫、demo 引擎 4 条 vs 3 条、`locks.memory` 死数据） | ⏳ 未修（收敛 = 见 §5.2 简化靶点） |
| C6 | P2 | `clampText(lk.file.replace(...))` 无 String 兜底 ⇒ 一条坏数据就把整块面板换成错误卡片 | ⏳ 未修（§4.3） |
| C7 | P2 | 注入 22 个 `--zcd-*` 变量，实测只有 6 个被引用（16 个死变量） | ⏳ 未修（§5.3） |
| C8 | P2 | 轮询 tick 无 in-flight 守卫；推送分支是死代码（宿主无 `registerRemoteEvents`） | ⏳ 未修（§4.3） |
| C9 | P2 | 异步回调 `setState` 无 alive 守卫；`setOpen` 的 updater 里写 localStorage（非纯） | ⏳ 未修（§4.3） |
| C10 | P2 | 同事实多点手写：`DISMISSABLE` 两份、`doRerun/doResume` 逐字相同、tail 行数散在 5 处、`kvRow` 两份 | 🟡 **部分已修**（DISMISSABLE 单源 ✅） |

### 2.4 测试与门禁（审计 D：3×P0 / 5×P1 / 2×P2）
| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| D1 | P0 | `verify-plugin.mjs` 越界项是**环境依赖判定**（profile 近 1h 无写入）⇒ 本机装过插件就恒红，加 env 又恒绿（不变量失效）；目录缺失时 ENOENT 崩而非 FAIL | ✅ **已修**（改为探针自身运行前后快照对比；本机现在**不加 env 即 21/21**，见 §3.4） |
| D2 | P0 | `channel-retry.test.mjs:124` `existsSync(d.lockPaths.memory) === false` **恒真**（ZB-16 已删该字段，`existsSync(undefined)` 返回 false + DEP0187） | ✅ **已修**（改为 `'memory' in lockPaths === false`，见 §3.4） |
| D3 | P0 | 不可移植：11 个测试文件 + 2 个探针硬编码 `F:\My Code\...` ⇒ 换路径/新克隆整体假红 | ⏳ 未修（机械替换 14 处，见 §4.2） |
| D4 | P0 | 令牌存在性不在门禁：`z4-token-check.mjs` 不匹配 `*.test.mjs`（glob 跑不到）且依赖被 gitignore 的 refs | ⏳ 未修（见 §4.2） |
| D5 | P1 | 卸载 kill 路径零覆盖（测试都在终态后才卸载） | ⏳ 未修（补测成本 S） |
| D6 | P1 | 陈旧锁回收零覆盖 | ⏳ 未修（S） |
| D7 | P1 | 持久化损坏降级零覆盖（catch 分支从未执行） | ⏳ 未修（S） |
| D8 | P1 | 真实 `ctx.tools` 注册 + `execute` 零自动化证据 | ⏳ 未修（需抽 `runToolAction`） |
| D9 | P1 | 三份 remote 方法表无一致性断言（= C2） | ✅ **已修**（哨兵，见 §3.3） |
| D10 | P2 | 11 份自实现断言框架重复 >> 建议抽 `test/harness.mjs`（可删 ~450 行、净减 ~270） | ⏳ 未修（见 §5.1） |

### 2.5 文档与配置（审计 E：3×P0 / 9×P1；README 实为 451 行）
| # | 严重度 | 问题 | 状态 |
|---|---|---|---|
| E1 | P0 | README 仍写 `lock(repo\|memory\|both)`，而 core 对 memory/both **直接抛错** ⇒ 照文档派发必失败 | ✅ **已修**（README + 根 README + zcd 帮助 + demo 假锁，见 §3.5） |
| E2 | P0 | `install_bundle` target 写 `F:\My Code\dsh-plugins\zcode-dispatch`（实测不存在） | ✅ **已修** |
| E3 | P0 | 开关 CLI / bridge 路径全是迁移前位置（实测 3 个路径 Test-Path=False） | ✅ **已修**（README/bridge/collab-kit/根 README，共 30+ 处） |
| E4 | P1 | `package.json` 的 `files` 缺 `bin` 与 `cordis.patch.yml`，而 `dsh.bundle.patch` 正指向后者 ⇒ 真装机缺文件 | ✅ **已修**（并扩展了哨兵覆盖面） |
| E5 | P1 | README 配置表缺 `runnerCwd`（= 我的 1.6） | ✅ **已修** |
| E6 | P1 | `index.js` 的 quota 文案与实现相反（说「恒 available:false，待接 RPC」，实际 Z3 已接入） | ✅ **已修** |
| E7 | P1 | README 写远端面「13 方法」，实际 15（含 C2 的漂移） | ✅ **已修**（README 15 + 三表相等哨兵） |
| E8 | P1 | README「已知限制 #4 工具注册 API 未确认」早已被 Z13 解决 | ✅ **已修**（删除该条） |
| E9 | P1 | README 推荐 `node test/z2-verify.mjs` 作验收，而它当前 63 PASS / 7 FAIL（且不在门禁内） | ✅ **已修**（改指向 `tools/verify-plugin.mjs`，并如实标注 z2-verify 现状） |
| E10 | P1 | 自测清单项数错（pill-position 15 vs 实测 16；根 README 20 项 vs 21；漏新增两行） | 🟡 **部分已修**（15→16；新增测试行待补） |
| E11 | P1 | 「同事实 15 组、7 组已漂移」 | 🟡 **主要几组已单源化**（§3.2/§3.3/§3.6） |
| E12 | P2 | 文档族：TODO 描述自相矛盾、框架说明错（10/21 用 node:test）、`grip` 值漂移 | ✅ **已修**（TODO 句、z2-verify 说明、grip 双份对齐 + 新增值一致性哨兵） |

## 3. 本轮已修（附验证方式）

| # | 修复 | 证据/验证 |
|---|---|---|
| 3.1 | **kill 抑制顺序**：工具层改为 pre-hook（`handleAction` 之前登记，失败回滚），notify 增加 `unmarkSuppressed` | `test/notify.test.mjs` 新增 4 条：真实顺序不唤醒 / 错误顺序会唤醒（记录缺陷存在性）/ 回滚后可唤醒 / 投递后释放归属 |
| 3.2 | **状态集合单源**：core `export TERMINAL_STATES` + 新增 `SETTLED_STATES`；`wire.DISMISSABLE`、`notify.SETTLE_STATES`、`wait` 判据全部改为引用它 | `test/single-source.test.mjs` ②：**引用级**断言（`DISMISSABLE === SETTLED_STATES`） |
| 3.3 | **remote 方法表**：`wire.client.mjs` 补 `dismiss`（14→15）；三表相等 + client 调用面越界检查 | `single-source.test.mjs` ③（15/15/15） |
| 3.4 | **门禁两处 P0**：verify-plugin 越界判定改为「探针运行前后快照对比」（不再依赖机器历史）；channel-retry 恒真断言改为真断言 | `tools/verify-plugin.mjs` **不加 env 21/21**（此前本机 FAIL） |
| 3.5 | **文档 P0 族**：lock 取值 4 处、旧路径 40+ 处（README/根 README/bridge/collab-kit/CREATOR-HANDOFF/工具自身 usage）、README 配置表补 `runnerCwd`、quota 文案、13→15 方法、删过时「已知限制 #4」、z2-verify 推荐改向、TODO 描述 | `grep dsh-plugins` 仅剩 `pitfalls.md` 的历史条目；`scripts/collab` 仅剩 collab-kit 自身的历史说明 |
| 3.6 | **文案双份同源**：`grip` 值对齐 + 新增「STRINGS ↔ locale 逐键逐值」哨兵 | `single-source.test.mjs` ⑤（126 键 × 2 语言，差异 0） |
| 3.7 | **动作清单单源**：`ACTIONS` 归属 `wire.host.mjs` 并导出；index.js 的工具 schema 与「未知 action」报错串都由它派生（**修掉漏列 `wait`** 的模型可见缺陷） | `single-source.test.mjs` ①：ACTIONS ≡ switch 分支集；报错串由 join 生成 |
| 3.8 | `package.json` 的 `files` 补 `bin`、`cordis.patch.yml` | `verify-plugin` 的「相对 import 全覆盖」哨兵 + 人工核对 |

**门禁（全部无条件绿，无 env 依赖）**：
`node --test test/*.test.mjs` → **105/105**；`node tools/verify-plugin.mjs` → **21/21**；
`node tools/verify-switch.mjs` → **8/8**；`node test/single-source.test.mjs` → **31/31**；
`node test/header-entry.test.mjs` → **29/29**。

### 3.9 核心安全/一致性 P0 批（ZB-26，用户选定「先修核心」）

| 项 | 修法 | 验证 |
|---|---|---|
| **B4 任意文件读取** | 抽公共 `isUnder(root, p)`（删除路径原先那份也改用它）；`tail()` 的读取路径补同一道校验 —— `captureOut/captureErr` 只允许在 `dirLogs` 内，`outLog` 允许 `dirLogs/workRoot/runnerCwd`（全部来自 config，不是 jobs.json 这种不可信输入）；越界候选**跳过并在 parseWarnings 留痕**，最终回落到内存 tailLines | `hardening.test.mjs` B4：越界内容不得出现在结果、越界被留痕、允许根内仍可读 |
| **B2 改写别进程的活 job** | job 落盘带 `ownerPid`；`restore()` 仅当 ownerPid **已不存在**（或无该字段的旧快照）才判残留并终结；ownerPid 活着 ⇒ 原样保留 | B2：ownerPid=本进程 ⇒ 保持 running；无字段 ⇒ 旧语义照旧；pid 已死 ⇒ interrupted |
| **B3 多进程丢失更新** | job 带 `updatedAt`（创建时、每次 emit、finalize **落盘前**都盖）；`persist()` 按 updatedAt 合并盘上更新版本（旧快照无该字段时保持旧行为）；淘汰只处理本进程拥有的记录（避免跨进程删对方捕获日志） | B3：A 采纳 X 的旧副本 → B 把 X 写为 done → A 再 persist ⇒ 盘上仍是 done |
| **B1 锁可被绕过** | `normalizeForLock` 对**最长已存在祖先**做 `realpathSync.native`（尾段拼回，保证「将来才创建的文件」照样能锁），失败退回 resolve | B1：含 `..` 写法与大小写不同 ⇒ 同一把锁；**junction 指向同目录时第二个任务必须 queued** |
| **A2 配置非法即整插件不激活** | 配置事实收敛为唯一 `FIELDS` 表（默认值 / 归一则 / 描述一处声明）；主路保留 schemastery **实例本身**（品牌 / type / meta 不动 ⇒ `isNativeConfigSchema` 仍判原生），只把 `~standard` 影子成「永不返回 issues」；两条路径共用 `normalizeConfig`；问题进日志 + 激活信标 `configIssues` | A2（`hardening.test.mjs`）：`maxConcurrent=0`→1、`maxConsecutiveWakes=2.5`→2、`runnerPath=123`→空串、字符串 `demo='yes'`→false，且 **issues 为 undefined**；品牌 / type / meta 三项结构标记仍在 |

> 为什么「保留 schemastery 实例、只影子 `~standard`」：DSH 的 `isNativeConfigSchema` 是**结构判定**
> （`Reflect.get(v, Symbol.for('schemastery')) === true` + `typeof v.type === 'string'` + `meta` 为对象，
> 见 `@deepseek-ai/dsh-app-boot`），换成包装对象有被判 `unsupported` 的风险；而 cordis 只在
> `resolveConfig` 里读 `Config['~standard'].validate`（`cordis/lib/index.js:958-960`，有 issues 就 throw）。
> 影子一个属性同时满足两边：投影与判原生不受影响，校验不再阻断激活。

## 4. 未修清单（按建议顺序，附最小改法与暂缓理由）

### 4.1 仍建议优先（core 性能/资源类，各自独立、都可配一条回归用例）
1. **B5 锁无心跳 + 无缺省看门狗**：锁体 `at` 只在获取时写一次，而 `isStaleLock` 先判年龄（>2h 即过期）⇒ 超 2h 的任务锁会被别的进程当过期夺走；未给 `timeoutMin` 则完全没有看门狗。改法：persist 时 touch 锁体 `at`；加缺省兜底看门狗（默认值须大于现有最长任务）。
2. **B6 stdout 行缓冲无上限**：`buf += chunk` 不设上限（同仓 `appserver-rpc.mjs` 有 4MB 上限），单条无换行超长行直接吃内存。改法：1MB 上限 + 截断计数 + 单行 tailLines 截断。
3. **B7 写放大与膨胀**：每解析一行就全量重写 `jobs.json`（终态 job 的 200 行 tailLines 全量落盘、parseWarnings 无上限），finalize 时同步全量读解析整个台账。改法：persist 节流（≥500ms/关键字段变化）、tailLines 落盘截断、parseWarnings 限长。
4. **B9 损坏文件锁永不 sweep**（且 `lockBlockersFor` 把它当「无阻塞」⇒ 排队但报「没人挡你」）；**B10 `mondayYmdInTz` 在 UTC+13/+14 偏移一天**（一行改法）。

### 4.2 仍需你拍板的一处
1. **C3 中文硬编码**：把锁文案/耗时格式改走 `t()` 会动 4 份文件 + 20+ 条按中文字面量钉死的测试断言。建议连同 D10 的共享 harness 一起做（一次改造，长期收益）。
2. （已决）**A2 配置语义**：按你的选择统一为 **warn + 安全默认**，已落地见 §3.9。

### 4.3 其余（可排后）
C1（legacy `spec.lock` 白名单归一化，`slimJob` 一处）、C4/C6/C8/C9（UI 健壮性）、D3（14 处绝对路径改 `import.meta.url`）、D4（令牌全集入库 fixture）、D5–D8（四类覆盖盲区，各 S 成本）、B8 余项（`kill(paused)→false`、zcd 僵尸字段）、B9、B10、E10（清单项数）、A5/A6/A7/A8。

## 5. 简化收益排序（审计 C 建议 + 我的判断）

1. **内嵌 wire 与 `wire.client.mjs` 收敛为单一来源（≈ −780 行）**：一次消除 C2/C5 整类漂移。风险：`package.json` exports、两文件头注释、`z2-verify.mjs:150` 的导入需同步。**建议在 D3 可移植化之后做。**
2. **删内嵌 demo 引擎（client.js 1002–1353，351 行）**：保留 ~30 行最小快照；同时消掉 C5 的 demo 分叉。风险：失去「builtin 一键假数据」。
3. **单点化零散同事实（≈ −70 行）**：五个 Section 数据驱动、合并 `doRerun/doResume`、`kvRow` 去重、删 16 个死 CSS 变量。风险：`section-order.test.mjs` 的正则断言必须同步改。
4. **抽 `test/harness.mjs`（−450 行样板 + ~180 行 harness，净减 ~270 ≈ 9%）**：同时解掉 D10 与 C4 的一半。

## 6. 结论

- **15 组「同事实多处定义」中，7 组已实际漂移**；本轮把其中**最能再漂的 6 组**收敛成「单一源 + 引用级/逐字级哨兵」（动作清单、状态集合、remote 方法表、协议常量、界面文案、包文件清单），并修掉 2 个**门禁自身的假红/假绿**。
- 真机上直接会咬人的两类已消除：**照 README 必失败**（lock 取值 + 旧路径 + install target）与 **模型可见的错误动作清单**（漏 `wait`）。
- 剩下的硬骨头是多进程一致性（B1–B3）与 core 的输入安全（B4）——它们需要一轮专门的、带双进程/越界用例的改动，我没有在这轮里硬塞，改法与验收方式都已写在 §4.1。

