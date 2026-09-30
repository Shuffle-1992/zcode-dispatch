---
round: Z2
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T05:59:00+08:00
task: Z2-01-task.md
---

# Z2 交付：DSH 插件「ZCode 派发台」（悬浮窗 UI + Host 半边）

## 一、交付清单

写入范围严格限于 `F:\My Code\dsh-plugins\zcode-dispatch\` 与本交付文档；`refs/`、Z1 的 `core/`、宿主仓库、`$DSH_HOME` 零改动。

| 文件 | 说明 |
|---|---|
| `zcode-dispatch/package.json` | bundle 清单。与任务包给定 JSON 逐字一致，**唯一偏离**：`files` 数组补了 `wire.host.mjs` / `wire.client.mjs`（否则 install_bundle 按 `files` 打包时 `index.js` 的相对 import 缺文件）。JS 文件中不含任何 `@deepseek-ai` 字面串；`dsh.client.inject` 的 `@deepseek-ai/dsh-client-ui-conversation` 是任务包给定的清单契约字段，仅存在于本清单 |
| `zcode-dispatch/cordis.patch.yml` | 插入一行 `id: zcode-dispatch`，config 五字段（demo/maxConcurrent/runnerPath/ledgerPath/workRoot），与任务包逐字一致；runner 路径已核验存在（只读） |
| `zcode-dispatch/index.js` | Host 半边：`apply(ctx, config)`；`Config` 为 JSON Schema（五字段带默认值）；`createDispatcher` 单例；`ctx.effect` 注册卸载清理（杀 running/queued 子进程 + `dispatcher.dispose?.()` 兼容调用点 + wire 释放）；导出 agent 工具 `zcode_dispatch`（`action: dispatch\|list\|kill\|tail\|quota`，中文描述写清参数与限制），与 UI 共用同一动作实现；注册 API 未确认 → `registerZcodeDispatchTool()` 按四候选防御式尝试，全失败打 warn 并给出 creator 修复指引 |
| `zcode-dispatch/wire.host.mjs` | **唯一允许 TODO 的模块之一**。显著三步注释块；导出 `createActionHandler(dispatcher, config)`（动作唯一实现点，`{ok,...}` 统一返回）与 `attachHostWire(ctx, dispatcher, config)` → `{handleAction, subscribe, getSnapshot, dispose}`；`slimJob` 裁剪 tailLines/capture 路径省 token；推送 300ms 节流，quota 聚合在节流点才算 |
| `zcode-dispatch/wire.client.mjs` | **唯一允许 TODO 的模块之一**。显著三步注释块；导出 `createClientWire(ctx, config)` → `{subscribe, dispatch, kill, tail, dispose}`。降级路径：轮询 `window.__zcodeDispatchDemo`（`{getSnapshot(), getQuota?(), dispatch?, kill?, tail?}`）→ 内置 demo 引擎（3 进程 + 三窗口用量，派发/kill/tail 可交互）；零订阅自动停表，dispose 清全部挂起定时器；`config.demo===true` 强制内置 demo |
| `zcode-dispatch/client.js` | UI 半边：`window.__ModuleLoader__.load({id, factory})`；纯 JS + `React.createElement`，唯一外部模块 react。`SLOT='shell.overlay'`（旁注回退候选 `conversation.composer.dock`）；悬浮窗可拖拽（标题栏 pointerdown/move/up + setPointerCapture）、可折叠、可最小化为圆角胶囊、默认右下贴边；位置/宽度/折叠态存 `localStorage`（key 前缀 `zcode-dispatch:`，读写 try/catch）；z-index 固定 2000000000（注释说明仅浮层自身）。四分区：①派发栏（kind/内容/模型 GLM-5.3·GLM-5.3-Flash/provider plan·personal/mode build·edit·plan·yolo 默认 edit/超时分钟/--memory-bench/派发按钮，派发后按钮变「排队中/执行中」+行内反馈）②进程列表（六色状态点 queued/running/done/failed/killed/interrupted、tag、model、耗时、上下文百分比无数据显 —、退出码、锁标记、kill、tail 展开 30 行等宽小字）③用量卡片（5h 滚动/本周/今日 × run 数/请求数/in/out/cache，来自 quota.aggregate 形状；一行「套餐剩余额度：待接入（需客户端签名接口，来源未定）」）④单写者状态（repo/memory 锁持有者 tag 或空闲、队列长度）。样式全部走 `--dsw-alias-*` 令牌、集中在 `TOKENS` 常量（带同族回退链，JS 内零字面 # 色值）；样式表作为 React 元素渲染、卸载即移除；不碰 document.body；卸载清理监听器与全部定时器（含 demo 编排挂起定时器）；demo 模式内置假数据（3 进程 + 用量窗口）完整渲染。内嵌降级 wire 与 wire.client.mjs 同源 |
| `zcode-dispatch/locale/zh.json`、`locale/en.json` | meta（title/description）+ 界面文案（ui 段，与 client.js 内嵌 STRINGS 同源，键集合一致性已验收） |
| `zcode-dispatch/icon.svg` | 几何图形（圆角方 + 纸飞机 + 三状态点），约 0.5KiB ≤ 256KiB；字面色值仅出现在此文件（任务包允许） |
| `zcode-dispatch/README.md` | 安装（创造模式 `plugin_manager install_bundle` + target 绝对路径、读 `application`/`warnings`）、config 说明表、agent 工具说明、**wire TODO 清单**（creator 三步）、验证步骤、已知限制、接线结论回写位 |
| `zcode-dispatch/test/z2-verify.mjs` | 验收脚本（保留供 DSH 复跑，放 test/ 目录）：75 项断言覆盖任务包「四、验收方式」1–6 |
| `zcode-dispatch/test/z2-verify.output.txt` | 最近一次验收的完整原始输出（与下文嵌入内容一致） |
| `pitfalls.md`（项目根，新增） | 本次 6 条踩坑记录（纪律 grep 命中注释 / Node≥21 navigator 只读 / 同步 subscribe TDZ / dispose 需清挂起编排定时器 / kill 过快 tail 为空是正确行为 / slots.inject 回调由框架调用） |

## 二、可复跑命令 + 原始输出

均在 `F:\My Code\dsh-plugins\zcode-dispatch` 下、Node v24.14.1 实跑，未删改。

### 1. `node test/z2-verify.mjs` → exit 0（75/75，覆盖任务包验收方式 1–6）

```text
===== 1. node --check 全部 JS =====
PASS  node --check index.js
PASS  node --check client.js
PASS  node --check wire.host.mjs
PASS  node --check wire.client.mjs
PASS  node --check core/dispatch-core.mjs
PASS  node --check core/quota.mjs
PASS  node --check bin/zcd.mjs

