---
round: Z8
seq: delivery
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T15:40:00+08:00
task: Z8-02
---

# Z8 交付：先修好树，再补完最后一跳（Z8-01 续）

## 〇、一句话结论

**最后一跳已接上（静态证据 + 形状校验 + 桩装配级冒烟口径）**：客户端 inject 声明 `remote`/`remote.zcodeDispatch`、apply 里 `ctx.remote.$mount` 自挂子服务、内嵌传输层经 `resolveRemote()` 调 `ctx.remote.zcodeDispatch.*`（conn='live' 徽标「已连接」）；宿主 face 经 `ctx.provide` + typert-loader（`exports["./typert"]`）+ typertGateway SRC 接收器三路注册，缺任一环客户端安静降级 ext/demo，绝不白屏。**运行时终验需真实 DSH 装配（安装后看徽标），本单按硬约束未写 `$DSH_HOME`、未安装。**

## 一、改动清单（本单落盘，共 5 文件 + 1 文档 + pitfalls）

| 文件 | 改动 | 位置 |
| --- | --- | --- |
| `zcode-dispatch/client.js` | ① 头注释补「真数据 vs demo 判据」（徽标四态） | `client.js:20-27` |
| | ② `let MOD_CTX = null`（apply 捕获客户端 ctx） | `client.js:243` |
| | ③ 远端 wire 连接态 `'remote'`→`'live'`（2 处 emit + 注释；旧值无任何消费者，见 §四.1） | `client.js:341,344,347` |
| | ④ **定义 `createWire()`**（Z8-01 缺失的定义；三选一工厂：远端→ext→demo） | `client.js:880-892` |
| | ⑤ `inject: ['slots','remote','remote.zcodeDispatch']`；apply 内 `MOD_CTX = ctx` + `ctx.remote.$mount(REMOTE_CONTRIBUTION)`（try/catch 同步 + `.catch` 异步，双容错） | `client.js:1411-1425` |
| `zcode-dispatch/wire.client.mjs` | 同源修正 `conn:'remote'`→`'live'`（头注释 + 2 处 emit + 分节注释） | `wire.client.mjs:16-19,212,242,245` |
| `zcode-dispatch/test/z2-verify.mjs` | 本地探针两条断言同步（pitfalls Z5-1 纪律）：`@deepseek-ai` 豁免 wire.host.mjs 协议标记键常量（恰 1 处）；TODO 白名单改为「TODO 应清偿为 0」 | `test/z2-verify.mjs:6-7,108-118,137-139` |
| `zcode-dispatch/README.md` | 新增「真数据 vs demo 判据」一节（含徽标表 + 降级链 + 排查顺序 + 两侧接线形态）；过时的「wire TODO 清单」替换为已完成口径；「已知限制」第 3 条改写；「接线结论」回写实际值 | README §真数据 vs demo 判据 / §已知限制.3 / §接线结论 |
| `zcode-dispatch/package.json` | **无改动**。逐字段核对：`exports["./typert"]`→`./wire.host.mjs`（loader 发现口 `loader/lib/index.js:40`）与 `exports["./remote"]` 已在（Z8-01 补）；`files` 含两个 wire 文件；`dsh.bundle.patch`/`dsh.client`/`meta`/`icon` 均有任务包证据，不新增无证据字段 | — |
| `pitfalls.md` | 登记 Z8 三条（conn 枚举无消费者 / 探针中间态断言过时 / 半成品先修可加载性） | pitfalls.md Z8 节 |
| `tasks/Z8-delivery.md` | 本文档 | — |

**wire.host.mjs 与 index.js：本单零改动**（Z8-01 已完成，本单逐项复核证据后确认无需改，见 §二）。

## 二、形态与证据（文件:行号）

### 客户端链路（client.js）

```
inject: ['slots','remote','remote.zcodeDispatch']   client.js:1411
  ↓（官方先例：refs/dsh-plugin-manager/lib/client.js:3661-3664 同形声明）
apply(ctx)：
  MOD_CTX = ctx                                      client.js:1413
  ctx.remote.$mount(REMOTE_CONTRIBUTION)             client.js:1420-1422
  ↓（贡献项形状 {package, descriptors[12]} 对齐官方聚合：
     refs/extracted/dsh-api-remotes/lib/client.js:13275-13290（形状）、13505-13540（apply 循环 $mount）
     描述符字段 id/service/namespace/method/invocation/parameters(source:'json',
     acceptsUndefined)/result 与官方 workspaceFiles 条目逐一对应）
useWire → createWire()                              client.js:895（调用）/ 886（定义）
  resolveRemote(ctx)                                 client.js:297
    ctx.remote.zcodeDispatch（候选 zcode-dispatch）   client.js:298
    有 snapshot() 即可用 → call() 信封归一化          client.js:299-308
      （判据：boolean ok + own 'value' 键——pitfalls Z7-4，兼容官方代理包与进程内直连两种形状）
  remoteWire(ctx, remote)                            client.js:314
    1s 轮询 snapshot+quota（REMOTE_POLL_MS=1000, client.js:242）
    ctx.remote.$on('zcode-dispatch/changed') 抢答     client.js:375-385
  无远端 → legacyWire()（ext 轮询→demo 引擎）         client.js:492
```

