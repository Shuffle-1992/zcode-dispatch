---
round: CREATOR-A
seq: "01"
from: creator
to: dsh
type: recon
status: done
created: 2026-09-30T15:2x+08:00
---

# CREATOR 阶段 A：只读侦查（Slots / Service / Event+Tool）

> 依据 `CREATOR-HANDOFF.md` §四 P1「**阶段 A（现在就能做，只读）**」执行。
>
> **本轮硬约束遵守声明**
> - **零源码改动**：`zcode-dispatch/**` 一个字节未写。全文只新增本文件（`tasks/CREATOR-RECON.md`）。
> - **写者占用回避**：Z12/Z13 的写集合（`index.js` / `wire.host.mjs` / `wire.client.mjs` / `client.js` / `locale`）**只读、未写**。
> - 未改 `<HOST_REPO>`（宿主仓库）任何文件；未写 `$DSH_HOME`；未装/卸插件；未 npm；未 git 操作。
> - 对 `index.js` / `wire.host.mjs` 的**只读**读取发生在 **15:2x**，此时 `tasks/Z12-delivery.md`（status: done，mtime 15:15:25）已落盘 —— 即所读内容为 **Z12 之后**的版本。经比对，Z12 改动清单**未包含** `wire.host.mjs:610-621` 的 `ctx.provide` 接线块，故本报告对该块的引用不受 Z12 影响。

## 0. 侦查环境

| 项 | 值 |
|---|---|
| 时间 | 2026-09-30 15:18–15:21 +08:00 |
| DSH | `@deepseek-ai/dsh-desktop 0.2.0-rc.2`（electron 44.0.0 / node 24.18.1）— 取自 `crash-2026-09-30T06-05-03-662Z-web-boot.log:4-7` |
| 插件 entry | `include:zcode-dispatch` → `moduleName: "@local/zcode-dispatch"`, `enabled: true`, **`fiberPhase: "active"`**, `patchId: "zcode-dispatch"` |
| 插件 config | `status: "schema"`（Standard Schema 校验通过；Z10 成果在运行期成立） |
| 页面连接 | client 侧 inspection 全部**有响应**（Slots/Service/Event 均返回数据）→ 页面已连接、preload 桥可用 |

`cordis_inspect_list` 本轮可用 provider（原始清单，10 个）：

| platform | provider | methods |
|---|---|---|
| host | `Service` | `listService` |
| host | `Event` | `listEvents` |
| host | `Config` | `listConfigs` |
| host | `Tool` | `listTools` |
| client | `Service` | `listService` |
| client | `Event` | `listEvents` |
| client | `Builtin` | `listBuiltins` |
| client | `Slots` | `listSubTree` |
| client | `Theme` | `listTokens` |

> ⚠️ **无任何「Remote / typert」provider**。故「客户端可调用的 `remote.*` 清单」**不能**由 provider 直接导出，只能从宿主 Service 面反推（见 §2.4）。

---

## 1. ① Slots 表

### 1.1 `shell.overlay` 精确查询（原始输出，逐字）

调用：`client` / `Slots` / `listSubTree`，`input = {"root":"shell.overlay"}`

```json
{
  "platform": "client",
  "provider": "Slots",
  "method": "listSubTree",
  "data": {
    "requestedRoot": { "name": "shell.overlay", "available": true },
    "trees": [
      {
        "type": "slot",
        "name": "shell.overlay",
        "kind": "list",
        "scope": "root",
        "purpose": "Frame-wide floating layer, above every column and outside their scroll containers.",
        "replaceRisk": "none",
        "registration": [
          { "name": "id",    "type": "string",             "required": true  },
          { "name": "order", "type": "number",             "required": false },
          { "name": "label", "type": "string | (() => string)", "required": false }
        ],
        "children": [
          {
            "type": "slot",
            "name": "shell.quota-notice",
            "kind": "chain",
            "scope": "root",
            "purpose": "Frame-wide quota notice chain.",
            "replaceRisk": "none",
            "registration": [ { "name": "select", "type": "(owner) => unknown | null", "required": true } ],
            "children": []
          }
        ]
      }
    ],
    "selected": {
      "type": "slot",
      "name": "shell.overlay",
      "kind": "list",
      "scope": "root",
      "declaredBy": "an entry in \"root\" (mf)",
      "occupants": [
        { "registrant": "mf", "id": "session-log-upload-toast", "priority": 0, "active": true },
        { "registrant": "mf", "id": "shortcuts",                "priority": 0, "active": true },
        { "registrant": "mf", "id": "desktop-onboarding",       "priority": 0, "active": true },
        { "registrant": "mf", "id": "account.platform-page",    "priority": 0, "active": true },
        { "registrant": "mf", "id": "workspace.session-rename", "priority": 0, "active": true },
        { "registrant": "mf", "id": "workspace.session-archive","priority": 0, "active": true },
        { "registrant": "mf", "id": "workspace.row-toast",      "priority": 0, "active": true },
        { "registrant": "mf", "id": "plugin-manager.refresh-toast", "priority": 0, "active": true },
        { "registrant": "mf", "id": "chat.quota-notice",        "priority": 0, "active": true },
        { "registrant": "mf", "id": "schedule.delete-toast",    "priority": 0, "active": true },
        { "registrant": "mf", "id": "zcode-dispatch.console", "order": 20, "priority": 0, "active": true },
        { "registrant": "mf", "id": "whale-pet",                "order": 90, "priority": 0, "active": true }
      ],
      "catalog": {
        "description": "Frame-wide floating layer, above every column and outside their scroll\ncontainers. Deliberately generic and unowned by any feature: a badge, a\ntoast stack or a status pill all belong here, and entries order among\nthemselves. The layer itself is click-through — entries opt back into\npointer events — so an occupant never blocks the app underneath.\n\nThis is the additive seat for a frame-wide surface of your own: a fresh\n`id` is added beside the shipped entries instead of replacing them.",
        "registration": [
          { "name": "id", "type": "string", "required": true,
            "description": "Your cell key. Use an id of your own: a fresh id is added beside the shipped entries, while reusing a shipped id puts you in THAT cell and replaces it. Owners that filter by id address you by it." },
          { "name": "order", "type": "number", "required": false,
            "description": "Position among the entries, ascending (default 0)." },
          { "name": "label", "type": "string | (() => string)", "required": false,
            "description": "Display text where the owner projects one (nav rows, tabs). A thunk is re-read on every projection, so localized text follows the active locale without re-registering." }
        ],
        "ownerProps": [],
        "ownerPropsReferences": [],
        "standardProps": [
          "useResource: UseResource",
          "useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>",
          "usePanelInfo: UsePanelInfo",
          "useSessions: UseSessions",
          "useSessionStatus: UseSessionStatus",
          "useSessionRetainInfo: UseSessionRetainInfo",
          "useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>"
        ],
        "keyDomain": "",
        "hookContext": "",
        "slotInject": "",
        "replaceRisk": "none"
      }
    },
    "referencedTypes": []
  }
}
```

