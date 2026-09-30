---
round: Z7
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T13:05:00+08:00
task: Z7-01-task.md
---

# Z7 交付：`wire.*` 接成真实通道（静态证据驱动）

## 一、改动清单

| 文件 | 改动 | 约束核对 |
|---|---|---|
| `zcode-dispatch/wire.host.mjs` | 全量重写：新增 `createRemoteFace()`（任务包 §二.1 的方法面）、`TYPERT` 宿主 face 描述符（纯数据）、常量 `FACE_NAME='zcodeDispatch'` / `EVENT_NAME='zcode-dispatch/changed'`；`attachHostWire()` 返回对象新增 `face` 字段。既有导出 `TAIL_DEFAULT_LINES` / `slimJob` / `quotaWindows` / `createActionHandler` / `attachHostWire`（含 `handleAction`/`subscribe`/`getSnapshot`/`dispose`）语义与签名**逐字未动** | index.js 消费面零变化（本地探针 §6 全过） |
| `zcode-dispatch/wire.client.mjs` | 全量重写：新增远端面传输层（`ctx.remote.zcodeDispatch` 探测 + 官方 `{ok,value}` 信封归一化 + 1s 轮询 + `ctx.remote.$on` 推送抢答）、`TYPERT_REMOTE` 客户端描述符（纯数据 + default 导出）、与宿主 face 同名的 `setChannel` / `setFallbackChain` / `snapshot` 等对齐方法；demo 引擎 / ext 数据源 / `config.demo` 优先级 / 旧接口信封**逐字保留**（demo/ext 分支仅把内联实现提成 `legacyChannelSet`/`legacyFallbackSet` 供别名共用，行为不变） | 本地探针 §5（demo/ext 路径）全过 |
| `zcode-dispatch/package.json` | `exports` 新增 `"./typert": "./wire.host.mjs"`、`"./remote": "./wire.client.mjs"`（对齐官方 manifest 字段） | 其余字段（`name/version/private/type`、`dsh.bundle.patch`、`dsh.client`、`meta`、`icon`、`files`）逐字未动，`JSON.parse` 通过 |
| `pitfalls.md` | 登记 Z7 四条（写时自纠，非带病上线） | — |

未动：`client.js`（组件树/样式/文案/内嵌 wire 全部原样）、`core/*`、`index.js`、`cordis.patch.yml`、locale、icon、README、refs。无 npm 依赖、无 `$DSH_HOME` 写入（DSH 探针越界项 PASS）、无 git 操作。

## 二、确定下来的 Remote 形态（证据 → 落地）

### 2.1 官方形态证据（refs/dsh-plugin-manager/）

| 证据点 | 出处 |
|---|---|
| 自定义远端面的宿主半边 = service 类，继承协议基类，方法带 `Remote` 装饰器，构造 `super(ctx, "<服务名>")` | `lib/index.js:3`（`import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"`）、`:45`（`class … extends TypertRemoteService`）、`:51`（`_fastest_decorators = [Remote]`）、`:80`（`super(ctx, "pluginRegistryProbe")`） |
| 描述符是**纯数据**，经 manifest 的 `exports["./typert"]`（宿主 `TYPERT`）与 `exports["./remote"]`（客户端 `TYPERT_REMOTE`）声明 | `lib/typert.host.js`（`face:'host'` + `invocations[]` + `model.services[]`）、`lib/typert.remote-client.js`（`descriptors[]` + default 导出）、`package.json:27-34` |
| 客户端调用：inject 声明 `"remote"` 与 `"remote.<服务名>"`，然后 `ctx.remote.<服务名>.<方法>()` | `lib/client.js:3661-3664`（inject 数组）、`:1130`（`await this.ctx.remote.pluginRegistryProbe.fastest()`） |
| 返回值信封 `{ ok:true, value }` / `{ ok:false, error:{message} }` | `lib/client.js:1051`（`result.ok && result.value.application`）、`:1120`（`answer.ok`）、`:1403-1407`（`result.error.message`） |
| 宿主→客户端**支持推送**：`ctx.remote.$on("<区域>/<事件>", cb)`，事件命名 `<区域>/changed` | `lib/client.js:3688-3692`（`plugin-manager/changed`、`install-log`、`install-state`） |
| 「一个操作两个调用方」「UI 动作经 Client 可调的 Host 入口」 | `refs/references/user-actions.md:7-9`；`refs/references/practices.md:1`（一切以 cordis_inspect_query 为准） |

