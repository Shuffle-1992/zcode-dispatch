# ZB-30 交付：自动降级 = 开关 + 单目标（通道/模型/思考强度）

## 用户要求（原文）

> 自动降级修改下，开关参考派发的开关，点击打开或关闭，带指示灯。打开后下面可以选择通道、模型、
> 思考强度，跟上面一致的，关闭不显示。

（配图为「通道」分区现状：一行 `自动降级链 关` + 一个逗号输入框 + 「开启降级链」按钮。）

## 一句话结论

`自动降级链`（逗号输入 + 二次确认按钮）**整体替换**为**开关 + 单目标三下拉**：开关点击开/关、
带指示灯（开=成功色、关=危险色，与标题栏派发总开关同一套视觉语言），**打开后**才显示
`通道 / 模型 / 思考强度` 三个下拉（与上面「通道」分区逐行同形、档位仍是中文标签），**关闭时不显示**。
core 侧状态升级为有序目标列表 `[{provider, model, reasoningLevel}]`（落盘 `version: 2`，旧 v1 自动迁移），
面板开关写单目标、CLI/工具仍可写多目标。

## 改动清单

| 文件 | 改动 |
|---|---|
| `core/dispatch-core.mjs` | ① `fallbackChain: string[]` → `fallbackTargets: [{provider,model,reasoningLevel}]`；② 新增 `normFallbackTargets`（字符串/对象归一，无 provider 丢弃不猜）、`persistFallback`（落盘 v2，**同时带旧形状 chain**）、`setFallbackTarget(target)`（单目标；null/'' = 关闭；无 provider 抛错）、`getFallbackChain` 返回 `{enabled, chain, targets, target}`；③ `setFallbackChain` 保留（旧入口，等价只有 provider 的目标列表）；④ `loadFallbackState` 读 `targets`，否则读旧 `chain` **自动迁移**；⑤ `maybeAutoFallback` 按目标列表跳转，并把目标的 `model` / `reasoningLevel` 传给 `retry`（有则覆盖、无则沿用）；⑥ `retry` 新增 `opts.reasoningLevel`（交接 spec 里优先用它，其次沿用原任务）；⑦ 导出 `setFallbackTarget`；⑧ 文件头补 ZB-30 语义段 |
| `wire.host.mjs` | ① `fallback` 动作：`chain` 可为**对象**（单目标）/ 数组（多目标）/ null（关闭）；也支持 `provider`+`model`+`thinking` 直接设单目标；② `face.setFallbackChain(list)` 对象走 `setFallbackTarget`（面板实际调用路径），null 仍可关闭 |
| `client.js` | ① 删除 `chainInput/confirming/trySetChain/saveClick/offClick` 与整段输入框 UI；② 新增开关（`.zcd-switch.zcd-toggle` + `.zcd-dot` 指示灯 + `aria-pressed`）与 `toggleFallback`（开启时默认目标 = 当前默认通道 + 其档位，当前通道不可用则退到第一个可用通道）；③ 开启后渲染 `通道/模型/思考强度` 三下拉（复用 `.zcd-field/.zcd-select/.zcd-field-v`，与「通道」分区逐行同形），模型/档位首项是**「沿用原任务…」**（不是「Agent决定」——自动降级那一刻没有 Agent 在决定）；④ 新增 CSS `.zcd-toggle` 三条；⑤ 内联 `normTargets`/`fallbackShape`（与 core 同语义），demo/ext/offline/dead 四个数据源的 `fallbackGet/fallbackSet` 一并升到新形状；⑥ `fallbackGet` 回显 `targets/target`；⑦ STRINGS 删 5 个死键、加 5 个新键（中英） |
| `wire.client.mjs` | 同步 `client.js` 的规范源：`normTargets`/`fallbackShape`、`fallbackSet`/`setFallbackChain` 接受对象、`fallbackGet` 带 `targets/target`、demo `legacyFallbackSet` 归一 |
| `locale/zh.json`、`locale/en.json` | 删 `fallbackPh/fallbackSave/fallbackOffBtn/fallbackConfirm2/fallbackSaved/fallbackEmptyErr`，加 `fallbackEnableTitle/fallbackHint/fallbackKeepModel/fallbackKeepThinking/fallbackOfflineHint`，`fallbackTitle` 去掉「链」字 |
| `index.js` | `chain` 参数描述改为「降级目标通道 id 数组（单目标也可直接传 provider+model+thinking）」；`action=fallback` 说明行重写（含 model/thinking 缺省=沿用原任务） |
| `bin/zcd.mjs` | `fallback set <id> --model <m> --thinking <lv>` = 单目标；`set a,b,c` = 多目标；`list`/`off` 输出改用新形状（`provider/model@level`） |
| `README.md` | 「自动降级」一节重写（开关形态、三下拉、v2 迁移、目标里无 Agent决定）；工具 action 表、测试表、暂停表同步 |

