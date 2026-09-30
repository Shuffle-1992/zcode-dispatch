---
round: Z13
seq: "01"
type: delivery
status: delivered
created: 2026-09-30T17:30:00+08:00
refs: tasks/Z13-01-task.md
---

# Z13 交付：用官方 API 真正注册 agent 工具 `zcode_dispatch`

> 结论先行：`index.js` 已改为官方契约 `ctx.tools.register(defineTool({...}))`，并导出
> `name` / `inject = ['tools']`；**真实现**（工作区提取的 `refs/dsh-tools/lib/index.js`，
> 即官方包 lib 产物）完整接受了本插件的参数 spec 与 output 形态（14/14 保真断言）。
> 本地全部门禁绿：verify-plugin 20/20、core.test 11/11、channel-retry 8/8、冒烟
> 主路径 17/17 + 降级 11/11（冒烟脚本按包要求跑完即删）。
> **真机验收 = 用户新开一个 DSH 会话，看工具列表里是否出现 `zcode_dispatch` 并能
> `action:'status'`**（本机标准模式会话无法自省工具列表，本地探针代替不了这一步）。

## 一、改动清单

| 文件 | 改动 |
|---|---|
| `zcode-dispatch/index.js` | ① 新增 `loadDefineTool()` + 顶层 `const defineTool = await loadDefineTool()`（动态 import，失败降级 null）；② 新增导出 `name` / `inject = ['tools']`；③ `TOOL_PARAMETERS` 由 JSON Schema 重写为官方参数 spec；④ 重写 `registerZcodeDispatchTool()`（官方注册 + 三重降级），删除全部四个猜测候选；⑤ 头部说明第 2 点更新为官方契约 |
| `zcode-dispatch/README.md` | 替换已过期的「⚠ 注册 API 未经 inspection 确认」段落；新增「其他会话如何发现并调用（Z13）」一节（status 查开关 → switch 切换 → 关闭时 dispatch/retry 被拒 → 注册降级的判别） |
| `pitfalls.md` | 新增 Z13 五条踩坑（静态 import 陷阱 / output 必填 / DSL 词汇 / validateArgs 入参 / 模块钩子通路） |

未动：`core/*`、`client.js`（客户端 `inject` 保持 `['slots','remote']`）、`wire.host.mjs`、`cordis.patch.yml`、宿主仓库；未安装依赖、未写 `$DSH_HOME`、未执行任何 git 操作。

## 二、我确定的官方契约（贴代码 + 文件:行号）

**包身份与导出面**
- `refs/dsh-tools/package.json`：`"name": "@deepseek-ai/dsh-tools"`、`"version": "0.2.0-rc.2"`、`exports["."] → ./lib/index.js`
- `refs/dsh-tools/lib/index.js:3714`：`export { … defineTool, parameterSchemaSpecToJsonSchema, validateArgs, … }`

**官方注册调用**（`refs/dsh-tools/tool-fs-example/index.js`）
- `:261` `ctx.tools.register(defineTool({ name: "read", description: …, parameters: { file_path: { type: "string", required: true, description: … }, offset: { type: "number", … } }, output: { schema: {…}, … } }))`
- `:1174` `const name = "tool-fs"`；`:1176-1180` `const inject = ["tools", "fs", "systemPrompt"]`；`:1212` `export { Config, apply, inject, name }`

**defineTool 契约**（`refs/dsh-tools/lib/index.js`）
- `:838` `function defineTool(options)`；`:848` `const parameters = parameterSchemaSpecToJsonSchema(options.parameters)`
- `:842` `const userRender = options.output.render;` 与 `:849` `const outputSchema = valueSchemaSpecToJsonSchema(options.output.schema);` —— **output 不可省略**（任务包「若可省略就省略」按真契约为假）
- `:866-870` `async execute(args, exec) { const violations = validate(args); if (violations.length > 0) throw new ToolArgsError(violations); return userExecute(args, exec); }` —— execute 先官方校验再透传
- `:813` `ToolArgsError`（`"invalid arguments: …"`，`code: "INVALID_ARGS"`）

