---
round: Z11
seq: 01
from: zcode
to: dsh
type: delivery
status: done
created: 2026-09-30T16:40:00+08:00
task: tasks/Z11-01-task.md
---

# Z11 交付单：派发台 UI 第二轮（用户实测反馈四项）

> 改动文件（`git diff --stat`）：`zcode-dispatch/client.js`（+268/−107 内含重排）、`zcode-dispatch/wire.host.mjs`（+94/−7）、`zcode-dispatch/locale/zh.json` 与 `en.json`（各 +6）、`zcode-dispatch/README.md`（+22/−9）、`pitfalls.md`（+1 条 Z11 记录）。
> 未触碰：`core/*`、`index.js`（含 Config 字段与工具 schema）、启动路径（`inject` 仍为 `['slots','remote']`、`apply` try/catch 未拆）、`wire.client.mjs`、`package.json`、宿主仓库、`$DSH_HOME`。无 npm 依赖、无 git 提交。
> 并行会话产物（非本单，未动）：`tools/bridge.mjs` 的「派发总开关」增量与 `tasks/Z12-01-task.md`。

## 一、改动清单（逐条对四项）

### ① 去掉内置演示数据 → 诚实空态 ✅

- `legacyWire()` 改为纯选择器（client.js:543）：`__zcodeDispatchDemo === 'builtin'` → `demoWire()`；是含 `getSnapshot()` 的对象 → `extWire(flag)`；**都没有 → `offlineWire()`**。
- 原内置 demo 引擎整体保留为 `demoWire()`（client.js:653，默认不启用，仅 `'builtin'` 显式开启，便于排查）；外部源轮询拆为 `extWire()`（client.js:551，含 `dismiss` 转发）。
- 新增 `offlineWire()`（client.js:618）：无定时器、订阅即同步发一包 `conn:'offline'` + 空快照；动作一律 `{ok:false, error:'未连接宿主（offline）：无进程数据，动作不可用'}`。
- 空快照形状（client.js:611）：`{counts:{running:0,queued:0,done:0,failed:0}, jobs:[], locks:{}, queue:[]}`。
  ⚠ **对任务包的唯一偏离**：`queue` 用 `[]` 而非示例的 `0`——`LockStatus` 按 `snapshot.queue.length` 取队列长度，`0`（数字）会渲染出字面 `undefined`；数组与 live 快照同形且语义同为「空」。
- 徽标补档：`connOffline`（zh「未连接」/ en "offline"），映射见 client.js:1639；`demo/ext/live` 三档不变，`connecting` 兜底不变。
- 进程区空态文案：`JobList` 新增 `offline` prop（client.js:1441），offline 时显示 `emptyOffline`：「未连接宿主：无进程数据（真数据需完成 Remote 接线）」（en 同步）；否则维持 `noJobs`。
- demo 假 job 的 `spec` 补 `prompt` 同名字段（client.js:661，与 core/真实 spec 形状一致；demo `dispatch()` 的新 job 同样带 `[kind]` 字段，client.js:838）。

### ② 分区可折叠（通道/派发默认折叠）✅

- section id 常量集中一处：`SEC`（client.js:52）+ 默认开闭表 `SEC_DEFAULT_OPEN`（client.js:55）：通道/派发/单写者=`false`，进程/用量=`true`。
- `Section({ id, title, collapsible, defaultOpen, children })`（client.js:1119）：折叠态存 `localStorage['zcode-dispatch:section:<id>']`（复用 `loadJson/saveJson`，自带 try/catch）；**整条标题栏可点**（`role=button` + `tabIndex=0` + `aria-expanded` + Enter/Space 键盘切换）；标题右侧倒三角（复用 `IconChevron` SVG，`up=open`）；折叠时只留标题一行。
- Z9 教训回扣（client.js:1114 注释）：本标题栏**不挂拖拽手势、head 内不放 button**——将来若加，必须先 `isInteractive()`（closest）守卫并在按钮 `onPointerDown` 停冒泡。
- FloatingPanel 五个分区全部传 `{ id: SEC.*, collapsible: true }`（client.js:1663-1670）。
- 新 CSS（全走主题令牌 `T`，零字面色值，探针已验）：`.zcd-sec-head`（client.js:110，hover 背景 + focus-visible 轮廓 + 过渡动效）、`.zcd-sec-caret`。

