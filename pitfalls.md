# 踩坑记录（pitfalls）

> 按全局规则维护：遇到踩坑问题登记于此，避免重复踩坑。新条目置顶。

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
