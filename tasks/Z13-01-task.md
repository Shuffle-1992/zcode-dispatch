---
round: Z13
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T15:00:00+08:00
---

# Z13 任务包：用**官方 API** 真正注册 agent 工具 `zcode_dispatch`（让其他 DSH 会话能发现并调用）

> 用户的问题：「在 DSH 新开会话，它可以知道并调用这个 ZCode 功能么？」
> **当前答案是不能** —— 我们 `index.js` 的工具注册用的是**猜的候选**（`ctx.tools.define` / `ctx.tools.register(name,def)` / `ctx.tools.add` / `ctx.tool.define`），全部不对，工具从未注册成功。
> **本单把它接对**。DSH 已挖到官方契约（证据在工作区，别再猜）。

## 一、官方契约（DSH 已从 asar 提取，路径可直接读）

| 证据 | 位置 |
|---|---|
| 官方工具注册调用 | `refs/dsh-tools/tool-fs-example/index.js:261` → `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))` |
| 插件必须导出的服务依赖 | 同文件 `:1176` `const inject = ["tools","fs","systemPrompt"]`；`:1212` `export { Config, apply, inject, name }` |
| `defineTool` 契约实现 | `refs/dsh-tools/schema.js:274` ~ `:330`（`options.execute` 是体；`timeoutMs` 可选；内部做参数编译与校验；`ToolArgsError` / `validateArgs` 同文件导出） |
| 包导出面 | `refs/dsh-tools/index.js:41` `export { defineTool, valueSchemaSpecToJsonSchema, parameterSchemaSpecToJsonSchema, validateArgs, ToolArgsError }` |
| 参数 spec 形状（注意与 JSON Schema 不同） | 例：`parameters: { file_path: { type:'string', required:true, description:'…' }, offset: { type:'number', description:'…' } }` |
| 输出面形状 | 例：`output: { schema: { type:'object', additionalProperties:false, properties:{…} }, render: (args, value) => [...] }` |

> `@deepseek-ai/dsh-tools` 随 dsh 出货，**bundle 无需声明依赖**即可 import（与 `schemastery` 同理）。

## 二、要改的（只动 `zcode-dispatch/index.js`，必要时 README/pitfalls）

1. 顶部加：`import { defineTool } from '@deepseek-ai/dsh-tools';`
2. 新增导出：`export const inject = ['tools'];`（**只加 `tools` 这一个**；`tools` 由 dsh 基础 bundle 提供，必定存在）
3. 新增导出：`export const name = 'zcode-dispatch';`
4. **重写** `registerZcodeDispatchTool()`：
   ```js
   function registerZcodeDispatchTool(ctx, log, handleAction) {
     if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
       log('warn', 'ctx.tools.register 不可用：agent 工具 zcode_dispatch 未注册（非致命，UI 与派发核心不受影响）');
       return null;
     }
     const def = defineTool({
       name: 'zcode_dispatch',
       description: TOOL_DESCRIPTION,      // 按 Z12 要求：描述里带能力 + 当前开关状态
       parameters: TOOL_PARAMETERS,        // 改成官方 spec 形状（见下）
       output: { /* 按 refs/dsh-tools/schema.js 契约给最小合法形态 */ },
       async execute(args, exec) { … handleAction(args.action, args) … },
     });
     ctx.tools.register(def);
     log('info', 'agent 工具 zcode_dispatch 已注册（官方 ctx.tools.register + defineTool）');
     return () => { /* 若 registry 提供 remove/unregister 就调用；否则返回空函数 */ };
   }
   ```
   - ❌ 删掉原来的四个猜测候选（`ctx.tools.define/register(name,def)/add/ctx.tool.define`）；
   - ✅ **任何失败都不许抛**（激活安全第一）：整体包 try/catch，失败只 `log('warn', …)` 并返回 `null`。
5. `TOOL_PARAMETERS` 从"JSON Schema（properties）"改成**官方参数 spec**（逐字段 `{type, required, description}`）；字段保留现有语义：`action`（枚举，含 `status`/`switch`，以 Z12 落地为准）、`kind`、`prompt`、`task`、`target`、`provider`、`model`、`mode`、`cwd`、`tag`、`timeoutMin`、`resume`、`id`、`enabled`（switch 用）、`chain`。
   - 枚举/必填保持与 `createActionHandler` 的实际入参一致（**实现与 schema 不许漂移**）。
6. `output`：以 `refs/dsh-tools/schema.js` 的真实契约为准选**最小合法形态**（若 `output` 可省略就省略；若必填，用 `{schema:{type:'object', additionalProperties:true, properties:{}}}` 之类最宽松形态，或按你们既有返回结构声明）。在交付文档里写清你选了哪种、依据是 schema.js 的哪几行。
7. README 增加一节「其他会话如何发现并调用」：工具名 `zcode_dispatch`、能力、`action:status` 查开关、`action:switch` 切换、以及"关闭时 dispatch 会被拒"。

## 三、硬约束

- ❌ **启动安全**：客户端 `inject` 保持 `['slots','remote']` 不许动；宿主只允许新增 `inject = ['tools']`；不得出现自家 `remote.*`；任何注册失败都要降级不抛。
- ❌ 不改 `core/*`；不改 宿主仓库；不安装、不写 `$DSH_HOME`、不 npm 依赖、不 git。
- ✅ 若 Z12 已把开关状态写进 `TOOL_DESCRIPTION`，保持它（本单只改注册方式与参数形状）。
- ✅ 每步落盘；不通读大文件（用给出的行号定位）。

## 四、自检（贴原始输出）

1. `node --check index.js`
2. `Z2_ALLOW_PROFILE_WRITE=1 node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"` → **20/20**
3. `cd zcode-dispatch && node test/core.test.mjs`、`node test/channel-retry.test.mjs` 不回归
4. **新增本地冒烟（跑完即删）**：桩 ctx `{ tools: { register(def){ captured = def; } }, logger: console, … }`
   - `apply(ctx, config)` 后**恰好捕获 1 个工具**，`captured.name === 'zcode_dispatch'`，`typeof captured.execute === 'function'`；
   - `captured.parameters.action` 是官方 spec 形状（对象且带 `type`/`description`），且 `action` 的枚举包含 `status` 与 `switch`；
   - `await captured.execute({ action:'status' })` 返回可 JSON 序列化的结果；
   - **桩 ctx 无 `tools`（或 `register` 非函数）时 `apply` 不抛**，且返回 `null` 注册句柄；
   - `export const inject` 含 `'tools'` 且**不含**任何 `remote.*`。
5. 明确写一句：**真机验收 = 用户新开一个 DSH 会话，看工具列表里是否出现 `zcode_dispatch` 并能 `action:'status'`**（本机标准模式会话无法自省工具列表）。

## 五、交付

`tasks/Z13-delivery.md`：改动清单 / 你确定的官方契约（贴代码 + `refs/dsh-tools/**` 的文件:行号）/ 复现命令 + 原始输出 / 未确定项。回复同样简短四段。
