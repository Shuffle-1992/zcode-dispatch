# 踩坑记录（pitfalls）

> 按全局规则维护：遇到踩坑问题登记于此，避免重复踩坑。新条目置顶。

## 2026-10-05 ZB-22（派发台落地自动唤醒；以及「host 代码改动何时才真生效」）

现场问题（用户报告）：「派发任务时会话窗口不等待、直接继续；任务跑完没人叫醒它，得我自己再发一句。
DSH 自带的后台任务完成时会自动把会话拉起来，派发台也应该这样。」

1. **第三方插件派出去的后台工作，宿主**不会**替你叫醒会话 —— 必须自己投递通知**。DSH 自带 `job_*` 的那套（`@deepseek-ai/dsh-tool-jobs`）是它自己的实现，不是通用服务：它在 job 落地时把一条 user 角色消息投进**发起它的那个会话**（空闲 `agent.followup` 开新一轮、忙碌 `agent.inject` 插下一步）。派发台原来只有 `dispatch`（fire-and-forget）+ `wait`（主动等），于是「会话不等待」这个正确行为变成了「跑完没人叫醒」这个错误体验。正解就照它的契约抄：`exec.agent.id`（工具 `execute(args, exec)` 第二参）登记归属 → 订阅 `dispatcher` 的 `job-updated` 判落地 → `ctx.get('agents').get(会话id)` 投递。DSH 那侧的三个实现细节必须一起抄对：① 判据用「终态 **+ paused**」（paused 也要人来决定续跑/换通道，干等是错的）；② `form` 只能写 `'notice'`（客户端 `contextBody` 对未知 form 直接 `throw unreachable context form`，不是降级渲染）；③ 自己 kill 的、自己 `wait` 已等到落地的 job 要**抑制**通知（否则「自己做的事又叫醒自己」，对应它的 `killedByModel`/`awaited`）。证据：test/notify.test.mjs 17 项 + test/wake-integration.test.mjs 3 项（后者跑真 `apply()` + 假 runner，断言落地后 `followup` 恰好一次）。

2. **`agents` 服务要在「投递那一刻」懒解析，别用 `ctx.inject(['agents'], …)` 等它就绪**。第一版写成 `ctx.inject`，看着更「cordis 正统」，但语义上它把「唤醒能不能用」绑在了「服务解析时机是否恰好赶上 apply」上——服务在子作用域/晚注册时回调永不来，**唤醒静默失效且没有任何报错**（信标只会停在 `wakeActive:false`）。改成 apply 里就建唤醒器、投递时 `ctx.get('agents')` 现取，并把这个事实写进激活信标（`agentsVisible`）。**活体契约核对**（宿主自带的 Inspect Provider，`cordis_inspect_query {platform:'host', provider:'Service', method:'listService', input:{service:'agents'}}`）明确把两条路分开了：`access.optional = ctx.get("agents")` 且 `requiresUndefinedCheck: true`；`access.hardDependency = inject:["agents"]` → `ctx.agents`。也就是说 `ctx.get` 就是官方给「可选依赖」的正门（未注册/未激活返回 undefined，不抛）。教训：**增强型能力不能有「时机依赖的静默失败」**，宁可每次现取。

3. **改 host 代码（index.js 等）后，动 profile patch 只会「重新 apply 已缓存的模块」——新代码要重启 DSH 才生效**。A/B 实证：14:40:20 落盘新 `index.js` → 14:40:46 改 profile `cordis.patch.yml` → 14:40:49 信标 `at` 更新（说明 apply 确实重跑了），但信标里**没有**新代码才会写的 `notifyOnSettle/wakeActive` 字段 = 跑的还是旧模块。原因：`@deepseek-ai/dsh-hmr` 的模块监听根是 profile 目录（`root:["."]`，且默认 `ignored` 含 `**/node_modules`），本插件在仓库路径、又经 `profiles/<p>/node_modules/@local/<pkg>` 软链装配，**两头都不在监听面内**；profile patch 的变更走的是「配置监听 → 重新 apply 同一条目」，ESM 模块实例照样命中缓存。推论：① 插件 host 代码改动一律以「重启 DSH」为验收前提；② 别为了「热更新方便」把插件目录加进 `hmr.root`——`disposeAll` 卸载时会 **kill 所有 running job**（index.js 的卸载清理），编辑一个文件就能干掉一个跑了半小时的派发任务。

