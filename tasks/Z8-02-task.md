---
round: Z8
seq: "02"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T12:58:00+08:00
---

# Z8-02 任务包：**先修好树，再补完最后一跳**（续 Z8-01；它被 35 分钟超时掐断）

> Z8-01 的客观结果：**改动已落盘但没写完**，且**当前树是"半破"状态**——语法能过、运行会炸：
> - `zcode-dispatch/client.js:873` 调用了 **`createWire()`，但全文件没有它的定义** →
>   DSH 探针报：`FAIL 组件函数可执行（浅渲染不抛错） 抛错: createWire is not defined`
> - `client.js` 的模块 `inject` **仍是 `['slots']`**（Z8-01 要补的 `remote` / `remote.zcodeDispatch` 还没加）
> - 没有 `tasks/Z8-delivery.md`
> - 已经改好的：`wire.host.mjs`（25KB，注释里已有它找到的证据：`protocol/lib/index.js:146-157 bindTypertRemote()` 与 `:248-268 mark()`）、`wire.client.mjs`（33.6KB）
>
> ⚠️ **铁律：先把 client.js 修回"可加载可渲染"，再做其余改造。任何时刻都不许让源码停在"引用未定义符号"的状态。** 每完成一步立刻落盘。

## 一、第一步（必须最先做，做完立刻自检并在回复里贴输出）

让 `client.js` 恢复可运行：在文件内**定义** `createWire`（浏览器模块表只能 `require('react')`，所以必须**内联**传输层实现；也可以退一步：把 L873 改回原先的内联 wire 逻辑）。
- 判据：`node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` 的 `组件函数可执行（浅渲染不抛错）` 必须 **PASS**。
- 允许用 `Z2_ALLOW_PROFILE_WRITE=1` 跑：那条 `$DSH_HOME profile 近 1h 无写入` 现在是**预期 FAIL**（用户已安装插件，profile 被合法写入）。

## 二、然后补完 Z8-01 未完成的三件

1. **客户端可达**：`client.js` 模块 `inject` 补 `"remote"` 与 `"remote.zcodeDispatch"`；把 `createWire()` 接成走远端（`ctx.remote.zcodeDispatch.*`），**保留 demo/外部数据回退**（远端缺席 → 不炸、不白屏）。`client.js` 顶部注释要写清"真数据 vs demo"判据（徽标 `已连接` / `演示数据`）。
2. **宿主 face 真注册**：按你已经在 `wire.host.mjs` 注释里写下的证据（`bindTypertRemote()` + `mark()`，出处 `refs/dsh-typert/protocol/lib/index.js:146-157 / 248-268`；loader 侧见 `refs/dsh-typert/loader/lib/index.js`）完成注册，用 `ctx.effect` 包裹并清理；不再保留"未实现的 `void ctx` 预留位"（若确实无解，**如实写"未确定 + 证据 + 你已排除的假设"**）。
3. **`package.json`**：只按证据补必需字段（其余字段逐字不动）。
4. **`README.md`**：加「真数据 vs demo 判据」一节。
5. **`tasks/Z8-delivery.md`**：改动清单 / 形态与证据（文件:行号）/ 复现命令 + 原始输出 / 未确定项。

## 三、硬约束（同 Z8-01，重申）

- ❌ 不安装、不写 `$DSH_HOME`、不改 宿主仓库、不 npm 依赖、不 git、不改 `core/*`
- ❌ 不改 `client.js` 的组件树/样式/文案（inject 段与 wire 接线除外）
- ❌ 不 import 任何 `@deepseek-ai/dsh-client-*`；宿主侧仅允许随 dsh 出货的 `@deepseek-ai/dsh-typert-*`
- ❌ **不通读** 53KB/85KB 大文件（用 grep 定位）；**不要重写已写好的 wire.host/wire.client**（除非确有错误，且要在交付文档说明改了什么、为什么）

## 四、自检（贴原始输出）

1. `node --check` 四个文件
2. `Z2_ALLOW_PROFILE_WRITE=1 node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` → **18/18**
3. `node test/core.test.mjs`（11/11）、`node test/channel-retry.test.mjs`（8/8）不回归
4. 你的本地冒烟（跑完即删）：无 `ctx.remote` 时走 demo；`client.js` 可被桩 ModuleLoader 加载并完成槽位注册

## 五、完成后（简短）

改动清单 / 最后一跳是否接上（**一句话结论**）/ 复现输出 / 未确定项。