===== 2. package.json / locale JSON 解析与关键字段 =====
PASS  package.json name
PASS  package.json dsh.bundle.patch
PASS  package.json dsh.client(platform/immediately)
PASS  package.json dsh.client.inject（清单契约字段）
PASS  package.json exports
PASS  package.json meta.title
PASS  package.json icon 存在
PASS  package.json files 含 wire 文件（对任务包的唯一偏离，已记录）
PASS  locale/zh.json meta.title 与 manifest 一致
PASS  locale ui 段关键文案存在（zh/en）
PASS  locale zh/en ui 键集合一致

===== 3. cordis.patch.yml 结构与路径 =====
PASS  patch.yml 顶层 - insert:
PASS  patch.yml 行 id=zcode-dispatch
PASS  patch.yml 行 name='@local/zcode-dispatch'
PASS  patch.yml config: 块
PASS  patch.yml config.demo=false
PASS  patch.yml config.maxConcurrent=1
PASS  config.runnerPath 非空
PASS  config.runnerPath 指向的 runner 存在（只读检查）
PASS  config.ledgerPath 指向台账
PASS  config.workRoot 指向本包 .data
PASS  未向 $DSH_HOME 写入本包内容

===== 4. 静态纪律（JS 零字面色值 / 无宿主包引用 / TODO 只在 wire 文件） =====
PASS  JS 不出现 @deepseek-ai（清单文件除外，属任务包给定契约）
PASS  JS 不操作 document.body
PASS  JS 无字面 # 色值
PASS  import/require 说明符仅 node:*、相对路径或浏览器模块表约定的 react
PASS  client.js 只 require('react')
PASS  TODO 注释块只存在于 wire.host.mjs / wire.client.mjs