4. **排障要看信标，不要靠「应该生效了吧」**：本轮把唤醒状态写进 `.data/state/activation.json`（`wakeActive`/`wakeNote`/`agentsVisible`/`systemPromptHintActive`），并且 `writeActivationBeacon` 从「整文件覆盖」改成「与已有内容合并」（原来只覆盖，晚到的动态结果写不进去）。上面第 3 条的「跑的还是旧模块」就是这么一眼看出来的。

5. **新增一个 host 半边文件，必须同步 `package.json` 的 `files`**：`install_bundle` 按 `files` 打包，漏一个文件 = 装出来的插件 `index.js` 静态 import 直接 ERR_MODULE_NOT_FOUND（本轮加 `notify.mjs` 时差点漏；本机因为是 `link:` 装配所以照样能跑，**只有真装机才炸**——最难发现的一类）。已给 `tools/verify-plugin.mjs` 加常驻哨兵：「index.js 的每个 `./xxx` 相对 import 要么列在 `files`、要么落在列出的目录项下」，并做了反向验证（摘掉 `notify.mjs` → 立刻 `FAIL 缺: notify.mjs`）。

## 2026-09-30 Z13（官方 API 注册 agent 工具 zcode_dispatch）

1. **「宿主随包出货」≠ 本地能静态 import**：本地 node_modules 只有宿主出货包的子集（cosmokit/schemastery）。给 index.js 加静态 `import '@deepseek-ai/dsh-tools'` 会让模块加载即炸——verify-plugin ③「Config 是 Standard Schema」项会**真实 import index.js**（tools/verify-plugin.mjs:38），门禁直接红；宿主真缺包则激活死（Z10-1 同源）。正解沿用本文件 loadConfig 同款：动态 import + try/catch 降级 null，宿主内解析到同一个官方包，语义等价、失败可降。
2. **defineTool 的 output 不可省略**：`options.output.render` / `options.output.schema` 被无条件读取（refs/dsh-tools/lib/index.js:842/:849），「若 output 可省略就省略」按真契约为假。最小合法形态：`{ schema: { type: 'json' }, render: (args, value) => [{type:'text', text: …}] }`——DSL 的 `type:'json'` 编译为注解即无约束 JSON（:688），任意 JSON 返回值都合法。
3. **官方参数 DSL 不是 JSON Schema**：字段级 `{ type, required?:true, description?, enum?/items?/const? }`；`required` 只能是 `true`（编译收拢到顶层 required 数组，:603）；`exclusiveMinimum`/`minimum` 不是 DSL 词汇 → authorError，数字范围约束只能写进 description 由 execute 侧兜底。
4. **validateArgs 吃「作者 spec」不吃编译产物**：`tool.parameters` 里存的是编译后 JSON Schema（`{type:'object', properties, required}` 形状），把它喂回 `validateArgs` 会报 `parameters.type must be a value schema object`（保真脚本首跑即踩）。要验「校验语义」直接走 `tool.execute(args)`——defineTool 的 execute 包装器内部先 validate 再透传（:866-870）。
5. **本地跑通官方包行为的通路（模块钩子）**：`node:module` 的 `register()` resolve 钩子把 `@deepseek-ai/dsh-tools` 短路到工作区提取的 `refs/dsh-tools/lib/index.js`，其 import 的宿主内部包（cordis/dsh-llm/dsh-scope/dsh-util-values/dsh-brand/dsh-sandbox）按名生成 data URL 最小桩——真实 defineTool 即可在本地完成编译/校验/注册全链路验证（本轮 14/14，脚本跑完即删）。另注意：URL pathname 在 Windows 不解码 `%20`（Z12-1），钩子里的文件 URL 一律 `fileURLToPath`/`new URL(…, import.meta.url).href`。

## 2026-09-30 Z12（派发总开关插件侧接入）

