# 给创造模式会话：当前交接（2026-09-30 15:50）

> 本文是**当前待办的唯一入口**。长版背景见 `CREATOR-HANDOFF.md`（含 Z1–Z14 历史与四步 Remote 配方），
> 阶段 A 侦查结论见 `tasks/CREATOR-RECON.md`（568 行）。
> **写者约定**：这一轮创造模式独占写权（标准模式会话 Z11–Z14 均已收尾并通过验收）；标准模式只在交付后做独立复跑验收。

---

## 0. 一句话

面板**已可见、且交互已可点**（Z14 修好了 `pointer-events` 全穿透）；剩下三件：
**① 让 `zcode_dispatch` 工具真正出现（新会话看不到）**、**② Remote 接线（面板真数据 + 通道/模型可选）**、③（可选）离线态给禁用控件加"未连接"提示。

---

## 1. 用户刚在重启后的实测事实（基线）

| 现象 | 判定 | 根因/依据 |
|---|---|---|
| 面板可见 | ✅ 正常 | 槽位注册已证实（`tasks/CREATOR-RECON.md` §1.3：`id=zcode-dispatch.console` active, order 20） |
| 折叠/点进程行等**能点** | ✅ 正常 | Z14 已给 `.zcd-root` 之外的 `.zcd-panel`/`.zcd-grip`/`.zcd-pill`/错误卡片补 `pointer-events:auto`（提交 `2f231b3`） |
| **通道 / 模型 下拉点不动** | ⚠️ **按设计禁用**，不是 bug | `client.js:1289` `disabled: channels.length === 0`；`client.js:1298` 模型 `disabled: !sel || !sel.enabled`。离线态 `offlineWire()` 不返回通道 → 两个下拉必然禁用 |
| **新开会话看不到 `zcode_dispatch`** | ❌ 待修（待办 ①） | 工具注册未生效；本地已证实代码路径正确（13/13），真机疑为裸 import 解析失败 |

---

## 2. 待办 ①：让 `zcode_dispatch` 在新会话里出现

### 2.1 先诊断（两步，别猜）
1. `cordis_inspect_query` → **Tool**：`listTools` 里是否有 `zcode_dispatch`；同时看 `tools/change` 事件有无对应记录。
2. 若缺席：给 `index.js` 的 `loadDefineTool()` 加**激活信标**（写入 `.data/state/activation.json`，写失败忽略、绝不抛）：
   ```json
   { "at": "…", "defineToolResolved": false, "defineToolSource": "bare|abs:<path>|null",
     "toolRegistered": false, "switchEnabled": true, "name": "zcode-dispatch" }
   ```
   重启 DSH 后读该文件 → 一眼定位是"包没解析到"还是"register 没成功"。

### 2.2 最可能的原因与修法（本轮最高优先）
- **原因**：`index.js` 用**裸 import** `@deepseek-ai/dsh-tools`，而我们的包位于 `F:\My Code\dsh-plugins`（**不在 DSH 安装目录内**），profile 的 `node_modules` 里也**没有 `@deepseek-ai` 作用域** → 解析失败 → `loadDefineTool()` 返回 `null` → 静默不注册。
- **反例证据（重要）**：`refs/plugin-whale-pet/lib_index.js` —— 那个**真实可用**的第三方插件，宿主半边**完全不 import 任何 `@deepseek-ai/*`**（只用注入的 `agents` 服务）。所以"随 dsh 出货的包可裸 import"在**第三方插件目录下没有先例**。
- **修法**：`loadDefineTool()` 增加**绝对路径回退**，命中即记录来源：
  1. `process.env.ZCD_DSH_TOOLS`（显式覆盖，最高优先）
  2. `path.join(process.resourcesPath ?? '', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')`
  3. `D:/DeepSeek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`
  4. `…/app.asar.unpacked/…`（若存在）
  > Electron 主进程可读 asar 内路径；逐个 `await import(pathToFileURL(p))`，失败继续下一个，全失败再降级 `null`。
- **对比参照**：`refs/dsh-tools/tool-fs-example/index.js:261`（`ctx.tools.register(defineTool({…}))`）、`:1176`（`const inject=['tools',…]`）、`:1212`（`export { Config, apply, inject, name }`）；契约 `refs/dsh-tools/schema.js:274-330`。

### 2.3 验收（必须现场）
- `listTools` 出现 `zcode_dispatch`；
- **用户新开会话**问「有 `zcode_dispatch` 吗？有就调 `action:"status"`」→ 能列出并返回开关状态；
- 关掉总开关（`node scripts/collab/zcode-switch.mjs off`）后 `action:"dispatch"` 必须被拒（`{ok:false}`）。
- 硬约束：注册失败**一律降级不抛**；宿主 `inject` 只允许 `['tools']`，**不得**出现自家 `remote.*`。

---

## 3. 待办 ②：Remote 接线（面板真数据；通道/模型转为可选）

**四步配方（whale-pet 实证，参考文件在 `refs/plugin-whale-pet/`）**：

