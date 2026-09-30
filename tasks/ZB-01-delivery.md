---
round: ZB-01
seq: "01"
from: creator
to: dsh
type: delivery
status: done
created: 2026-09-30T16:00:00+08:00
---

# ZB-01 交付：① 工具注册（绝对路径回退 + 激活信标）② Remote 接线（四步配方）③ 离线态提示

> 任务包：`tasks/CREATOR-NEXT.md`（本轮创造模式独占写权）。改动只落在
> `F:\My Code\dsh-plugins\zcode-dispatch\**`（+ 本交付文档）；**未动 宿主仓库任何文件**，
> 未安装/卸载插件，未写 `$DSH_HOME`，未 npm 依赖，**未做任何 git 操作**（任务包硬约束）。
>
> **宿主半边已改 → 需要完全退出 DSH 再启动**（§4 给步骤）。客户端半边刷新页面即可。

---

## 0. 一句话

三件都做了。**① 的根因已定证**（裸 import 必然失败，已补绝对路径回退 + 双策略装载）；
**② 找到了阶段 A 查不出的真正断点：异步 `$mount` 与「首帧一次性探测」的竞态**，按 whale-pet 配方
改用子 fiber + 就绪后重建 wire；③ 离线提示按真实留痕给出原因。**全部门禁 47/47 绿**。
剩一个未定项：宿主 `ctx.provide` 到底有没有登记成功——本轮**已把它变成可查事实**（激活信标），
重启后读一个文件即可判定，见 §4 与 §5。

---

## 1. 改动清单

| 文件 | 改动 | 对应待办 |
|---|---|---|
| `index.js` | `+127 −?`：新增 node 内建 import、`DSH_TOOLS_REL`/`dshToolsCandidates()`、重写 `loadDefineTool()`（裸 import → 绝对路径 `import()` → 同路径 `require()`）、激活信标 `writeActivationBeacon()`、`TOOL_REGISTER_ERROR` 留痕 | ① |
| `wire.host.mjs` | `+49 −?`：`provide` 留痕（`provideDiag`）+ `ctx.reflect.provide` 降级回退 + 注册后可见性自检 + 失败改 `console.warn` 不再静默；`attachHostWire` 返回值新增 `diagnostics` | ②（E1） |
| `client.js` | `+99 −?`：远端就绪信号（`REMOTE_SVC`/`markRemoteReady`/`onRemoteReady`/`MOUNT_DIAG`）、`resolveRemote` 优先用子 fiber 实例、`useWire` 就绪后重建 wire、`apply` 改用子 fiber `ctx.inject(['remote.zcodeDispatch'], …)`、`ChannelSection` 离线提示 | ②③ |
| `locale/zh.json`、`locale/en.json` | `+1` 各：`ui.chanOfflineHint` | ③ |

`git status --short`（本轮结束）：仅上述 5 个文件 `M`，无新增未跟踪文件（`.data/` 已在 `.gitignore`）。

```
 zcode-dispatch/client.js      |  99 ++++++++++++++++++++++++++++----
 zcode-dispatch/index.js       | 127 +++++++++++++++++++++++++++++++++++++++---
 zcode-dispatch/locale/en.json |   1 +
 zcode-dispatch/locale/zh.json |   1 +
 zcode-dispatch/wire.host.mjs  |  49 ++++++++++++++--
 5 files changed, 254 insertions(+), 23 deletions(-)
```

---

## 2. 待办 ①：工具注册

### 2.1 诊断（§2.1 要求的两步，都做了）

**第一步 · `cordis_inspect_query` → Tool / `listTools`**：原始输出落盘件
`C:\Users\ADMINI~1\AppData\Local\Temp\dsh-spill-OphxhO\session-283b1745d551\2f3b9a3435e1-cordis_inspect_query.txt`，
对全文 `grep -i zcode` → **No matches found**。即 **`zcode_dispatch` 当前确实不在本 Agent 可调用工具表里**（① 待办成立）。

**第二步 · 根因定证（比"疑为"更硬）**——任务包 §2.2 的猜测**成立**，且补上了证据链：

| 证据 | 结论 |
|---|---|
| profile 的 `node_modules` 实际内容只有 `@local`、`dsh-plugin-whale-pet`、`.pnpm` —— **没有 `@deepseek-ai` 作用域** | 从本包向上逐级找 `node_modules` 必然找不到 `@deepseek-ai/dsh-tools` → `ERR_MODULE_NOT_FOUND` |
| 本包是**软链**进 profile 的；Node 默认按 **realpath** 解析（`F:\My Code\dsh-plugins\zcode-dispatch`），无论软链与否都出不了 `F:\My Code\...` 这棵树 | 解析失败与安装方式无关，是**结构性的** |
| **asar 头 JSON 解析**（自写一次性探针，读完即删）→ `dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js` **存在，157954 字节**，与 `refs/dsh-tools/lib/index.js` **同尺寸** | 绝对路径回退**有真实靶子**，不是猜路径 |
| `app.asar.unpacked/dsh/node_modules/@deepseek-ai/` 下只有 `dsh-desktop-host / dsh-session-log-export / libreoffice-kit*` —— **`dsh-tools` 不在 unpacked 里** | 只能走 asar 内路径（unpacked 候选保留为兜底，命中则用） |
| 反例：`refs/plugin-whale-pet/lib_index.js` 宿主半边**完全不 import 任何 `@deepseek-ai/*`**（只用注入的 `agents`） | 第三方目录下裸 import **无先例**，与任务包判断一致 |

> 附带发现（**同一根因，本轮未改，如实登记**）：`loadConfig()` 的裸 `import('@deepseek-ai/schemastery')`
> 同样必然失败 → 实际走的是 `fallbackConfig()` 手写 Standard Schema。功能等价（Z10 已双证），
> 故本轮**不动**它，避免扩大爆炸半径；见 §5 未确定项 3。

### 2.2 修法（§2.2 的四候选 + 双策略）

`index.js:95-179`

```js
const DSH_TOOLS_REL = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'];   // :95
function dshToolsCandidates() { … }                                                              // :98
async function loadDefineTool() { … }                                                            // :122
```

候选顺序（**与任务包 §2.2 的 1–4 条一一对应**）：
1. `process.env.ZCD_DSH_TOOLS`（显式覆盖，最高优先）
2. `path.join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')`
3. `…/app.asar.unpacked/…`（同源推导）
4. 硬编码 `D:/DeepSeek/resources/app.asar/…` 与 `…/app.asar.unpacked/…`

每个候选**先试 `await import(pathToFileURL(p).href)`，再试 `require(p)`**（Node 24 支持 `require(esm)`：
本轮实测 `require(esm) OK -> function`，见 §3）。双策略的理由：**asar 内 ESM 装载**这一环没有本地可复现的
验证手段（Node 无法读 asar，只有 Electron 的 fs 补丁能读），而 CJS `require` 对 asar 的支持是 Electron 最老的路径
——两条都试，命中即用；**全失败再降级 `null`，激活安全第一**（硬约束 3）。

**证据（契约侧）**：`refs/dsh-tools/package.json` → `"type":"module"`, `main: lib/index.js`,
`exports["."] → ./lib/index.js`；`refs/dsh-tools/lib/index.js:3714` 导出清单含 `defineTool`；
实现 `refs/dsh-tools/lib/types/schema.js:274`（`defineTool(options)` 编译 parameters/output、
包 execute 校验、挂 presenters）。我们**沿用既有调用形态** `ctx.tools.register(defineTool({…}))`
（`index.js` 内 `registerZcodeDispatchTool`，与 `refs/dsh-tools/tool-fs-example/index.js:261` 同形），本轮只修**解析**这一环。

### 2.3 激活信标（§2.1 要求）

`index.js:171` `writeActivationBeacon()`，落点 `config.workRoot/state/activation.json`
（默认即 `zcode-dispatch\.data\state\activation.json`；`.data/` 已 gitignore）。**写失败绝不抛**。
`index.js:351` 在 `apply()` 里写入，字段：

```json
{ "at": "…", "name": "zcode-dispatch", "dispatcherReady": true, "workRoot": "…",
  "switchPath": "…",
  "ctxToolsRegisterAvailable": true,
  "defineToolResolved": true, "defineToolSource": "abs:D:/DeepSeek/resources/app.asar|import",
  "defineToolAttempts": [ { "source": "bare", "strategy": "import", "ok": false, "error": "ERR_MODULE_NOT_FOUND: …" }, … ],
  "toolRegistered": true, "toolRegisterError": null,
  "remote": { "available": true, "strategy": "ctx.provide", "ok": true, "error": null,
              "visibleAfter": true, "matchedFace": true, "fallbackTried": null },
  "switchEnabled": true }
```

一眼定位表：

| 现象 | 指向 |
|---|---|
| `defineToolResolved:false` | 包没解析到 → 看 `defineToolAttempts` 里每个候选的错误 |
| `defineToolResolved:true` 但 `toolRegistered:false` | 解析到了，`ctx.tools.register` / `defineTool` 调用有问题 → 看 `toolRegisterError` |
| `remote.ok:false` | **H2**：`provide` 抛错（错误文案会写进 `remote.error`，例如 `service "zcodeDispatch" has been registered at <fiber>`） |
| `remote.ok:true` 但 `remote.visibleAfter:false` | **H1 的一种**：provide 返回了 disposer 但 `ctx.get` 取不到 → 注册语义与预期不符 |
| `remote.ok:true` + `visibleAfter:true` | 宿主服务确已登记 → 不通就在客户端/描述符侧（此时客户端面板会给出 `$mount` 的真实结果，见 §3.3） |

---

## 3. 待办 ②：Remote 接线（四步配方逐条对齐）

### 3.0 先说一条**对任务包 §3 表格的更正**（宁缺毋编）

任务包 §3 表格写「① 宿主暴露：… ❌ **缺 `typertRemote` 标记**」。**这一条不成立**——
`wire.host.mjs` 的 `RemoteFace` 构造函数**早已**设置该标记（Z8 落地）：

```js
// wire.host.mjs:451-454（本轮未改这一处）
class RemoteFace {
  constructor() {
    this.typertRemote = Object.freeze({ service: this, serviceKey: FACE_NAME, namespace: FACE_NAME });
  }
```

且与官方网关的校验面**逐字段对得上**（`refs/extracted/dsh-api-gateway/lib/index.js:1459-1461` `readBinding`）：
`binding.service === original`（恒等）✅ `binding.serviceKey === serviceKey` ✅ `binding.namespace` 是 string ✅；
方法标记键也逐字一致（`wire.host.mjs:111` 的 `'@deepseek-ai/dsh-typert-protocol/remote-methods'`
== `refs/dsh-typert/protocol/lib/index.js:135`，`version: 1` ✅），方法签名走原型链解析
（`…/dsh-api-gateway/lib/index.js:1467-1492` `methodParameterNames`）也满足（我们的方法全是简单标识符参数）。
**故本轮没有"补标记"这件事可做**；真正缺的是下面 §3.3 的那一环。

### 3.1 ① 宿主暴露 —— 已有，本轮加留痕与降级回退

`wire.host.mjs:618-652`：`provideDiag` + `tryProvide()`；`ctx.provide` 失败时**才**试
`ctx.reflect.provide`（官方客户端插件同款写法，`refs/extracted/dsh-client-ui-layout/lib/client.js:600`），
避免同名二次 provide 抛「already registered」。注册后立即自检 `ctx.get(FACE_NAME)`。
失败从**静默 catch** 改为 `console.warn`（阶段 A §6 的 **E1 实验**，此处落地）。
`provideDiag` 经 `wire.host.mjs:723` `diagnostics` 交给 `index.js` 写进信标。

### 3.2 ② 宿主描述符 —— 已对齐，逐条核过官方校验

`TYPERT`（`wire.host.mjs`）对 typert-loader 的**实际校验点**逐条过：
`schemas` 必须是数组 ✅（我们 `[]`）、`model.services/events/objects` 必须是数组 ✅、
每个 codec 必须 `{mode:'strict', typeSymbol:string, create:function}` ✅
（校验实现：`refs/dsh-typert/loader/lib/index.js:82-106`、`:208-211`）。
loader 侧**没有**「typeSymbol 必须能解析到已声明 schema」这类跨校验，故 `schemas: []` 合法。
`exports["./typert"]` = `./wire.host.mjs` ✅（`package.json`）。

### 3.3 ③ 客户端 —— **本轮的真正修复点**（任务包 §3 表格判为「❌ 运行时探测」，方向对，但没说透）

**新证据链（本轮读官方源码定证）**：

1. `$mount` 是**异步**的：`refs/extracted/dsh-api-gateway/lib/client.js:1636-1646`
   `async $mount(contribution)` → `callerCtx.effect(async () => mountContribution(...))` → `await owned`。
2. `mountContribution`（`:1662-1683`）→ `installNamespace`（`:1721`）→ `createNamespace` 在**其 fiber 的 apply 里
   同步装出 `remote.<namespace>`**（`:1712-1716` 原注释：*"a fresh namespace installs its whole group synchronously
   inside its fiber's apply"*）→ 即命名空间是在**若干 microtask 之后**才出现。
3. **`$mount` 对宿主零依赖**（`:1684-1710` `validateContribution` 只校验本地描述符形状 + strict codec，
   不查宿主就绪；与 whale-pet `lib/client.js:2184` 注释 *"$mount installs LOCAL descriptors only;
   it does not check Host readiness"* 一致）→ **所以 $mount 大概率是成功的**。
4. 而 `useWire()`（改前 `client.js:1127-1129`）用 `useRef` **只在首帧建一次 wire**：
   `if (ref.current == null) ref.current = createWire() ?? DEAD_WIRE;`
   → 首帧探测 `resolveRemote()` 落空 → `legacyWire()` → `offlineWire` → **面板被永久锁在「未连接」**，
   即使 100 ms 后命名空间已经装好也不会再看一眼。

**⇒ 断点 = 异步 `$mount` 与「首帧一次性探测」的竞态。** 这解释了全部现场症状
（徽标「未连接」+ 通道/模型因 `channels.length === 0` 而禁用），且**不需要宿主有任何问题**。

**修法（配方步骤③的子 fiber 正是这件事的正解）**，`client.js:313-329` / `:386` / `:1155-1172` / `:1836-1856`：

```js
let REMOTE_SVC = null;                       // :313  命名空间就绪后的权威实例
const remoteWaiters = new Set();             // :314
const MOUNT_DIAG = { attempted:false, ok:null, error:null };  // :316  $mount 结果留痕
function markRemoteReady(svc) { … }          // :317
function onRemoteReady(fn) { … }             // :323
// :386  resolveRemote 优先 REMOTE_SVC，其次才 ctx.remote 即时探测（两种时序都能命中）
const svc = REMOTE_SVC ?? ctx?.remote?.zcodeDispatch ?? ctx?.remote?.['zcode-dispatch'];
// :1156 useWire：就绪信号到达即重建 wire（旧的先 dispose，避免两套轮询并存）
const [remoteEpoch, setRemoteEpoch] = useState(0);
useEffect(() => onRemoteReady(() => setRemoteEpoch((n) => n + 1)), []);
// :1848 apply：$mount 之后挂子 fiber（顶层 inject 仍只有 slots/remote）
ctx.inject(['remote.zcodeDispatch'], (scope) => {
  const svc = scope?.remote?.zcodeDispatch;
  if (svc && typeof svc.snapshot === 'function') {
    markRemoteReady(svc);
    scope.effect(() => () => { if (REMOTE_SVC === svc) REMOTE_SVC = null; }, 'zcode-dispatch.namespace');
  }
});
```