**参数 spec 编译**（同文件）
- `:802-811` `parameterSchemaSpecToJsonSchema(spec)`：隐式 property map → object 根 JSON Schema，字段级 `required:true` 收拢为顶层 `required` 数组
- `:603-604` `required` 只能是 `true`（`".required must be true when present"`）
- `:688-691` `case "json":` → 编译为注解即无约束 JSON（模块头 `:9-14`：「Annotation-only schemas are accepted as the standard unconstrained-JSON form」）——**本单 output.schema 选 `{ type: 'json' }` 的依据：最小合法且最宽松，任意 JSON 返回值都合法**（真实现编译产物已实证为 `{}`）
- `:699` `type:'object'` 必须显式带 boolean `additionalProperties`（DSL 词汇里没有 `exclusiveMinimum`/`minimum`，数字范围约束只能进 description）

## 三、复现命令 + 原始输出

冒烟脚本已按「跑完即删」删除；其原始输出如下（冒烟桩：`ctx.tools.register` 捕获 + data URL 模块桩；保真脚本让真实 `defineTool` 亲自编译注册）。

**① `node --check index.js`**
```
SYNTAX OK
```

**② `Z2_ALLOW_PROFILE_WRITE=1 node tools/verify-plugin.mjs`（20/20）**
```
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  Config 是 Standard Schema（cordis 激活判据）  {"demo":false,"maxConcurrent":1,...}
PASS  index.js 引用 core dispatcher  imports core
...（其余 16 项同绿）
[DSH Z2 探针] 20 项，失败 0 项
```
（profile 项按 `Z2_ALLOW_PROFILE_WRITE=1` 放行：用户已安装插件，写入属预期。）

**③ 回归**
```
node test/core.test.mjs          → ℹ tests 11  ℹ pass 11  ℹ fail 0
node test/channel-retry.test.mjs → ℹ tests 8   ℹ pass 8   ℹ fail 0
```

**④ 冒烟·主路径（桩 ctx 有 tools.register + dsh-tools 可解析）17/17**（已删）
```
PASS  export name === zcode-dispatch  zcode-dispatch
PASS  export inject === ['tools']  ["tools"]
PASS  inject 不含任何 remote.*
PASS  恰好捕获 1 个工具  count=1
PASS  captured.name === 'zcode_dispatch'  zcode_dispatch
PASS  typeof captured.execute === function
PASS  工具描述含注册时刻开关状态  操作「ZCode 派发台」：…（当前：已开启）。…
PASS  parameters 是官方 spec 对象（非 JSON Schema 包装）
PASS  parameters.action 带 type/description（官方 spec 形状）  {"type":"string","required":true,"enum":["dispatch",…,"status","switch",…],"description":"操作类型"}
PASS  action 枚举含 status 与 switch
PASS  action.required === true
PASS  enabled/chain 字段 spec 形状保持
PASS  output = { schema:{type:'json'}, render } 最小合法形态
PASS  execute({action:'status'}) 可 JSON 序列化且 ok:true  {"ok":true,"switch":{"enabled":true,…,"source":"default(无文件=开启)"}}
PASS  非法 action 被 defineTool 校验层拒绝  ToolArgsError: …
PASS  apply 返回 {dispatcher, wire, handleAction}（假 runner 就绪）
PASS  卸载清理（ctx.effect 注册的 disposeAll）不抛
```

**④b 冒烟·降级（dsh-tools 解析失败 / ctx 无 tools / register 非函数）11/11**（已删）
```
PASS ① defineTool 缺失：apply 不抛 / 不注册任何工具 count=0 / 打出降级 warn / 卸载清理不抛
PASS ② ctx 无 tools：apply 不抛 / 不注册任何工具 / 打出降级 warn / 卸载清理不抛
PASS ③ register 非函数：apply 不抛 / 打出降级 warn / 卸载清理不抛
```