### 1.2 `root` 顶层树（原始输出要点）

`listSubTree`（无 `root`）返回 `trees = [root(slot), factory:conversation.content]`。`root` 的 children 里与浮层相关的三分支：

| 子槽位 | kind | scope | purpose |
|---|---|---|---|
| **`shell.overlay`** | **list** | **root** | Frame-wide floating layer, above every column and outside their scroll containers. |
| `shell.leading` | single | root | Window-chrome seat at the frame's top-left, over every main panel. |
| `sidebar` | single | root | The whole left column.（`replaceRisk: shadows-shipped-ui`） |

### 1.3 结论 ①

1. **`shell.overlay` 真实存在且形态已定证**：`kind = "list"`、`scope = "root"`、`replaceRisk = "none"`、`declaredBy = an entry in "root" (mf)`。
   注册契约 = `{ id: string(必填), order?: number, label?: string | (() => string) }` —— **与我们 `client.js` 的 `register({ name: SLOT, id: 'zcode-dispatch.console', order: 20 }, …)` 完全相容**（`name` 走 `ctx.slots.register` 的槽位参数，非 catalog 的 registration 字段）。
2. **唯一子槽位** = `shell.quota-notice`（`kind: "chain"`，需 `select` 参数）→ 与官方 `chat.quota-notice` 用法一致（handoff §三.4 引用 `dsh-client-ui-chat/lib/client.js +563756` 的那段），**我们不占用它**，走的是 additive 的 `id` 单元格，正确。
3. ✅ **`id = zcode-dispatch.console` 已注册且 active**：
   `{ "registrant": "mf", "id": "zcode-dispatch.console", "order": 20, "priority": 0, "active": true }`
   → **P0「面板不可见」在槽位层已无残留问题**（注册被接受、条目生效、order=20 排在 `chat.quota-notice` 之后、`whale-pet`(90) 之前）。
   - ⚠️ 诚实标注：全部 12 个 occupant 的 `registrant` 都是 `"mf"`，这是**客户端打包模块的 id**，不是插件名 → **不能**用 `registrant` 区分「哪个插件注册了什么」，只能靠 `id` 认领。
4. 🆕 **本轮新增的、与 Z9「点不动」直接相关的官方约束**（原文见 §1.1 catalog.description）：
   > *"The layer itself is **click-through** — entries opt back into pointer events — so an occupant never blocks the app underneath."*
   → 官方明示 `shell.overlay` 浮层本身 **`pointer-events: none`**，**occupant 必须自己 opt-in 回 pointer events**。
   这正好解释 Z9 修掉的「右上角折叠/最小化点不动」类症状，也给出**判据**：`client.js` 面板根节点（及标题栏按钮）必须显式 `pointer-events: auto`。**建议阶段 B 先只读核对现有 CSS 是否已 opt-in，再决定动不动**（本轮未改任何 CSS）。

---

## 2. ② Service 表

### 2.1 精确查询 `zcodeDispatch`（原始输出，逐字）

```
cordis_inspect_query  platform=host  provider=Service  method=listService
input = {"service":"zcodeDispatch"}

→ Error: no catalogued Service named "zcodeDispatch"
```

（对照：`client` 侧同法查 `remote` 亦为 `Error: … provider-error: no catalogued Service named "remote"`，且该次查询还触发 10s 超时 —— 见 §2.5 注。）

### 2.2 宿主 Service 目录全集：**91 个 key，其中没有 `zcodeDispatch`**

对**完整**原始输出（落盘件，见附录 A）跑 `grep '"key": "'` → 91 命中，逐条如下（按输出顺序）：

```
agentDefaultModel, agentLoop, agentPresets, agents, agentTeams, approval, attachments,
authorization, browserUse, clientModules, commands, compaction, computerUse, configEditor,
connection, credentials, credentialsController, deepseekAccount, deepseekLlmApiExtensions,
directoryPicker, directoryPickerController, fileReferences, fileUploads, fs, goals, hmr,
inspector, invariants, jobController, jobs, llm, lsp, mcpResources, messageFeedback,
officeToPdf, otel, permissionPresets, planMode, pluginManager, pluginRegistryProbe,
productAnalytics, productTelemetry, profileContext, ptcRuntime, sandbox, sandboxPolicy,
schedule, sessionController, sessionFeedback, sessionFileReferences, sessionPersistence,
sessionProjectionCache, sessionProjections, sessionQuery, sessionReferenceResolver, sessions,
sessionSkillCatalog, sessionTelemetry, sessionTitle, settings, settingsController, shell,
shellEnv, skills, speechController, speechToText, spillStore, ssh, storage, storageDomain,
subagentModelSelection, subagents, subprocess, systemPrompt, terminalController, terminals,
timer, tokenMeter, toolResultPruner, tools, typert, typertGateway, userQuestions, web,
webhookRuntime, webServer, workflowEngine, workspaceChanges, workspaceController,
workspaceFiles, workspaceRegistry
```