**与硬约束的一致性**：顶层 `inject` 仍是 `['slots','remote']` —— **没有**出现 `remote.zcodeDispatch`
（探针第 18 项 `boot 安全: inject 不自声明 remote 命名空间` **PASS**，逐字见 §3.4）。
子 fiber 与顶层 inject 的关键区别正在这里（whale-pet `lib/client.js:2217-2218` 原注释：
*"A mounted namespace is a separate Cordis capability. Inject it in a child AFTER mounting;
requiring it in the mount owner would prevent that owner loading."*），
命名空间缺席时子 fiber 只是 pending，**不会让本条目激活失败**——所以既有序又不阻塞启动。

### 3.4 ④ 客户端制品 —— 已对齐（说明一处与 whale-pet 的形态差异）

- 实际被 `$mount` 的贡献项是 `client.js` 内联的 `REMOTE_CONTRIBUTION` = `{ package, descriptors }`
  （`client.js:339-356`），与官方聚合产物同形（`refs/extracted/dsh-api-remotes/lib/client.js:13538`
  `ctx.remote.$mount(contribution)`）✅。
- 与宿主 `TYPERT.invocations` **逐方法核对无漂移**：两边都是 15 个方法、同名参数、同样的可选参数集
  （宿主 `FACE_METHOD_TABLE` ↔ 客户端 `REMOTE_METHOD_TABLE`），`id` 都用
  `@local/zcode-dispatch#zcodeDispatch/<method>`，codec 都是 `{mode:'strict', typeSymbol, create}` ✅。
- `exports["./remote"]` = `./wire.client.mjs`，导出 `TYPERT_REMOTE`（`{package, service, generator, descriptors}`）
  比 whale-pet 的 `{package, descriptors}` 多两个信息字段——**官方校验只读 `descriptors`**，多余字段无害；
  且该文件**运行时不被 `client.js` import**（浏览器模块表只给 `react` 与本包 `dsh.client.inject` 声明的包，
  本包无构建步骤）→ 它是**同源对照件**，不参与接线。**本轮不改它**（改了也不生效，徒增漂移面）。

---

## 4. 待办 ③：离线态提示

`client.js:1321` / `:1328` / `:1338` / `:1764-1769`，文案键 `ui.chanOfflineHint`（三处同源：
`client.js` 内联 `STRINGS.zh/en` `:202`/`:237` + `locale/zh.json`/`locale/en.json`）。

- 离线/降级态在通道区顶部给一行 `role="status"` 说明，并给两个下拉加同文 `title`；
- **原因取自真实留痕，不猜**（`MOUNT_DIAG`）：
  - `$mount` 不可用 → 「（ctx.remote.$mount 不可用）」
  - `$mount` 失败 → 「（$mount 失败：<真实错误消息>）」
  - 描述符已挂载 → 「（描述符已挂载，等宿主命名空间 remote.zcodeDispatch 就绪）」
- 只对 `conn !== 'live'` 生效；live 时 `title` 为 `undefined`，不干扰正常态。

---

## 5. 门禁与原始输出（§5 清单，逐条）

```powershell
$env:Z2_ALLOW_PROFILE_WRITE='1'
node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"
node "F:\My Code\dsh-plugins\tools\verify-switch.mjs"
cd "F:\My Code\dsh-plugins\zcode-dispatch"
node test/core.test.mjs; node test/channel-retry.test.mjs
node --check index.js; node --check client.js; node --check wire.host.mjs; node --check wire.client.mjs
```

**① verify-plugin（20 项，失败 0）** — 逐条 PASS：

```
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,…}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config  …
PASS  纪律: 不 import DSH 客户端包  no @deepseek-ai/dsh-client
PASS  纪律: 不操作 document.body  no document.body
PASS  纪律: client.js 无字面色值（仅主题令牌）  none
PASS  纪律: client.js 不用 JSX/模块 import  createElement 次数=2
PASS  纪律: 使用 --dsw-alias-* 主题令牌  令牌引用 41 处，去重 22 个
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  Config 是 Standard Schema（cordis 激活判据）  {"demo":false,"maxConcurrent":1,…}
PASS  index.js 引用 core dispatcher  imports core
PASS  client.js 通过 __ModuleLoader__.load 注册  id=@local/zcode-dispatch
PASS  factory 只 require react  react only
PASS  factory 返回 {inject, apply}  inject=["slots","remote"]
PASS  boot 安全: inject 不自声明 remote 命名空间  inject=["slots","remote"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=class PanelBoundary extends React.Component
PASS  越界: $DSH_HOME profile 近 1h 无写入  cordis.yml

[DSH Z2 探针] 20 项，失败 0 项          exit=0
```

**② verify-switch（8 项，失败 0）** `exit=0`（逐条输出见上轮，本轮无开关相关改动）。
**③ core.test.mjs `pass 11 / fail 0`，`exit=0`**；**channel-retry.test.mjs `pass 8 / fail 0`，`exit=0`**。
**④ `node --check` 四件全 OK**。**⑤ locale JSON 可解析且 zh/en 对称**：`ui` 键各 98 个，`ui.chanOfflineHint` 两侧齐备。

**⑥ 前置能力实测**（本轮新增，用于支撑 §2.2 的 require 策略）：

```
require(esm) OK -> function | function        # Node v24.14.1：require() 可直接取 ESM 命名空间
temp asar probe removed: True                 # 一次性 asar 头解析探针读完即删，未入库
```

**门禁合计：20 + 8 + 11 + 8 = 47 项，失败 0。**

---

## 6. 重启与现场验收（**宿主改动必须完全重启 DSH**）

> ⚠️ 完全退出 DSH（不是刷新页面、不是切插件开关——cordis `_reload()` 复用进程内已 import 的模块，
> 切开关不会重新读盘）再启动。**重启会结束我这条会话**，故验收步骤写在这里供你/下一会话执行。

1. **先读激活信标**（重启后立刻可读）：
   ```powershell
   Get-Content 'F:\My Code\dsh-plugins\zcode-dispatch\.data\state\activation.json'
   ```
   对照 §2.3 的定位表：重点看 `defineToolResolved` / `defineToolSource` / `toolRegistered` /
   `remote.ok` / `remote.visibleAfter`。
2. **工具面**（新开会话，本会话看不到新注册）：
   - `cordis_inspect_query` → host `Tool` → `listTools` 应出现 `zcode_dispatch`；
   - 新会话问「有 `zcode_dispatch` 吗？有就调 `action:"status"`」→ 应返回开关状态 JSON；
   - 关闭总开关后 `action:"dispatch"` 必须被拒：
     ```powershell
     node '<HOST_REPO>\scripts\collab\zcode-switch.mjs' off
     # 工具 action:"dispatch" → {ok:false, error:'ZCode 派发总开关已关闭（collab/zcode-dispatch.switch.json）'}
     node '<HOST_REPO>\scripts\collab\zcode-switch.mjs' on   # 记得开回来
     ```
3. **面板面**（刷新页面）：
   - 徽标应从「未连接」变「**已连接**」；
   - 通道/模型下拉**可点且有真值**（通道清单来自宿主 `channels()`）；
   - 若仍离线：面板通道区那行提示会直接写出原因（`$mount` 的真实错误 / 或"等宿主命名空间就绪"），
     **把那行原文带回来即可精确定位**。
4. **`.data\state\jobs.json`** 出现 = 派发核心真跑起来（本次不派发则为空/不出现，不算失败）。
5. 判据提醒：徽标「已连接」只证明**客户端命名空间装上了**（`$mount` 本地安装，不问宿主）；
   只有**通道下拉真的有值**才证明宿主侧在服务。两者要一起看。

---

## 7. 未确定项（宁缺毋编）

1. **宿主 `ctx.provide` 到底成功没有 —— 仍未直接观测到**（阶段 A 的 H1/H2 未闭合）。
   阶段 A 已证 `Service` 目录是**静态声明目录**、答不了这个问题；本轮**不猜**，改为把它**变成可查事实**：
   重启读 `activation.json` 的 `remote.*` 五个字段即可判定（§2.3 定位表）。这是本轮对 ② 的主要交付之一。
2. **「asar 内 ESM 装载」未能在本地预验**：Node 读不了 asar（只有 Electron 的 fs 补丁能读），
   本机也没有第二个可安全启动的 Electron 实例（另起一个 DSH 有污染风险，未做）。
   故本轮用**双策略**（`import()` + `require()`）覆盖该不确定性；哪个策略命中会写进 `defineToolSource`。
   **若两者都失败**，信标里会留下每个候选的完整错误文本，据此再定向修。
3. **`loadConfig()` 的裸 `import('@deepseek-ai/schemastery')` 同样必然失败**（同一根因），
   当前实际走 `fallbackConfig()`。功能等价（Z10 已双证：主路径 + 降级路径），本轮**有意不改**以免扩大爆炸半径。
   若希望 Config 走真实 schemastery（例如要它的 `.description()` 生成的配置表单文案），
   可把 `dshToolsCandidates()` 的候选表复用给它——**建议单独一单**，属于本轮范围外。
4. **`remote.zcodeDispatch` 装上之后、宿主未服务时的表现未验**：此时徽标会是「已连接」但动作报错。
   本轮未做「已连接但调用失败 → 自动降级徽标」这类判据，属 UI 打磨下一轮范畴。
5. **客户端 `wire.client.mjs` 与 `client.js` 的内联副本是两处同源实现**（本包无构建步骤的既有限制）。
   本轮只改了 `client.js`（真正生效的那份），`wire.client.mjs` 未动 —— 两者在"就绪信号"这一环
   从此**不再逐字同源**（`wire.client.mjs` 仍是单次 `createClientWire` 语义）。它是测试/对照件，
   不影响运行时；但**下次改接线形态时记得两处对齐**，已在本文件登记。
6. **`ctx.inject` 子 fiber 的卸载路径**：客户端模块表未给 `apply` 提供卸载通道（Z8 已知限制），
   子 fiber 的 disposer 未持久持有；本轮用 `scope.effect` 在依赖撤销时清 `REMOTE_SVC`（whale-pet 同款），
   但"整个客户端条目被卸载"时的清理仍未验。

---

## 8. 与任务包要求的逐条对照

| 任务包要求 | 状态 | 证据 |
|---|---|---|
| §2.1 先 `listTools` 诊断 | ✅ | §2.1 第一步（全量落盘件 grep 无命中） |
| §2.1 加激活信标（写 `.data/state/activation.json`，写失败忽略、绝不抛） | ✅ | `index.js:171`、`:351`；字段与任务包给定 JSON 对齐（并补 `remote.*`） |
| §2.2 绝对路径回退（env → resourcesPath → 硬编码 → unpacked） | ✅ | `index.js:95-179`；asar 头解析证实靶子存在 |
| §2.2 失败降级 `null`、绝不抛 | ✅ | 全部候选包 try/catch；`verify-plugin` 在纯 Node 下 import `index.js` 成功 |
| §2.3 注册失败一律降级不抛 | ✅ | `registerZcodeDispatchTool` 三分支均 return null + warn |
| §2.3 宿主 `inject` 只允许 `['tools']`，不得出现自家 `remote.*` | ✅ | `index.js:94` `export const inject = ['tools']`（未改） |
| §3 四步配方 ① typertRemote 标记 | ✅ 已存在（**任务包表格该条不成立**，见 §3.0） | `wire.host.mjs:451-454` + 网关校验面逐条核对 |
| §3 ② 宿主描述符严格形态 | ✅ 已对齐 loader 全部校验点 | `refs/dsh-typert/loader/lib/index.js:82-106,208-211` |
| §3 ③ 客户端子 fiber（既有序又不阻塞启动） | ✅ 本轮落地 | `client.js:1848`、`:1156`、`:386` |
| §3 ④ `exports["./remote"]` 形态 | ✅ 已对齐（不改 `wire.client.mjs`，理由见 §3.4/§7-5） | `client.js:339-356` vs 官方 `:13538` |
| §3 若 ① 后仍不通 → 做 E1 实验 | ✅ E1 已**前置**落地（不留到下一轮） | `wire.host.mjs:618-652` |
| §4 离线态通道/模型提示 + 文案走 locale | ✅ | `client.js:1321,1328,1338,1764`；`locale/*.json` 各 +1 键 |
| §5 门禁每次改完都跑 | ✅ 47/47 | §5 |
| §5 交付写 `tasks/ZB-01-delivery.md`（改动/形态证据/复现+原始输出/未确定项） | ✅ | 本文件 |

---

## 9. 补记（2026-09-30 16:0x，重启后实测）—— 信标读数的**更正**与实测结论

### 9.1 ① 实测通过（信标 + 工具面板双证）

```json
"defineToolSource": "resourcesPath/app.asar|import",   // 命中候选 2；且 asar 内 ESM import() 可行
"toolRegistered": true
```
`defineToolAttempts` 首条正是预期的失败：
`{"source":"bare","strategy":"import","ok":false,"error":"ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools' imported from F:\\My Code\\dsh-plugins\\zcode-dispatch\\index.js"}`。
`zcode_dispatch` 已进入新会话工具表，`action:"status"` 与 `action:"channels"` 均返回真数据（9 条真实通道）。
→ **§2.2 的根因判断与修法均被运行期证实；原 §7-2「asar 内 ESM 装载」未确定项就此关闭。**

### 9.2 ⚠️ 更正：`remote.visibleAfter:false` **不是**「provide 失败」

本次信标读出：

```json
"remote": { "available": true, "strategy": "ctx.provide", "ok": true, "error": null,
            "visibleAfter": false, "matchedFace": false, "fallbackTried": null }
```

**§2.3 的定位表把 `visibleAfter:false` 解释为「H1 的一种：注册语义与预期不符」——该解释是错的。**
真实原因在 cordis `get` 的严格语义：

```js
// refs/extracted/cordis/src/reflect.ts:237-243
_getImpl(name, strict = true) {
  const impl = key && this.store[key]
  if (!impl) return
  if (strict && impl.fiber.state !== FiberState.ACTIVE) return   // ← 提供方 fiber 未 ACTIVE 即返回 undefined
  return impl
}
```

`ctx.get(name)` 默认 `strict = true`，而自检是在 **`apply()` 执行中**跑的（此刻插件 fiber 尚未 ACTIVE）；
cordis 自己的 `provide` 里也有同一道门（`if (this.ctx.fiber.state === 2) this.notify([name])`）。
→ **`visibleAfter:false` 只说明「那一刻还不可见」，不能说明 provide 失败。自检时机有 bug，属误报。**
`remote.ok:true` + `error:null` 才是有效读数：**provide 未抛错**。
（正确修法是把自检改到激活后延迟复检；本轮**未改**，故**本次信标该字段无诊断价值，读时请忽略**。）

### 9.3 「宿主 Service 目录里没有 `zcodeDispatch`」再次确认为**非信号**

重启后重查：仍 `Error: no catalogued Service named "zcodeDispatch"`。但**对照组**给出反证——
**whale-pet（已知可用的第三方插件，与本插件同款 `ctx.provide(name, service)` + `typertRemote`）**
的 `whalePet` **同样不在该目录里**。两条同形证据合看：该目录是**声明目录**（阶段 A §2.5 结论成立），
它的缺席对第三方运行时服务**不构成任何证据**。

### 9.4 「宿主侧在不在服务」的分层实测判据（可复跑）