### ③ 暂停进程可「关闭」✅（先核对 core → 走 dismiss 兜底路线）

- **core 语义核对结论**：`dispatch-core.mjs` 的 `kill(id)` 对 paused **是空操作**——paused 时子进程已退出（`close` 处理器跑完即 `children.delete(job.id)`，dispatch-core.mjs:603），`kill` 走默认分支仅 `killRequested.add(id)` + emit（dispatch-core.mjs:1187-1199），**返回 true 但状态永停 paused**（且 `killRequested` 条目残留）。dispatcher 也无删除 API。→ 按任务包预案：wire 层加 `dismiss`，core 零改动。
- `wire.host.mjs` 新增（任务包明示允许）：`dismissed.json` 持久化存储（`state/dismissed.json`，与 jobs.json 同目录；`dismissedSet`/`persistDismissed` 临时文件+rename 原子落盘，wire.host.mjs:72-93）；`createActionHandler` 新 case `dismiss`（wire.host.mjs:203）：仅接受 `DISMISSABLE = paused|done|failed|killed|interrupted`（queued/running 明确报错「请先 kill」），成功返回 `{ok:true, id, state}`；`list` 动作与 face `snapshot()`、`attachHostWire` 推送路径（`snapFiltered`，wire.host.mjs:537）同样过滤 dismissed；`default` 错误提示补 `dismiss`。
- Remote 面补方法：`REMOTE_METHODS`/`FACE_METHOD_TABLE`/`impl.dismiss`/`RemoteFace.dismiss`（wire.host.mjs:203-385），TYPERT 由表自动再生；客户端 `REMOTE_METHOD_TABLE`/`remoteWire`/`useWire` 同步补 `dismiss`（信封不 reject）。
- UI「关闭」按钮（`zcd-btn2`，新 key `closeJob`）：paused 行内第三枚（client.js:1396）。点击逻辑 `doClose`（client.js:1343）：**先 `wire.kill(job.id)`；返回 `ok:false`、或 `ok:true` 但 `job.state` 仍为 `'paused'`（即 core 空操作的特征，返回值带最新 job）时，退回 `wire.dismiss(job.id)`**。
- **关闭后的可见结果（二选一的选定）**：live 路线=**该行从列表消失**（下一轮 1s 轮询的 snapshot 已过滤 dismissed，且跨 DSH 重启仍不出现）；demo 路线=变 `killed`（demo 的 kill 对 paused 有效）。选「从列表消失」因其实现更稳：dismissed.json 落盘后 `snapshot/list/推送` 三条输出路径一致过滤，不依赖 core 状态迁移。宿主重启后仍生效；删除 `state/dismissed.json` 即恢复显示（README 已写明）。

### ④ 点击进程行 → 看到「派发了什么」✅