1. **`new URL('.', import.meta.url).pathname` 在 Windows 不解码 `%20`**：路径含空格时得到 `F:\My%20Code\…`，再喂给 `pathToFileURL` 会二次编码（`%2520`）→ ERR_MODULE_NOT_FOUND。Z6-4 只记了正向（path → import 要用 `pathToFileURL(p).href`），反向（URL → path）必须用 `fileURLToPath(import.meta.url)`，别手搓 `.pathname` 替换。
2. **给既有动作加门禁 = 给所有调用方（含验收探针）引入运行期真值依赖**：Z12 给 `dispatch` 加开关门禁后，`test/z2-verify.mjs` 的 e2e dispatch 隐式变成「真值文件为开才能过」——探针从密封变活体依赖，且静态跑探针时毫无征兆。修法：探针 cfg 显式 `switchPath` 指向临时文件（缺失=开启，恢复密封）。与 Z5-1「行为变更必须同步本地验收探针」同源：同步的不止断言，还有**探针的输入依赖面**。

## 2026-09-30 Z11（UI 第二轮：空态/折叠/关闭/行展开）

1. **core 的 `kill()` 对 `paused` 是「返回 true 的空操作」**：paused 时子进程已退出（close 处理器跑完即 `children.delete`），`kill()` 走默认分支只 `killRequested.add` + emit——返回 `{ok:true}` 但状态永停 paused，且 `killRequested` 条目永久残留。UI 判据：kill 返回的 `job.state` 仍是 `'paused'` 即视为无效，退回 dismiss（wire 层 `createActionHandler` 新动作，`state/dismissed.json` 落盘 + snapshot/list 过滤；core 零改动）。
2. **本地 React 桩测试三坑**（test/z11-ui.test.mjs 已删，复现成本高，记下）：
   ① `useState` 的 setter 闭包必须捕获**自己组件的 hooks 数组**——若引用共享可变变量，写入会落到「最后渲染的组件」，表现为状态永不更新/串台；
   ② `createElement` 的 children 要同时放进 `props.children`（PanelBoundary 的 `this.props.children` 依赖它）且遍历器沿 render 产物走——沿 raw `props.children` 下降会漏掉所有函数组件内部；
   ③ effect 桩要「每次渲染重跑、先执行上次 cleanup」——JobRow 的 tail effect 依赖 `open` 变化重跑，只跑一次会让展开区永远「读取中/无输出」。
3. **test/z2-verify.mjs §7 是既有红、非 Z11 引入**：其 React 桩没有 `Component`，`PanelBoundary extends React.Component`（Z9 提交 e4cdb4c 引入）在 factory 即抛 `Class extends value undefined`。已用 `git stash` A/B 实证改动前后同红。该脚本不在任何现行验收门禁里（现行=tools/verify-plugin.mjs 20/20）；后续要么给它补 `Component` 桩、要么把 §7 断言改为跳过渲染冒烟。

## 2026-09-30 Z10（Config 换 Standard Schema）

1. **cordis 的 Config 只认 Standard Schema v1，裸 JSON Schema 直接炸激活**：`resolveConfig` 取 `runtime.Config['~standard'].validate`（cordis lib/index.js:958），draft-07 JSON Schema 没有 `~standard` → `TypeError: Cannot read properties of undefined (reading 'validate')`。宿主随包出货的 schemastery 就是 Standard Schema（`Schema.prototype['~standard']` getter，vendor='schemastery'），官方插件一律 `import z from '@deepseek-ai/schemastery'` + `z.object({...})`。降级兜底写手写 `{'~standard':{version:1,vendor,validate}}`，validate 只归一不抛 issues——激活永不被配置打崩。
2. **验收探针的正则是契约，改代码形态前先 grep 探针**：DSH 探针用 `/export\s+const\s+Config\s*=/` 断言「Config 可配置」，任务包示例的 `let Config; export { Config }` 会让这条静默变红；写成 `export const Config = await loadConfig();` 语义等价且保住契约。同坑变体：本地探针的纪律断言（`@deepseek-ai` 全禁、裸包名说明符禁、Config 为 JSON Schema 形状）必须随行为变更同步豁免/改写（Z5-1、Z8-02 同一先例），否则探针永久假红。
3. **try/catch 包住主路径会让「方法名写错」静默落降级**：schemastery 导入失败与方法不存在都会进 catch → 手写降级兜底，探针若只断言 `~standard.validate` 是函数就测不出主路径已死。探针必须断言 `Config['~standard'].vendor === 'schemastery'` 区分主/降级路径（本地探针临时脚本据此发现主路径健康）。

