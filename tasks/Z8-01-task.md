---
round: Z8
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T12:20:00+08:00
---

# Z8 任务包：补上"最后一跳"——让宿主 face 真注册、客户端真能调（**静态证据驱动**）

> 前置：Z7 已把传输层/描述符/面方法/demo 回退写好，并**如实申报最后一跳未实现**（`wire.host.mjs` 的 `void ctx` 预留位 + `client.js` 未声明 `remote` inject）。
> 本单目标：用官方 typert 三件套的实现（已提取到本地）把这一跳接上。**只动 `wire.host.mjs`、`wire.client.mjs`、`client.js` 的 inject 段、必要时 `package.json`/`README.md`；不动 UI 结构、不动 core。**

## 一、材料（全部已提取，路径直接读；**不要通读 85KB/52KB 大文件，用 grep 定位**）

| 材料 | 用途 |
|---|---|
| `F:\My Code\dsh-plugins\refs\dsh-typert\protocol\README.zh.md`（10.7KB，**先读这篇**） | 官方 typert 协议说明：`TypertRemoteService` / `Remote` 装饰器 / face 注册与调用语义 |
| `refs\dsh-typert\protocol\lib\index.js`（12KB） | 基类实现：`super(ctx,"<服务名>")` 之后做了什么注册 |
| `refs\dsh-typert\loader\README.zh.md` + `lib\index.js`（18KB） | loader **怎么发现并挂载 face**（认哪些 manifest 字段 / `exports["./typert"]` / `exports["./remote"]` 是怎么被消费的） |
| `refs\dsh-typert\registry\lib\client.js`（53KB） | **客户端**如何注册/查找 `ctx.remote.<服务名>`（grep `remote.` / `descriptors` / `TYPERT_REMOTE`） |
| `refs\dsh-typert\plugin-manager\lib\index.js`（85KB） | 官方 host 半边完整实现（grep `TypertRemoteService` / `Remote` / `super(ctx`） |
| `refs\dsh-plugin-manager\lib\{index.js,client.js,typert.host.js,typert.remote-client.js}` + `package.json` | 官方插件管理页的成对样例（face 声明 + 生成产物 + 客户端调用） |

> 提示：官方包随 dsh 出货，**bundle 不需要声明对 `@deepseek-ai/*` 的依赖**（技能原文：Packages shipped with dsh resolve from the dsh installation）。宿主侧 import `@deepseek-ai/dsh-typert-protocol` 是允许的（官方插件管理页就这么做）。

## 二、要做的事

1. **宿主 face 真注册**（`wire.host.mjs`）
   - 按 protocol README + 基类实现，把现有 `createRemoteFace()` 的对象形态改成官方认可的注册形态（若官方形态是 service 类 + `Remote` 装饰器/装饰器表，就照做；若是 `ctx.xxx.register(face)`，也照做）。
   - 在 `attachHostWire(ctx, dispatcher, config)` 里完成注册，**用 `ctx.effect` 包裹并在卸载时清理**；保留不可用时的降级（不抛、不白屏）。
   - 保持 `createRemoteFace()` 的方法面与既有导出不变（agent 工具与 face 仍是同一实现单点）。
2. **客户端可达**（`client.js` 的 inject 段 + `wire.client.mjs`）
   - Z7 指出的两步必须做：① 模块 `inject` 补 `"remote"` 与 `"remote.zcodeDispatch"`；② 搞清楚客户端模块表能否 import 本包 `./remote`（若不能，就把必要传输层代码**内联**进 `client.js`——这是 DSH Web 客户端的常规做法：浏览器制品里的模块表只解析 react 与 `dsh.client.inject`/`dsh.client.external` 声明的包）。
   - `exports["./remote"]` / `exports["./typert"]` 是否被 loader/registry 消费：以 `refs\dsh-typert\loader\lib\index.js` 与 `registry\lib\client.js` 的实证为准；不对就改。
3. **package.json**：只按证据补必需字段（如 face/remote 声明），其余字段逐字不动。
4. **README.md**：加一节「真实数据 vs demo 的判据」：远端面接通 → 显示真进程/真用量；未接通 → demo 数据（含一句"如何判断"）。
5. `tasks/Z8-delivery.md`：改动清单 / **你确定的形态（贴关键代码 + 来源文件:行号）** / 复现命令 + 原始输出 / 未确定项。

## 三、硬约束

- ❌ 不安装、不写 `$DSH_HOME`、不改 宿主仓库、不 npm 依赖、不 git、不改 `core/*`
- ❌ 不改 `client.js` 的组件树/样式/文案（inject 段与 wire 接线除外）
- ❌ 不 import 任何 `@deepseek-ai/dsh-client-*`（客户端包禁 import）；宿主侧仅允许官方随包出货的 `@deepseek-ai/dsh-typert-*`
- ✅ **无法确定就如实写"未确定 + 证据"**，不要编 API；demo 回退必须始终可用

## 四、自检（贴原始输出）

1. `node --check` 全部改动文件
2. **DSH 探针**：`node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` 必须 **18/18**（无 `ctx.remote` 时不能炸）
3. 既有测试：`node test/core.test.mjs`、`node test/channel-retry.test.mjs` 不回归
4. 你的本地冒烟（跑完即删）：face 注册调用被 `ctx.effect` 包裹、卸载会清理；client 侧 `ctx.remote.zcodeDispatch` 缺失时走 demo

## 五、完成后（简短回复）

改动清单 / 最后这一跳的形态与证据 / 复现输出 / 未确定项 + **明确一句：装到运行态后，"真数据"应该在哪里体现、如何判断是真是假**。