| 层 | 判据 | 实测结果 |
|---|---|---|
| **action 层**（宿主插件已加载、dispatcher 可用） | 调 agent 工具 `zcode_dispatch`：`{"action":"status"}` / `{"action":"channels"}` | ✅ `status` → `{"ok":true,"switch":{…}}`；`channels` → 9 条真实通道（真 endpoint/model/enabled 原因） |
| **注册层**（face 已登记为 cordis 服务） | 信标 `remote.ok` / `remote.error` | ✅ `ok:true`、`error:null`（provide 未抛错） |
| **客户端条目层** | client `Slots` 的 `shell.overlay` occupants 含 `zcode-dispatch.console` 且 `active:true` | ✅ 仍 active |
| **Remote 传输层**（面板真正需要的那一跳） | 面板徽标 → 已连接；或面板离线提示行给出的 `$mount` 真实结果 | ❌ 仍「未连接」→ **断点在这一跳** |

### 9.5 本轮追加的客户端改动（仅需刷新页面，无需重启）

把离线原因从「默认折叠的通道分区内」挪到**始终可见**处，并补 DevTools 可复制诊断：
- `.zcd-conn` 徽标加 `title=offlineReason`；
- `zcd-body` 首行（各分区之外）在 `conn==='offline'` 时渲染该原因；
- `$mount` 成功/失败、子 fiber 就绪、降级 wire 命中各 `console.info/warn` 一行，后者附带
  `{ mountDiag, childFiberService, hasModCtx, ctxRemoteZcodeDispatch }`。

门禁复跑：`node --check client.js` OK、verify-plugin 20/20、verify-switch 8/8、core 11/11、channel-retry 8/8。

### 9.6 仍未确定

1. **`ctx.provide` 是否登记成功**：`ok:true` 表明未抛错，但正面观测仍未拿到（自检时机 bug，§9.2）。
   等 §9.4 传输层判通后此问题自动失去意义。
2. **Remote 传输跳的失败点**：待面板首行提示 / DevTools 那行 `$mount` 结果返回后定位。
   **已可排除**：描述符 shape 与 typert 客户端注册表校验 —— 对照
   `refs/dsh-typert/registry/lib/client.js:1314-1367`（`validateWireName /^[A-Za-z0-9_$.-]+$/`、
   `validateSegment` 仅禁 `#` 且非空、`validateCodec` 要求 strict + `create()`）逐条比对，
   我方 15 个描述符**全部合法**；且 `$mount` 对宿主零依赖（`dsh-api-gateway/lib/client.js:1684-1710`）。

---

## 10. ② 根因定证与修复（2026-09-30 16:1x，现场截图定位）

**现象**（面板首行提示，即 §9.5 加的诊断，一句话给出答案）：

```
未连接宿主：通道/模型来自宿主远端面，连接后这两个下拉才可选（$mount 失败：cannot get property "typert" without inject）
```

### 10.1 根因：`$mount` 用的是**调用方** ctx，而我们的客户端 inject 缺 `typert`

```js
// refs/extracted/dsh-api-gateway/lib/client.js:1578
const inject = ["typert", "connection"];          // ← gateway 自己 inject 了 typert
// :1595-1596
super(ctx, "remote");
this.ownerCtx = ctx;                              // ← 网关自己的 ctx 另存为 ownerCtx
// :1636-1640
async $mount(contribution) {
  const callerCtx = this.ctx;                     // ← 名字就叫 callerCtx：这是【调用方】的 ctx
  const owned = callerCtx.effect(async () => {
    const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution));
// :1662-1664
async mountContribution(callerCtx, contribution) {
  this.validateContribution(contribution);
  const disposeRemote = callerCtx.typert.remotes.register(contribution);   // ← 从【调用方 ctx】取 typert
```

为什么 `this.ctx` 会是调用方的？cordis `Service` 构造时注册了追踪器，且 traceable 代理对**被追踪属性**直接返回调用方 ctx：

```js
// refs/extracted/cordis/src/service.ts:42-58
const tracker: Tracker = { associate: name, property: 'ctx' };   // 'ctx' 即被追踪属性
// refs/extracted/cordis/src/utils.ts:165-176
if (prop === tracker.property) return ctx                          // ← 读 this.ctx 得到调用方 ctx
```

我们的客户端顶层 `inject` 原本只有 `['slots','remote']` → `callerCtx.typert` 无法解析 →
代理抛 `cannot get property "typert" without inject` → `$mount` 整体 reject → 命名空间从未挂上 → 徽标恒「未连接」。

> **顺带解释了 whale-pet**：它的客户端 inject 是 `['slots','sessions','connection','locale','remote']`
> —— **同样没有 `typert`**，所以它的 `$mount` 也必然失败；它代码里那句
> `.catch(() => { entry.failed = true; throw new Error('Local whale mount failed'); })`
> 正是在处理这个失败。⇒ 「whale-pet 可用」指的是它的 UI/桥接路线，**其 Remote 面在本版本同样是坏的**，
> 不能作为「$mount 形态正确」的先例（原 §3.3 对它的引用需按此理解）。

### 10.2 修复（**客户端半边，仅需刷新页面，无需重启 DSH**）

`client.js`：`inject: ['slots','remote']` → **`inject: ['slots','remote','typert']`**（附完整证据注释）。
`typert` 由 `@deepseek-ai/dsh-typert-registry` 客户端半边提供
（`refs/dsh-typert/registry/lib/client.js:1151` `super(ctx,"typert")`，其插件自身 `inject = []`），
必定先于本条目就绪；gateway 自己也 inject 了它 ⇒ **不会阻塞启动**（硬约束「inject 绝不出现自家 `remote.*`」不受影响）。

### 10.3 同时去重离线说明（用户反馈「有 2 段一样的描述」）

§9.5 让离线原因在 body 首行渲染，而通道分区内仍渲染同一句 → 视觉上重复。现统一为**只在 body 首行渲染一处**；
两个下拉保留 `title`（悬停提示，不占版面）。`ChannelSection` 的 `offline` 仍用于 `title`，未变成死参数。

### 10.4 门禁复跑（全绿）

`node --check client.js` OK；verify-plugin **20/20**（`inject=["slots","remote","typert"]`，
`boot 安全: inject 不自声明 remote 命名空间` **PASS**，`apply 注入槽位并注册组件`、`组件函数可执行` 均 PASS）；
verify-switch 8/8；core 11/11；channel-retry 8/8。

### 10.5 验收（刷新页面即可）

徽标应从「未连接」→「**已连接**」；通道/模型下拉可点且有真值（§9.4 已证宿主侧返回 9 条真实通道）。
若仍不通，面板首行会给出新的真实原因（`$mount` 成功 → 会显示「描述符已挂载，等宿主命名空间就绪」）。

### 10.6 仍未确定

1. **本修复未能在本地预验**：`inject` 是**运行期** cordis 依赖解析，纯 Node 的 verify-plugin 只能校验
   静态形态（已过），真正的 `$mount` 成功与否必须由页面刷新后的徽标/面板首行确认。
2. **`ctx.provide` 正面登记观测**仍缺（§9.2 自检时机 bug 未修）——若 10.5 通过，此问题自动失去意义；
   若仍不通，再补「激活后延迟复检」。

---

## 11. 端到端验收（2026-09-30 16:12–16:13，真机实测 · 全部通过）

### 11.1 面板侧（用户刷新后截图确认）

徽标「**已连接**」、派发开关「开」、通道下拉 = 「默认套餐（runner 自动选择）」、模型下拉可选、
用量卡片为真数据（本周 27 runs / 757.17M 输入 tokens）。
→ §10 的 `inject: ['slots','remote','typert']` 修复**现场生效**，② 的验收口径（徽标已连接 + 通道/模型可选）达成。

### 11.2 派发链路（本轮实跑，最小副作用）

派发前基线：`action:"list"` → `{"ok":true,"jobs":[]}`（无 job、无锁）。

```
zcode_dispatch { action:"dispatch", kind:"prompt", mode:"plan", tag:"zb01-smoke", timeoutMin:5,
                 prompt:"只回复一行文字，不要调用任何工具、不要读写任何文件：ZCD-SMOKE-OK" }
→ {"ok":true,"job":{"id":"j-muntuzh1-0-45c5","state":"running","lock":"repo+memory",…}}
```

35 秒后 `action:"list"`：

```json
{"id":"j-muntuzh1-0-45c5","state":"done","exitCode":0,"elapsedSec":7.511,
 "sessionId":"sess_e643c6e7-295e-492a-83a6-d0d3142b55c6",
 "provider":"plan:bigmodel-coding-plan","endpoint":"https://open.bigmodel.cn/api/anthropic",
 "model":"GLM-5.3","contextUsed":28910,"contextWindow":200000,"responseChars":12,
 "summarySeen":true,"ledgerMatched":true,"timedOut":false,"pauseReason":null,
 "turnCount":1,"billing":"zcode-plan","traceId":"fc3cd09d-6da4-4d06-9fa3-b009c40c007d",
 "usage":{"requests":1,"inputTokens":28901,"outputTokens":9,"cacheReadTokens":15616}}
```

`action:"tail"`（n=30）末段：

```json
{ "sessionId": "sess_e643c6e7-…", "traceId": "fc3cd09d-…", "turnId": "turn_7c529968-…",
  "response": "ZCD-SMOKE-OK",
  "usage": { "modelRequestCount": 1, "inputTokens": 28901, "outputTokens": 9, "cacheReadTokens": 15616 },
  "projection": { "status": "idle", "turnCount": 1, "contextUsed": 28910, "contextWindow": 200000 } }
```

**⇒ 响应正文正是要求的 `ZCD-SMOKE-OK`**：任务真的跑到了模型并回传，不是空转。

### 11.3 落盘与锁（独立复核，非读工具自述）

| 检查 | 结果 |
|---|---|
| `.data\state\jobs.json` | ✅ **首次出现**（3370 B，16:12:44 = 任务完成时刻），`{version, savedAt, jobs:[…]}`，内含 `id=j-muntuzh1-0-45c5 state=done exit=0` |
| `.data\locks\` | ✅ **空目录** —— repo/memory 双锁已随任务结束干净释放，无残留 |
| 台账 | `ledgerMatched:true`，`outLog/errLog/resultFile` 三件均落在 `<HOST_REPO>\collab\logs\` |

> 这正是 `CREATOR-HANDOFF.md` §六 的两条现场判据：**徽标=已连接** ✅、**`.data/state/jobs.json` 出现** ✅。

### 11.4 结项：原任务包验收口径逐条对照

| 口径（用户现场验收） | 结果 | 证据 |
|---|---|---|
| 新会话能列出并调用 `zcode_dispatch` | ✅ | 工具已进工具表；本轮 `status`/`channels`/`list`/`dispatch`/`tail` 五次真调用全部返回真数据 |
| 面板徽标变「已连接」 | ✅ | §11.1 截图 |
| 通道/模型可选 | ✅ | 通道=「默认套餐（runner 自动选择）」，模型下拉可用；`channels` 返回 9 条真实通道 |
| （原 handoff）`.data/state/jobs.json` 出现 | ✅ | §11.3 |

### 11.5 唯一残留（低优先，不影响验收）

`activation.json` 的 `remote.visibleAfter` 仍是**误报**（§9.2：自检时机在 fiber ACTIVE 之前）。
它现在**没有任何诊断价值**，读信标时请忽略该字段；`remote.ok`/`error` 有效。
修法已明确（改到激活后延迟复检），但既然 ② 已端到端验通，此修复降为可选项——**未改，如实登记**。
另：本轮未做 git 操作；`jobs.json`/`activation.json` 均在 `.gitignore` 的 `.data/` 内，不污染仓库。

---

## 12. 验收期发现并修复：终态 job 没有「关闭」按钮（ZB-02）

**用户现场反馈**：进程行只剩展开箭头，**没有关闭按钮**，完成的任务清不掉。

### 12.1 根因：`关闭` 被硬绑在 `paused` 上，而宿主契约允许终态

```js
// client.js（改前）
active ? h('button', { …IconKill… }) : null,            // 终止：仅 queued/running
paused ? h('div', { className: 'zcd-row' },
  …继续…, …换通道…,
  h('button', { onClick: doClose }, t('closeJob')),      // 关闭：仅 paused
) : null,
```

宿主的可关闭集合本来就更大：

```js
// wire.host.mjs:127
const DISMISSABLE = new Set(['paused', 'done', 'failed', 'killed', 'interrupted']);
```

⇒ 我们的 smoke 任务 `state:'done'`：**既非 `active` 也非 `paused`** → 两个按钮都不渲染 → 列表里没有清理入口。
这是 **Z11「暂停进程可关闭」只接到 `paused` 的遗留缺口**，不是渲染/点击问题。

### 12.2 修复（客户端半边，刷新页面即可）

`client.js`：
- 新增 `DISMISSABLE_STATES = ['paused','done','failed','killed','interrupted']`（与宿主 `DISMISSABLE` **逐一对应**，注释标明同源）；
- `JobRow` 增加 `canDismiss`，动作区的渲染条件由 `paused` 改为 `canDismiss`；
- 区内按钮各自按需渲染：继续/换通道仍 `paused` 独占（它们依赖 `sessionId` 与暂停语义），
  **关闭对所有可关闭状态可见**；
- 每行仍然**只有一个**关闭按钮（沿用同一处动作区，不新开第二个入口 —— 避免重蹈上一次的重复渲染）。

### 12.3 关键分支已运行期验证

`doClose` 对终态 job 会**先试 kill**，若 kill 返回 `ok:true` 就提前 return、**根本走不到 dismiss** —— 这是本次修复唯一的暗礁。实测：

```
zcode_dispatch { action:"kill", id:"j-muntuzh1-0-45c5" }     # 该 job 已 done
→ {"ok":false,"error":"kill 失败：job 不存在或已是终态（id=j-muntuzh1-0-45c5）"}
```

`ok:false` ⇒ `doClose` 的早返回条件不成立 ⇒ 正确落到 `onDismiss(job.id)` ⇒ 宿主 `dismiss` 动作对该 job 返回 `{ok:true}`（`state:'done' ∈ DISMISSABLE`）⇒ 1s 轮询带回的快照经 `withoutDismissed` 过滤后该行消失。
（该 kill 调用对终态 job 是空操作，**任务仍保留在列表里**供用户点击验证。）

### 12.4 门禁复跑（全绿）

`node --check client.js` OK；verify-plugin **20/20**；verify-switch 8/8；core 11/11；channel-retry 8/8。

### 12.5 待用户点击确认（本修复未自证的部分）

- **未自证**：按钮点击 → `dismiss` → 行消失 的完整往返（`dismiss` 动作本身只做了代码级核对，未运行期调用，
  以免用户失去可点的行）。
- **验收**：刷新页面 → 「进程」区该行应出现「关闭」按钮 → 点击 → 该行消失，且
  `.data\state\dismissed.json` 出现并含该 jobId。

### 12.6 UI 修订（用户反馈：文字按钮太大 → 改 X 图标置展开箭头左侧）

**用户意见**：「关闭按钮太大了，就用一个 X 图标放在倒三角左边就行。」

修订后形态（`client.js`）：
- 关闭入口 = **行头内的 `zcd-iconbtn`**，复用 `IconKill` 的 X 字形，位置**紧邻展开箭头左侧**
  （`h('span',{className:'zcd-spring'}) → [终止?] → [关闭?] → 展开箭头`）；
- 动作区（`paused ? …`）**回退为只含「继续 / 换通道」**，不再放文字关闭按钮 ⇒ 全行关闭入口唯一；
- **共用同一 X 字形不产生歧义**：`active`（queued/running）与 `canDismiss`（paused/终态）**状态互斥**，
  两个按钮永不同时出现；语义由 `title` / `aria-label` 区分；
- 行头 `onClick` 的 Z9 `isInteractive` 守卫（`closest('button,…')`）保证点 X 不会误触展开；
- **反馈行上提**：`retryFb` 从 paused 动作区移到行头之后独立渲染 —— 关闭按钮已不在动作区，
  终态行没有动作区，`dismiss` 失败的提示仍需可见（否则会静默失败）。

唯一性核对（grep 全文件）：`canDismiss` 仅 3 处 = 声明 1 + 注释 1 + **渲染 1**；
`doClose` 仅 2 处 = 定义 1 + **引用 1**；无第二个关闭入口。

门禁复跑：`node --check client.js` OK；verify-plugin **20/20**；verify-switch 8/8；core 11/11；channel-retry 8/8。

验收：刷新页面 → 该 done 行**展开箭头左侧**应出现 X 图标（悬停提示「关闭」）→ 点击 → 该行消失，
`.data\state\dismissed.json` 出现并含该 jobId。

---

## 13. 事实回答：进程是否复用（用户提问）

**结论：每个任务都新起一个子进程，不复用；可复用的是 ZCode 会话（上下文），不是进程。**

| 层 | 是否复用 | 依据（`core/dispatch-core.mjs`） |
|---|---|---|
| dispatcher（队列 / 锁 / 内存态） | ✅ 常驻复用 | `index.js:237` 在 `apply()` 建一次，活到插件卸载；`jobs.json` 由它持久化 |
| **子进程**（`node zcode-run.mjs`） | ❌ **每 job 一个，结束即弃** | `:519` `spawnImpl(process.execPath, [runnerPath, ...])`；`:529` `children.set(job.id, child)`；`:603` close 后 `children.delete(job.id)`。全文件**无池化/无复用**代码 |
| ZCode session（对话上下文） | ✅ 可复用（仍是新进程） | `:627` 从输出解析 `sessionId`；`:1100` `retry` 同通道 → `spec.resume = job.sessionId` → 传 `--resume`（`buildRunnerArgs` `:496`） |

旁证：
- 每个 job 的日志文件名各自带时间戳（`zcode-run-<tag>-<ISO>.out.log`），互不覆盖 ⇒ 一次运行一套产物；
- `channels` 动作探测通道时**也会临时 spawn** 一个 `--list-providers` 子进程（`:838-855`），
  靠 5s 缓存（`CHANNELS_TTL_MS`）避免面板每拍都起进程；
- `maxConcurrent` 限制的是**并发子进程数**（其余排队），不是复用连接池。

⇒ 「复用」的正确心智模型：**dispatcher 常驻 + 会话可续（`--resume`）+ 进程一次性**。
若希望省去重复的冷启动开销，那属于新特性（例如常驻 runner 池），本轮不做、也未承诺。

### 13.1 补充定证：一个任务其实是**两个**一次性进程

`scripts/collab/zcode-run.mjs`（宿主仓库，只读）:

```js
const CLI = process.env.ZCODE_CLI || 'F:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs';   // :58
const r = spawnSync(process.execPath, [CLI, ...args], { … });                                 // :361（同步阻塞）
if (opt.resume) args.push('--resume', opt.resume);                                            // :333
```

完整进程树（**每层都不是复用**）：

```
DSH 宿主进程（Electron main，常驻）
 └─ dispatcher（内存对象，常驻；不是进程）
     └─ 【每个 job 新起】node zcode-run.mjs        ← dispatch-core.mjs:519 spawn，close 即弃（:603）
           └─ 【每个 job 新起】node zcode.cjs ...  ← zcode-run.mjs:361 spawnSync，跑完即退
