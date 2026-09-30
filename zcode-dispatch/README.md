# @local/zcode-dispatch —— ZCode 派发台（cordis bundle）

在 DSH Harness 里派发/监视多个 ZCode 无头进程（`zcode-run.mjs`）：单写者互斥、用量与上下文、套餐通道。
Host 半边（`index.js` + `wire.host.mjs` + `core/*`）跑进程调度并暴露 agent 工具 `zcode_dispatch`；
Client 半边（`client.js` + `wire.client.mjs`）在 Web 页面渲染右下角悬浮窗（拖拽 / 折叠 / 最小化胶囊）。

> ⚠ **标准模式不可安装**：标准模式 DSH 会话没有 `plugin_manager` / `cordis_inspect_query`，
> 本包只能被写出、不能被安装验证。安装由**创造模式（creator preset）会话**执行（见下）。
>
> 槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核。

## 目录结构

```
zcode-dispatch/
├─ package.json          bundle 清单（dsh.bundle.patch + dsh.client + meta/icon/locale）
├─ cordis.patch.yml      插入一行 id=zcode-dispatch 的 config（demo/maxConcurrent/runnerPath/ledgerPath/workRoot）
├─ index.js              Host 半边：apply(ctx, config)；创建 dispatcher 单例、卸载清理、注册 agent 工具
├─ wire.host.mjs         Host 接线适配器（含 creator 三步 TODO 注释块）＋ 动作唯一实现 createActionHandler
├─ wire.client.mjs       Client 接线适配器（含 creator 三步 TODO 注释块）＋ 轮询/demo 降级
├─ client.js             UI 半边：悬浮窗（React.createElement，无构建）；内嵌降级 wire
├─ core/                 Z1 交付的派发核心（dispatch-core.mjs / quota.mjs，Z3 增 appserver-rpc.mjs）——只 import，不改
├─ bin/zcd.mjs           Z1 的独立 CLI（与插件同 core，可做对照排查）
├─ locale/{zh,en}.json   meta + 界面文案（ui 段与 client.js 内嵌 STRINGS 同源）
├─ icon.svg              插件图标（几何图形，≤256KiB）
└─ test/                 Z1 core 自测 + Z2 验收脚本（z2-verify.mjs）+ Z6 通道/续跑自测（channel-retry.test.mjs），可复跑
```

## 运行期数据（不随包分发）

`work/`（`bin/zcd.mjs` 默认工作根：`state/jobs.json`、`logs/*.out|err.log`、`locks/`）与插件安装后
patch 默认指向的 `.data/`（同结构，见 config 说明）都是**运行期数据**：不进 `package.json` 的
`files`、不随 bundle 分发，可随时整体删除重建（删除后进程列表清空；用量以 `config.ledgerPath`
指向的台账为准，不受影响）。`test/` 下的验收输出物（如 `*.output.txt`）同样不入包。

## 安装（创造模式会话执行）

1. `plugin_manager` → `install_bundle`，`target` = `F:\My Code\dsh-plugins\zcode-dispatch`（绝对路径）。
2. **读返回的 `application` 与 `warnings`**（不是看日志）：`applied` 才算生效；`restart-required` /
   `failed` / `overridden` 分别处置。若报 pending build scripts，**先问用户**再传 `approvedBuilds`。
3. 本包无构建步骤、无 npm 依赖；替换已安装包需要重启才加载新 JS（新装 bundle 可走 HMR）。

## config 说明（cordis.patch.yml 可改；用户 patch 层升级存活）