### 2.2 本包落地形态

**宿主半边（wire.host.mjs）**——方法面严格按任务包 §二.1，全部 JSON 可序列化；动作实现在 `createActionHandler` 单点复用（agent 工具与 face 同一入口）：

```js
export function createRemoteFace(dispatcher, config = {}) {   // wire.host.mjs:219 起
  return {
    async snapshot() {                    // → 快照对象 + channels（listChannels 5s 缓存，任务包规定）
      const snap = dispatcher.snapshot();
      const { channels } = await channelsCached();
      return { ...snap, jobs: snap.jobs.map(slimJob), channels };   // jobs 裁剪：capture 路径不出网
    },
    dispatch: (spec = {}) => viaAction('dispatch', …),  // → {ok:true, job}|{ok:false, error}
    kill: (id) => viaAction('kill', { id }),            // → {ok:true, job}|{ok:false, error}
    retry: (id, opts) => viaAction('retry', { id, …opts }),
    async tail(id, n) { … return r.lines; }             // → string[]；找不到 job reject Error（官方远端方法同形）
    async setChannel(next) { … },                       // → {ok:true, channel}|{ok:false, error}
    async setFallbackChain(list = null) { dispatcher.setFallbackChain(list == null ? [] : list); … },
                                  // ↑ null=清空，直调 core：createActionHandler 的 fallback 动作
                                  //   对 null chain 会 String(null).split(',') 拆成 ["null"]，见 §五
    /* 任务包面之外按「至少」原则补的读数方法：quota()/quotaPlan()/channels()/channel()/fallbackChain() */
  };
}
```

宿主 face 模型描述符（纯数据，对齐官方产物字段；差异：无 zod，`result.mode:'json'` + `generator` 注记）：

```js
export const TYPERT = { package: '@local/zcode-dispatch', face: 'host', service: FACE_NAME,
  invocations: [ { id: '@local/zcode-dispatch#zcodeDispatch/snapshot', service: 'zcodeDispatch',
    namespace: 'zcodeDispatch', method: 'snapshot', invocation: { kind: 'direct' },
    parameters: [], result: { mode: 'json', note: '…' } }, /* …共 12 个 */ ],
  model: { services: [{ key: 'zcodeDispatch', exportName: 'createRemoteFace', members: […] }],
           events: [{ name: 'zcode-dispatch/changed', … }], objects: [] } };   // wire.host.mjs:263 起
```

`attachHostWire()` 返回值新增 `face`（wire.host.mjs:325 起），index.js 的 `apply()` 现返回 `{ dispatcher, wire: {…, face}, handleAction }`——既有字段无一变动。

**客户端半边（wire.client.mjs）**——传输层按官方调用形状实现，数据源优先级：`config.demo===true`（强制演示）→ **remote** → ext（`window.__zcodeDispatchDemo`）→ 内置 demo：

```js
function resolveRemote(ctx) {                                  // wire.client.mjs:139 起
  const svc = ctx?.remote?.[FACE_NAME] ?? ctx?.remote?.['zcode-dispatch'];
  if (!svc || typeof svc.snapshot !== 'function') return null;
  const call = async (method, ...args) => {
    const raw = await svc[method](...args);
    // 官方代理信封 {ok, value}|{ok:false, error:{message}} → 拆包；本进程域形状 → 原样透传
    if (raw && typeof raw === 'object' && typeof raw.ok === 'boolean' && 'value' in raw)
      return raw.ok ? raw.value : { ok: false, error: raw.error?.message ?? String(raw.error) };
    return raw;
  };
  return { call };
}
```

`subscribe(cb)`（remote 分支，wire.client.mjs:196 起）：**1s 轮询 `snapshot()`+`quota()` 为正确性兜底**（任务包「简单优先」；宿主 emit 入口未经 inspection 证实，故不做纯推送）；`ctx.remote.$on` 可用时同时订阅 `zcode-dispatch/changed` 抢答即时刷新（官方 `$on` 形状，client.js:3688 证据）；`planQuota` 每次 wire 生命周期取一次（慢 RPC ≈2s，不进秒级轮询）。退订/`dispose()` 统一清 interval + `$on` 退订。远端抖动发 `{conn:'remote', snapshot:null, error}` 空态包，**绝不抛出、绝不白屏**。