## 2026-09-30 Z8（wire 全接线）

1. **新增的状态枚举值必须逐个核对消费者，否则永远停在初始态**：Z8-01 给远端 wire 选了新连接态 `conn='remote'`，但 UI 徽标映射（client.js connLabel）只认 `demo/ext/live`，未识别值全部落到「连接中」——远端真接通徽标也永远显示连接中，`node --check`/探针/浅渲染全测不出来（纯映射遗漏）。修法：wire 发 `conn='live'`（与既有枚举对齐），两处 emit（正常/出错）都要改；同源镜像 wire.client.mjs 同步。教训：给既有 discriminated 字段加值前先 `grep` 该字段的全部比较点。
2. **本地验收探针的「TODO 白名单」类断言会过时**（Z5-1 变体）：test/z2-verify.mjs 断言 TODO 只存在于 wire.*.mjs 两文件，Z8-01 把 TODO 清偿后变成 0 个文件，断言反而红——期望值把「临时状态」写死成永久断言。同理 `@deepseek-ai` 全禁断言没豁免协议标记键常量（typert 协议要求键跨副本精确相等，wire.host.mjs 必须含该字符串）。修法：断言表达不变式（TODO 应清偿为 0；协议键仅限 wire.host.mjs 且恰 1 处），别表达「当前中间态」。
3. **接续半成品单子先修可加载性再做增量**：Z8-01 被超时掐断时留下 `createWire is not defined`（调用点已写、定义没写），此刻任何增量改动的验证都是噪音。Z8-02 先落 createWire 定义、跑探针回到 18/18，再补 inject/$mount——每步落盘保持源码可加载（任务包铁律）。

## 2026-09-30 Z7（wire 接成 Remote 面）

1. **对象字面量里的「别名方法」不能按名引用同字面量的其他方法**：`{ setChannel: (c) => channelSet(c) }` 里 `channelSet` 是属性不是作用域绑定，调用时才解析 → ReferenceError（写时无告警、`node --check` 也不报）。共用逻辑先落成局部函数，再挂两个名字。
2. **纯数据描述符表先声明后引用**：`export const TYPERT = { …members: DOCS.map(…) }` 引用声明在其后的 `const DOCS`，模块求值即 TDZ ReferenceError——比函数体内引用更早爆炸，import 阶段就挂。
3. **ESM（strict）分支内漏 `let` 声明 = ReferenceError 而非隐式全局**：旧代码把 `let pollTimer` 写在分支里，重排分支时把它落在别的分支，被引用分支直接炸。拆分支时逐分支核对局部变量声明。
4. **官方 Remote 信封有两种返回形状要归一化**：官方代理包 `{ok:true,value}|{ok:false,error:{message}}`，进程内直连 face 是域形状（`{ok,job}`、`string[]`）——拆包判据用「有 boolean `ok` 且 own `value` 键」而不是 `ok===true`，否则直连形状会被误拆。

## 2026-09-30 Z6（通道/暂停/续跑）