```

⇒ **明确回答用户的问题**：不是「一个会话只起一个进程并复用」，而是
**一个会话可以起任意多个进程；每个进程只服务一次运行，完成即弃用**。
`--resume` 复用的是 **ZCode 会话（上下文）**，续跑时照样**再起两个全新进程**。
`spawnSync` 这一处也解释了为什么它是「一次性批处理」而不是常驻服务。

---

## 14. 进程区按状态分组显示（ZB-03，用户要求「进行中 / 已完成 / 异常」）

### 14.1 实现

`client.js`：新增分组表（**唯一真值，要调分组只改这张表**）与 `JobList` 分组渲染：

```js
const JOB_GROUPS = [
  { key: 'grpActive', states: ['queued', 'running'] },               // 进行中（含排队）
  { key: 'grpPaused', states: ['paused'] },                          // 需处理：等你决定续跑/交接
  { key: 'grpFailed', states: ['failed', 'interrupted', 'killed'] },  // 异常：非成功终态
  { key: 'grpDone',   states: ['done'] },                            // 已完成
];
```

两条纪律（都写进注释）：
1. **空分组不渲染** ⇒ 分组可以取细而不占版面（没有失败的 job 时「异常」组直接不出现）；
2. **未归属状态兜底** `grpOther` ⇒ 绝不能因为「将来 core 新增状态没进分组表」就让 job 在列表里**凭空消失**。

每组渲染 `组名 + 计数徽标`，行沿用既有 `JobRow`（关闭 ✕ / 展开箭头 / 单写者锁等全部保留）。
新增 CSS 仅 `.zcd-group / .zcd-group-head / .zcd-group-body`，**只用主题令牌，无字面色值**（探针第 26 项 PASS）。
文案 `grpActive/grpPaused/grpFailed/grpDone/grpOther` 四处同源：`client.js` 内联 `STRINGS.zh/en` +
`locale/zh.json`/`locale/en.json`（各 103 键，双语齐备、对称）。

### 14.2 验证方式（**用真实代码渲染真实数据**，非纸面推演）

`verify-plugin` 的浅渲染没有 job，覆盖不到分组逻辑，故另写一次性探针（**跑完即删，未入库**）：
用 `__ModuleLoader__` 捕获真实 `client.js`，自建最小 React 替身（按**确定性路径**给每个组件实例分配
hook 单元，三趟展开让 `subscribe()→setState()` 生效），并置 `window.__zcodeDispatchDemo='builtin'`
以驱动**真实 demo 数据源**，然后遍历展开后的真实组件树：

```
=== 进程分组 ===
[组头] 进行中 2
     └ job: demo-running
     └ job: demo-queued
[组头] 需处理 1
     └ job: demo-paused
[组头] 已完成 1
     └ job: demo-done
```

⇒ 组名解析为真字符串、计数正确、**4 个 job 一个不少**（兜底未被触发也未被绕过）、
**「异常」组因无成员而正确地不渲染**。
（探针同步打印了 `[zcode-dispatch] 远端面未就绪 → 降级 wire` 诊断行，亦佐证 §9.5 的诊断链可用。）

### 14.3 门禁复跑（全绿）

`node --check client.js` OK；verify-plugin **20/20**；verify-switch 8/8；core 11/11；channel-retry 8/8；
locale zh/en 各 103 键、5 个分组键双语齐备。

### 14.4 未确定

- 真实页面里的**视觉排布**（组头与行间距、长列表滚动）未由探针覆盖，需刷新页面目视确认。
- 分组只影响**展示**：`dismiss`/`kill`/`retry` 的可用性仍由各自状态判定，与分组无关（未改语义）。

---

## 15. 「已完成的任务能否续接」——实测定证（用户提问）

### 15.1 能力侧：可以（`retry` 只挡 queued/running）

```js
// core/dispatch-core.mjs:1084-1086   唯一门禁：运行中不可续
if (job.state === 'queued' || job.state === 'running') throw new Error(`retry: job … 仍在 ${job.state}…`);
// :1099-1110  同通道且有 sessionId → 原 spec + --resume（绝不带 --model）；新 job 记 parentJobId/attempts
const spec = { ...job.spec, resume: job.sessionId };
```

⇒ `done` / `failed` / `killed` / `interrupted` / `paused` **都可续**；无 `sessionId` 或换通道则走「交接重跑」。

### 15.2 实测：`retry` 一个 done 任务，会话**真的复用**了

```
zcode_dispatch { action:"retry", id:"j-muntuzh1-0-45c5" }
→ {"ok":true,"job":{"id":"j-munupx86-1-f30d","tag":"zb01-smoke-r1","parentJobId":"j-muntuzh1-0-45c5",
     "attempts":[{"reason":"manual-retry:done"…},{"reason":"resume-same-channel"…}]}}
```

对照两次运行（同一任务续接前后）：

| 字段 | 原 `zb01-smoke` | 续接 `zb01-smoke-r1` | 结论 |
|---|---|---|---|
| `sessionId` | `sess_e643c6e7-…` | **同一个** `sess_e643c6e7-…` | ✅ 会话被复用，不是新会话 |
| `contextUsed` | 28910 | **28988** | ✅ 上下文接上了上文 |
| `eventCount`（tail 内） | 17 | **61** | ✅ `--resume` 确实载入了本会话既有事件 |
| `traceId` | `fc3cd09d-…` | `37c34f04-…` | 新一次运行 |
| 日志文件 | `…zb01-smoke-2026-09-30T08-12-36-834Z.*` | `…zb01-smoke-r1-2026-09-30T08-36-40-275Z.*` | ✅ **新进程、新产物** |
| 原 job | — | `resumedBy: "j-munupx86-1-f30d"` | ✅ 双向簿记 |
| `elapsedSec` | 7.511 | 6.306 | 同样是全新进程 |

**⇒ 再次印证 §13 的心智模型：复用的是「会话」，每次续接都起全新进程。**

### 15.3 ⚠️ 一个必须说清的语义差别

| 想要的效果 | 正确调用 | 行为 |
|---|---|---|
| **重跑**（同会话 + **原提示词**） | `retry(id)` | `spec = {...job.spec, resume: sessionId}` —— **原样重发原提示词**（本次实测即如此：又回了一遍 `ZCD-SMOKE-OK`） |
| **真·续接**（同会话 + **新指令**） | `dispatch({ kind:'prompt', prompt:'新指令…', resume:'sess_xxx' })` | `--resume` 载入会话，再追加一条新用户消息（`dispatch` 的 `resume` 参数会被透传，见 `wire.host.mjs` action handler 的 `['model','provider','mode','tag','cwd','resume']` 拷贝表） |

**「续接」≠「retry」**：`retry` 重发的是原提示词；要接着往下说新内容得用 `dispatch` + `resume`。

### 15.4 UI 现状（**缺口，未修**）

面板上 `继续 / 换通道` 按钮仍是 **`paused` 独占**（ZB-02 只把「关闭」提到了行头），
所以 **`done` 的 job 在面板里只有 ✕，没有续接入口**；能力目前只能经 agent 工具使用。
是否要在终态行加「重跑 / 续接」入口，**待用户决定**（见 §15.5），本轮未擅自扩大改动面。

### 15.5 未确定 / 待决

- 终态行加「重跑（原提示词）」还是「续接（新指令）」、还是两个都加 —— 需用户拍板；
  两者语义不同（§15.3），建议至少把标签写清楚，避免用户以为「续接」是接着聊。
- 续接是否要限制在「同 tag 最近一次」以防点到很早的历史会话，未讨论。

---

## 16. ZB-04：终态行「重跑 / 续接」入口 —— 并在验证中发现并修复一个核心 F2 缺陷

用户决策：**两个都加** + **新画 ↻ 图标**。

### 16.1 UI 实现（`client.js`，刷新页面即可）

- 新增 `IconRerun`（↻ 圆弧+箭头）与 `IconContinue`（对话框），几何保守、`stroke: currentColor`（无字面色值）；
- `JobRow` 新增 `terminal = canDismiss && !paused`：**只有非 paused 的终态行**给这两个入口
  —— paused 行已有「继续 / 换通道」，而「继续」与「重跑」同义（都走同会话 `--resume`），再放就是重复入口；
- **重跑**（↻）→ `onRetry(job.id, {})`：同会话重发**原提示词**；无 sessionId 则交接重跑（title 写明）；
- **续接**（对话框）→ 展开行内输入框 + 发送按钮（Enter 亦可），→ `onContinue(job, text)`
  = `dispatch({ kind:'prompt', prompt: 新指令, resume: job.sessionId, 继承 provider/mode/lock/cwd/timeoutMin })`
  —— **提示词是用户新输入的**，这正是与「重跑」的区别；
- 无 `sessionId` 时续接按钮**禁用并给出原因**（不静默消失）；
- 文案 8 个新键四处同源（内联 `STRINGS.zh/en` + `locale/zh.json` + `locale/en.json`，各 110 键）。

**渲染验证**（真实组件树 + demo 数据，一次性探针跑完即删）：

```
demo-running   buttons: 终止 | 输出
demo-queued    buttons: 终止 | 输出
demo-paused    buttons: 关闭 | 输出 | 同通道续跑（--resume） | (换通道)
demo-done      buttons: 重跑(t=同会话重发原提示词…) | 续接(t=在同一会话里发一条新指令…) | 关闭 | 输出
--- 点击「续接」(demo-done) ---
demo-done      buttons: … | 发送[disabled]   inputs: 1      ← 输入行出现，空输入时发送禁用
```

### 16.2 ⚠️ 验证中发现的核心缺陷：`dispatch` + `resume` 必然失败（F2 的另一条入口）

用新指令续接旧会话的实测（这是**最能证明上下文连续性**的测法 —— 让它引用上一条指令）：

```
zcode_dispatch { action:"dispatch", kind:"prompt", resume:"sess_e643c6e7-…",
                 prompt:"上一条指令要求你回复的那串文字，请在末尾加上 -CONT 再回复一次，只回那一行。" }