**④c 保真·真 defineTool（模块钩子把 `@deepseek-ai/dsh-tools` 短路到 refs/dsh-tools/lib/index.js）14/14**（已删）
```
PASS  真实现 defineTool 已加载（refs/dsh-tools/lib/index.js）
PASS  真实 defineTool 接受本插件 spec 并注册（捕获 1 个）  count=1
PASS  真实编译：parameters.type=object 且 required=[action]  ["action"]
PASS  真实编译：action 枚举含 status/switch
PASS  真实编译：timeoutMin 无 DSL 外键残留
PASS  真实编译：output schema = 注解即无约束 JSON（{}）  {}
PASS  真实 execute：{action:status} 过校验 → ok:true
PASS  真实 execute：可选字段（tail 无 id）过校验进入 handler  {"ok":false,"error":"tail 需要参数 id"}
PASS  真实 execute 拒绝：缺必填 action  missing required property "action"
PASS  真实 execute 拒绝：枚举外 action  "action" must be one of […]
PASS  真实 execute 拒绝：enabled 非布尔  "enabled" must be a boolean
PASS  真实 execute 拒绝：chain 非字符串数组  "chain[0]" must be a string; "chain[1]" must be a string
PASS  卸载清理不抛
```

**⑤ 真机验收口径**：新开 DSH 会话 → 工具列表出现 `zcode_dispatch` → 先 `action:'status'` 查开关，再按需 `action:'switch'`。**宿主半边改动必须完全退出 DSH 再启动**（pitfalls Z10-2：切开关/重载不会重新 import 磁盘代码）。

## 四、与任务包的三处偏离（均按硬约束优先，已辩证核实）

1. **静态 import → 动态 import + 降级**。任务包要求「顶部加 `import { defineTool } from '@deepseek-ai/dsh-tools';`」，但本地 node_modules 无该包（只有 cosmokit/schemastery），静态 import 会让模块加载即炸——`tools/verify-plugin.mjs:38` 会**真实 import index.js**，门禁「Config 是 Standard Schema」项必红；宿主真缺包时激活直接死，违反本单「激活安全第一」与 pitfalls Z10-1。采用本文件 `loadConfig()` 同款动态 import（宿主内解析到同一个官方包，语义等价，失败降级不抛）。
2. **output 不省略**。任务包「若 output 可省略就省略」——`defineTool` 无条件读 `options.output.render`/`.schema`（lib/index.js:842/:849），省略即 TypeError。选最小合法形态 `{ schema: { type: 'json' }, render }`，依据见第二节。
3. **参数字段 21 个（任务包列 15 个）**。任务包硬约束「枚举/必填保持与 createActionHandler 的实际入参一致（实现与 schema 不许漂移）」：`createActionHandler` 还真实消费 `by`/`note`（switch）、`memoryBench`/`lock`（dispatch）、`n`（tail）、`retryModel`（retry），删掉它们才是漂移，故全保留。

## 五、未决问题

1. **真机验收未做**（无法本地替代）：需要用户重启 DSH 后新开会话确认工具出现且 `status` 可用。
2. **`test/z2-verify.mjs` 豁免过期**：其 `:118/:120/:134` 断言「index.js 的 @deepseek-ai 仅 schemastery 一处 / 裸说明符只豁免 schemastery」，本单后为两处。该脚本是遗留探针、不在现行门禁（现行=verify-plugin 20/20，pitfalls Z11-3），且本单硬约束限定只动 index.js/README/pitfalls，故未改；下轮按 Z5-1 先例同步豁免即可。
3. **git 状态异常（非本单操作）**：进行期间并发会话提交了 `2f231b3`（Z14 pointer-events，作者 DSH@local 15:35），把本单当时的 index.js/README 改动与 6 个冒烟文件一并扫进了它的提交。当前未提交残留 = `pitfalls.md`（+8 行 Z13 条目）与 6 个冒烟文件的删除（跑完即删的正确产物）。本单未执行任何 git 操作；残留如何落库请用户指示。
4. `output.render` 目前把 execute 的 JSON 字符串原样作为 text 块返回（与旧版工具结果契约一致）。若日后想让模型侧看到结构化渲染，可在此按动作定制——不影响本次注册。