| 步骤 | 官方可用形态 | 我们现状 |
|---|---|---|
| ① 宿主暴露 | `service.typertRemote = Object.freeze({ service, serviceKey: name, namespace: name }); ctx.provide(name, service);`（`refs/plugin-whale-pet/lib_index.js:101-109`） | ✅ `ctx.provide` 已有；❌ **缺 `typertRemote` 标记** |
| ② 宿主描述符 | `exports["./typert"]` 严格形态（`refs/plugin-whale-pet/lib_typert.host.js`，847B） | ⚠️ 我们 Z7 手写的 `TYPERT` 需对齐（尤其 `model.services[].members`） |
| ③ 客户端 | 顶层 `inject` 只放基础服务，再用**子 fiber**：`ctx.inject(['remote.zcodeDispatch'], scope => …)`（`refs/plugin-whale-pet/lib_client.js`） | ❌ 现为运行时探测；子 fiber 是**既有序又不阻塞启动**的正解 |
| ④ 客户端制品 | `exports["./remote"]`（whale-pet `lib/remote.js`，41KB，内含 Zod） | ⚠️ 按此形态产出/对齐 |

**验收**：徽标「未连接」→「**已连接**」；**通道/模型下拉可点且有真值**；`.data/state/jobs.json` 出现。
**若 ① 后仍不通**：做 `tasks/CREATOR-RECON.md` §6 的 **E1** 实验（catch 里补 `log('warn',…)` + 把 `wire.registered` 写进启动日志）→ 重启读日志即可分 H1/H2。

---

## 4. 待办 ③（可选，UI 打磨）

- 离线态给**通道/模型**控件加"未连接宿主"提示（`title` 或副标题），避免用户以为坏掉；文案风格复用 Z12 已有的 `switchHintOffline`。
- 新增文案一律走 locale（`locale/zh.json` + `en.json` 同步）。

---

## 5. 验收门禁（每次改完都跑，缺一不可）

```powershell
$env:Z2_ALLOW_PROFILE_WRITE='1'
node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"      # 20/20
node "F:\My Code\dsh-plugins\tools\verify-switch.mjs"      # 8/8（开关门禁 + 不 spawn）
cd "F:\My Code\dsh-plugins\zcode-dispatch"
node test/core.test.mjs            # 11/11
node test/channel-retry.test.mjs   # 8/8
node --check index.js; node --check client.js; node --check wire.host.mjs; node --check wire.client.mjs
```
- **宿主半边任何改动 → 完全退出 DSH 再启动**（cordis `_reload()` 复用进程内模块，切插件开关不重新读盘）；
- 客户端半边改动 → 刷新页面即可；
- **启动失败别慌**：救援按钮会重置 profile → `profile-backup/README-RECOVERY.md` 两条命令还原；
- 交付写 `tasks/ZB-01-delivery.md`：改动清单 / 形态与证据（文件:行号）/ 复现命令 + 原始输出 / **未确定项（宁缺毋编）**。

---

## 6. 关键文件索引

| 路径 | 用途 |
|---|---|
| `zcode-dispatch/index.js` | 宿主入口：Config（Standard Schema）、apply、`inject=['tools']`、`loadDefineTool()`、`registerZcodeDispatchTool()` |
| `zcode-dispatch/client.js` | 客户端入口 + 面板组件（槽位注册、开关注释、`pointer-events` opt-in、折叠/展开、进程行） |
| `zcode-dispatch/wire.host.mjs` | 宿主 Remote 面（`createRemoteFace`/`TYPERT`/`attachHostWire`/`ctx.provide`/开关读写单点） |
| `zcode-dispatch/wire.client.mjs` | 客户端传输层（`createClientWire`/`TYPERT_REMOTE`） |
| `refs/plugin-whale-pet/` | **真实可用的第三方插件模板**（四步配方来源） |
| `refs/dsh-typert/{protocol,loader,registry,plugin-manager}/` | 官方 typert 实现 |
| `refs/dsh-tools/` | 官方工具注册契约 + `tool-fs-example` |
| `tools/verify-plugin.mjs`、`tools/verify-switch.mjs` | 常驻探针（DSH 侧独立复现） |
| `tasks/CREATOR-RECON.md` | 阶段 A 侦查结论（槽位 ✅ / 服务目录是静态声明 / 工具缺席） |
| `tasks/Z1..Z13-*`、`*-passed.md` | 完整审计链 |
| `profile-backup/README-RECOVERY.md` | profile 被重置后的还原 |

---

## 7. 历史一句话（避免重复劳动）

Z1 派发核心 → Z6 通道/暂停/续跑/降级链 → Z7/Z8 typert 接线（形态对、注册未通）→ Z9 UI 两 bug → Z10 Config 必须 Standard Schema →
Z11 去假数据/折叠/行展开/关闭 → Z12 总开关（三入口 + 面板 + 工具描述）→ Z13 官方 `defineTool` 注册（本地 13/13，真机待验）→
Z14 `pointer-events` opt-in。**两次启动事故（裸 JSON Schema、inject 自声明 remote.\*）均已修复且有常驻判据。**