→ job j-munuv2cn-2-0cc3  state=failed  exitCode=1  resultFile=null  elapsedSec=2.106
→ err.log: Error: Model creation failed (traceId: 34129a47-…)
```

**根因**（我方 spec 里赫然出现未传入的 `model: "GLM-5.3-Flash"`）：

```js
// core/dispatch-core.mjs:1009-1014（改前）公共派发入口：未指定 model → 注入通道默认 model
if (effSpec.model == null && channel.model) effSpec.model = channel.model;
// :498  if (spec.model) args.push('--model', spec.model);     → 与 --resume 同现 → 必失败（F2）
```

`retry` 靠 `delete spec.model`（`:1101`）躲过了 F2，但**公共入口 `dispatch` 这条路没躲**
—— 所以任何 `dispatch + resume`（工具直调、以及本次新做的面板「续接」）都会踩。
`test/channel-retry.test.mjs:134` 原本只覆盖了 `retry` 那条入口，**这正是测试缺口**。

**修复**（`core/dispatch-core.mjs`，附 F2 出处注释）：

```js
if (effSpec.model == null && channel.model && !effSpec.resume) effSpec.model = channel.model;
```

**回归测试**（`test/channel-retry.test.mjs`，双向锁定，**已通过**）：

```
✔ dispatch 直接带 resume → 命令行含 --resume 且不含 --model（F2 的另一条入口） (396ms)
ℹ pass 9   fail 0        ← 原 8/8 升为 9/9（阈值只升不降）
```

该用例同时断言对照组：**普通 `dispatch` 未指定 model 时仍须注入通道默认 model**（否则通道默认值失效）。

### 16.3 ⚠️ 修复的生效条件：**必须完全重启 DSH**

`node test/*.mjs` 直接 `createDispatcher` 读盘，所以**测试已证明修复正确**；
但**运行中的宿主进程里仍是旧模块**（cordis `_reload()` 复用进程内已 import 的 `runtime`，改盘上的
`core/*.mjs` 对已加载的 dispatcher 无效）—— 实测第二次续接（`zb01-cont2`）**同样 `failed`** 即为此故。

| 入口 | 现在可用？ |
|---|---|
| **重跑**（走 `retry`，该路径原本就 `delete spec.model`） | ✅ **立即可用**（已实测 `zb01-smoke-r1` 成功，见 §15.2） |
| **续接**（走 `dispatch + resume`） | ⏳ **需完全重启 DSH 后可用**（修复已在盘上 + 测试已过） |

### 16.4 门禁（全绿，阈值只升不降）

`node --check`（含 `core/dispatch-core.mjs` 与测试文件）全 OK；verify-plugin **20/20**；
verify-switch **8/8**；core **11/11**；channel-retry **9/9**（↑1）。

### 16.5 现场残留（供清理）

`.data/state/jobs.json` 现含 4 条：`zb01-smoke`(done)、`zb01-smoke-r1`(done)、
`zb01-cont`(failed)、`zb01-cont2`(failed)。两条 failed 是 F2 缺陷的现场证据，
在面板里会落在新的「**异常**」分组下（正好可用来目视验收分组）；确认后可用 ✕ 关闭。
锁目录已空（无残留锁）。`jobs.json` 本身经复核为 **UTF-8 无 BOM、JSON 合法、中文正确**
（此前 `ConvertFrom-Json` 报错是本机 Windows PowerShell 5.1 的 ANSI 读取问题，非数据问题）。

---

## 17. 问答存档：状态语义 / 状态总数 / 累计与清理机制

### 17.1 状态全集：**7 个业务状态** + `idle` 兜底

```js
// core/dispatch-core.mjs:277
const TERMINAL_STATES = new Set(['done', 'failed', 'killed', 'interrupted']);   // 4 个终态
// 非终态 3 个：queued / running / paused
// client.js:1215 StatusDot 的 cls 白名单 = 上述 7 个；未知值一律落 'idle'
```

颜色（全部走主题令牌；`client.js:83-92`）：

| 状态 | 令牌 | 观感 | 含义 |
|---|---|---|---|
| `queued` | `--dsw-alias-label-tertiary` | 灰 | 已入队，等单写者锁/并发额度 |
| `running` | `--dsw-alias-state-business-primary` | 蓝 + 1.2s 呼吸 | 子进程在跑 |
| `paused` | `--dsw-alias-state-warn-secondary` | 黄 + 2.4s 呼吸 | 可恢复中断（额度耗尽/未开通/需签名/配置错），**不占锁、不堵队列** |
| `done` | `--dsw-alias-state-success-primary` | **绿** | **成功完成**（终态）|
| `failed` | `--dsw-alias-state-error-primary` | 红 | 失败（终态）|
| `killed` | `--dsw-alias-state-warn-primary` | 黄 | 被 kill（终态）|
| `interrupted` | `--dsw-alias-state-idle-primary` | 灰 | 宿主重启时在飞 → 强制标中断（终态）|
| `idle`（兜底） | `--dsw-alias-label-tertiary` | 灰 | 非业务状态；仅用于**标题栏**「无任务在跑」与未知值 |

**⚠️ 标题栏有两个点，都不是单任务状态**（容易误读）：
1. 最左圆点 = `StatusDot(runningNow ? 'running' : 'idle')` —— 表示**整台派发台是否有任务在跑**（蓝=有，灰=无）；
2. 「派发：开」前面那个点 = **`SwitchBadge`**，开=`stDone`(**绿**)、关=`danger`(红)、未知=灰 ——
   它是**总开关状态**，与「完成」无关。

### 17.2 清理机制：**记录有界，日志无界**

| 对象 | 机制 | 有界？ |
|---|---|---|
| `jobs.json` 记录 | `JOBS_FILE_CAP = 1000`（`:51`）；`persist()` 超限时按 `queuedAt` 从最老开始**只淘汰终态**（`:406-412`），运行中的绝不动；`evicted` 集（`:329`）防止下一轮 `persist` 把淘汰项从磁盘回灌（`:401`） | ✅ 1000 封顶 |
| 内存 tailLines | `TAIL_CAP = 200` 行/job（`:50`、`:614`） | ✅ |
| 面板 ✕（dismiss） | **只是隐藏**：写 `state/dismissed.json`，wire 层 `withoutDismissed` 过滤；记录仍在 `jobs.json` | — 非删除 |
| **插件侧捕获日志** | `logs/<jobId>.out.log` + `.err.log`（`:510-515`）每任务 2 个，**淘汰时不删文件**（`:406-412` 只删内存条目与 tails） | ❌ **单调增长** |
| **runner 侧产物** | 宿主项目 `collab/logs/zcode-run-*.{out,err,result}.log` —— `zcode-run.mjs` 只在 `:375` 清自己的临时配置目录，**不清理产物** | ❌ **单调增长** |
| 台账 | `collab/logs/zcode-runs.jsonl` append-only（`:467`） | ❌ 单调增长 |

**实测规模（2026-09-30 18:0x）**：`jobs.json` 12,459 B / 4 条（≈3.1 KB/条，其中 tailLines 约占 1/3）；
`.data/logs` 8 文件 / 3,077 B；宿主项目 `collab/logs` 的 `zcode-run-*` 共 **96 文件 / 150,409 B**（对应 31 行台账 ≈ 3 文件、4.9 KB/run）；`zcode-runs.jsonl` 16,411 B / 31 行。

### 17.3 「累计太多」的实际影响（分级）

1. **磁盘（先到）**：日志按 ≈5 KB/run 单调增长 —— 每天 20 次 ≈ 100 KB/天 ≈ 36 MB/年。量级不大，但**永不回收**，且文件数（5 个/run）涨得更快：每天 20 次 = 100 文件/天。
2. **`persist()` 写入成本（真正的隐患）**：每次 `persist()` 都要
   **读全量 `jobs.json` → `JSON.parse` → 合并磁盘条目 → `JSON.stringify` → 原子写**（`:396-415`），
   而运行期每个可解析的 runner 行都会触发一次（`:644`，终态后短路）。
   按 3.1 KB/条外推，**1000 条上限 ≈ 3.0 MB/次写**，每个 run 约 10+ 次 → 每任务数 MB 的读写放大。
   当前 12 KB 完全无感，但逼近上限时会明显。
3. **面板轮询**：`snapshot()` 全量过 `slimJob`（剥掉 tailLines/capture 路径）后 1s 轮询一次，
   载荷随条数线性增长、被 1000 上限封顶；`dismiss` 过的条目仍参与 `filter` 但不出现在结果里。
4. **内存**：tails ≤200 行/job，其余为纯 JSON，量级同 jobs.json。

**结论**：记录侧**有界**（1000 条 + 终态优先淘汰），所以"进程累计"不会无限膨胀；
真正无界的是**日志文件**与**台账**。清理策略待用户决定（见 §17.4）。

### 17.4 待决（需用户拍板，涉及删文件，不擅自动手）

可选日志清理策略：① 按运行次数保留最近 N 次；② 按时间保留最近 N 天；③ 只清插件侧 `.data/logs`（自有目录，零风险），
宿主项目 `collab/logs` 属应用户显式同意再动；④ 维持现状（量级可接受）。
另：`persist()` 的读-改-写放大若要在上限附近优化，属独立性能单，本轮不动。

---

## 18. ZB-05：日志清理 —— 分析结论与落地（用户委托判断）

用户答复：日志清理「**你来分析给出意见**」；`persist()` 写放大「**暂不优化，仅登记为已知风险**」（见 §17.3-2，已登记）。

### 18.1 我的判断

分两半，**只做零风险的那一半**：

| 对象 | 我的意见 | 理由 |
|---|---|---|
| 插件侧 `workRoot/logs/<jobId>.{out,err}.log` | ✅ **删，且只跟随「淘汰」触发** | 记录被淘汰后 `tail()` 再也找不到该 job（只会返回"找不到 job"），这两个文件**没有任何读取方** = 纯垃圾。这不是新增策略，而是让淘汰逻辑完整 —— 删掉后插件侧日志与 `jobs.json` 一起被 `JOBS_FILE_CAP` 封顶（稳态 ≤ 1000 条 × 2 文件） |
| 宿主项目 `collab/logs/zcode-run-*.{out,err,result}.log` | ❌ **不碰** | ① 那是你的审计现场（31 次运行的原始证据）；② 属另一个仓库，跨仓删除应由你或 宿主侧决定；③ 量级小（150 KB / 31 run）。**建议保留**，需要时你手动清理 |
| 台账 `collab/logs/zcode-runs.jsonl` | ❌ **绝对不能删** | 它是面板「用量」5 小时/本周/今日窗口的数据源（`quota` 动作读它聚合）—— 删了用量直接归零 |
| 面板「✕」(dismiss) | ❌ 不在此删除 | dismiss 只是隐藏、记录仍在，`tail` 仍可用；此时删文件会**破坏功能** |
| 按时间/次数保留 N | ❌ 不做 | 会引入新配置与新状态（dismissed 时间戳），而「跟随淘汰」已经把无界变有界，不必再加策略 |

### 18.2 实现（`core/dispatch-core.mjs`）

```js
// persist() 淘汰分支内
for (const j of all.slice(0, all.length - JOBS_FILE_CAP)) {
  if (!isTerminal(j)) continue; // 只淘汰终态
  dropCaptureFiles(j);          // ZB-05：连它的捕获日志一起回收
  jobs.delete(j.id); tails.delete(j.id); evicted.add(j.id);
}

/** 只允许删 dirLogs 目录内的文件。 */
function dropCaptureFiles(job) {
  for (const f of [job.captureOut, job.captureErr]) {
    if (typeof f !== 'string' || f === '') continue;
    const rel = relative(dirLogs, resolve(f));
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) continue; // 越界或目录本身：拒绝
    unlinkSync(f);   // 失败只是"没删掉"，绝不影响淘汰与写盘
  }
}
```

**⚠️ 安全设计（必须说明）**：`jobs.json` 是**可被手工编辑**的外部输入，其中 `captureOut/captureErr`
属**不可信数据** —— 若不校验，把 `captureOut` 改成 `C:\重要文件.txt` 再触发淘汰就变成任意路径删除。
故加了 `dirLogs` 归属校验（拒绝 `..` 逃逸、绝对路径与目录本身）。这是本轮唯一一处"删文件"代码，
安全边界必须在代码里、而不是靠调用方自觉。

### 18.3 回归测试（`test/core.test.mjs`，**已通过**）

```
✔ JOBS_FILE_CAP 淘汰终态时回收其捕获日志；越界路径被拒绝（ZB-05） (443ms)
ℹ pass 12  fail 0        ← 原 11/11 升为 12/12
```

用例构造：磁盘预置 1001 条 job（两条最老 = 待淘汰者），其中
- `j-oldest`：`captureOut/captureErr` 指向 `logs/` 内的真实文件；
- `j-evil`：`captureOut` 指向 `logs/` **之外**的文件（模拟被篡改的 jobs.json）；
然后派发一个任务触发 `persist()` 淘汰，断言：
① `logs/` 内两文件**已删**；② 越界文件**原样保留**；③ 被淘汰 job 不在内存；④ `jobs.json` 仍正常写盘。

> 附注：该用例首次运行时**确实红了一次** —— 失败在我最后一条断言的哨兵值
> （`d.get()` 对未知 id 返回 `null` 而非 `undefined`），关键三条断言当时已全绿。
> 已改为语义断言 `assert.ok(!d.get(...))`，避免哨兵值变化导致假红。

### 18.4 门禁（全绿，阈值只升不降）

`node --check`（6 个文件，含 core 与两份测试）全 OK；core **12/12**（↑1）；channel-retry **9/9**；
verify-plugin **20/20**；verify-switch **8/8**。

### 18.5 生效条件与残留

- ⚠️ 本修复在 `core/` 内 ⇒ 与 §16.2 的 F2 修复一样，**需完全重启 DSH 才装入运行中的宿主**。
  建议与 F2 修复**共用同一次重启**。
- 清理只在**淘汰发生时**生效（超过 1000 条记录后）；**存量 8 个旧文件不会自动回收** ——
  它们是现存 job 的捕获日志，删了会让 `tail` 失效，属**有意不删**。
- 仍未做（如实登记）：宿主侧产物与台账无自动清理；`persist()` 写放大未优化（§17.3-2，用户已定"仅登记"）。

---

## 19. ZB-06 / ZB-07：三问的答复与两项落地（通道持久化 / 进程截断 / 面板宽高）

### 19.1 Q1 通道设置是否延续 —— **会，已落盘**（无需改动）

`setChannel()` 原子写 `workRoot/state/channel.json`（`dispatch-core.mjs:736-743`），
构造时 `loadChannelState()` 读回 ⇒ **完全重启 DSH 后仍延续**。现场实证：

```json
// .data/state/channel.json（2026-09-30T08:14:33Z）
{ "version": 1, "provider": "builtin:bigmodel-coding-plan", "model": "GLM-5.3-Flash", "updatedAt": "…" }
```

面板截图里的通道/模型与之一致 ⇒ 面板读的正是这份持久化值，不是"碰巧选了第一项"。
（同理持久化：`dismissed.json`、`jobs.json`；降级链 `fallbackChain` 亦随 `persist` 落盘。）

> 附带闭环：`dismissed.json` 内容为 `["j-munuv2cn-2-0cc3","j-munuvmur-3-fac9"]`，
> 而 `jobs.json` 仍含这 4 条 ⇒ **§12.5「✕ 点击往返未自证」由用户实测闭环**：
> 记录保留（只隐藏）、wire 层过滤生效。

### 19.2 Q2 进程多时的显示 —— 分组内截断 + 显式展开（ZB-07）

问题：进程上限是 `JOBS_FILE_CAP = 1000`，全量渲染会变成几百行长列表（且 1s 轮询重建整棵树）。

修法（`client.js`）：
- 新增 `JOB_GROUP_PREVIEW = 5`：**每组默认只渲染最近 5 条**；
- 组内**最新在上**（按 `queuedAt` 降序，显式排序，不依赖 core 的返回顺序）；
- 超出部分折进一个按钮「**还有 N 条更早的**」，点击展开该组全部并出现「收起」；
- **绝不静默吞行**：按钮上写明还有多少条；展开状态仅会话内记忆（刷新回到只显示最近 5 条，
  这个默认方向永远是"少显示"而不是"漏掉最新"）。

**真实验证**（真实组件树 + 注入 12 条 done / 1 条 running 的外部数据源，探针跑完即删）：

```
=== 默认（每组最多 5 条）===
  [进行中 1] 渲染 1 行: run-0
  [已完成 12] 渲染 5 行: done-11, done-10, done-09, done-08, done-07      ← 最新在上
      按钮: … | 还有 7 条更早的
=== 点击「还有 N 条更早的」后 ===
  [已完成 12] 渲染 12 行: done-11 … done-00
      按钮: … | 收起