客户端描述符 `TYPERT_REMOTE`（12 条 descriptors，与 `TYPERT.invocations` 一一对应，运行时冒烟已断言）+ `export default TYPERT_REMOTE`（对齐官方 remote-client 产物）。

### 2.3 为什么宿主半边不是 service 类（约束冲突，非偏好）

官方宿主形态要求 `import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"`。本任务包硬约束「不 npm 依赖」，而 profile 安装目录的 `node_modules` 只含 profile 安装的 bundles（SKILL.md），该包在安装产物里无法解析；官方技能亦禁止把宿主客户端包当模块加载（practices.md:35）。故宿主半边落成「纯 JS face 对象 + 纯数据描述符」——face 的方法名/参数/返回与官方调用形状完全兼容，**差的是最后一跳：把 face 注册进宿主远端表**（见 §五.1）。

## 三、复现命令 + 原始输出

### 3.1 语法检查（任务包 §四.1）

```
$ cd "F:\My Code\dsh-plugins\zcode-dispatch"
$ node --check wire.host.mjs && node --check wire.client.mjs && node --check client.js && node --check index.js
OK wire.host
OK wire.client
OK client
OK index
```

### 3.2 DSH 侧探针（任务包 §四.2，要求 18/18）

```
$ node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,...}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config
PASS  纪律: 不 import DSH 客户端包  no @deepseek-ai/dsh-client
PASS  纪律: 不操作 document.body  no document.body
PASS  纪律: client.js 无字面色值（仅主题令牌）  none
PASS  纪律: client.js 不用 JSX/模块 import  createElement 次数=2
PASS  纪律: 使用 --dsw-alias-* 主题令牌  令牌引用 41 处，去重 22 个
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  index.js 引用 core dispatcher  imports core
PASS  client.js 通过 __ModuleLoader__.load 注册  id=@local/zcode-dispatch
PASS  factory 只 require react  react only
PASS  factory 返回 {inject, apply}  inject=["slots"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=div
PASS  越界: $DSH_HOME profile 近 1h 无写入  clean

[DSH Z2 探针] 18 项，失败 0 项
```

### 3.3 既有测试（任务包 §四.3）

```
$ node test/core.test.mjs          → ℹ tests 11  ℹ pass 11  ℹ fail 0
$ node test/channel-retry.test.mjs → ℹ tests 8   ℹ pass 8   ℹ fail 0
$ node test/quota-rpc.test.mjs     → ℹ tests 16  ℹ pass 16  ℹ fail 0   （任务包未要求，一并回归）
$ node test/z2-verify.mjs          → ===== 结果：75 PASS / 0 FAIL =====   （同上）
```

### 3.4 package.json 校验（任务包 §四.4）

```
$ node -e "const p=JSON.parse(...); console.log(...)"
JSON.parse OK
exports keys: . ./client ./package.json ./locale/*.json ./typert ./remote
fields: name version private type exports dsh meta icon files
files: index.js client.js core locale icon.svg README.md wire.host.mjs wire.client.mjs
dsh: {"bundle":{"patch":"./cordis.patch.yml"},"client":{"platform":"web","immediately":true,"inject":["@deepseek-ai/dsh-client-ui-conversation"]}}
```

任务包字段逐条核对：`dsh.bundle.patch` ✓、`dsh.client` ✓、`exports`（原 4 键全在 + 新增 2 键）✓、`meta` ✓、`icon` ✓、`files` ✓（wire 文件在列）。

### 3.5 新增路径运行时冒烟（按规范放 test/ 跑完即删，38/38）

`test/z7-wire-smoke.mjs`（已删）用假 runner + 真 dispatcher 端到端验证，要点输出：