1. **返回克隆的 API 不能再拿来写簿记**：`dispatchRaw()` 末尾 `return get(id)`（= serialize 展开克隆），`retry()` 在其返回值上写 `parentJobId/attempts/hopCount` 全部静默丢失（内存、`d.get()`、jobs.json 三面皆空），且**只断言 retry() 返回值测不出来**——簿记断言必须从 `d.get()/d.list()/jobs.json` 读回。修复走内部 `{raw:true}` 返回 jobs 里的真实对象，对外仍给克隆。
2. **纪律 grep 会被"注释+文案"组合命中**（Z2-1 变体）：client.js 头注释"不 import 任何宿主包" + 英文文案 `parentFrom: 'continued from', hop: 'hop'` 恰好构成 `import … from '…, hop: …'` 假形状，贪婪说明符正则一次假命中同时打挂 z2-verify 两条断言（真 `require('react')` 还被这次大匹配吞掉、没数到）。修法：说明符扫描前先剥块注释。
3. **classifyPause 是行优先不是签名优先**：`PAUSE_SIGNATURES` 注释说"顺序即优先级"，实现却是外层遍历行、内层遍历签名——跨行时先出现的行先定性（前面的 quota 宽词行会抢先 entitlement），签名顺序只在**同一行内**生效。写断言别照注释想当然。
4. **Windows ESM 静态 import 不吃盘符绝对路径**（`F:\...` → ERR_UNSUPPORTED_ESM_URL_SCHEME）：临时探针要用 `await import(pathToFileURL(p).href)`。

## 2026-09-30 Z5（安装前收尾）

1. **行为变更必须同步本地验收探针**：Z3 把 `fetchPlanQuota` 从占位变真实、Z4 把注册 id 改为 `zcode-dispatch.console`，两单都没同步 `test/z2-verify.mjs` 的对应断言，探针一直 73 PASS / 2 FAIL 假红（DSH 侧探针是另一份所以没暴露）。改行为的那一单要 grep 本地验收脚本里的相关断言一起改。
2. **React 桩必须在 factory 之前装好**：client.js 顶部 `const { useState, … } = React` 在 factory 时解构，之后再造 `R.useState` 无效（表现诡异：hooks 返回初始值、整树只剩 21 个节点）。先装桩再调 factory。
3. **遍历元素树要对函数组件求值**：只递归 children 会把 Section/QuotaCards 等函数组件当黑盒叶子（节点数骤减、找不到目标 DOM）。要 `el.t({ ...el.p, children })` 递归求值，并按组件切换 hooks 槽（同 test/z2-verify.mjs 的 renderTree 做法）。

## 2026-09-30 Z4（槽位/令牌证据固定）

1. **asar header 里文件 offset 是相对数据区基址的**：扫描器把命中绝对偏移映射回文件时，必须先减 `baseOffset` 再对文件表二分，直接用绝对偏移会整体错位到错误的文件。
2. **提取器 stdout 接 `head`/`tail` 会 EPIPE 崩**（退出码≠0）：但文件其实已写全——管道下游提前关闭是主因，看落盘结果别看退出码。
3. **提取器对无尾斜杠前缀平铺落盘**：前缀 `…/lib` 会把 `lib/client.js` 直接写到 `outDir/client.js`（`slice(prefix.length)` 后去首斜杠）；要保留目录形态就给前缀加尾斜杠或按整包前缀提取。
4. **令牌差集只认 `var(…)` 引用**：注释里的通配写法（如 `--dsw-alias-bg-layer-*`）会被正则截断成 `--dsw-alias-bg-layer-` 伪命中；同理任务包口径的"20 个令牌"实为 19 个去重引用，先去重再比对。
5. **DSH 主题令牌真实命名与直觉不同**：文本是 `--dsw-alias-label-*`（不是 `-text-*`）、边框 `-border-l1..l4`（不是 `-border-default`）、状态 `-state-*-primary`、阴影 `--dsw-shadow-lv1/2/3`（非 alias）、代码字体 `--ds-font-family-code`（`--ds-` 前缀！）；`brand-primary` 是近黑/近白不是蓝，产品蓝用 `-state-business-primary`。权威调色板在 `dsh-client-ui-theme/lib/client.js` 的 `design_platform_css_default`（body 亮色 + body[data-ds-dark-theme] 暗色）。

## 2026-09-30 Z3（套餐额度 RPC）