对**完整**落盘件跑 `grep -i zcode` → **No matches found**（连字符串都没出现）。
对 `index.js` 全包导出名 `zcodeDispatch` 亦无命中。

### 2.3 客户端 Service 目录（原始输出，逐字：仅 8 个）

```json
{ "mode": "catalog", "services": [
  { "key": "layout",       "methods": ["selectPanel","beginNavigation","toggleSidebar","openRightbar","closeRightbar"] },
  { "key": "locale",       "methods": ["getLocale","getSnapshot","subscribe","setLocale","addLanguage","register","bind"] },
  { "key": "sessions",     "methods": ["retain","using","retainInfo","refreshProjections","search","fork","scope","binding"] },
  { "key": "slots",        "methods": ["register","registerFactory","inject"] },
  { "key": "theme",        "methods": ["getTheme","setTheme","setFontSize","register","overrideTokens"] },
  { "key": "timer",        "methods": ["timeout","interval","throttle","debounce"] },
  { "key": "uiWorkspace",  "methods": ["openSession","openWorkspace","forkSession","connectWorkspace","startSession","archiveSession","unarchiveSession","pickDirectory","listDirectory","createDirectory"] },
  { "key": "workspaces",   "methods": ["create","rename","delete","archiveSession","unarchiveSession","insertSessionBefore"] }
] }
```

> `remote` **不在**其中。但 handoff §三.3 已证 `inject: ['slots','remote']` 是能激活的（否则 web boot 会 pending）——即 **`remote` 是运行时存在、却不在目录里的服务**。这条本身就是 §2.5 的关键旁证。

### 2.4 客户端可调用的 `remote.*` 清单（从宿主 `@Remote` 反推）

无 Remote provider，故按「宿主服务上带 `@Remote` 注解的方法」= 客户端 `ctx.remote.<namespace>` 的可调用面。对宿主完整落盘件跑 `grep '@Remote'` → **116 命中，落在 27 个服务上**：

| remote.* namespace | 可调用方法（`(stream)` = 流式） |
|---|---|
| `agentPresets` | `list` / `read` / `select` |
| `commands` | `list` / `execute` |
| `credentials`（服务 key = `credentialsController`）| `describe` / `set` / `unset` |
| `directoryPicker`（服务 key = `directoryPickerController`）| `pick` / `list` / `createDirectory` |
| `fileUploads` | `upload` |
| `goals` | `get` / `edit` / `pause` / `resume` / `complete` / `clear` / `create` |
| `jobController` | `list`(stream) / `follow`(stream) / `kill` |
| `llm` | `listProviders` / `listConfigurableProviders` / `discoverModels` |
| `messageFeedback` | `list` / `put` / `delete` |
| `officeToPdf` | `render` / `generation` |
| `permissionPresets` | `catalog` |
| `pluginManager` | `listVersionExemptions` / `setVersionExemption` / `listPlugins` / `listBundles` / `registries` / `inspect` / `setPluginEnabled` / `setBundleEnabled` / `installBundle` / `waitForInstall` / `cancelInstall` / `removeBundle` |
| `pluginRegistryProbe` | `fastest` |
| `productAnalytics` | `enabled` / `watchPolicy`(stream) / `report` |
| `schedule` | `list` / `catalog` / `history` / `delete` / `update` |
| `sessionController` | `list` / `search` / `create` / `selectModel` / `initializeDefaultModel` / `modelCatalog` / `canOpenWorkspacePath` / `openWorkspacePath` / `workspacePathApplications` / `rename` / `fork` / `prompt` / `attachment` / `updateQueue` / `cancel` / `page` / `follow`(stream) / `projections` / `control`(stream) |
| `sessionFeedback` | `record` |
| `sessionFileReferences` | `list` |
| `sessionReferenceResolver` | `candidates` |
| `sessionSkillCatalog` | `list` |
| `settingsController` | `describe` / `update` / `replace` / `mutate` / `openSettingsDocument` |
| `speechController` | `catalog` / `follow`(stream) / `configure` / `prepare` / `cancelPreparation` / `transcribe` |
| `subagents` | `prompt` / `interruptByParent` |
| `terminalController` | `environment` / `shells` / `list` / `create` / `retain`(stream) / `follow`(stream) / `write` / `resize` / `rename` / `close` |
| `userQuestions` | `answer` / `attachWait`(stream) |
| `workspace`（服务 key = `workspaceController`）| `create` / `initializeDefault` / `rename` / `delete` / `insertBefore` / `insertSessionBefore` / `archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession` / `follow`(stream) |
| `workspaceFiles` | `read` / `readBytes` / `stat` / `list` / `changes`(stream) |

**`zcodeDispatch` 不在其中**（与 §2.2 一致）。另注意 `pluginManager` 的 `inspect(spec, options?)` —— 官方插件管理页正是靠这些 `@Remote` 方法拿到插件详情，可作为阶段 B 的形态参照物。

### 2.5 ⚠️ 关键判定：Service 表是「**声明目录**」，不是「**运行时注册表**」

这是本轮最重要的方法论结论，直接决定「`zcodeDispatch` 缺席」能不能被当成证据。