```
PASS  face.snapshot 基础形状 / 内嵌 channels / jobs 已 slim / JSON 可序列化
PASS  face.dispatch → {ok, job}  j-munl8x49-0-f14c
PASS  face.tail → string[]；未知 id → reject Error
PASS  face.setChannel → {ok, channel}；face.channel 读回一致
PASS  face.setFallbackChain(list) → enabled；face.setFallbackChain(null) → 清空
PASS  face.quota → {quota}；face.quotaPlan → {planQuota} 适配器形状
PASS  TYPERT 描述符（12 个 invocation）；TYPERT_REMOTE 一一对应；default 导出
PASS  remote subscribe 首包 conn=remote 且带 snapshot；首包带 planQuota
PASS  remote dispatch/tail（UI 信封）；setChannel/setFallbackChain 别名；fallbackGet/channelGet 旧信封保持
PASS  $on 推送触发即时刷新；1s 轮询兜底在跑；退订后停止轮询
PASS  远端抖动 → 空快照包+error（不抛出、不白屏）；动作异常 → {ok:false, error}
PASS  config.demo=true 压过 remote；无 remote 无 ext → 内置 demo（3 进程）；demo 分支别名可用
PASS  attachHostWire 返回 {handleAction, subscribe, getSnapshot, dispose, face}；不自行注册 effect
```

## 四、Review / 强制性优化 / Simplify（自检记录）

- **Review 问题清单（闭环）**：① 初稿 `TYPERT` 引用后置 `const` 表 → TDZ，已前置（import 即炸级）；② remote 分支对象字面量别名方法按名引用同字面量方法 → 调用期 ReferenceError，已改局部函数共用；③ ext 分支重排时丢 `let pollTimer` 声明（ESM strict 直接炸）→ 已补；④ demo 分支残留死变量 `pollTimer` → 已删。四处均为写时自纠，冒烟+双探针复跑确认。
- **强制性优化**：性能——channels 5s 缓存（任务包规定）、quota 每 tick 一次、quotaPlan 每 wire 生命周期一次（避免秒级起 2s RPC 子进程）、推送节流保留；安全——`slimJob` 保证 captureOut/captureErr 本进程路径不出网、face 参数面收窄（setChannel 必带 provider、setFallbackChain null→[]）、零新依赖零 eval；健壮性——远端抖动空态包不抛出、信封双形状归一化、退订/卸载全清理（interval + $on off + 挂起定时器）。
- **Simplify**：动作实现单点复用 `createActionHandler`（agent 工具 = face = 同一份）；三数据源同接口，别名转发旧实现；信封归一化/错误折叠各只有一处。
- **门禁**：全部证据见 §三，测试脚本已删（test/ 目录无残留临时文件）。

## 五、未确定项（如实申报，宁缺毋编）

1. **宿主 face 的注册入口（最后一跳）**：官方形态经协议基类自动注册；本包纯 JS face 如何注册进宿主远端表**未经 inspection 证实，未实现**——`attachHostWire` 的 `void ctx` 处就是预留位。需 DSH 创造会话 `cordis_inspect_query → Service/Event` 确认；若结论是「必须走协议基类」，需放开 npm 依赖约束后再改。当前客户端探测不到远端面，**UI 仍渲染 demo 数据（不白屏）**——这是任务包「宁可保留 demo 回退」的预期表现，不是回归。
2. **宿主 emit 未实现**：`zcode-dispatch/changed` 事件在描述符里已声明，但宿主侧发事件的 API 无静态证据；客户端已按官方 `$on` 形状就绪，到事件即刷，轮询兜底。
3. **浏览器可达性两步**：① client.js 的内嵌镜像段仍是 demo 引擎（本文件暂无法被 client.js import——模块表只认 react 与 `dsh.client.inject` 声明的包；需 inspection 确认挂模块表/`dsh.client.external` 的可行性）；② client.js 模块 inject 是 `['slots']`，未声明 `remote`，即使远端面已注册，浏览器 `ctx.remote` 也是 undefined（需补 `"remote"` 与 `"remote.zcodeDispatch"` 两项）。两步都在本任务包文件白名单之外，已写进 wire.client.mjs 尾部 TODO。
4. **描述符保真度**：官方产物带 zod 校验器（`result.create`）；本包无 zod 依赖，`result.mode:'json'` + `generator` 注记替代。若平台严格校验描述符形状，`./typert`/`./remote` 的消费方式需 inspection 确认。
5. **既有尖角（未改，申报）**：`createActionHandler` 的 `fallback` 动作对 `chain:null` 会拆成 `["null"]`（`String(null).split(',')`）；face 已绕行直调 core，但 agent 工具路径若有人手传 null 仍会踩（工具 schema 声明 chain 为 string 数组，风险低）。另 `face.snapshot()` 冷启动要起 runner 子进程探通道（最长 ≈15s，5s 缓存后廉价），客户端首包可能慢一拍。
