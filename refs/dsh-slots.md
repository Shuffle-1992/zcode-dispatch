# DSH 客户端槽位实证（Q1：`shell.overlay` 存在性与契约）

> Z4 证据文档。结论全部来自 `D:\DeepSeek\resources\app.asar`（只读）内客户端包的字符串扫描与源码阅读，
> 工具：`tools/asar-extract.mjs`（提取）与 `tools/dsh-scan.mjs`（扫描）。生成：2026-09-30（Z4）。

## 一、直接结论

1. **`shell.overlay` 真实存在**，由 `dsh-client-ui-layout` 在 `root` 槽位的 children 表中声明：
   `{ kind: "list", scope: "root" }`。不是猜测。
2. 它由宿主 `AppFrame` 渲染进**专用悬浮图层**（`div[data-shell-overlay]`，CSS module 类 `overlayLayer`），
   调用形式 `renderSlot("shell.overlay", {})` —— owner props 为空对象。
3. **list 型槽位的注册硬约束**：必须带 `id`（同 priority 下唯一）；`order` 参与 list 内排序；
   `priority` 默认 0（值越低越先渲染，同格后者被 shadow 拒绝）。注册进未声明槽位会**同步 throw**
   （`slot "X" is not declared`），这就是此前"猜槽位"的真实风险。
4. 官方先例 6 处（chat / plugin-manager / workspace 三个包），全部 `ctx.slots.inject("shell.overlay", cb)`
   + `ctx.slots.register({ name, id, ... }, Comp)`，与本插件写法同构。
5. 传入组件的 props = `{...kit, ...injected, ...slotInjected.props, ...ownerProps}`；
   对本插件这种「无 children/store/locale/inject」的注册，组件只收到全局标准钩子（`useSessions` 等）
   + 空 ownerProps。`FloatingPanel` 不声明任何 props 字段 → **天然兼容，零改动**。
6. `SLOT = 'shell.overlay'` **保持不变**；仅把注册 `id` 从 `'zcode-dispatch'` 对齐为先例惯例
   `<功能>.<物>` → `'zcode-dispatch.console'`。

## 二、槽位清单（可扫描验证）

### shell 前缀（声明者：`dsh-client-ui-layout`，root children 表）

| 槽位 | kind | scope | 证据（文件 + 文件内偏移） | 注册先例 |
|---|---|---|---|---|
| `sidebar` | single | root | `dsh-client-ui-layout/lib/client.js +29941 区域`（children 表） | sidebar 包注册 `sidebar` 内容 |
| `main` | keyed | root | 同上（`"main": {kind:"keyed", scope:"root"}`） | `main.conversation`（conversation 包）、各面板入口 |
| `rightbar` | single | root | 同上 | 宿主右栏 |
| **`shell.overlay`** | **list** | **root** | 声明：`dsh-client-ui-layout/lib/client.js +29942`；宿主渲染：同文件 `+17145`（`renderSlot("shell.overlay", {})`，置于 `overlayLayer`） | `chat.quota-notice`（chat +563810）、`plugin-manager.refresh-toast`（plugin-manager +181660）、`workspace.session-rename` / `workspace.session-archive` / `workspace.row-toast`（workspace +198618/198868/199055） |
| `shell.leading` | single | root | 声明：layout children 表（`+30017` 扫描命中）；mac 折叠边栏时的前置座位 | sidebar 包：`+31856`（`inject: injectProps`） |

### conversation 前缀（声明者：`dsh-client-ui-conversation`，随注册逐级声明）

| 槽位 | kind | scope | 证据偏移（`dsh-client-ui-conversation/lib/client.js`） | 备注 |
|---|---|---|---|---|
| `conversation.header` | single | session-maybe | 声明于 `main.conversation` 入口（`+614083` 上方注册块） | |
| `conversation.header.leading` | single | root | registerHeader children 表 | |
| `conversation.session.header` | single | session | registerSessionHeader 注册 | |
| `conversation.session.header.lineage` | single | session | 其 children 表 | |
| `conversation.session.header.actions` | list | session | `+709158`（声明）、消费者：agent-preset `+81169`、jobs `+31166` | |
| `conversation.session.header.utilities` | list | session | 同一 children 表 | |
| `conversation.session.header.corner` | single | session | 同一 children 表 | |
| `conversation.content` | Factory | session-maybe | `registerFactory`（`+705799` 区域） | 可复用装配定义，非普通槽位 |
| `conversation.session` | single | session | Factory children | |
| `conversation.composer` | chain | session | Factory children | chain 型须带 `select` |
| `conversation.composer.bar` | single | session-maybe | Factory children | |
| `conversation.input.dock` | list | session | `+576040 / +619841 / +691921` | |
| `conversation.hero.brand.mark` | single | root | `+705799`；消费者 brand-official README | |
| `conversation.hero.workspace` | single | root | workspace 包注册（`+198950 区域`），自带 children `…directoryFlow` | |
| `conversation.hero.agentPreset` | single | session-maybe | Factory children | |
| `conversation.input.attachments` | single | session-maybe | registerComposerBar children 表 | |
| `conversation.input.overlay` | list | session | 同表；消费者：commands 包 `+49244/+58422` | |
| `conversation.input.permission` | single | session | 同表 | |
| `conversation.input.left` / `.right` | list | session | 同表 | |
| `conversation.input.plan` / `.model` / `.activity` | single | session | 同表 | |
| **`conversation.composer.dock`** | **list** | **session** | 声明：`+710633`；宿主渲染：`+684399`（仅 composer 变体且已有会话时） | 先例：chat 注册 `id:"stats", order:0`（`+564507`） |