| 字段 | 类型/默认 | 说明 |
|---|---|---|
| `demo` | boolean / `false` | UI 演示模式：客户端用内置假数据渲染悬浮窗，不触达 dispatcher |
| `maxConcurrent` | integer / `1` | 同时运行的 run 上限（单写者互斥下的并发度） |
| `runnerPath` | string / `''` | runner 绝对路径（宿主仓库 `scripts/collab/zcode-run.mjs`，只读使用）。**与 `workRoot` 任一为空则不创建 dispatcher**（UI 走 demo 降级，工具动作返回可读错误） |
| `ledgerPath` | string / `''` | 台账 `zcode-runs.jsonl` 绝对路径；留空则跳过台账回读与用量聚合 |
| `workRoot` | string / `''` | 派发器工作根目录（`locks/`、`state/jobs.json`、`logs/` 落在这里）。默认 patch 指到本包 `.data/` |

## agent 工具 `zcode_dispatch`

一个工具 + `action` 参数：`dispatch | list | kill | tail | quota | channels | channel | retry | fallback`，
与 UI 悬浮窗操作一一对应
（同一实现：`wire.host.mjs` 的 `createActionHandler`，references/user-actions.md「一个操作两个调用方」）。

- `dispatch`：`kind=prompt|task|target` + 对应内容字段；可选 `model(GLM-5.3|GLM-5.3-Flash)`、
  `provider(plan|personal)`、`mode(build|edit|plan|yolo，默认 edit)`、`timeoutMin(>0)`、
  `memoryBench(仅 kind=prompt)`、`tag`、`lock(repo|memory|both，默认 both)`、`cwd`、`resume`。
- `list` / `kill(id)` / `tail(id, n=30)` / `quota`（本地台账 5h 滚动 / 本周 / 今日聚合 +
  引擎本周已用；`bin/zcd.mjs quota --json` 同时含 `local` 与 `planQuota` 两段，
  任一失败不互相影响）。
- `channels` / `channel set` / `retry(jobId, {provider?, model?})` / `fallback`：Z6 通道与续跑，见下节。
- 限制：单写者互斥（同锁 FIFO 排队，不报错）；`memoryBench` 仅 prompt；工具不授予/确认任何权限。
- ⚠ 注册 API 未经 inspection 确认：`index.js` 的 `registerZcodeDispatchTool()` 按
  `ctx.tools.define → register → add → ctx.tool.define` 候选顺序防御式尝试；若全部失败会打
  warn 日志（动作实现不受影响，creator 按 `cordis_inspect_query → Tool` 调整候选列表即可）。

## 通道切换 / 暂停 / 续跑（Z6）

**用户可见语义（一句话）**：换通道 = 交接重跑（新会话 + 未完成部分交接），同通道 = 真 `--resume` 续跑；
CLI 硬限制：`--resume` + `--model` 必失败（ZCode 机制实测 F2），因此同通道续跑绝不带 `--model`。

- **通道切换器**（面板顶部）：provider 下拉 + model 下拉，数据来自 `listChannels()`（runner
  `--list-providers` 真实输出 + 权益缓存 + 个人 provider 配置，解析不出就空清单 + warning，
  **绝不猜测可用性**）；不可用项置灰并显示原因（如 `未开通：coding_plan_not_entitled`）；
  切换后显示「新任务将使用：<通道>/<模型>」。个人通道的模型列表以个人配置
  （`provider_config.json` 的 `personalModelIds`）实际声明为准。
- **暂停态**：run 非 0 退出且输出命中暂停签名 → `paused` + 原因徽章（`额度耗尽` / `未开通` /
  `需签名` / `配置错误`）。paused **不占锁、不占并发、不自动重试**，队列继续跑其他任务；
  未命中签名保持 `failed`（Z1 语义不变），仅记 `pauseReason: unknown` 作信息字段。
- **两个续跑按钮**（paused 行内）：
  - 「同通道续跑」：有 sessionId 时可用 → 真 `--resume <sessionId>` 续跑（绝不带 `--model`）；
  - 「换通道重跑」：选目标通道 → **交接重跑**（新会话），确认提示明示语义后执行；交接提示词
    含五要素：① 原任务原文 ② 上次中断点（pauseReason + 最后输出）③ 新通道说明（交接重跑 ≠
    原会话续跑）④ 先核对现状、只做剩余、按原要求交付 ⑤ 不回滚、不重复交付。
  - 交接链路全程簿记：新 job 记 `parentJobId / attempts[] / hopCount`，旧 job 标 `handedOffTo`
    （同通道续跑标 `resumedBy`）；从 `list/get` 与 `state/jobs.json` 均可读回。