- **行头点击（非按钮区）切换展开**：`zcd-job-head` 加 `onClick` + `isInteractive(e.target)`（closest `button,input,select,textarea,a,[role="button"]`）守卫（client.js:1372）——行内按钮点击不触发展开切换（防双重切换）；`isInteractive` 从 FloatingPanel 上移模块级与拖拽守卫共用（client.js:279）。展开态用现有 `useState`（`open`），不持久化。
- **展开区 = 派发要素详情 + 「输出」子块**（client.js:1415-1432）：`kind`（中文标签 kindPrompt/kindTask/kindTarget）、prompt/task/target 原文（`clampText` 截 **1200** 字符 +「…」，mono 块）、`provider`/`model`（spec 优先、job 权威值兜底）、`mode`、`cwd`、`timeoutMin`、`createdAt`（queuedAt 本地化时间）、`sessionId`（有则显示）、`pauseReason`（有则显示中文标签，复用 pauseLabel）；输出子块沿用现有 tail 能力，标题用 `t('tail')`。全部文案走 locale，新增 key：`cwd/createdAt/sessionId/closeJob`（+`connOffline/emptyOffline`，共 6 个，zh/en 同步，client.js 内嵌 STRINGS 与 locale/*.json 双份同源）。
- `slimJob` 现状核对：**spec 本来就有**（不是没带），但 body 截 200、无 cwd → 本次放宽：`body: trunc(spec?.[bodyField], 2000)` + `cwd: spec?.cwd ?? null`（wire.host.mjs:118,122）。capture 路径纪律不变：`captureOut/captureErr` 仍在 job 层剥离，spec 本就不含本进程文件路径；UI 侧再截 1200 展示。
- demo wire 假 job 带 `spec.prompt`（形状一致，见 ①）。

## 二、复现命令 + 原始输出

### 1) 语法

```
$ cd zcode-dispatch && node --check client.js && node --check wire.host.mjs
== node --check: client.js OK / wire.host.mjs OK ==        （无输出=通过，echo 为证）
```

### 2) 常驻探针（20/20）

```
$ Z2_ALLOW_PROFILE_WRITE=1 node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,...}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config  demo: false | maxConcurrent: 1 | runnerPath: ... | ...
PASS  纪律: 不 import DSH 客户端包  no @deepseek-ai/dsh-client
PASS  纪律: 不操作 document.body  no document.body
PASS  纪律: client.js 无字面色值（仅主题令牌）  none
PASS  纪律: client.js 不用 JSX/模块 import  createElement 次数=2
PASS  纪律: 使用 --dsw-alias-* 主题令牌  令牌引用 41 处，去重 22 个
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  Config 是 Standard Schema（cordis 激活判据）  {"demo":false,"maxConcurrent":1,...}
PASS  index.js 引用 core dispatcher  imports core
PASS  client.js 通过 __ModuleLoader__.load 注册  id=@local/zcode-dispatch
PASS  factory 只 require react  react only
PASS  factory 返回 {inject, apply}  inject=["slots","remote"]
PASS  boot 安全: inject 不自声明 remote 命名空间  inject=["slots","remote"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=class PanelBoundary ...
PASS  越界: $DSH_HOME profile 近 1h 无写入  (Z2_ALLOW_PROFILE_WRITE=1 放行)
[DSH Z2 探针] 20 项，失败 0 项
```

### 3) 既有单测不回归

```
$ cd zcode-dispatch && node test/core.test.mjs
ℹ tests 11   ℹ pass 11   ℹ fail 0
$ node test/channel-retry.test.mjs
ℹ tests 8    ℹ pass 8    ℹ fail 0
```

### 4) 新增本地桩测试（29/29，**已按任务包跑完即删**：`test/z11-ui.test.mjs` 及 2 个调试脚本已删除）

```
$ node test/z11-ui.test.mjs
PASS  S1 空态: 渲染出 emptyOffline 文案
PASS  S1 空态: 无任何 j-demo 行  clean
PASS  S1 空态: 徽标=未连接（非演示数据）
PASS  S1 空态: 快照计数为空（非假数据）
PASS  S2 折叠: 5 个分区标题栏  实际 5
PASS  S2 折叠: 默认——通道收起 / 进程展开
PASS  S2 折叠: 点击通道标题→展开（回调被调用）
PASS  S2 折叠: localStorage 写入 true  store=true
PASS  S2 折叠: 再点→收起且 localStorage=false
PASS  S2 折叠: 进程分区可收起（persist 独立 key）
PASS  S1/S2 浅渲染全程不抛错
PASS  S3 行: ext 源渲染出 1 行（徽标外部数据）
PASS  S4 行头守卫: 按钮 target 不切换展开
PASS  S4 展开: 渲染出 spec.prompt/派发要素
PASS  S4 展开: kind/provider/mode/cwd/createdAt/sessionId/pauseReason 标签齐
PASS  S4 展开: 「输出」子块在展开区内
PASS  S4 行头守卫: 已展开时按钮 target 也不收起
PASS  S5 关闭: wire.kill(id) 被调用  kill=["j-ext-1"]
PASS  S5 关闭: kill 无效→fallback dismiss(id) 被调用  dismiss=["j-ext-1"]
PASS  S3/S4/S5 浅渲染全程不抛错
PASS  S6 builtin: 显式开启时 demo 引擎仍可用（形状回归）
PASS  H1 dismiss: paused → ok 且落盘 dismissed.json
PASS  H2 dismiss: 落盘内容含 id  ["j-paused"]
PASS  H3 list: dismissed 后不再出现在列表
PASS  H4 dismiss: running 拒绝（需先 kill）
PASS  H5 dismiss: 不存在 id → ok:false
PASS  H6 dismiss: 缺参 → 可读错误
PASS  H7 face.snapshot: jobs 过滤 dismissed
PASS  H8 face.dismiss: 信封 {ok,id,state}
[Z11 桩测试] 29 项，失败 0 项
```

（S6 用 `__zcodeDispatchDemo='builtin'` 验证 demo 引擎保留可用；H1-H8 用 mock dispatcher + 临时目录验证 wire.host 的 dismiss 动作/守卫/落盘/过滤。）

### 5) 真机点击声明

**真实点击行为（拖拽共存下的折叠点击、真浏览器里的展开/关闭）需用户刷新页面后确认——本环境无法点浏览器。** 客户端半边改动刷新页面即生效；wire.host.mjs 属宿主半边，**dismiss 要生效必须完全退出 DSH 再启动**（cordis 不重读盘，见 CREATOR-HANDOFF §改动生效语义 / pitfalls Z10-2）。

## 三、Review / 强制优化 / Simplify（按全局规则留档）

- **Review**：通读 5 文件全量 diff；conn 枚举消费点逐个核对（Z8-1 教训：emitter 5 处 + connLabel + offline prop）；客户端 `REMOTE_METHOD_TABLE` 与宿主 `FACE_METHOD_TABLE` 均 13 方法一一对应；修正 2 处 review 发现（wire.host 未使用的 `existsSync` 导入、文件头过时注释）。
- **强制优化**（性能/安全/健壮性）：性能=offlineWire 零定时器（探针浅渲染不再起 demo interval）、dismissed 集合按文件路径缓存一次加载；安全=dismiss 服务端二次校验状态（queued/running 拒绝）、capture 路径不出网纪律不变、dismissed.json 原子写（tmp+rename）、渲染全走 React 文本节点（无 XSS 面）、不碰 document.body/全局样式；健壮性=dismissed 读取失败按空集合起步、落盘失败不致命（内存态生效）、过滤任何异常放行原列表（过滤永不压过展示）、DEAD_WIRE 补 `dismiss` 方法、键盘可达（Enter/Space）+ aria-expanded。
- **Simplify**：legacyWire 拆三个单一职责函数；`jobs` Map 死变量（demo 引擎内从未使用）顺手清除；折叠持久化复用 loadJson/saveJson，不新造存储层；isInteractive 单实现两处共用。

## 四、未确定项 / 偏离（宁缺毋编）

1. **任务包 snapshot 示例的 `queue:0` 偏离为 `queue:[]`**（理由见 §一①；与 live 快照同形，`LockStatus` 才能正常显示「队列 0」）。
2. **`wire.client.mjs`（`exports["./remote"]` 镜像）未同步**：不在本单允许文件清单内；它不被 client.js 运行时引用（UI 用内嵌同源传输层），但其内嵌 demo 仍是「无 window 即启用」的旧策略且无 offline/dismiss——后续如要对外发布 `./remote` 入口需补齐（已在此如实申报）。
3. **`index.js` 的 agent 工具 schema 未加 `dismiss` 枚举**（index.js 不在本单允许清单）：`createActionHandler` 已支持 dismiss 动作（远端面与 UI 可用），agent 工具侧未主动暴露；如需暴露仅改 index.js 工具说明即可，动作实现无需再动。
4. **`test/z2-verify.mjs` §7 是既有红**（其 React 桩缺 `Component`，Z9 引入 PanelBoundary 后即如此；已 `git stash` A/B 实证改动前后同红）——非本单引入，且该脚本不在现行验收门禁（现行=verify-plugin 20/20）。已记入 pitfalls.md，后续可给它补桩或下线 §7。
5. **本轮为核验第 4 条曾短暂 `git stash push/pop` 单文件做 A/B**（随即还原，`node --check`+标记串已验完整恢复）；此外本单未执行任何 git 写操作（遵守任务包「不 git」）。
6. 真机验收时宿主半边改动（wire.host.mjs 的 dismiss/过滤）需**完全重启 DSH** 才生效；仅刷新页面时 UI 的「关闭」会先走 kill（对 paused 无效）且 dismiss 调用会因远端面无该方法而显示失败反馈——属预期，重启后消失。