**原始输出里的铁证**（摘自立 / 客两端的签名字符串）：

```
"signature": "@Remote('list') async remoteExportList(): Promise<AgentPresetRoster>"     ← 装饰器 + TS 泛型
"signature": "abstract readonly imageLimits: ImageAttachmentLimits"                      ← TS abstract
"signature": "declare readonly register: SlotCore['register']"                           ← TS declare + 索引访问类型
"keyDomain": "fixed by the owner's key table { [Kind in ChatNodeKind]: … }"              ← 映射类型
```

`@Remote(...)` 装饰器、`abstract`、`declare readonly`、`Pick<>`/`Promise<>` —— **运行时对象不可能携带这些**。目录里还并列给出 `description`、`standardProps`、`keyDomain` 等文档字段。

**由此得出两条硬结论：**

1. **`Service.listService` 是按「已发布类型声明/文档」编目的目录**（工具描述里 "compact capability/signature directory" 的字面意思），错误文案也精确地写作 *"no **catalogued** Service"*。
2. 因此，**「目录里没有 `zcodeDispatch`」≠「运行时没有 `zcodeDispatch` 服务」**。第三方手写插件（`zcodeDispatch`、以及同为第三方的 `whalePet` 之类）天生不会有编目条目，**无论 `ctx.provide` 成功与否都不会出现**。

**旁证（同一条逻辑的正面例）**：客户端目录列了 `theme`、`layout`（都不在 `remote`），却不列 `remote`、`uiRenderer`、`modules` —— 而 `uiRenderer`/`modules` 在官方包里同样用 `ctx.reflect.provide("uiRenderer"|"modules", …)` 注册（`refs/extracted/dsh-client-ui-renderer/client.js:1844`、`dsh-client-modules/lib/client.js:868`），`theme`/`layout` 亦然（`dsh-client-ui-theme/lib/client.js:1582`、`dsh-client-ui-layout/lib/client.js:600`）。**同一注册手法，结果一半在目录里一半不在** → 只可能是「编目」而非「注册」在决定可见性。

**故：阶段 A 无法用 Service 表判定 P2 的根因。** 这不是侦查失败，而是必须如实上报的边界（handoff §七：「凡涉及宿主/客户端 API 形态，必须以 inspection 或官方包源码为准，不许猜」——同理，**不许把「不在目录」当成「没提供」**）。

### 2.6 关于「由哪个 fiber 提供」的直接回答

| 问题 | 答复 | 证据 |
|---|---|---|
| `zcodeDispatch` 由哪个 fiber 提供？ | **无从判定**。目录里没有该服务，因此没有 provider fiber 可报。 | §2.1、§2.2、§2.5 |
| 插件**自身**的 entry fiber 状态？ | `include:zcode-dispatch` → `enabled: true`, **`fiberPhase: "active"`** | `plugin_manager list_plugins`（offset 100 页，逐字见附录 A） |
| 是否**尝试过**注册？ | **是**。`index.js:210` 在 `apply()` 里**无条件**调用 `attachHostWire(ctx, dispatcher, config)`；`wire.host.mjs:615-621` 的 `ctx.provide(FACE_NAME, face)` 外层守卫是 `typeof ctx.provide === 'function'`。 | 见 §2.7 |
| 失败了会怎样？ | **静默降级**：`catch { disposeProvide = null }`，返回值 `registered: disposeProvide != null`（即 `false`），**不抛、不白屏、不打日志**。 | `wire.host.mjs:614-621`、`:673` |

### 2.7 `ctx.provide` 是否存在？—— 存在（已定证）

`wire.host.mjs:616` 的守卫是 `typeof ctx.provide === 'function'`。若该守卫为假，则**根本没尝试过**，根因立刻锁定。核对官方 cordis 源码：

```js
// refs/extracted/cordis/src/context.ts:29-30
/** The reflection layer backing the context proxy (`ctx.get`, `ctx.provide`, ...). */
reflect: ReflectService
// refs/extracted/cordis/src/context.ts:78
this.reflect = new ReflectService(self)
```