## 关键设计决定（都有测试钉住）

1. **落盘 v2 同时保留旧 `chain` 字段** —— 旧读者（CLI `list`、旧版客户端、外部脚本）读 `chain` 照旧可用；
   新读者读 `targets`。`loadFallbackState` 两种都认 ⇒ **v1 配置自动迁移，不丢**（测试 A 手写 v1 文件验证）。
2. **`model`/`reasoningLevel` 的 `null` = 沿用原任务**，不是空串、不是 `'agent'`。
   这一条是「跟上面一致」的**语义**对齐：上面「通道」分区的档位默认 `'agent'`（给派发 Agent 的规定），
   而自动降级没有 Agent 参与，留空只能解释为"沿用原任务"。测试 B2 断言目标未指定时交接 spec 里
   `model === undefined`、`reasoningLevel === 'enabled'`（原任务值）。
3. **开关不禁用 offline 态**：`offline`（`conn !== 'live'`）只是"没连上宿主远端面"，ext/demo 数据源同样
   提供 `fallback` 方法。判据只看 `busy || channels.length === 0`（无源时 channels 为空，自然禁用）——
   这与「通道」分区两个下拉的判据一致（真渲染测试 ④ 就是靠它才点得动）。
4. **`setFallbackTarget({model:'x'})` 抛错**（无 provider）：不猜通道。CLI/工具的旧路径（字符串数组）
   不受影响。

## 验收证据

### 全量测试：26 个文件 / 431 项断言 / 0 失败

```
PASS channel-retry.test.mjs        PASS lock-badge.test.mjs        PASS section-order.test.mjs
PASS core.test.mjs                 PASS lock-model.test.mjs        PASS shared-wire-liveness.test.mjs
PASS ctx-format.test.mjs           PASS lock-priority.test.mjs     PASS single-source.test.mjs
PASS elapsed-format.test.mjs       PASS lock-queue-visibility.test.mjs  PASS tail-scroll.test.mjs
PASS fallback-target.test.mjs ←新  PASS lock-ui.test.mjs           PASS thinking-level.test.mjs
PASS fallback-ui.test.mjs ←新      PASS memory-ban.test.mjs        PASS wait-action.test.mjs
PASS file-lock.test.mjs            PASS notify.test.mjs            PASS wake-integration.test.mjs
PASS hardening.test.mjs            PASS panel-style.test.mjs
PASS header-entry.test.mjs         PASS pause-timeout.test.mjs
PASS lock-ui…                      PASS quota-rpc.test.mjs
失败文件数=0        总断言通过=431
```

### 新增测试（25 项）

`test/fallback-target.test.mjs`（6 项，node:test）：单目标/关闭/落盘 v2/v1 迁移、跳转带目标 model+档位、
未指定则沿用、wire 三形状 + face 对象走单目标、面板源码形态、文案四处齐备。

`test/fallback-ui.test.mjs`（19 项，**真渲染**，DOM + React 桩 + ext 数据源）：

```
✓ 关闭态只有「通道」分区的 3 个下拉（实际 3）
✓ ① 关闭态已渲染降级开关按钮      ✓ ① 关闭态 aria-pressed=false
✓ ① 开关带指示灯（.zcd-dot）      ✓ ① 关闭态指示灯用错误/危险状态色令牌（非字面色值）
✓ ② 开启态 aria-pressed=true      ✓ ② 开启态指示灯用成功状态色令牌
✓ ② 开启后出现目标三下拉（通道/模型/思考强度 ⇒ 共 6 个，实际 6）
✓ ③ 档位 option 中文标签（disabled→关闭思考 / enabled→开启思考）
✓ ③ deepseek 通道的四档中文（高强度/最高强度）
✓ ③ option value 仍是原始档位字符串（high）—— 中文只在 label
✓ ★ 模型/档位首项是「沿用原任务」（不是 Agent决定）
✓ ★ 降级目标下拉里不出现「Agent决定」（自动降级时没有 Agent 在决定）
✓ ④ 点击开关触发一次 fallback 写入
✓ ★ 关闭时 wire 收到 chain:null（不是 ["null"] 的旧缺陷）
✓ ④ 关闭后目标下拉消失（回到 3 个，实际 3）
✓ ⑤ demo 数据源的 fallbackGet 用同一 fallbackShape（新形状）
✓ ⑤ demo 数据源的 fallbackSet 用同一 normTargets（对象/数组/null 三形状一致）
✓ ⑤ 旧的 demoChain 已彻底替换（不留死变量）
===== ZB-30 UI 渲染：19 PASS / 0 FAIL =====
```