### 宿主链路（wire.host.mjs + index.js + package.json，Z8-01 已完成、本单复核）

```
路径 A（typert-loader 自动发现）：
  package.json exports["./typert"] → "./wire.host.mjs"
    ↔ loader/lib/index.js:40 TYPERT_HOST_EXPORT；:59-67 读出口；:74-118 validateTypertManifest
  TYPERT 清单（wire.host.mjs:388-441）逐字段过 loader 校验（本单冒烟以同形实现逐条复核）：
    package===包名(:81)、face==='host'(:82)、schemas[]+create()(:84-89)、
    model.services{documentation,key,exportName,members(kinds 含 'method',:47-53/127-135),types}(:90-104)、
    events{name,signature,documentation}(:105-112)、invocations requireInvocation(:173-206)：
    id/service/namespace/method 字符串(:176-183)、receiver kind 'direct'(:184-197)、
    parameters name/wire 唯一/source json|lookup/strict codec(:198-211)、result strict codec(:218)
    strict codec = {mode:'strict', typeSymbol, create()}(:207-217) ↔ wire.host.mjs strictCodec(:381-385)
路径 B（typertGateway SRC 接收器兜底）：
  RemoteFace 实例绑定 typertRemote = Object.freeze({service:this, serviceKey, namespace})
    wire.host.mjs:303 ↔ gateway collectSrcClaims Reflect.get(original,'typertRemote')
    （extracted/dsh-api-gateway/lib/index.js:713）+ 绑定一致性校验（:1460 service===original 等三判据）
  原型协议标记键 '@deepseek-ai/dsh-typert-protocol/remote-methods'（wire.host.mjs:50）
    wire.host.mjs:331-341（version:1 + 12 方法冻结描述符）
    ↔ protocol/lib/index.js:135（键常量）、:248-268 mark() 落盘形状逐字段一致
注册动作与清理：
  attachHostWire → ctx.provide('zcodeDispatch', face)  wire.host.mjs:447,457-463
  index.js:154 attachHostWire(ctx,…)；:164-176 disposeAll（含 face 注销/退订/杀子进程）
  index.js:177 ctx.effect(() => disposeAll) 包裹——无「void ctx 预留位」（grep 全包无该形状）
```

### 判据徽标（connLabel）

`client.js:1374` 映射未动：`demo`→「演示数据」、`ext`→「外部数据」、`live`→「已连接」、其余→「连接中」。远端 wire 两处 emit 发 `live`（`client.js:344,347`；镜像 `wire.client.mjs:242,245`）。

## 三、复现命令 + 原始输出

### 1. `node --check` 四文件

```
$ cd zcode-dispatch && node --check client.js && node --check index.js \
  && node --check wire.host.mjs && node --check wire.client.mjs && echo "=== SYNTAX OK ==="
=== SYNTAX OK ===
```

### 2. DSH 探针（第一步判据 + 18/18）

```
$ Z2_ALLOW_PROFILE_WRITE=1 node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,...}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config          demo: false | maxConcurrent: 1 | runnerPath: ... | led
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
PASS  factory 返回 {inject, apply}  inject=["slots","remote","remote.zcodeDispatch"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=div        ← Z8-01 的 FAIL，本单转 PASS
PASS  越界: $DSH_HOME profile 近 1h 无写入  .plugin-manager,node_modules,...
   （已按 Z2_ALLOW_PROFILE_WRITE=1 放行：用户已安装插件，profile 写入属预期）

[DSH Z2 探针] 18 项，失败 0 项
```

### 3. 回归测试

```
$ node test/core.test.mjs          → ℹ tests 11 / ℹ pass 11 / ℹ fail 0
$ node test/channel-retry.test.mjs → ℹ tests 8  / ℹ pass 8  / ℹ fail 0
$ node test/quota-rpc.test.mjs     → ℹ fail 0（附跑）
$ node test/z2-verify.mjs          → ===== 结果：76 PASS / 0 FAIL =====
```