```

### 19.3 Q3 面板宽高自定义 + 持久化（ZB-06）

改前：`.zcd-panel{max-height:min(72vh,560px)}` 写死；左下 grip **只改宽度**；只保存 `{width}`。
⇒ 高度不可调、不可存。

改后（`client.js`）：
- 左下 grip 改为双向（`cursor:nesw-resize`）：左右 → 宽度，上下 → 高度；
- 新增 `HEIGHT = { min: 160 }` + `maxPanelHeight()` = `clamp(min(1200, vh-80), ≥160)` ——
  **上限随视口收敛，不会把面板拖到屏幕外**；
- CSS 改为 `height:var(--zcd-h,auto); max-height:var(--zcd-h,min(72vh,560px))`：
  **未设定 `--zcd-h` 时行为与旧版逐字一致**（auto + 72vh/560 上限），设定后固定高度、`.zcd-body` 内部滚动；
- 落盘仍用同一个键 `zcode-dispatch:panel:size:v1`，值扩为 `{width, height}` ⇒ **旧值 `{width}` 兼容**。

**真实验证**（探针注入 `window.localStorage` 与 `innerHeight:700`）：

```
无 height（旧值 {width:500}）→ --zcd-h = undefined   --zcd-w = 500px    ← auto；旧值兼容
{width:520,height:700}       → --zcd-h = 620px       --zcd-w = 520px    ← 700 被视口钳到 700-80
height:99999（越界）          → --zcd-h = 620px                          ← 上限生效
height:10（低于下限）         → --zcd-h = 160px                          ← 下限生效
```

> 诚实标注：首次跑该验证时 `--zcd-h` 全为 `undefined`，是**我的探针**只挂了 `globalThis.localStorage`
> 而 `loadJson` 读的是 `window.localStorage`（`client.js:292`）—— 属探针 bug，非代码缺陷；
> 修正后复跑通过。另：首轮 `innerHeight` 未设、钳制走的是回退分支（900-80=820），
> 补上真实视口后才验到 620，即"随视口收敛"是在**真实分支**上验的。

### 19.4 门禁（全绿）

`node --check` 7 文件（含 core 与两份测试）全 OK；verify-plugin **20/20**；verify-switch **8/8**；
core **12/12**；channel-retry **9/9**；locale zh/en 各 **113** 键、双向齐备。

### 19.5 生效条件

本轮两项（ZB-06/ZB-07）均在 `client.js` ⇒ **只需刷新页面**。
（§16.2 的 F2 修复与 §18 的日志回收在 `core/` ⇒ 仍需**完全重启 DSH** 才装入运行中的宿主。）

---

## 20. ZB-08 / ZB-09：面板固定按钮 + 进程状态改 Tab 分页

### 20.1 ZB-08 固定按钮（锁定位置，禁止拖动）

- `LS.pinned = 'zcode-dispatch:panel:pinned:v1'`，`pinned` 进 `useState` **并持久化** ——
  固定表达的是"我把面板安置好了"的意图，跨会话应当保持；
- 标题栏新增图钉按钮（`IconPin`，固定=实心 `fill:currentColor` / 未固定=空心 `fill:none`，
  只用关键字不引入字面色值），title 在「固定位置」/「取消固定」之间切换，带 `aria-pressed`；
- `startDrag` **首行早退**：`if (pinned) return;`。已固定时标题栏加 `zcd-locked`
  （`cursor:default`），不再给出"可拖"的视觉承诺；
- ⚠️ **依赖陷阱（已避开）**：`startDrag` 是 `useCallback(…, [])`，把 `pinned` 读进闭包后
  **必须把 `pinned` 加入依赖**，否则回调永远读到初始值 —— 固定后仍可拖动。已改为 `[pinned]`。

**真实验证**（真实组件树 + 给 `ref` 接假 DOM，让 `startDrag` 越过 `if (!el) return` 真正走到守卫之后）：

```
默认 pinned=false → titlebar="zcd-titlebar"            拖动监听注册数=3   (期望 >0)
     pinned=true  → titlebar="zcd-titlebar zcd-locked"  拖动监听注册数=0   (期望 0)
     pin 按钮 title: 取消固定（恢复可拖动）        ← localStorage 的 pinned=true 被正确读回
```

⇒ 固定**不是只改了 CSS**：事件监听真的没被注册，拖动被实际拦住。

### 20.2 ZB-09 进程状态改 Tab 分页

改前：4 个分组从上到下堆在同一页，进程一多就要长距离滚动，且与面板里其他分区抢纵向空间。
改后（`client.js` 的 `JobList`）：
- 顶部一排分类 tab（`.zcd-tabs/.zcd-tab`，胶囊样式、只用主题令牌），每个 tab 带计数；
- **分类 tab 固定 4 个**（计数可为 0）⇒ tab 集合稳定，不会随状态变化忽隐忽现；
  兜底分组 `grpOther` 只在真有未归属状态时才作为第 5 个 tab 出现；
- **默认落在「第一个非空分组」**：`userTab` 初始为 `null`，每次渲染按当前数据推导 ——
  这解决了"面板挂载时快照还没到、无法在初始化时定 tab"的时序问题；
  用户点过某个 tab 后固定用它，**即使该 tab 为空也如实显示空态，不偷偷跳走**；
- 每个 tab 内保留 ZB-07 的「最近 5 条 + 还有 N 条更早的 / 收起」。

**真实验证**（真实组件树 + 注入 12 条 done / 1 条 running）：

```
默认           tabs: 进行中 1 | 需处理 0 | 异常 0 | 已完成 12    active: 进行中    行: run-0
点击「已完成」  tabs: 同上（稳定）                            active: 已完成    行: done-11…done-07 | 还有 7 条更早的
点击「需处理」  tabs: 同上（稳定）                            active: 需处理    行: (空态)
点击「进行中」  tabs: 同上（稳定）                            active: 进行中    行: run-0
```

> 诚实标注：该探针前两轮输出里出现过 `active: (none)` 与 `titlebar="(no titlebar)"`，
> 是**探针自身**的 `byClass` 用了 `className` **全等**匹配，而激活 tab 是 `'zcd-tab zcd-tab-on'`、
> 固定后的标题栏是 `'zcd-titlebar zcd-locked'` —— 改成按 token 匹配后复跑即通过。
> 这已是本轮第三次同类探针 bug（前两次见 §19.3），一并记下以免下次再踩。

### 20.3 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；
channel-retry **9/9**；locale zh/en 各 **115** 键、双向齐备（新增 `pin`/`unpin`）。

### 20.4 生效条件

两项均只改 `client.js` ⇒ **刷新页面即可**。
`core/` 的两笔（§16.2 F2 修复、§18 日志回收）**仍需一次完全重启 DSH**。

---

## 21. ZB-10：修「抓左下角、实际动的是右下角」（用户现场报告）

### 21.1 根因：手柄钉死在左边，但面板一旦被拖过就是 **left/top 锚定** ⇒ 动的是右边

```js
// 改前
'.zcd-grip{position:absolute;left:0;bottom:0;…cursor:nesw-resize;}'   // 手柄恒定在左下
w = clampWidth(startW - (ev.clientX - startX));                       // 指针左移 = 变宽
// rootStyle：pos ? {left,top} : {right:'24px', bottom:'24px'}
```

- `pos` **未设** → CSS `right/bottom` 锚定 → **左边缘**动 → 与"手柄在左下 + 左移变宽"一致 ✅
- `pos` **已设** → `left/top` 锚定 → **右边缘**动 → 而手柄仍在左下、方向仍是"左移变宽" ⇒
  结果就是**抓左下角、实际右下角在动**，且方向相反 ❌

**而面板只要被拖动过一次，`startDrag` 就会写 `pos`（并持久化）** ⇒ 用户几乎必然处于第二种状态。
这与现场描述（"鼠标放左下角，实际动的是右下角"）**逐字吻合**。

### 21.2 修复（`client.js`）

1. **手柄侧跟随锚定**：
   ```js
   '.zcd-grip{position:absolute;bottom:0;…}',
   '.zcd-grip.zcd-grip-l{left:0;cursor:nesw-resize;}',
   '.zcd-grip.zcd-grip-r{right:0;cursor:nwse-resize;}',
   // JSX：className: 'zcd-grip ' + (pos ? 'zcd-grip-r' : 'zcd-grip-l')
   ```
2. **变宽方向跟随锚定**：`const growRight = !!pos; w = clampWidth(growRight ? startW + dx : startW - dx);`
3. **`pos` 进 `useCallback` 依赖**（`[pos]`）—— 与 §20.1 的 `pinned` 是同一个陷阱：
   不进依赖则回调永远读到初始 `pos`，修了等于没修。
4. `.zcd-panel` 补 `position:relative`：此前它是 `position:static`，绝对定位的手柄实际是相对
   `.zcd-root` 定位的（今天两者同框所以看不出问题，但语义脆弱）；现在手柄的包含块就是面板本身。

**高度方向刻意不改**：`h = startH + dy`（下移 = 变高）。`pos` 已设时下边缘动、手柄跟着走 ✅；
`pos` 未设时下边缘被 CSS 锚住，面板改为**向上**长高 —— 这是**有意保留**的：面板默认贴着屏幕底部，
向下长会直接长出屏幕外。已在代码注释里写明理由。

### 21.3 真实验证（真实组件树；**抓 `pointermove` 处理器实测宽高增减**，不只是看 class）

```
=== pos 未设（CSS right/bottom 锚定 ⇒ 左边缘动）===
  手柄 class = zcd-grip zcd-grip-l   监听=pointermove,pointerup,pointercancel
  指针左移50 → --zcd-w=490px      ← 变宽 ✅（与手柄所在边一致）
  指针右移50 → --zcd-w=390px
  指针下移60 → --zcd-h=360px

=== pos 已设 {left:100,top:50}（left/top 锚定 ⇒ 右边缘动）===
  手柄 class = zcd-grip zcd-grip-r   监听=pointermove,pointerup,pointercancel
  指针左移50 → --zcd-w=390px
  指针右移50 → --zcd-w=490px      ← 变宽 ✅（正是本次修复点）
  指针下移60 → --zcd-h=360px
```

> 诚实标注：该探针首轮输出里宽高**完全没变**（440px 恒定），原因是**我的探针**在
> `pointermove` 之后做了 `cellStore.clear()` —— 把 `setWidth` 刚写入的状态单元一起抹掉了。
> 去掉那次 clear 后即通过。这是本轮第四次探针自身缺陷（前三次见 §19.3、§20.2），
> 已一并记下：**hook 状态探针绝不能在"动作"与"重渲染"之间清空状态单元**。

### 21.4 重启已确认生效（顺带闭环两笔 core 欠账）

`activation.json` 的 `at = 2026-09-30T10:24:42.908Z`（= **本地 18:24:42**，用户重启时刻）⇒
宿主确实重新 `apply()` 过。由于 `createDispatcher` 就在 `apply()` 里、且重启后模块是**全新载入**的，
⇒ **§16.2 的 F2 修复（`dispatch + resume` 不再注入 `--model`）与 §18 的捕获日志回收，现已生效于运行中的宿主**；
面板「续接」按钮从此刻起可用。

### 21.5 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 21.6 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 22. ZB-11：修「收起后空盒子」+ 右下角三角标（用户现场报告）

### 22.1 缺陷一：收起面板后留下一个大空盒子 —— **是我 §19（ZB-06 高度）引入的回归**

用户报告：「点击倒三角图标收起面板，面板里面的内容收起了，实际面板还在。」

```js
// 改前（cssVars）
...(height == null ? {} : { '--zcd-h': `${height}px` }),   // 收起时也照注入
// .zcd-panel{height:var(--zcd-h,auto); …}
// 收起渲染：collapsed ? null : h('div',{className:'zcd-body'}, …)   ← body 被移除
```

一旦用户设过高度（`--zcd-h` 有值），收起时 body 虽已移除，`height:var(--zcd-h)` 仍把面板撑在原高度
⇒ 屏幕上留下一个**只剩标题栏的大空盒子**。ZB-06 之前高度是 `auto`，所以没这个现象 —— 属我引入的回归。

**修复**：收起时不注入 `--zcd-h`（`collapsed || height == null ? {} : {…}`），
面板回到 `height:auto` ⇒ 收起后只剩标题栏，高度不残留。

### 22.2 需求二：右下角三角标 + **仅右下角**可控制尺寸

改前（ZB-10）：手柄会在左下/右下之间**跟着锚定切换**（用户觉得难以预判）。

现在按用户要求收敛为**唯一手柄**：
- 位置**恒在右下角**（`.zcd-grip{right:0;bottom:0}`），`cursor:nwse-resize`，悬停变色；
- 新增**三角标** `IconResizeMark`：贴角的实心右三角（`fill:currentColor` + `opacity:0.55`），
  一眼可辨"这里能拖"；外框仍是 16×16 的抓取区（可视图形小于热区，好点）；
- 删除 `zcd-grip-l` / `zcd-grip-r` 两个修饰类，手柄只有一种形态；
- **方向随之统一为正向**：`w = startW + dx`、`h = startH + dy`（右移=变宽、下移=变高）。
  这要求面板是 `left/top` 锚定 —— 而面板若从未被拖动过，CSS 是 `right/bottom` 锚定，
  于是 `startResize` **开头把 left/top 按当前 rect 钉住**（取的就是当前几何 ⇒ **视觉零位移**），
  从此右/下两条边才是会动的边，手柄与行为永远一致（ZB-10 那类"抓错角"不会再出现）。

### 22.3 真实验证（真实组件树）

```
=== A. 收起面板：高度不得残留 ===
  collapsed=false → --zcd-w=520px  --zcd-h=620px      body=1  grip=1
  collapsed=true  → --zcd-w=520px  --zcd-h=undefined  body=0  grip=0   ← 空盒子消除

=== B. 手柄：仅右下角 + 三角标 + 方向 ===
  手柄 class = "zcd-grip"（只剩一种形态）   含三角标 = true
  起点 --zcd-w=520px   pos(未拖动前)=(未设)
  右移50 → --zcd-w=490px        ← 440(起点)+50 = 变宽 ✅ 手柄在右、与光标同向
  拖拽后 pos = {"left":10,"top":10}   ← 未被拖动过的面板已被自动钉成 left/top
  下移60 → --zcd-h=360px        ← 300(起点)+60 = 变高 ✅
```

> 说明：B 里"起点 440"来自探针假 DOM 的 `offsetWidth`（真机上它就是面板实际宽度），
> 与 `--zcd-w=520px` 不一致是探针造数据的差异，不影响方向判定（440+50=490 即证方向）。

### 22.4 已知取舍（如实登记，未做）

手柄在右下、面板靠屏幕底部时，**向下**长高可能把面板底部（含手柄本身）推出视口。
本轮**未加视口钳制** —— 理由：用户当前已有的行为就是"下边缘自由向下长"，
加钳制等于**收回他们已有的能力**；且面板可随时拖到屏幕上方再调整。
若实际使用中造成困扰，可再加"按 `vh - EDGE - top` 钳制高度"（一行），届时另行确认。

### 22.5 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 22.6 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 23. ZB-12：行头瘦身为纯摘要 + 动作全部移入展开详情（用户要求）

用户要求：删掉进程行的倒三角；默认点整行展开/收起；把那三个图标放进展开详情里。

### 23.1 改动

**行头（`.zcd-job-head`）现在是纯摘要，零按钮**：
```js
h('div', { className: 'zcd-job-head', role: 'button', 'aria-expanded': open, onClick: toggle },
  StatusDot, tag, model, [暂停徽章], [来源徽章], [跳数徽章], 耗时, 上下文%, exit, 锁)