===== 5. wire.client.mjs 降级路径 =====
PASS  createClientWire 可导入
PASS  subscribe 立即回包且 conn=demo
PASS  demo 快照含 3 个进程
PASS  demo 用量含三窗口
PASS  demo dispatch 返回 ok+job
PASS  demo tail 返回行
PASS  demo kill（queued→killed）
PASS  demo kill 不存在 id → ok:false
PASS  demo dispatch 缺内容 → ok:false
PASS  config.demo=true 强制内置 demo 引擎
PASS  注入 __zcodeDispatchDemo 后走 ext 轮询
PASS  ext 数据源动作透传

===== 6. index.js Host 半边端到端（Z1 假 runner） =====
PASS  导出 apply
PASS  Config 为 JSON Schema object
PASS  Config 字段与 patch config 一致
PASS  Config 字段均带默认值
PASS  Config 抽查默认值
PASS  apply 返回 {dispatcher, wire, handleAction}
PASS  ctx.effect 注册了卸载清理
PASS  日志：dispatcher 就绪
PASS  handleAction dispatch → ok（queued/running）
PASS  slimJob：带 tailCount、不带 capture 路径
PASS  wire.subscribe 推送到 running
PASS  kill → 终态（killed）
PASS  handleAction tail 返回捕获行
PASS  handleAction quota（台账缺失→available:false；planQuota 占位）
PASS  handleAction list
PASS  dispatch 缺 prompt → ok:false（core 校验透传）
PASS  未知 action → ok:false
PASS  wire.getSnapshot 可用
PASS  卸载清理函数执行无异常

===== 7. client.js：ModuleLoader 桩 + 假 ctx + 渲染冒烟 =====
PASS  window.__ModuleLoader__.load 被调用且 id 正确
PASS  factory 返回 {inject:[slots], apply}
PASS  slots.inject 槽位=shell.overlay（SLOT 默认值）
PASS  slots.register 选项 {name, id, order}
PASS  register 的是组件函数
PASS  首帧渲染节点数=192（>20 视为完整渲染）
PASS  快照更新后二次渲染节点数=257
PASS  组件卸载后无残留定时器（监听器/interval 清理）

===== 8. 越界检查（宿主仓库 porcelain 指纹，只读） =====
PASS  宿主仓库指纹前后一致（1d30225d8da63639 → 1d30225d8da63639）