- **自动降级链**（默认关）：面板开关或 `zcd fallback set <a,b,c>` 开启（二次确认）；仅当暂停
  原因属于 {额度耗尽 / 未开通 / 需签名} 时，按交接语义自动跳到链上下一个**可用**通道，
  最多 `chain.length` 跳；链耗尽或某一跳失败即停在 `paused`。⚠ 开启即授权**自动消耗下游通道额度**。
- CLI 对照：`zcd channels [--json]` / `zcd channel set <provider> [--model]` /
  `zcd retry <jobId> [--provider --model]` / `zcd fallback [list|set a,b,c|off]`；
  agent 工具 `zcode_dispatch` 同名 action 一一对应。

## 真数据 vs demo 判据（Z8 接线后）

面板标题栏徽标（`connLabel`）直接标明当前数据来源，逐级降级、绝不白屏：

| 徽标 | conn 值 | 数据来源 | 含义 |
| --- | --- | --- | --- |
| **已连接** | `live` | `ctx.remote.zcodeDispatch` 远端面 | **真数据**：真 ZCode 子进程 + 真用量台账（宿主 face 已注册） |
| 外部数据 | `ext` | `window.__zcodeDispatchDemo` | 宿主/creator 注入的外部数据源（测试用） |
| **演示数据** | `demo` | 内置演示引擎 | 纯前端假数据（3 个进程 + 用量窗口，可交互） |
| 连接中 | `connecting` | — | 尚未收到任何数据包（首帧渲染前） |

降级链：`apply` 捕获 ctx → `resolveRemote()` 探测 `ctx.remote.zcodeDispatch`（有 `snapshot()` 即可用）
→ 命中走 1s 轮询 + `$on('zcode-dispatch/changed')` 抢答；未命中（远端缺席 / `$mount` 失败 /
无 ctx）→ 外部源 → demo 引擎。**看到「演示数据」即表示远端面未接通**，排查顺序：
宿主侧 `wire.host.mjs` 的 face 注册（日志 `attachHostWire`）→ 客户端 `$mount` 贡献项 → 探测判据。

接线两侧（Z8 落地，原「wire TODO 清单」已清偿）：
- 宿主侧：`wire.host.mjs` 的 `attachHostWire()` 把 face 经 `ctx.provide('zcodeDispatch', face)`
  注册为 cordis 服务，`index.js` 用 `ctx.effect` 包裹 dispose 清理；导出 `TYPERT` 清单经
  `package.json` 的 `exports["./typert"]` 由 typert-loader 自动注册（loader 形状校验已本地复核）。
- 客户端侧：`client.js` 模块 `inject` 声明 `remote` 与 `remote.zcodeDispatch`，`apply` 里
  `ctx.remote.$mount({package, descriptors})` 自挂子服务（第三方本地包不被构建期内联进
  api-remotes，须自挂），内嵌同源传输层（`wire.client.mjs` 的镜像）调用远端面。

## 验证步骤（creator 会话，安装后）

1. `cordis_inspect_query`：确认新行已挂（`Config.listConfigs` 过滤本包名 → 查 `entry`；插槽注册）。
2. 页面出现右下角悬浮窗：可拖拽（标题栏按住）、可折叠、可最小化成胶囊；四个分区
   （派发栏 / 进程列表 / 用量卡片 / 单写者状态）齐全；浅色/深色主题各看一眼。
3. 双调用方一致性：agent 跑工具 `zcode_dispatch` `action: list`，与 UI 列表一致；
   `action: quota` 的三窗口数字与 `node bin/zcd.mjs quota` 一致。