```
- **删除倒三角**（`IconChevron` 在进程行不再使用；标题栏的折叠按钮仍在用，图标未删）；
- 删除行头的 `zcd-spring` 占位与**全部 4 个按钮**（终止/重跑/续接/关闭）；
- 行头补 `role="button"` + `aria-expanded` —— 它现在是**唯一的展开开关**，可访问性上应该说清；
- 整行点击即切换详情（原有 Z9 `isInteractive` 守卫保留，作为"将来若再往行头加元素"的防护）。

**行动作全部移入「仅展开时可见」区**（`open && …`）：
终止（active）/ 重跑 / 续接（terminal）/ 关闭（canDismiss），
以及 paused 专属的「继续 / 换通道」、换通道选择器、续接输入行。

**`retryFb` 反馈行刻意留在展开区之外**：它是动作结果的回执，收起时也应能看到失败原因，
否则"点了没反应也没提示"。

> ⚠️ 行为变化（用户未明说，我按一致性处理，可回退）：**paused 行的「继续 / 换通道」现在也需要先展开**。
> 理由：行头已是纯摘要，若把部分动作留在外面、部分收进详情，反而更难预期。
> 若你希望 paused 的动作保持常显，把它从 `open && paused` 改回 `paused` 即可（一处）。

图标形态未改成文字按钮 —— 你原话是"把那三个图标放进去"，故按原样搬移；
终止(✕) 与 关闭(✕) 共用同一字形不会混淆（`active` 与 `canDismiss` 状态互斥，永不同时出现）。

### 23.2 真实验证（真实组件树，逐状态点开）

```
=== 初始（默认 tab=进行中；全部收起）===
  demo-queued    head 按钮=0  aria-expanded=false  整行按钮=0  详情=0
  demo-running   head 按钮=0  aria-expanded=false  整行按钮=0  详情=0
=== 切到「已完成」tab（仍收起）===
  demo-done      head 按钮=0  aria-expanded=false  整行按钮=0  详情=0
=== 点击行头（展开）===
  demo-done      head 按钮=0  aria-expanded=true   整行按钮=3 ["重跑","续接","关闭"]  详情=1
=== 再点行头（收起）===
  demo-done      head 按钮=0  aria-expanded=false  整行按钮=0  详情=0
=== 「进行中」tab 全部展开 ===
  demo-queued    head 按钮=0  aria-expanded=true   整行按钮=1 ["终止"]  详情=1
  demo-running   head 按钮=0  aria-expanded=true   整行按钮=1 ["终止"]  详情=1
```

⇒ 收起态**整行 0 按钮**（倒三角确实没了）；展开后才出现对应状态的动作；再点即收起。

> 诚实标注：该探针首轮崩在 `btns()` 未防 `null` 子节点（这棵树里 null 很常见）——
> 又是探针自身缺陷（本轮第五次）。已修。**注意这五次全是探针代码的问题、不是产品代码**，
> 但我把它们逐条记下来，因为"验证工具本身没被验证"是真实风险。

### 23.3 死代码核查

`IconKill / IconRerun / IconContinue / IconChevron / IconPin / IconMinus / IconResizeMark`
逐个 grep 均有定义 + 使用（≥2 处）；`zcd-spring` 仍被 1342/1497 两处使用 ⇒ **未引入死代码或死 CSS**。

### 23.4 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 23.5 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 24. ZB-13：修「点击行头不展开」—— ZB-12 的自伤回归（用户现场报告）

### 24.1 根因：我加的 `role="button"` 与既有 Z9 守卫互相打死

ZB-12 给行头加了 `role="button"`（可访问性：它现在是唯一的展开开关）。而行头的点击守卫是 Z9 那段：

```js
const isInteractive = (el) => !!(el && typeof el.closest === 'function'
  && el.closest('button,input,select,textarea,a,[role="button"]'));
// 行头 onClick：if (isInteractive(e.target)) return;
```

点行头**任何位置**时，`e.target` 是行头内的某个 span，`closest(...)` 会一路向上找到**行头自己**
（因为它带了 `role="button"`）⇒ 判定为"交互元素" ⇒ `return` ⇒ **永远不切换**。
行头越"可访问"，越是点不动。

**修复**：把守卫的语义从"命中可交互元素就跳过"改为"命中**行头之外的**控件才跳过"：

```js
const hit = e.target && typeof e.target.closest === 'function'
  ? e.target.closest('button,input,select,textarea,a,[role="button"]')
  : null;
if (hit && hit !== e.currentTarget) return;   // 命中行头自身（含其非交互子元素）→ 正常切换
setOpen(!open);
```

`role="button"` 与 `aria-expanded` 保留（可访问性不回退），守卫的作用（"将来若往行头加真按钮、
点按钮不误触展开"）也保留。

### 24.2 ⚠️ 为什么我上一轮的探针没抓到 —— **探针把守卫整个绕过了**

ZB-12 的探针这样点行头：

```js
head.props.onClick({ target: {} });      // ← 空对象，没有 closest()
```

`isInteractive({})` 里 `typeof el.closest === 'function'` 为 false ⇒ 守卫判 false ⇒ 照常切换。
**假事件不具备 `closest`，于是把被测的守卫短路掉了** —— 探针"通过"与真机行为无关。

⇒ 教训（已写入本轮结论）：**凡是处理器会去查 DOM（`closest` / `currentTarget` / `getBoundingClientRect`），
假事件就必须如实建模这些方法**，否则测的是"绕开守卫的那条路"，不是真实路径。

### 24.3 真实验证（假事件如实模拟 `closest` / `currentTarget`）

```
初始                                    详情 0
点行头内的 span（closest 命中行头自己）    详情 0 → 1   aria-expanded=true    ← 修复点
再点一次                                详情 1 → 0   aria-expanded=false
点行头内的真控件（closest 命中别的节点）   详情 0 → 0   aria-expanded=false   ← 守卫仍有效，不误触
展开后 行内按钮 = ["重跑","续接","关闭"]
```

### 24.4 同类隐患全量扫描（结论：只有行头这一处中招）

| 位置 | 带 `role="button"`？ | 有 `isInteractive` 守卫？ | 是否中陷阱 |
|---|---|---|---|
| `zcd-job-head` 进程行头 | 是（ZB-12 新加） | 是 | **是 → 已修** |
| `zcd-sec-head` 分区头 | 是（Z11 既有） | **否**（裸 `onClick: toggle`） | 否（注释里本就有"head 内不放 button"的纪律） |
| `zcd-titlebar` 标题栏（拖拽） | 否 | 是（`startDrag`） | 否 |

> 顺带说明：探针第一版还把"点真控件"的负向用例写错了 —— `closest` 返回 `null`（＝"没有可交互祖先"）
> 而不是另一个节点，于是负向用例也走成了正向。已改为返回独立节点对象后复跑通过。
> 这是本轮第六次探针自身缺陷，同样是"验证工具本身没被验证"。

### 24.5 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 24.6 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 25. ZB-14：通道/模型改成固定两行表单（用户报告「随窗口尺寸乱跑」）

### 25.1 根因：4 个元素挤在一个 `flex-wrap` 行里

```js
h('div', { className: 'zcd-row' },        // .zcd-row{display:flex;…;flex-wrap:wrap;}
  span 通道 · select provider · span 模型 · select model)
```

- `flex-wrap:wrap` ⇒ 面板一变窄就**换行**，换行点随宽度漂移；
- 两个 `select` 没有 `flex` 声明 ⇒ 宽度各随**选项文字**变化 ⇒ 版式在不同宽度下不成一体。
两者叠加就是用户看到的"乱跑"。

### 25.2 修复：固定两行，标签定自然宽、下拉等宽撑满

```js
h('div', { className: 'zcd-field' }, span(通道) , select(.zcd-field-v)),
h('div', { className: 'zcd-field' }, span(模型) , select(.zcd-field-v)),
```
```css
'.zcd-field{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;}',   /* 明确不换行 */
'.zcd-field-k{flex:none;white-space:nowrap;color:…;}',                     /* 标签取自然宽 */
'.zcd-field-v{flex:1 1 auto;min-width:0;}',                                /* 下拉等宽撑满 */
```

`min-width:0` 是必需的：`select` 默认不会缩到内容宽以下，缺了它会把行撑破、又把"乱跑"带回来。
两个下拉同为 `flex:1` 且两行结构相同 ⇒ **任意面板宽度下都等宽、位置固定**。

### 25.3 真实验证（真实组件树，探针内先展开「通道」分区）

```
=== 通道分区结构 ===
  zcd-field 行数 = 2   (期望 2：通道一行、模型一行)
  第1行: 直接子元素=2  标签="通道"(zcd-field-k)  下拉 class="zcd-select zcd-field-v"  选中值="plan"
  第2行: 直接子元素=2  标签="模型"(zcd-field-k)  下拉 class="zcd-select zcd-field-v"  选中值="GLM-5.3-Flash"
  旧的合并写法残留（一行 4 元素）= 无
=== 关键 CSS 是否就位 ===
  <style> 节点数=1  CSS 文本长度=11457
  .zcd-field 不换行: OK
  .zcd-field-v 撑满: OK
  .zcd-field-k nowrap: OK
```

> 诚实标注：该探针首轮把三项 CSS 全报成"缺失"，原因是**我的探针按 `className` 去找 `<style>` 节点**
> —— 而 `<style>` 根本没有 `className`，于是永远找不到、`cssText` 为空 ⇒ 全判缺失。
> 改成按 `type === 'style'` 查后全部 OK。这是本轮第七次探针自身缺陷（同 §24.4 的教训：
> **假 DOM 的查询方式也必须与真实 DOM 语义一致**）。

### 25.4 未改动的部分（如实登记）

- 「自动降级链」那一行仍是 `zcd-row`（可换行）：它由 标签 + 状态徽章 + 若干链徽章组成，
  数量不定、换行反而更合适，用户也未提。
- 链输入行（输入框 + 按钮）同样保持 `zcd-row`。

### 25.5 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 25.6 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 26. ZB-15：全面板间距统一放宽（用户报告「行间距太挤」+「整个面板都检查下」）

### 26.1 做法：按层次定一套节奏，逐项对齐（不是零散补丁）

| 层次 | 项 | 旧 → 新 |
|---|---|---|
| **全局** | `.zcd-root` line-height | 1.5 → **1.6** |
| 面板骨架 | `.zcd-body` gap / padding | 8 / 8 → **10 / 10** |
| | `.zcd-titlebar` gap / padding | 6 / `6px 8px` → **8 / `7px 10px`** |
| | `.zcd-conn`（徽标） line-height / padding | 1.6 / `0 6px` → **1.7 / `1px 7px`** |
| 分区 | `.zcd-sec` gap / padding | 6 / 8 → **9 / 10** |
| | `.zcd-sec-head` min-height / gap | 18 / 6 → **22 / 8** |
| 表单行 | `.zcd-row` / `.zcd-field` gap | 6 → **8** |
| | `.zcd-select/.zcd-input/.zcd-ta` padding | `3px 6px` → **`5px 8px`** |
| | `.zcd-ta` min-height | 52 → **60** |
| 按钮 | `.zcd-btn` padding | `4px 14px` → **`6px 16px`** |
| | `.zcd-btn2` padding | `3px 10px` → **`4px 12px`** |
| 进程区 | `.zcd-jobs` / `.zcd-group` / `.zcd-group-body` gap | 6 → **8** |
| | `.zcd-tabs` gap / `.zcd-tab` padding | 4 / `1px 8px` → **6 / `3px 10px`** |
| | `.zcd-job` padding | `4px 6px` → **`7px 9px`** |
| | `.zcd-job-head` gap / min-height | 6 / 20 → **8 / 24** |
| | `.zcd-badge` padding / line-height | `0 4px` / 1.5 → **`1px 5px` / 1.6** |
| 详情 | `.zcd-detail` gap / margin-top | 3 / 2 → **5 / 6** |
| | `.zcd-tailwrap` margin-top | 4 → **6** |
| | `.zcd-mono` padding / line-height / max-height | 4 / — / 140 → **6 / 1.55 / 160** |
| | `.zcd-kv` gap + line-height | 6 / — → **8 / 1.55** |
| 用量卡 | `.zcd-cards` gap / `.zcd-card` gap,padding | 6 / 2,6 → **8 / 4,8** |
| 文本 | `.zcd-note` / `.zcd-planline` line-height | — / 1.45 → **1.6 / 1.55** |
| 行内 | 动作区/续接/暂停/交接/详情小标题 `marginTop` | 4 → **6** |
| | 降级链标题行 `marginTop`、分组头、planline `margin-top` | 2 → **4** |

**未改动**：`.zcd-panel` 的 `max-height:min(72vh,560px)` —— 那是"默认最大可视高度"，
与间距正交；面板高度本身可拖拽且持久化（ZB-06），需要更多可视区直接拖高即可，故不擅自改默认值。

零字面色值纪律未破（新增值全是数字/关键字），verify-plugin 第 26 项照旧 PASS。

### 26.2 验证

对落盘后的 CSS 文本逐项断言（10/10 全部命中）：

```
OK  zcd-select,input,ta padding  (padding:5px 8px)      OK  zcd-tab padding   (padding:3px 10px)
OK  zcd-job padding              (padding:7px 9px)      OK  zcd-btn padding   (padding:6px 16px)
OK  zcd-badge padding            (padding:1px 5px)      OK  zcd-btn2 padding  (padding:4px 12px)
OK  zcd-card padding             (padding:8px)          OK  sec gap           (gap:9px;padding:10px)
OK  zcd-kv gap                   (gap:8px;…)            OK  group-head mt     (margin-top:4px)
line-height:1.6 出现 4 处
```

### 26.3 过程中的一次失败（如实登记）

先用 `node -e "...多行脚本..."` 批量替换，被 **PowerShell 的引号/换行解析**吃掉，
脚本根本没执行（文件未变、也无报错），差点误以为已改。已改用 `edit` 工具逐项替换 ——
**可观测、可回滚、且每次替换都有明确回执**。教训：在本机 shell（Windows PowerShell 5.1）里，
多行 `node -e` 不可靠，批量文本改写一律走带回报的编辑工具。

### 26.4 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 26.5 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 27. ZB-16：修「分区内元素贴在一起」—— 根因是**裸根容器**，不是间距数值

用户报告（附截图）：通道板块里两个下拉框挨在一起、下面的「新任务将使用」也贴得近。

### 27.1 根因：`.zcd-sec` 的 gap 管不到分区**内部**

```js
function ChannelSection(...) {
  return h('div', null,                 // ← 没有 class、没有 gap 的裸 div
    h('div', { className: 'zcd-field' }, …),   // 通道
    h('div', { className: 'zcd-field' }, …),   // 模型
    h('div', { className: 'zcd-note' }, …),    // 新任务将使用
    …);
}
```

`.zcd-sec{display:flex;flex-direction:column;gap:9px}` 的 gap 只作用于它的**直接子元素**，
而它只有一个子元素 = 这个裸 div；裸 div 内部**没有任何间距规则** ⇒ 各块只能靠自身行高挤在一起。
ZB-15 调的是 `.zcd-sec` 的 gap，**对这一层完全无效** —— 所以那一轮没解决这里。

**全量排查**（同一类问题不止一处）：

| 组件 | 内容根 | 问题 |
|---|---|---|
| `ChannelSection` | `h('div', null, …)` | **裸根** → 无间距（用户报告处） |
| `QuotaCards` | `h('div', null, …)` | **裸根** → 无间距 |
| `DispatchBar` | `.zcd-dispatch` | 有 class，但**该 CSS 规则根本不存在** → 无间距 |
| `JobList` | `.zcd-jobs` | 已有 gap:8 ✅ |
| `JobRow` | `.zcd-job` | 有 class 但**无 display/gap** → 头与反馈行贴着（靠各处 `marginTop` 手工补） |
| `LockStatus` | `.zcd-row` | 横向单行，gap:8 ✅ 设计如此 |

### 27.2 修复：统一走「stack 容器」，间距由容器负责

```css
'.zcd-stack{display:flex;flex-direction:column;gap:10px;min-width:0;}',      /* 分区内容根 */
'.zcd-dispatch{display:flex;flex-direction:column;gap:10px;min-width:0;}',   /* DispatchBar 有了规则 */
'.zcd-job{display:flex;flex-direction:column;gap:8px; …}',                    /* JobRow 行内节奏 */
'.zcd-tailwrap{margin-top:0;}',                                              /* 交给父容器 gap */
```
JSX：`ChannelSection` 与 `QuotaCards` 的根 `null` → `'zcd-stack'`；
并**移除 4 处动作行的内联 `marginTop:6`** 与降级链标题行的 `marginTop:4`（否则与容器 gap 叠加成 14–16px）。

原则：**间距属于容器，不再由每个块自带 margin 拼**——这也是上一轮"调了 gap 却没生效"的根因。

### 27.3 真实验证（真实组件树）

```
=== 每个分区的「内容根」是否带 gap 容器 ===
  [通道]   内容根 class = "zcd-stack"        ← 修复点
  [派发]   内容根 class = "zcd-dispatch"     ← 修复点（此前连规则都没有）
  [进程]   内容根 class = "zcd-jobs"
  [用量]   内容根 class = "zcd-stack"        ← 修复点
  [单写者] 内容根 class = "zcd-row"          （横向单行，设计如此）