```js
// refs/extracted/cordis/lib/index.js:800-823  (ReflectService.provide)
provide(name, value, check) {
  return this.ctx.fiber.effect(() => {
    if (!this.props[name]) this.props[name] ??= { type: "service" };
    else if (this.props[name].type !== "service") throw new Error(`property "${name}" is already declared as ${this.props[name].type}`);
    this.props[name] = { type: "service" };
    this.ctx.root[symbols.isolate][name] ??= Symbol(name);
    const key = this.ctx[symbols.isolate][name];
    const impl = { name, value, fiber: this.ctx.fiber, check };
    if (this.store[key]) throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`);
    this.store[key] = impl;
    this.ctx.fiber.store[name] = impl;
    if (this.ctx.fiber.state === 2) this.notify([name]);
    return async () => { delete this.store[key]; … };
  }, `ctx.provide(${JSON.stringify(name)})`);
}
```

结论：上下文注释**明写** `ctx.provide` 由 context proxy 转发到 `ReflectService`；官方客户端插件也确实直接写 `ctx.provide("theme", theme)`（`refs/extracted/dsh-client-ui-theme/lib/client.js:1582`）。**故守卫为真 → `provide` 已被调用过。**

由此，`zcodeDispatch` 缺席只剩两种可能，且**二者都无法用阶段 A 的只读手段区分**：

- **H1（provide 成功，仅未编目）**：服务已在运行时注册，客户端仍取不到 → 问题在**下游**（typert 描述符注册 / `$mount` / 客户端 `remote` 命名空间解析）。
- **H2（provide 抛错被吞）**：`ReflectService.provide` 会在**同名服务已被占用**时抛 `service "…" has been registered at <fiber>`（见上方 `lib/index.js:813`）。插件若经历 `_reload()`/开关切换而旧 fiber 的 disposer 未跑完，第二次 `provide` 就会踩这条并**被 catch 静默吞掉** → `registered: false`。

> 📌 补充事实（有利于 H2 排查）：`ctx.provide` 的注册**由 fiber effect 持有**，插件卸载应自动撤销；`attachHostWire` 的 `dispose()` 还会再调一次 `disposeProvide?.()`（`wire.host.mjs:687-691`）。但 DSH 的 `_reload()` 语义已知会**复用进程内已 import 的 runtime**（handoff §一「改动生效语义」）→ 快速连续重载下 fiber 生命周期的边界值得实测。

---

## 3. ③ Event 与 Tool 面（Z13 交叉验证）

### 3.1 宿主 Event 目录：75 条（完整原始输出已落盘）

与「工具注册」直接相关的 6 条（逐字）：

```json
{ "name": "tools/change",        "mode": "emit",
  "signature": "'tools/change'(): void",
  "description": "A tool was registered or unregistered, or a scoped restriction changed (the available tool set changed — possibly for one scope only)." }
{ "name": "tools/execute",       "mode": "waterfall",
  "signature": "'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>",
  "description": "Around-dispatch waterfall for timeout, retry, or metrics." }
{ "name": "tools/pre-execute",   "mode": "waterfall",
  "description": "Allow, deny, cancel, or ask before dispatch." }
{ "name": "tools/post-execute",  "mode": "waterfall",
  "description": "Accept, replace, enrich, or block a normalized dispatch result." }
{ "name": "tools/result",        "mode": "emit",
  "description": "Observe the frozen, lossless-JSON final outcome." }
{ "name": "tools/ptc-dispatch-log", "mode": "waterfall",
  "description": "Allow a listener to replace content in the DURABLE LOG COPY of one `run_code` sub-dispatch outcome …" }