> 为什么要真渲染而不只是源码正则：源码正则能钉"写了什么"，但**测不出运行时是否抛错、关闭时是否真的
> 不渲染**。`fallback-ui.test.mjs` 用与 `panel-style.test.mjs` 同一套桩把面板真渲染两遍
> （关闭态 / 开启态）并断言下拉**个数**（3 → 6 → 3），这是"关闭不显示"唯一的硬证据。

### DSH 独立探针

```
[DSH Z2 探针] 21 项，失败 0 项
```

含「client.js 无字面色值」（指示灯用 `T.stDone`/`T.danger` 令牌）、「boot 安全 inject 不自声明 remote
命名空间」、「组件函数可执行（浅渲染不抛错）」、「越界: $DSH_HOME 无写入」。

### 语法门禁

`node --check` 全绿：`index.js` / `client.js` / `wire.host.mjs` / `wire.client.mjs` /
`core/dispatch-core.mjs` / `bin/zcd.mjs` / `collab-kit/zcode-run.mjs`。

### 真宿主路径冒烟（真实 dispatcher + 真实 wire.host face，非桩）

```
初始: {"enabled":false,"chain":[],"targets":[],"target":null}
开:   {"ok":true,"enabled":true,"chain":["builtin:bigmodel-coding-plan"],
       "targets":[{"provider":"builtin:bigmodel-coding-plan","model":"GLM-5.3-Flash","reasoningLevel":"enabled"}], …}
盘:   { "version": 2, "chain": [ "builtin:bigmodel-coding-plan" ], "targets": [ {…} ], "updatedAt": … }
换模型: {"provider":"builtin:bigmodel-coding-plan","model":"GLM-5.3","reasoningLevel":null}
关:   {"ok":true,"enabled":false,"chain":[],"targets":[],"target":null}
```

走的是面板实际调用链（`face.setFallbackChain(对象)` → `setFallbackTarget`），确认落盘 v2 且旧 `chain` 同步。

## 生效方式

- `client.js` / `wire.client.mjs` / locale：**刷新页面**即生效。
- `index.js` / `wire.host.mjs` / `core/dispatch-core.mjs`：**需要完整重启 DSH**（宿主半边）。
- `bin/zcd.mjs`：下次调用生效。
- 现网 `state/fallback.json` 若还是 v1（只有 `chain`），首次启动自动迁移，**配置不丢**。

## 未确定项 / 已知取舍

1. **面板只设单目标**（用户要求"打开后下面可以选择通道、模型、思考强度"——单数）。core 仍支持多目标
   列表，CLI `fallback set a,b,c` 与工具 `chain:[...]` 照旧可写多目标；面板读回时会显示首项徽标
   （`provider/model · 档位`）。**未做**面板上的"多目标编辑器"（超出本轮要求，且会把「通道」分区撑长）。
2. **降级目标的档位下拉取该通道档位集的并集**（`channels[].thinkingLevels`，与「通道」分区同源）——
   同一通道内多模型档位不同时，并集里可能含某模型不支持的档位。与「通道」分区现有行为一致；
   最终由 runner 按 builtin 声明 fail-fast 校验（不静默降级）。
3. **旧文案键删除而非保留**：`fallbackPh/fallbackSave/fallbackOffBtn/fallbackConfirm2/fallbackSaved/
   fallbackEmptyErr` 在 client 与 locale 四处一起删（single-source 哨兵要求逐键逐值相等）。
   若外部有人按 key 取文案，会拿到 `undefined` → `t()` 回退显示 key 本身（不白屏）。