4. 端到端：`action: dispatch`（`kind: prompt`、`model: GLM-5.3-Flash`、内容 `只回答 OK`）→
   UI 出现 queued→running→done，5h 窗口 run 数 +1。
5. 控制台不得有 `slot entry crashed in '<slot>'`；跑完恢复动过的任何设置/状态。
6. 安装前可先跑本地静态验收（无需安装）：
   `node test/z2-verify.mjs`（语法/清单/YAML/纪律 grep/桩加载渲染冒烟/Host e2e/越界检查）。

## 已知限制

1. **套餐剩余额度未接入**：用量区拆成两段展示——「本地用量（可核对）」= 台账聚合（5h 滚动 /
   本周 / 今日）+ 引擎本周已用（`core/quota.mjs` 的 `fetchPlanQuota()` 经 ZCode app-server
   `usage/stats`，Z3 实装；语义是引擎本地库「已用」合计）；「套餐剩余额度：未接入」明示
   limit/remaining/resetAt 不在 CLI RPC 面（方法表全枚举 + 候选方法实测 -32601；桌面端走签名
   HTTP，裸 Key/OAuth 均 401），以 ZCode 客户端显示为准。三类证据见 `tasks/Z3-delivery.md` §四。
   引擎本地用量**不得**呈现为「套餐已用」。
2. **标准模式不可安装**：无 `plugin_manager`，也不写 `$DSH_HOME`（`C:\Users\Administrator\.dsh`）。
3. **远端面接通但未见真数据的场景**：Z8 已全接线（宿主 face 注册 + 客户端 `$mount` 自挂），
   但若宿主侧 `ctx.provide` 缺席或 typert-loader 未注册本包 TYPERT，客户端会安静降级到
   demo（徽标「演示数据」）；安装后以徽标为准判断（见「真数据 vs demo 判据」一节）。
   宿主→客户端的 `$on` 推送依赖装配级事件源，未接通时以 1s 轮询兜底（功能不受影响，仅刷新及时性）。
4. **工具注册 API 未确认**：见上文 `zcode_dispatch` 一节；激活后看 Host 日志即可判断是否注册成功。
5. **Config 形态**：`index.js` 的 `Config` 用 JSON Schema；若加载器要求 cordis Schema 包装
   （`Schema.object`），只需改写该常量（字段与默认值不变）。
6. **与任务包给定 manifest 的偏离**：`package.json` 的 `files` 数组在任务包给定内容之上补了
   `wire.host.mjs` / `wire.client.mjs` 两项——否则 install_bundle 按 `files` 打包时
   `index.js` 的相对 import 会缺文件。其余字段与任务包逐字一致。
7. 界面文案在 `client.js` 内嵌 `STRINGS` 与 `locale/*.json` 的 `ui` 段**双份同源**（浏览器模块表
   取不到本包 locale 文件）；接线后可改走宿主 locale 服务并删内嵌。

## 接线结论（creator 会话回收处）

> Z8 接线已落地，实际确认值回写如下（升级时对照）：
>
> - 槽位（SLOT 实际取值）：`shell.overlay`（list 型，id=`zcode-dispatch.console`，order=20；
>   证据见 `refs/dsh-slots.md`，与 chat / plugin-manager / workspace 官方先例同槽）
> - Host 入口（Service/Event）：远端面 face `zcodeDispatch`（`ctx.provide` 注册，12 方法；
>   typert-loader 经 `exports["./typert"]` 自动注册 TYPERT 清单 + typertGateway SRC 接收器兜底：
>   实例 `typertRemote` 绑定 + 原型协议标记键）；Host→客户端推送事件名 `zcode-dispatch/changed`
> - TOKENS 实际令牌名：已按 `refs/dsh-theme-tokens.md` 核对（文本族 `--dsw-alias-label-*`、
>   边框 `-border-l1..l4`、状态 `-state-*-primary`、阴影 `--dsw-shadow-lv3`、代码字体
>   `--ds-font-family-code`）