```

其余 69 条覆盖 `agent/*`、`session/*`、`api-session/*`、`plugin-manager/*`、`subagent/*`、`workflow/*`、`workspace/*`、`llm/*`、`fs/*`、`credentials/*`、`goal/*`、`settings/*`、`skills/change`、`system-prompt/*`、`user-questions/request`、`approval/request`、`commands/change`、`schedule/changed`、`app-boot/config-reload`、`connection/request`、`domain/changed`、`hmr/*`、`webserver/index-inject` 等。
（**75 条中无任何 `zcode-*` 事件** —— 我们声明的 `zcode-dispatch/changed` 依赖「装配级事件源」，本版本 Event 目录里没有对应接线，与 `wire.host.mjs:586-589` 的自述「未接通时客户端以 1s 轮询兜底」一致。）

### 3.2 客户端 Event 目录：4 条（原始输出，逐字）

```json
{ "mode": "catalog", "events": [
  { "name": "connection/reset", "mode": "emit", "signature": "'connection/reset'(): void",
    "description": "A connection generation was established." },
  { "name": "locale/change",    "mode": "emit", "signature": "'locale/change'(snapshot: LocaleSnapshot): void",
    "description": "The active locale switched." },
  { "name": "slots/changed",    "mode": "emit", "signature": "'slots/changed'(key: string): void",
    "description": "An ordinary Slot declaration or entry registration set changed." },
  { "name": "theme/change",     "mode": "emit", "signature": "'theme/change'(snapshot: ThemeSnapshot): void",
    "description": "Theme state changed (preference switched, registry updated, or the OS color scheme changed while the preference is `system`)." }
] }
```

→ 客户端可用事件**只有这 4 条**，**没有任何 `remote/*` 或 `$on("<区域>/<事件>")` 的推送事件编目**。handoff §三.5 提到的 `ctx.remote.$on("<区域>/<事件>", cb)` 在本版本**无编目证据**，阶段 B 若要依赖推送，必须另找形态证据（或维持 1s 轮询兜底）。

### 3.3 宿主 Tool 面：`zcode_dispatch` **缺席**（原始输出核对）

`host` / `Tool` / `listTools` 返回的是「**本 Agent 当前可调用**的全部工具」。对完整落盘件跑 `grep -i zcode` → **No matches found**。

即：**`zcode_dispatch` 工具当前未注册成功**。与 `index.js:146-151` 的候选探测列表完全吻合：

```js
const candidates = [
  ['ctx.tools.define(def)',        () => ctx.tools?.define?.(definition)],
  ['ctx.tools.register(name, def)', () => ctx.tools?.register?.(definition.name, definition)],
  ['ctx.tools.add(def)',           () => ctx.tools?.add?.(definition)],
  ['ctx.tool.define(def)',         () => ctx.tool?.define?.(definition)],
];
```

### 3.4 `defineTool` 契约 —— 交叉验证结果（**证实 Z13 的方向**）

`tools` 服务在宿主目录里的**权威签名**（原始输出逐字）：

```json
{ "key": "tools",
  "description": "Tool registry and execution pipeline.",
  "methods": [
    { "signature": "presentAs(mode: ToolPresentationMode): () => void" },
    { "signature": "register(definition: ToolDefinition): () => void" },      ← 单参！不是 (name, def)
    { "signature": "restrict(filter: ToolRestriction): () => void" },
    { "signature": "guard(guard: ToolGuard): () => void" },
    { "signature": "get(name: string, scope?: ScopeKey): ToolDefinition | undefined" },
    { "signature": "schemas(scope?: ScopeKey): ToolSchema[]" },
    { "signature": "executionMode(exec: ToolExecutionInput): ToolExecutionMode" },
    { "signature": "async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>" }
  ] }
```

| 判定项 | 结论 | 依据 |
|---|---|---|
| `ctx.tools.register` 的真实签名 | **`register(definition: ToolDefinition)` —— 单参数** | 上方宿主目录签名 |
| `index.js:148` 的 `register(name, def)` 候选 | **形态错误**（把字符串当 `definition` 传进去） | 同上 |
| `ctx.tools.define` / `ctx.tools.add` / `ctx.tool.define` | **该服务的目录里不存在这三个方法** | 同上（目录列出 `presentAs/register/restrict/guard/get/schemas/executionMode/execute`） |
| 官方 `defineTool` 契约 | 仍以 handoff §四 阶段 C 为准：`import { defineTool } from '@deepseek-ai/dsh-tools'` + 插件 `inject = ['tools']` + `ctx.tools.register(defineTool({name, description, parameters, output, execute}))`；样例 `refs/dsh-tools/tool-fs-example/index.js:261,1176,1212`、契约 `refs/dsh-tools/schema.js:274-330` | handoff §四·阶段 C（**本轮未重复验证**，仅做签名侧交叉确认） |
| `@deepseek-ai/dsh-tools` 是否在装 | ✅ `include:tools` → `@deepseek-ai/dsh-tools`，`enabled: true`, `fiberPhase: "active"` | `plugin_manager list_plugins` |
| 注册成功后的可观测判据 | `tools/change` 事件（emit）+ `Tool.listTools` 里出现 `zcode_dispatch` | §3.1、§3.3 |
| 卸载函数形态 | `register` 返回 `() => void`（disposer）；**没有** `remove/unregister/undefine/dispose` 这些 `ctx.tools.*` 方法（目录未列） | 上方签名 + `index.js:157-166` 的注销探测列表 |

> 🎯 **给 Z13 的一条精确修正**：`index.js` 现有候选表里**没有一项**能命中；应改为 `ctx.tools.register(defineTool({ … }))`，并把注销函数改成**直接用 `register` 的返回值**（`const dispose = ctx.tools.register(def)`），而不是探测 `ctx.tools.remove/unregister/undefine/dispose`。
> （本轮**未改** `index.js` —— 属 Z13 写者范围。）

---

## 4. 结论汇总

| # | 判据 | 阶段 A 结论 | 置信度 |
|---|---|---|---|
| ①-1 | `shell.overlay` 是否存在、形态 | ✅ 存在；`kind=list`, `scope=root`, `replaceRisk=none`；唯一子槽 `shell.quota-notice`(chain) | **确定** |
| ①-2 | `id=zcode-dispatch.console` 是否已注册 | ✅ **已注册且 `active:true`、`order:20`** | **确定** |
| ①-3 | 面板不可见（P0）在槽位层是否还有残留 | ✅ 无残留 —— 槽位注册这条路是通的 | **确定** |
| ①-4 | 官方对 `shell.overlay` 的点击语义 | 🆕 浮层**本身 click-through**，occupant 必须自行 opt-in `pointer-events` | **确定**（catalog 原文） |
| ②-1 | 宿主 Service 目录里是否有 `zcodeDispatch` | ❌ **没有**（91 个 key，全量核对无命中） | **确定** |
| ②-2 | 宿主 entry fiber 是否 active | ✅ `include:zcode-dispatch` = `enabled:true`, `fiberPhase:"active"`；config `status:"schema"` | **确定** |
| ②-3 | `ctx.provide` 是否存在（守卫是否为真） | ✅ 存在（context proxy → `ReflectService.provide`）→ **已被调用过** | **确定** |
| ②-4 | **「目录里没有」能否证明「运行时没提供」** | ❌ **不能** —— 该 provider 是**类型声明目录**，非运行时注册表 | **确定**（TS 语法铁证） |
| ②-5 | `zcodeDispatch` 到底注册成功没有 | ⚠️ **阶段 A 无法判定**（H1 已注册仅未编目 / H2 provide 抛错被吞） | **未定** |
| ②-6 | 客户端可调用 `remote.*` 清单 | ✅ 已导出：**27 个 namespace**（§2.4），**不含 `zcodeDispatch`** | **确定**（清单本身） |
| ②-7 | 客户端 `remote` 服务是否在目录里 | ❌ 不在（但 handoff §三.3 证其运行时可用）→ 反证 ②-4 | **确定** |
| ③-1 | `zcode_dispatch` 工具是否已注册 | ❌ **未注册**（`Tool.listTools` 无命中） | **确定** |
| ③-2 | `ctx.tools.register` 真实签名 | ✅ `register(definition: ToolDefinition)` —— **单参** | **确定** |
| ③-3 | `index.js` 现有 4 个候选是否可行 | ❌ 全部不可行（`(name,def)` 形态错误；`define/add/ctx.tool.define` 不存在） | **确定** |
| ③-4 | 客户端推送事件编目 | 仅 4 条（`connection/reset`、`locale/change`、`slots/changed`、`theme/change`）；**无 `remote.$on` 编目证据** | **确定**（编目范围） |
| ③-5 | 宿主 `zcode-dispatch/changed` 事件 | 75 条宿主事件里**无对应接线** → 与 `wire.host.mjs:586-589` 自述一致，1s 轮询兜底 | **确定**（编目范围） |

**一句话**：**槽位这一跳是通的（面板能出现是对的）；工具这一跳形态错了（Z13 方向正确）；Remote 这一跳「目录查不到」既不能证实也不能证伪，必须靠另一种判据。**

---

## 5. 未确定项（宁缺毋编）

1. **H1 / H2 未分**（§2.5、§2.6）：`ctx.provide('zcodeDispatch', face)` 在 14:12:56 那次启动里是成功还是抛错被吞，**阶段 A 没有任何只读手段可观测**。这是 P2 的唯一真正未知数。
2. **`remote.*` 清单是「反推」而非「直读」**（§2.4）：无 Remote provider，清单按宿主 `@Remote` 注解推导；**未**验证 `ctx.remote` 在客户端是否对这 27 个 namespace 全部实际可解析。
3. **`remote.$on("<区域>/<事件>")` 的推送形态未定证**（§3.2）：客户端事件目录只有 4 条，本版本是否支持 `$on` 推送**无编目证据**（handoff §三.5 的引用来源是官方插件管理页 bundle，本轮未复核）。
4. **75 / 91 等计数为人工清点**（§2.2、§3.1）：逐条数自完整落盘件，未用脚本 `count`。
5. **`shell.overlay` 的 `pointer-events` opt-in 现状未查**（§1.3-4）：只读到官方约束，**未**核对 `client.js` 现有 CSS 是否已 opt-in（属写者范围，本轮不碰）。
6. **`.data\{locks,logs,state}` 的 14:04:41 时间戳**未追新：本轮仅确认三目录存在（`git status` 干净、无 `jobs.json`），与 handoff §一「自 14:04:41 起无新写入」一致；**未**再采样一次判断是否有变化。

---

## 6. 阶段 B 建议（等 DSH 放行后执行；本轮不做）

按「先取判据、再改代码」排序，**每一步都给出可复跑的判别实验**：

1. **先分 H1/H2（最高优先，1 个实验定方向）** —— 任选其一：
   - **E1（推荐，最小侵入）**：在 `attachHostWire` 的 `catch` 里补一行 `log('warn', 'ctx.provide 失败：' + e.message)`，并让 `index.js` 把 `wire.registered` 写进启动日志；重启 DSH 后读日志即知。
     → 若日志出现 `service "zcodeDispatch" has been registered at <fiber>` ⇒ **H2**（旧 fiber 残留），修法是**不要手写 provide，改走官方形态**（`TypertRemoteService` 子类 / `bindTypertRemote()`，见 `refs/dsh-typert/protocol/lib/index.js:146-157,248-268`；官方完整 host 半边：`refs/dsh-typert/plugin-manager/lib/index.js:1184-1212` 用 `extends TypertRemoteService` + `@Remote` 装饰器）。
     → 若日志无 warn 且 `registered: true` ⇒ **H1**，问题在 typert 描述符注册或客户端 `$mount`，转 2。
   - **E2（纯只读，但需临时脚本）**：宿主侧一次性脚本调 `ctx.typert.listPackages()` / `ctx.typert.get('@local/zcode-dispatch#zcodeDispatch/snapshot')`，看宿主是否真的注册了 strict 描述符（`typert` 服务已在目录，签名 `register/get/resolve/list/getPackage/listPackages/toJSONSchema`）。
2. **对齐官方 host 半边**（若 H2 或描述符未注册）：以 `refs/dsh-typert/plugin-manager/lib/index.js`（`TypertRemoteService` + `@Remote`）与 `lib/typert.host.js` 为模板，替换 `wire.host.mjs` 手写的 `ctx.provide` + 手写方法标记；客户端 `$mount(REMOTE_CONTRIBUTION)` 对齐 `refs/dsh-typert/registry/lib/client.js`。
3. **Z13 工具注册**（独立于 P2，可并行）：按 §3.4 改为 `ctx.tools.register(defineTool({...}))` + 用返回值作 disposer；判据 = `Tool.listTools` 出现 `zcode_dispatch` + `tools/change` 事件。
4. **验收判据（handoff §六）不变**：徽标「演示数据」→「**已连接**」；`.data\state\jobs.json` 出现。
5. **回归门禁**（每次改完宿主半边）：`node tools/verify-plugin.mjs`（20/20）、`node test/core.test.mjs`、`node test/channel-retry.test.mjs`、`node --check` 四件；宿主改动后**必须完全重启 DSH**。

---

## 附录 A：原始输出落盘位置（本轮 provider 返回的完整件）

| 查询 | 落盘文件 |
|---|---|
| `host` / `Service` / `listService`（91 服务全量，含 `@Remote` 116 处） | `C:\Users\ADMINI~1\AppData\Local\Temp\dsh-spill-MgSTLr\session-283b1745d551\395ec77fbfca-cordis_inspect_query.txt` |
| `host` / `Tool` / `listTools`（本 Agent 全量工具） | `C:\Users\ADMINI~1\AppData\Local\Temp\dsh-spill-MgSTLr\session-283b1745d551\3602bc3be8c2-cordis_inspect_query.txt` |
| `client` / `Slots` / `listSubTree`（root 全树，含 14473B 省略段） | `C:\Users\ADMINI~1\AppData\Local\Temp\dsh-spill-MgSTLr\session-283b1745d551\f2c13620ee75-cordis_inspect_query.txt` |

> ⚠️ 上述为 **Temp 目录**，系统清理后即失效。**未**复制到仓库（避免污染 git）；阶段 B 若要留档，建议复制到 `collab/logs/` 或 `tasks/raw/` 后再引用。

**未落盘（完整内联，未截断）的原始输出**：`client`/`Slots`(root=shell.overlay)、`client`/`Service`/`listService`、`host`/`Event`/`listEvents`、`client`/`Event`/`listEvents`、`host`/`Config`/`listConfigs`、`plugin_manager` 两页共 195 条 entry —— 均已按需摘录在上文（§1.1、§2.3、§3.1、§3.2、§0）。

**关键单条原始输出**（逐字，无摘录）：

```
# plugin_manager list_plugins（offset=100 页内）
{"entryId":"include:zcode-dispatch","moduleName":"@local/zcode-dispatch","enabled":true,"fiberPhase":"active","patchId":"zcode-dispatch"}

# host Config listConfigs {name:"@local/zcode-dispatch"}
{"entries":[{"id":"include:zcode-dispatch","patchId":"zcode-dispatch","name":"@local/zcode-dispatch","status":"schema"}],"total":1,"nextOffset":null}

# host Service listService {service:"zcodeDispatch"}
Error: no catalogued Service named "zcodeDispatch"

# client Service listService {service:"remote"}
Error: Service.listService: Client inspect query Service.listService timed out after 10000ms. Client failure: provider-error: no catalogued Service named "remote"

# crash log（既有事故，非本轮）
C:\Users\Administrator\AppData\Roaming\@deepseek-ai\dsh-desktop\logs\crash-2026-09-30T06-05-03-662Z-web-boot.log:13
@local/zcode-dispatch: pending (waiting for service: remote.zcodeDispatch)
```

## 附录 B：本轮**只读**读取的文件（零写入）

**插件源码（只读，Z12/Z13 写者范围，未写）**

| 文件 | 读取内容 | 备注 |
|---|---|---|
| `zcode-dispatch\wire.host.mjs` | 全文 701 行 | 重点 `:41-97`（Z12 开关读写）、`:365-501`（`createRemoteFace`）、`:547-594`（`TYPERT`）、`:606-621`（`ctx.provide`）、`:670-700`（返回值/`registered`） |
| `zcode-dispatch\index.js` | `:125-239` + 关键词 grep | 重点 `:146-151`（工具注册候选）、`:193-239`（`apply()`，`:210` 无条件 `attachHostWire`） |
| `zcode-dispatch\package.json` | 全文 14 行 | `exports["./typert"] = "./wire.host.mjs"` ✅；`dsh.client = {platform:"web", immediately:true, inject:["@deepseek-ai/dsh-client-ui-conversation"]}` |
| `tasks\Z12-delivery.md` | `:1-70` | 仅用于确认「所读源码 = Z12 之后」；**未据此采取任何行动** |

**官方证据（refs/，只读）**

| 文件 | 行 | 用途 |
|---|---|---|
| `refs\extracted\cordis\src\context.ts` | 29-30, 78 | 证 `ctx.provide` 经 context proxy → `ReflectService` |
| `refs\extracted\cordis\lib\index.js` | 782-824 | `ReflectService.set/provide` 实现；同名冲突抛错文案 |
| `refs\extracted\cordis\src\reflect.ts` | 46, 270-304 | `provide(name, value?, check?)` 契约 |
| `refs\extracted\cordis\src\registry.ts` | 107-108 | `provide?: string \| string[]`（registry 侧声明） |
| `refs\extracted\dsh-client-ui-theme\lib\client.js` | 1567-1582 | 官方 `ctx.provide("theme", …)` 形态（在目录里） |
| `refs\extracted\dsh-client-ui-layout\lib\client.js` | 585-600 | 官方 `ctx.reflect.provide("layout", …)` 形态（在目录里） |
| `refs\extracted\dsh-client-ui-renderer\client.js` | 1844 | `ctx.reflect.provide("uiRenderer", …)`（**不在**目录里）→ 反证 |
| `refs\extracted\dsh-client-modules\lib\client.js` | 868 | `ctx.reflect.provide("modules", …)`（**不在**目录里）→ 反证 |
| `refs\dsh-typert\plugin-manager\lib\index.js` | 8, 1184-1212 | 官方 host 半边：`extends TypertRemoteService` + `@Remote` 装饰器（阶段 B 模板） |

**未读取**（按 handoff §四 阶段 C 明示「别再重复验证」且不属阶段 A）：`refs\dsh-tools\**`、`refs\dsh-typert\protocol|loader|registry` 的实现细节、`client.js` / `wire.client.mjs` / `locale`（Z12/Z13 写者范围）。

---

## 附录 C：本轮命令足迹（可复跑核对）

```powershell
# 1) 插件 entry / fiber 状态
cordis_inspect_query host  Service listService            # 91 服务全集（无 zcodeDispatch）
cordis_inspect_query host  Service listService {service:"zcodeDispatch"}
cordis_inspect_query host  Config  listConfigs {name:"@local/zcode-dispatch"}
cordis_inspect_query host  Event   listEvents             # 75 条
cordis_inspect_query host  Tool    listTools             # 无 zcode_dispatch
cordis_inspect_query client Service listService           # 8 服务（无 remote）
cordis_inspect_query client Event   listEvents            # 4 条
cordis_inspect_query client Slots   listSubTree
cordis_inspect_query client Slots   listSubTree {root:"shell.overlay"}
plugin_manager list_plugins {offset:0,limit:100}          # total 195
plugin_manager list_plugins {offset:100,limit:100}

# 2) .data 三态（只读）
Get-ChildItem 'F:\My Code\dsh-plugins\zcode-dispatch\.data' -Recurse -Force
git -C 'F:\My Code\dsh-plugins' log --oneline -3          # e2d98ab / 1864f95 / 9a8ced2
git -C 'F:\My Code\dsh-plugins' status --short            # 空（干净）

# 3) 运行时日志（只读）
Get-ChildItem "$env:APPDATA\@deepseek-ai\dsh-desktop\logs"   # 仅 2 个 crash-*.log（14:04/14:05）
Select-String -Path "$env:APPDATA\@deepseek-ai\dsh-desktop\logs\*.log" -Pattern 'zcode'
```

> 复跑提示：`plugin_manager` 与 `cordis_inspect_query` 均为**只读**动作；`list_plugins` 的 `total=195` 会随插件安装/启停变化，比对时以 `include:zcode-dispatch` 单条为准。

---

**本轮到此为止，等待 DSH 通知「Z12/Z13 已放行」后再进入阶段 B。**