### 其他已见槽位（抽样，非全量）

| 槽位 | 证据偏移 |
|---|---|
| `sidebar.footer.action` | `dsh-client-ui-cordis/lib/client.js +73169` |
| `tool.call.toolview` | `dsh-client-ui-cordis/lib/client.js +74260`（同一 key 多注册 = list 型先例） |

> 注：`dsh-client-ui-slots` 只是**纯注册表核心**（SlotMap 在该包为空，槽位名由各消费包 `declare module`/
> children 表增补），因此槽位名证据在消费包里。`Slots.listSubTree` 检查面对应 `SlotCore.snapshot()`：
> `{type:'slot', name, kind, scope, declaredBy, occupants:[{registrant,key,id,order,priority,active}], children}`。

## 三、注册选项与 props（源码级证据）

### 注册选项全集（`dsh-client-ui-slots/lib/index.js`，`register(options, component)`）

| 选项 | 适用 | 说明 |
|---|---|---|
| `name` | 全部 | 槽位 key（必填；未声明即 throw） |
| `id` | list | **必填**，同 priority 下唯一（`list slot "X" requires options.id`） |
| `key` | keyed | 必填（每 key 一格） |
| `select` | chain | 必填；按 `priority` 升序竞选，第一个非 null 胜出，成为组件 `matched` prop |
| `order` | list | 同 priority 内显示排序（`a.order - b.order`） |
| `label` | 全部 | 字符串或 thunk（跟随 locale） |
| `priority` | 全部 | 默认 0；越低越先渲染；同格重复注册 throw（shadow 提示语见源码） |
| `inject` | 全部 | 业务 props 注入函数（结果作为 props 展开进组件） |
| `children` | 全部 | 声明子槽位表 `{ name: {kind, scope} }`；与已有声明冲突 throw |
| `store` | 全部 | store 席位（挂到组件 `useStore`/`actions` props） |
| `locale` | 全部 | locale 命名空间 → 组件获得 `t` prop |
| `registrant` | 全部 | 登记者标注（宿主装载链填） |

`ctx.slots.inject(key, cb)` 时序（`dsh-client-ui-renderer/lib/client.js +1343`）：按槽位**声明生命周期**
安装 effect —— 声明已存在则同步执行 `cb`；否则在声明提交后执行；声明折叠时清理、重现时重跑。
`cb` 返回一个 disposer，或返回 generator（yield 多个 disposer，事务式安装、逆序清理）——workspace 包的
三连注册即此形态。

### props 形状（`dsh-client-ui-renderer/lib/client.js`，`ContextualEntry`/`renderEntry`）

```
Comp({ ...kit, ...injected, ...slotInjected.props, ...ownerProps })
```

- `kit`（standardKit）：全局标准钩子（`useSessions`/`useWorkspaces` 等）+ uiSession provide 束
  （每个 `hooks` 源变成 `use<Name>` 选择器钩子、`props` 原样展开）+ `renderFactorySlot`；
  声明了 `locale` 才有 `t`；声明了 `store` 才有 `useStore`/`actions`；声明了 `children` 才有
  `renderSlot`（含 chain 子项才有 `renderSlotChain`，含非 root scope 子项才有 `SessionProvider`）。
- `injected`：本条目 `inject()` 的返回值。
- `ownerProps`：宿主渲染调用点传入，对 `shell.overlay` 为 `{}`。
- **对本插件**：无 locale/store/children/inject → 组件只收到全局标准钩子 + `{}`。
  `FloatingPanel()` 不读取任何 props 字段，无未证实字段引用。

## 四、复现命令

```bash
# 1) 列 @deepseek-ai 包清单
LIST_ONLY=1 node tools/asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai" NUL

# 2) 扫 shell.overlay（12 命中：声明/宿主渲染/6 注册/文档）
node tools/dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "shell.overlay" --ctx 120 --max 12

# 3) 扫 composer.dock（4 命中：声明 +710633 / 宿主渲染 +684399 / chat 注册 +564440）
node tools/dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "composer.dock" --ctx 90 --max 8 --path dsh-client-ui

# 4) 抽查任意槽位名（验收抽查用）
node tools/dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "conversation.session.header.actions" "sidebar.footer.action" "tool.call.toolview" --ctx 0 --max 4 --path dsh-client-ui

# 5) 提取四个关键包到 refs/extracted/（已随本交付落盘，共 <1MB）
node tools/asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-client-ui-slots" "refs/extracted/dsh-client-ui-slots"
node tools/asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-client-ui-layout" "refs/extracted/dsh-client-ui-layout"
```

## 五、对 client.js 的落地

- `SLOT` 常量不变（`'shell.overlay'`），注释改为证据摘要。
- 注册 `id`: `'zcode-dispatch'` → `'zcode-dispatch.console'`（对齐先例命名惯例；list 槽位必填项复查通过）。
- `order: 20` 保留（list 型有效语义）；无 props/字段改动。