1. **ZCode Protocol stdio 没有 JSON-RPC 包装**：带 `jsonrpc:"2.0"` 直接 -32600（报错的 zod union issues 会把四种合法形状全暴露出来）。正确帧是裸 `{id,method,params}` / `{method,params}` / `{id,result|error}`。
2. **stdio 面无握手**：bundle 里的 hello/clientHello 是桌面 WebSocket 面的（`clientMode:"desktop-continuous"`）；stdio 启动先推 5 条 `startup/storageState` 通知，直接发业务请求即可，别等 hello。
3. **`usage/stats` ≠ 套餐剩余**：它是本地 agent-db 的日粒度聚合（range 7d/30d/all）。找"剩余额度"先全枚举方法表 + 实测 -32601 再下结论——0.13.3 的 RPC 面不提供套餐 limit/remaining/resetAt。
4. **Windows `taskkill /PID x /T /F` 对已退出进程 exit=128**（找不到 PID）：树杀兜底代码要把 128 当正常，别当失败重试。
5. **反查 minified bundle 的捷径**：grep zod 校验错误文案（如 "Unrecognized key"、"Method not found"）可直接反推协议 union 形状与方法表，比读压缩代码快一个量级。
6. **模拟 spawn ENOENT 时假进程 pid 必须为 undefined**：真实 Node spawn 失败不给 pid；假进程给了 pid，库的"pid 已设=spawn 成功"快路径会误判（测试假桩踩的）。

## 2026-09-30 Z2（ZCode 派发台插件包）

1. **纪律 grep 会被注释命中**：任务包禁止 JS 出现 `@deepseek-ai`、`document.body`、`require('react')` 以外的 require——这些字面串连**注释**里都不能出现（client.js 头注释原样写了这三个，验收 grep 全部命中）。改述为「DSH 宿主客户端包 / 宿主 body 节点 / 经宿主模块表注入的 react」。
2. **Node ≥21 的 `globalThis.navigator` 只读**（本机 v24.14.1）：测试桩直接赋值抛 `TypeError: Cannot set property navigator … only a getter`。赋值要 try/catch；业务代码读 navigator 必须带回退链。
3. **同步 subscribe 的 TDZ**：`const un = wire.subscribe(cb)` 里 cb 被同步首推时引用 `un` 命中暂时性死区（ReferenceError），promise 快速 reject 且现象诡异。写法改为 `let un = null; un = wire.subscribe(...)`；适配器侧把首推包进 try/catch（wire.host.mjs subscribe 已如此）。
4. **dispose() 只清 interval 不够**：demo 引擎「派发编排」的挂起 setTimeout（约 6.2s 后置 done）会跨组件卸载存活，导致定时器泄漏检查偶发失败。挂起定时器要登记（pendingTransitions）并在 dispose 统一清（wire.client.mjs 与 client.js 内嵌引擎均已处理）。
5. **杀进程过快 ≠ 缺陷**：dispatch 后立刻 kill（<100ms），子进程还没打印任何行，captureOut 为空、`tail()` 返回 `[]` 是 core 正确行为（UI 显示「无输出」）。测试要在 kill 前等一拍（等 runner 打印启动行），不要反过来「修」core。
6. **`ctx.slots.inject(owner, cb)` 的回调由框架在挂载时调用**：桩环境测试必须手动调用 cb 才会触发 `slots.register`，否则会误判「没注册组件」。

## Z10：Config 必须是 Standard Schema；且**宿主半边改代码必须重启进程**（2026-09-30 实测）

1. **激活失败 `Cannot read properties of undefined (reading 'validate')`**
   cordis `lib/index.js:958` 只认 `Config["~standard"].validate(config)`（Standard Schema v1）。
   导出裸 JSON Schema 会得到 `runtime.Config["~standard"] === undefined` → 激活失败、插件不加载。
   正解：`import z from "@deepseek-ai/schemastery"`（随 dsh 出货、官方插件同款）+ `z.object({...})`；
   或手写 `{'~standard':{version:1,vendor,validate}}`（DSH 已加降级兜底，见 `zcode-dispatch/index.js`）。

2. **"关→开开关"重载不到新代码（宿主半边）**
   cordis `_reload()` → `_resolveConfig()` 用的是 `this.runtime`，即**进程内已 import 的模块对象**；
   `_reload` 不会重新从磁盘 import。实测：源码修好后切开关，仍报**完全相同**的旧错误。
   判据：DSH 主进程启动时间早于源码修改时间（本例进程 03:19 启，源码 13:30 改）。
   → **宿主半边改动：必须完全退出 DSH 再启动**；客户端半边（`client.js`）改动：刷新页面即可（浏览器重新取包）。