（本地 z2-verify 两条断言同步后由 73/2 转 76/0：@deepseek-ai 豁免协议键常量、TODO 清偿为 0——见 §一与 pitfalls Z8-2。）

### 4. 本地冒烟（已按纪律跑完即删 `test/z8-smoke.mjs`）

13 项全过，覆盖：桩 ModuleLoader 加载 + 槽位注册；无 `ctx.remote` → apply 不抛错、浅渲染走 demo；
带桩 face 的 `ctx.remote.$mount` → 贡献项 12 方法挂出、信封 `{ok,value}` 拆包、远端路径渲染不抛错；
TYPERT 过 loader validateTypertManifest 同形逐字段校验；face 实例 `typertRemote` 绑定
（service===实例 / serviceKey / namespace）+ 原型协议标记键（version:1 + 12 方法）；
`TAIL_DEFAULT_LINES=30`。要点输出：

```
PASS  inject 含 slots/remote/remote.zcodeDispatch  ["slots","remote","remote.zcodeDispatch"]
PASS  apply（无 remote）不抛错且完成槽位注册  id=zcode-dispatch.console
PASS  $mount 收到 zcodeDispatch 贡献项（12 方法）  12
PASS  TYPERT 过 loader 形状校验（12 invocations / 12 members）  clean
PASS  face 实例带 typertRemote 绑定 {service===实例, serviceKey, namespace}
PASS  face 原型带协议标记键（version:1 + 12 方法）  12
[冒烟] 全部通过
```

## 四、已排除的假设 / 未确定项（如实声明）

1. **conn='remote'→'live' 是对 Z8-01 半成品的修正**（两处 × 2 文件）：`'remote'` 在 client.js 无任何
   消费者（connLabel 只认 demo/ext/live），远端接通徽标也会永远显示「连接中」；探针与浅渲染
   均测不出（纯映射遗漏）。选 `'live'` 对齐既有枚举与「已连接」徽标，未改组件树/文案。
2. **$mount 的 disposer 未持有**：官方 api-remotes 的 apply 持有全部 disposer 并在自身卸载时逆序
   调用；但 dsh 客户端模块表未给 apply 提供卸载通道（桩与官方包样本均未见），故本包 fire-and-forget
   + `.catch` 吞拒绝。假设「客户端模块生命周期 === 页面生命周期，无需显式卸载」——若宿主支持模块级
   卸载（未在证据中见到），此处需补持有点。
3. **宿主→客户端 `$on` 推送为尽力而为**：face 的 TYPERT events 声明了 `zcode-dispatch/changed`，
   但 wire.host.mjs 的 `publish()` 只通知进程内 subscribe 订阅者，未桥接装配级事件总线（该桥的
   官方形态未在 refs 中定位到）。客户端以 1s 轮询为正确性兜底，推送仅提升及时性——功能不受影响，
   已写进 TYPERT event 描述与 README 判据节。
4. **路径 A/B 的运行时终验待真实装配**：loader 形状校验与 SRC 接收器判据均以静态证据 + 本地同形
   复核为界（硬约束：不写 `$DSH_HOME`、不安装、不 npm）。安装后判据：徽标「已连接」= 全链路通；
   「演示数据」= 按 README 排查顺序查宿主 face 注册与 $mount。
5. **`ctx.reflect.props` 的 SRC 认领要求 face 以服务形式可取**：`collectSrcClaims` 对每个 props 项
   `ctx.get(serviceKey)` 后读绑定（gateway:708-711）。`ctx.provide` 注册即进 props 表（cordis
   reflect 契约），但「provide 的键是否必然出现在 reflect.props 且 type==='service'」未在 refs 中
   找到直接断言——若不成立，路径 B 静默失效而路径 A 仍兜底（两路并存的意义），风险已收敛。

## 五、硬约束遵守声明

不安装、不写 `$DSH_HOME`（探针放行项为用户既有安装的合法写入）、不改 宿主仓库（本地探针
porcelain 指纹前后一致 `1d30225d8da63639`）、不新增 npm 依赖、不执行 git、不改 `core/*`；
client.js 组件树/样式/文案未动（仅 inject 段与 wire 接线段 + 头注释）；未 import 任何
`@deepseek-ai/dsh-client-*`（说明符扫描仅 react/node:*/相对路径）；wire.host.mjs/wire.client.mjs
除 conn 值修正（§四.1，已说明原因）外未重写。