=== 关键 CSS ===
  .zcd-stack 纵向 gap 容器: OK      .zcd-dispatch 有规则了: OK
  .zcd-job 列方向 + gap: OK         .zcd-tailwrap margin-top 归零: OK

=== 通道分区直接子元素（应各由 10px gap 隔开，无内联 marginTop） ===
  <div> class="zcd-field"  inline marginTop=(无)
  <div> class="zcd-field"  inline marginTop=(无)
  <div> class="zcd-note"   inline marginTop=(无)
  <div> class="zcd-row"    inline marginTop=(无)
  <div> class="zcd-row"    inline marginTop=(无)
```

另：全文件 `grep "return h('div', null"` → **0 命中**（裸根容器已清零）。

### 27.4 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 27.5 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 28. ZB-17：派发输入框宽度超出右边界 —— 缺 `box-sizing`（用户报告「同理」）

### 28.1 根因：全文件**没有任何 `box-sizing` 规则**，而 `.zcd-ta` 是 `width:100%`

```css
/* 第 160 行（共享） */ '.zcd-select,.zcd-input,.zcd-ta{…border:1px solid …;padding:5px 8px;…}',
/* 第 162 行        */ '.zcd-ta{width:100%;min-height:60px;resize:vertical;}',
```

CSS 默认 `box-sizing:content-box` ⇒ `width:100%` **不含** padding 与 border，于是
实际占位 = 容器宽 + 8 + 8 + 1 + 1 = **容器宽 + 18px** ⇒ 必然冲出右边界。

精确扫描（全文件）：**唯一的 `width:100%` 就是 `.zcd-ta`**（第 162 行），
其唯一调用点是第 1512 行的 `<textarea className="zcd-ta">` ⇒ 与用户截图逐字吻合。

### 28.2 修复：面板子树统一 `border-box`（作用域限定，不碰宿主）

```css
'.zcd-root,.zcd-root *{box-sizing:border-box;}',
```

- 作用域严格限定在 `.zcd-root` **之内**：不碰宿主 shell、不碰应用其他区域；
- 全文件 `box-sizing` 仅此一处（另一处是注释）；
- 一举消除同类隐患：所有带 padding 的 `select/input/card/badge` 都从此按"含边框"计算宽度；
- 已复查受影响元素：`.zcd-iconbtn(20×20,padding:0,border:none)`、`.zcd-grip(16×16)`、`.zcd-dot(8×8)`
  均无 padding/border ⇒ **尺寸不变**；`.zcd-ta` 由"100%+18px"变为"正好 100%" ⇒ 溢出消失。

### 28.3 验证边界（如实说明）

本机 harness **没有浏览器布局引擎**，我**无法实测像素**。可验证的是：

```
node --check client.js                       → OK
box-sizing 全文件出现 1 处真规则（另一处是注释）
唯一 width:100% 声明 = .zcd-ta（第 162 行）；唯一 textarea 调用 = 第 1512 行 class="zcd-ta"
verify-plugin 20/20（含"无字面色值"纪律项）
```

⇒ 修复依据是 **CSS 语义算术**（content-box 的 100%+padding+border vs border-box 的 100%），
**不是**我在浏览器里量到的 —— 最终以你刷新后的目视为准。

### 28.4 门禁（全绿）

`node --check` 7 文件全 OK；verify-plugin **20/20**；verify-switch **8/8**；core **12/12**；channel-retry **9/9**。

### 28.5 生效条件

只改 `client.js` ⇒ **刷新页面即可**。

---

## 29. ZB-02：修「新会话让它派发 zcode，却走了 DSH 后台」+ 公开仓库整备

用户报告：**在新会话里说「派发 zcode」，任务跑去了 DSH 自带后台，没进 ZCode 派发台。**
用户随后明确策略：**能用派发台时优先用派发台；不可用才用自带子代理。**

### 29.1 根因：工具描述把模型带偏了（不是代码 bug，是**提示词契约 bug**）

用 `cordis_inspect_query` 的 `Tool.listTools` 取到**模型眼中的描述原文**：

```
操作「ZCode 派发台」：把任务派发给 ZCode 子代理（当前：已开启）。action=status 查开关状态；
action=switch 切换 enabled=true|false；action=dispatch 派发（关闭时会被拒绝）。…
```

两处硬伤：

1. **首行把动作重心给了 `status`/`switch`** —— 读起来像"状态管理工具"，不像"派发入口"；
2. **「子代理」是撞车词** —— DSH 自带 `subagent` 的自述是
   *"Delegate a self-contained task to a subagent"*。模型看到「派发 / 子代理」，
   顺手调了 `subagent`，任务于是跑在 DSH 后台，**不产生派发台 job、也不受派发总开关约束**。

### 29.2 修复：把「优先级策略」写进描述首段

```js
'【派发优先级：能用派发台就优先用派发台】凡是「把任务交给一个 agent 去做」的诉求——用户说
 「派发给 ZCode / 让 ZCode 做 / 用 ZCode 跑 / zcode 派发 / 在派发台派一个」，或只是笼统地说
 「派发这个任务」——**先**用本工具的 action=dispatch：它才会在「ZCode 派发台」面板里生成
 可监视的 job（独立 ZCode 进程、独立额度与会话，可查输出/终止/续跑/换通道）。',
'✅ **仅当派发台不可用时**才退回 DSH 自带的 subagent / spawn_teammate / subagent_fork / 后台 jobs：
 即 action=status 显示开关已关闭、dispatch 返回 ok:false（未配置 runner/workRoot、锁冲突等），
 或用户明确要求「你自己（DSH）去做」。此时要**说明为什么没用派发台**，不要静默切换。',
`当前派发总开关：${state}（实时状态用 action=status）。…`,
```

要点：① 触发条件从"用户点名 ZCode"放宽到**一切"把任务交给 agent 去做"的诉求**（含笼统的"派发这个任务"）；
② 明确**优先级**（能用就用）而非只说"必须用"；③ 给出**可判定的降级条件**（`status` 关闭 / `dispatch` 返回
`ok:false` / 用户点名要 DSH 自己做）；④ 要求降级时**说明原因**，不静默切换。
「子代理」全部换成「ZCode 无头进程」；开关状态挪到第三行（不再是首行主角）。

> **为什么改描述就够**：模型选工具的唯一依据就是这段文字，而它随插件注册进**每一个会话**，
> 与工作目录无关——比在某个项目的 `AGENTS.md` 里写约定更可靠（那种只在那个目录生效）。
> 描述属 Host 半边 ⇒ **需要重启 DSH 才生效**。

### 29.3 公开仓库整备（三件事）

**① 根 `README.md`（新增）** —— 项目定位、能力表、目录结构、安装、配置、agent 工具、面板、
复跑证据、第三方材料声明、许可现状。

**② 机器专有路径移出公开仓库**

原先 `zcode-dispatch/cordis.patch.yml` 直接写着宿主项目的绝对路径（runner/ledger/switch），
这是**部署配置**，不该进公开仓库：

- 仓库内 `cordis.patch.yml` 只留 `demo` / `maxConcurrent` + 注释说明覆盖方式；
- 真值路径写进 **`~/.dsh/profiles/desktop/cordis.patch.yml`**（profile patch 层，仓库外）；
- 代码硬编码兜底一并清掉，改为「参数 → 环境变量 → 空」：
  - `wire.host.mjs`：`DEFAULT_SWITCH_PATH = ''`；`writeSwitch` 遇空路径**明确报错**而非猜位置
    （`readSwitch('')` 仍按"无文件=开启"降级，不误锁）；
  - `bin/zcd.mjs`：`runner`/`ledger` 默认空，缺则报错退出（`--runner` / `ZCD_RUNNER` 可用）；
  - `tools/bridge.mjs`：`ZCD_SWITCH_FILE` 未设时按"无文件=开启"放行并提示该事实；
  - `test/z2-verify.mjs`：改 `Z2_HOST_REPO`，未设则第 8 节 **SKIP 并如实标注**（不伪装通过）。

> profile patch 按 id 覆盖是 DSH 标准机制——同一文件里 `ui-theme` / `ui-chat` 等条目正是这样
> 覆盖 bundle 内置条目的，本机既有先例。

**③ 清除宿主项目名（用户要求）**

机械替换 36 个 md 文件 88 处 + 代码注释 1 处，**全仓该字样出现次数 = 0**
（本节原文里残留的那一处，已在 §30 的历史重写中一并替换）：

| 原 | 现 |
|---|---|
| `F:\My Code\<项目>` 等 4 种写法 | `<HOST_REPO>` |
| `<项目> 仓库` | `宿主仓库` |
| `<项目> 侧` | `宿主侧` |
| 其余 `<项目>` | `宿主项目` |

> 代价如实说明：`tasks/` 是开发留档，替换后**损失了原文里的具体项目名**（路径变占位符）。
> 替换规则有序（先长后短），已抽查 `Z12-01-task.md` / 本文档可读性正常。

### 29.4 门禁（全绿）

`node --check` **12 文件**零失败；verify-plugin **20/20**；verify-switch **8/8**；
core **12/12**；channel-retry **9/9**；quota-rpc **16/16**。

### 29.5 ⚠️ 生效条件（这轮**不只要刷新页面**）

| 改动 | 生效方式 | 不重启的后果 |
|---|---|---|
| `index.js`（工具描述） | **完全退出 DSH 再启动** | 新会话看到的仍是旧描述，原问题依旧 |
| `cordis.patch.yml` + profile patch（路径搬家） | **完全退出 DSH 再启动** | 仍用旧配置，派发照常 |
| README / tasks 文档 | 无 | —— |

**重启后按序验证这三条**（能证明"路径搬家没把功能搬坏 + 描述已更新"）：

1. host `Config.listConfigs{name:'@local/zcode-dispatch'}` → `runnerPath`/`workRoot`/`switchPath`
   应为**非空**（证明 profile patch 覆盖生效）；
2. host `Tool.listTools` → `zcode_dispatch` 描述首段应为「【派发优先级：能用派发台就优先用派发台】…」；
3. `zcode_dispatch{action:'status'}` 返回真实开关状态，而非 `default(未配置)`。

> 若第 1 条为空 ⇒ profile patch 的 override 未命中：把 `- id: zcode-dispatch`（含 `name`）那段
> 补进 profile patch 即可。插件会退化为"不创建 dispatcher"而**不会崩**（刻意设计）。

---

## 30. ZB-03：清除**历史提交**里的宿主项目名（历史重写）

用户问：能否删掉此前提交里带宿主项目名的内容？不行的话是否删库重建？

**结论：不必删库 —— 重写本地历史后强推即可**（仓库刚建、无 fork、仅本人在推）。

### 30.1 规模（重写前实测）

| 项 | 值 |
|---|---|
| 提交总数 | 19 |
| 含该字样的提交 | **10**（`git log -S` pickaxe 精确列出） |
| 全历史 diff 命中行 | **231** |

> 关键认识：§29 那次只清洗了**工作区**——旧提交的树里仍原样保留该字样，
> 任何人 `git log -p` 都能翻出来。要真正抹掉必须**重写历史**。

### 30.2 第一次尝试失败：`--tree-filter` 撞上 Windows 文件锁

```
error: unable to unlink old '.gitignore': Invalid argument
Could not checkout the index
rm: cannot remove 'F:/My Code/dsh-plugins/.git-rewrite/t/.gitignore': Device or resource busy
```

- 在**第 14/19 个提交**才失败 ⇒ 不是系统性问题，是实时扫描/监视对临时检出目录的**瞬时占用**；
- `--tree-filter` 要为每个提交把整棵树检出到磁盘（上千次创建/删除），正好踩这个坑；
- **失败是干净回滚**（已实测确认）：历史 SHA 未变、无 `refs/original` 残留、工作区仅多出 `?? .git-rewrite/`，
  历史命中数仍是 231 ⇒ **零损伤**。

**改用 `--index-filter`**：只改写索引里的 blob，**全程不落盘**，从根上绕开该类锁。
脚本见 `%TEMP%/zcd-idx-filter.mjs`（一次性，用完即删）：读 `git ls-files -s -z`
→ 对文本类 blob 做与 §29 **完全相同的替换规则** → `git hash-object -w` + `update-index --cacheinfo`。

```powershell
git filter-branch --force --index-filter 'node "…/zcd-idx-filter.mjs"' -- --all
```

### 30.3 重写结果与自检

| 自检项 | 结果 |
|---|---|
| 提交数保持 19 | ✅（`--all` 会计到 38，因 `refs/remotes/origin/main` 仍指向重写前 tip——刻意保留作远端真实值依据与回滚点） |
| **main 全历史命中** | **0**（重写前 231）✅ |
| **逐提交树检查**（19 个逐个 `git grep`） | **全部干净** ✅ |
| 末次树 vs 重写前 | 差 1 文件 1 行 —— **正是修掉了我自己的疏漏**（§29.3 那句「…该字样出现次数 = 0」本身含该字样，随上次提交推上去了） |

**回滚保险**：重写前用 `git bundle create` 留了全量备份（`%TEMP%/dsh-plugins-pre-rewrite.bundle`，594.6 KB），
还原方式 `git clone <bundle> <目标目录>`。

事后清理：删除 `refs/original/*` 备用 ref → `reflog expire --expire-unreachable=now --all` → `gc --prune=now`。

### 30.4 强推

重构后本地 `main` 已是一段新历史，与远端不共享祖先 ⇒ 需强推：

```powershell
git push --force-with-lease=main:1efaa4b0d96f2ce0d2775afd75c2fe960d6a8632 origin main
```

> 用 `--force-with-lease=<ref>:<期望值>` 显式给出**重写前远端 tip**：这样若远端在此期间被别人
> 推过，推送会被拒绝而不是覆盖掉别人的提交。

### 30.5 残留与边界（如实标注）

- 强推后 GitHub 上旧提交**会在短期内仍可通过直接 SHA 访问**（服务端对象延迟回收）。
  本项目被清理的是**项目名**、非凭据/密钥，风险等级低；
  若要求**零残留**，最彻底的做法是**删库重建**（用户已授权该选项），但那会一并丢失 19 条提交历史。
- 本次选择**重写 + 强推**：达到"公开可见的历史里没有该字样"，同时保住提交历史与 `tasks/` 留档。