3. **本地自证的两条路径**（写单必带）
   - 主路径：`node -e "import('./zcode-dispatch/index.js')"` → `Config['~standard'].validate({})` 应有 5 个默认值；
   - 降级路径：`node --import <block-hook>`（resolve 钩子对该包抛 ERR_MODULE_NOT_FOUND）→ 仍须有 `~standard` 且归一脏值。

## 2026-09-30：DSH 崩溃对话框的「禁用第三方插件、备份 profile patch 并重启」会重置配置（务必知晓）

- 它**保留备份**（`~/.dsh/profiles/desktop/cordis.patch.yml.bak-<ts>`），但会把 `cordis.patch.yml` 与
  `dsh.profile.bundles` **重置为出厂默认**（web 模板 = `dsh-base` + `dsh-web-app`）。
- 后果：用户自定义项全部消失 —— 默认模型（`agent-default-model`）、权限预设（`permission-presets`）、
  `ui-settings.enabled`、`ui-chat.performanceUsage`、以及自行开启的官方实验 bundle
  （agent-team-profile / auto-review / schedule-bundle）。
- 还原：`profile-backup/README-RECOVERY.md`（含三态留档与两条恢复命令）。
- **教训**：让插件进入启动路径前，先用常驻判据挡住"会阻塞启动"的写法（本轮已加：
  「inject 不自声明 remote 命名空间」+「apply 全兜底」），否则一次启动失败就要用户点救援按钮 = 配置被重置。

## 2026-10-05：仓库目录改名（`dsh-plugins` → `zcode-dispatch`）—— link 状态必须由 pnpm 重建

- **起因**：本地目录名与 GitHub 仓库名（`zcode-dispatch`）不一致，改名对齐。
- **踩的坑**：改完 `profile/package.json` 的 `link:` spec 后，**只手工改了
  `node_modules/.pnpm/lock.yaml`，漏了 profile 根目录的正式锁文件 `profiles/desktop/pnpm-lock.yaml`**。
  约 2.5 小时后 DSH 插件管理器自动跑 `pnpm install`（日志
  `profiles/desktop/.plugin-manager/logs/operation-*/pnpm.log`），pnpm 以**仍含旧路径的根锁**为准，
  把 `package.json`/两个 lock/junction 全部按旧路径重建 ⇒ junction 悬空 ⇒ 下次启动报
  `cannot resolve profile bundle "@local/zcode-dispatch"`。
- **正确做法**：改 `link:` spec 后**跑一次 profile 的 pnpm install**，让它自己重建 lock + junction；
  若必须手工改，则 `profiles/<p>/pnpm-lock.yaml`（正式）与 `node_modules/.pnpm/lock.yaml`（副本）
  **两个都要改**，并重建 junction，最后**再跑一次 install 复验**。
- **附带教训（本仓库自身）**：`tools/`、`zcode-dispatch/test/*.test.mjs`、README、`CREATOR-*.md`
  里**硬编码了绝对路径**（本次共 23 文件 43 处），改名后测试/校验脚本全部找不到源码。
  本次已批量更正；**建议后续改为相对自身推导**（`import.meta.url` → `path.resolve`），
  这样仓库放哪都能跑，不必再随改名批量改路径。
- **附带教训（改名必查项）**：`junction`/`symlink` 的目标路径**不在任何文本里**，文本替换扫不到 ——
  改名后必须单独扫链接：`Get-ChildItem <root> -Recurse -Force -Directory | Where-Object { $_.LinkType }`
  再校验 `Target` 是否存在（本次另发现 `node_modules/@deepseek-ai/{cosmokit,schemastery}` 悬空）。
- **附带教训（验收标准）**：改名后实测面板派发成功（exit 0）**不足以**作为验收 —— 依赖/link 类改动
  必须**跑一次 install + 重启一次**；故障可能延迟到下次启动才暴露。