===== 结果：75 PASS / 0 FAIL =====
```

验收方式逐条对应：① node --check / JSON.parse / YAML 结构校验+关键字段 grep（第 1–3 组）；② 静态纪律 grep（第 4 组）；③ client.js 桩加载 + 假 ctx + 渲染冒烟（第 7 组，超出最低要求的整树渲染、effect 运行/清理、定时器零泄漏）；④ index.js 导出与 Config schema（第 6 组前 5 项）；⑤ 越界（第 3 组末项 + 第 8 组）；⑥ 本文档命令即验收命令本身。

### 2. `node test/core.test.mjs` → exit 0（Z1 core 11/11，证明 Z2 未破坏 core）

```text
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5148.6982
```

### 3. 越界核验

```text
宿主仓库 porcelain 指纹：脚本开工前 1d30225d8da63639 → 结束 1d30225d8da63639（只读 git status）
$DSH_HOME（C:\Users\Administrator\.dsh）：零写入（脚本断言 + 本会话无任何指向该目录的写操作）
zcode-dispatch/.data：未创建（该目录由插件运行期按 patch config 生成，本单不安装故不触达）
临时 e2e 目录 test/z2-e2e-*：跑完已自动删除，无残留
```

### 4. 按任务包逐条复跑（未改动交付物时可重复）

```bash
cd "F:\My Code\dsh-plugins\zcode-dispatch"
node --check index.js && node --check client.js && node --check wire.host.mjs && node --check wire.client.mjs
node -e "import('./core/dispatch-core.mjs').then(m=>console.log(typeof m.createDispatcher));import('./core/quota.mjs').then(m=>console.log(typeof m.aggregate, typeof m.fetchPlanQuota))"
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).name)"
node test/z2-verify.mjs
```

## 三、实现要点与决策记录

- **一操作两调用方**：动作唯一实现点 `wire.host.mjs createActionHandler`，agent 工具 `zcode_dispatch` 的 `execute` 与（接线后的）UI 客户端动作都走它，杜绝双份逻辑（references/user-actions.md）。
- **决策 1（偏离说明）**：`package.json.files` 补 `wire.host.mjs` / `wire.client.mjs` 两项，其余与任务包给定 JSON 逐字一致。理由：无此两项时按 `files` 打包安装会缺模块。
- **决策 2**：浏览器模块表取不到本包 `wire.client.mjs`（无构建步骤、无 exports 注入客户端），`client.js` 内嵌**同源精简**降级 wire；两文件均已注明「接线时同步替换/删除」。这是任务包结构在无构建约束下的唯一可行形态。
- **决策 3**：`Config` 用 JSON Schema（draft-07 语境，practices.md 提到 `Config.listConfigs` 返回文档含 `$defs`）；若宿主要求 cordis Schema 包装，只改 `index.js` 的 `Config` 常量。`apply` 缺 `runnerPath`/`workRoot` 时不创建 dispatcher（打 warn），UI 走 demo、动作返回可读错误——降级不崩。
- **决策 4**：工具注册 API 未经 inspection 确认 → `registerZcodeDispatchTool()` 按 `ctx.tools.define → register → add → ctx.tool.define` 候选顺序尝试，成功返回注销函数；全失败打 warn 指引 creator 只改候选列表（动作实现不受影响）。
- **决策 5**：卸载清理 = 杀全部 running/queued job（`kill(id, 'plugin unloading…')`，子进程 close 落终态并持久化）→ `dispatcher.dispose?.()`（Z1 暂无此方法，预留调用点）→ wire.dispose（清节流定时器/订阅）。进程直接退出时由 core `restore()` 兜底标 interrupted，状态不悬空。
- **决策 6**：demo 引擎派发编排（queued→1.2s→running→5s→done 并计入用量窗口）让「安装后立即看到形态」且可交互（派发/kill/tail 全可用）；零订阅自动停表 + dispose 清挂起编排定时器，无泄漏。
- **安全**：UI 全 React 文本节点渲染（无 innerHTML/dangerouslySetInnerHTML，XSS 免疫）；localStorage 读写 try/catch；拖拽夹取视口范围；动作异常统一 `{ok:false,error}`；spawn 数组参数无 shell（core 语义）；JS 内零字面 # 色值，主题令牌集中在 `TOKENS`，回退链最终只落 `currentColor/transparent/inherit` 关键字。

## 四、Review / 强制性优化 / Simplify 自查

- **Review 闭环（验收抓出并修复的真实问题）**：① client.js 头注释含 `@deepseek-ai` / `document.body` / `require('react')` 字面串，纪律 grep 三项全命中 → 改述；② 同步首推回调引用未初始化退订函数 → TDZ，适配器首推包 try/catch + 测试侧改 `let un = null` 先行；③ demo 引擎 dispose 未清「派发编排」挂起定时器 → 泄漏检查失败，双侧补 `pendingTransitions`；④ 测试桩 hook 槽预置 `{v:undefined}` 使 useState 初始化被跳过 → 桩修正；⑤ kill 过快导致 tail 为空是 core 正确行为 → 测试等一拍而非改 core。
- **性能**：Host→客户端推送 300ms 节流（dispatcher 每行输出都 emit）；quota 台账聚合只在节流点执行；`slimJob` 裁剪 tailLines（只回条数）/capture 路径/超量 parseWarnings，工具结果省 token；demo 引擎零订阅自动停表。
- **健壮性**：双端 wire 均有降级路径（UI 不白屏）；localStorage/指针捕获/视口夹取/组件卸载全量清理；动作处理器所有异常收敛为 `{ok:false,error}`；坏 config（缺路径）降级不崩；75 项验收含全部错误路径（未知 action、缺内容、kill 不存在 id、台账缺失）。
- **Simplify**：9 个交付文件 + 1 个验收脚本；动作单实现、TOKENS 单点换肤、文案 zh/en 双份同源；无构建/无依赖/无 TS/无 JSX；wire 外文件零 TODO（验收断言固化）。

## 五、未决问题

1. **wire 接线（唯一真正空白，creator 三步）**：见下节。标准模式无法运行 `cordis_inspect_query`，真实槽位/服务名未知；降级路径已保证未接线时 UI 可用。
2. **套餐剩余额度未接入**（沿袭 Z1 未决 1）：`core/quota.mjs fetchPlanQuota()` 恒 `{available:false, reason:'pending-app-server-rpc'}`；UI 已按任务包要求显示「待接入（需客户端签名接口，来源未定）」。候选：ZCode app-server `usage/stats` RPC 或复刻客户端签名头。
3. **工具注册 API 未确认**：防御式四候选，激活后看 Host 日志即知是否成功；失败时 creator 只改 `index.js` 的候选列表。
4. **Config 形态**：JSON Schema 若与宿主校验器不兼容，改 `index.js` `Config` 常量一处（字段/默认值不变）。
5. **浏览器侧 wire 双份同源**：接线时须同步改 `wire.client.mjs` 与 `client.js` 内嵌段（或把 wire.client.mjs 挂进宿主模块表后改为 require）。
6. **跨进程 kill / jobs.json 多进程写竞争**（沿袭 Z1 未决）：host 单写者 + 独立 workRoot 可避开；插件 workRoot 已默认指向本包 `.data/`，与 CLI 默认 `<pkg>/work` 分离，天然规避。

## 六、creator 会话要做的 3 步接线（README「wire TODO 清单」同源）

1. **`cordis_inspect_query` → `Service` / `Event`**：找 Host 侧可被客户端调用的入口（如 session command + `ctx.remote.commands.execute()`）。把 `attachHostWire()` 返回对象的 `handleAction(action, params)` 挂为动作入口（返回值原样回传），并把 `subscribe(fn)` 收到的 `{snapshot, quota}` bundle 经该通道广播；客户端侧把 `wire.client.mjs`（及 `client.js` 内嵌降级段 `createWire()`）的 dispatch/kill/tail 改为调用该入口。
2. **`cordis_inspect_query` → `Slots.listSubTree`**：确认悬浮窗槽位（首选 `shell.overlay`，找不到用 `conversation.composer.dock` 或其它已分配空间槽位）与它的 props——只改 `client.js` 顶部 `SLOT` 常量一行（及该槽位 props 用法）。
3. **按 inspection 结果替换 `wire.host.mjs` / `wire.client.mjs` 的 TODO 实现，并删除两处注释块**（`client.js` 内嵌段同步）；顺带用 `cordis_inspect_query` → `Theme` 核对 `client.js` `TOKENS` 的 `--dsw-alias-*` 令牌名（回退链可整体收敛为确认存在的令牌）。

接线完成后把实际槽位/服务名/令牌名回写进 `README.md` 的「接线结论」小节。
