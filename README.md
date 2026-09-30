# ZCode 派发台（zcode-dispatch）

> 一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：
> 把任务派发给本机 **ZCode** CLI 的无头进程，并在 DSH 页面右下角的悬浮面板里监视它们。

DSH 自带的 `subagent` 跑的是 DSH 自己的 agent；**本插件跑的是 ZCode**——独立进程、独立额度、
独立会话，任务行出现在「ZCode 派发台」面板里，可查输出、可终止、可续跑、可换通道重跑。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| **派发** | 把 `prompt` / 任务文件 / 目标描述交给 ZCode 跑，支持 `build / edit / plan / yolo` 四种模式 |
| **单写者互斥** | `repo` / `memory` 文件锁 + 进程内 FIFO 队列：同锁任务串行，冲突只排队不报错（多会话并发也不会互相踩） |
| **实时监视** | 每个 job 的状态、耗时、上下文占用、退出码、锁持有者；可拉最近输出（tail） |
| **续跑 / 重跑** | 同会话 `--resume` 重发原提示词，或在同一会话里发一条新指令 |
| **通道与降级链** | 切换套餐通道 / 模型；额度耗尽或未开通时按降级链自动交接重跑到下一个可用通道 |
| **用量聚合** | 本地台账 5 小时滚动 / 本周 / 今日，外加套餐剩余额度（数据源不可用时如实标注 `available:false`，不猜） |
| **派发总开关** | 一个跨会话真值文件：`false` = 任何会话都不得派发（runner / 插件 / 桥接三处强制生效） |
| **agent 工具** | 注册 `zcode_dispatch`，与面板同一套动作实现（一操作两调用方） |

---

## 目录结构

```
dsh-plugins/
├─ zcode-dispatch/          ★ 插件本体（cordis bundle：Host 半边 + Client 半边）
│  ├─ index.js              Host 入口：apply(ctx, config)、dispatcher 单例、注册 agent 工具、激活信标
│  ├─ wire.host.mjs         Host 接线 + 动作唯一实现 createActionHandler + 派发总开关读写
│  ├─ wire.client.mjs       Client 接线 + 轮询 / demo 降级
│  ├─ client.js             UI 半边：悬浮面板（React.createElement，无构建步骤）
│  ├─ core/                 派发核心（零 npm 依赖）：dispatch-core / quota / appserver-rpc
│  ├─ bin/zcd.mjs           独立 CLI（与插件同 core，用来对照排查）
│  ├─ locale/{zh,en}.json   中英文案
│  ├─ test/                 可复跑自测与验收脚本
│  └─ cordis.patch.yml      bundle 层 patch（**只放 demo/maxConcurrent**，机器路径见「配置」）
├─ tools/                   常驻证据脚本（见「复跑证据」）
├─ bridge/                  客户端自动化桥（inbox/outbox 收发任务文件）
├─ tasks/                   开发留档：每轮任务书与交付记录（含原始输出与未决项）
├─ refs/                    参考资料（**含第三方材料，见文末声明**）
└─ profile-backup/          DSH profile 配置的三态留档与恢复说明
```

---

## 安装

要求：DSH 桌面版（在 `0.2.0-rc.2` 上开发验证）+ 可选的本机 ZCode CLI。

1. 让插件目录能被 profile 解析（开发期常用 junction / `link:`）：

   ```powershell
   # 例：把本包挂进 profile 的 node_modules
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\zcode-dispatch" `
     -Target "<本仓库>\zcode-dispatch"
   ```

2. 在 **创造模式会话**里用 `plugin_manager` 的 `install_bundle` 安装（`target` = 插件绝对路径），
   并**读返回的 `application` 与 `warnings`**（`applied` 才算生效）。

3. 在 profile patch 里补上机器专有路径（见下一节），然后**完全退出 DSH 再启动**。

> 本包**无构建步骤、无 npm 依赖**；Host 半边（`index.js` / `wire.host.mjs` / `core/*`）改动
> 需要重启 DSH 才生效，Client 半边（`client.js`）改动刷新页面即可。

---

## 配置

### 插件字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `demo` | `false` | UI 演示模式：用内置假数据渲染面板，不触达 dispatcher |
| `maxConcurrent` | `1` | 同时运行的 run 上限 |
| `runnerPath` | `''` | runner 脚本绝对路径（**宿主项目**的 `scripts/collab/zcode-run.mjs`，只读使用） |
| `ledgerPath` | `''` | 台账 `zcode-runs.jsonl` 绝对路径；留空则跳过用量聚合 |
| `workRoot` | `''` | 派发器工作根目录（`locks/`、`state/jobs.json`、`logs/`）；留空落到插件目录 `.data/` |
| `switchPath` | `''` | 派发总开关真值文件；留空则开关不可写 |

`runnerPath` 与 `workRoot` **任一为空则不创建 dispatcher**：面板走 demo 降级，agent 工具返回可读错误。
这是**刻意设计**——不猜一个位置静默跑错。

### 机器专有路径放 profile patch（不进本仓库）

上面的路径都指向**某个具体宿主项目**，属部署配置。请在
`~/.dsh/profiles/<profile>/cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: zcode-dispatch
  name: "@local/zcode-dispatch"
  config:
    demo: false
    maxConcurrent: 1
    runnerPath: '<宿主项目>\scripts\collab\zcode-run.mjs'
    ledgerPath: '<宿主项目>\collab\logs\zcode-runs.jsonl'
    workRoot:   '<本插件目录>\.data'
    switchPath: '<宿主项目>\collab\zcode-dispatch.switch.json'
```

（`cordis.patch.yml` 的 patch 层按 id 覆盖是 DSH 的标准机制——同文件里 `ui-theme` / `ui-chat`
等条目就是这么覆盖 bundle 内置条目的。）

---

## agent 工具 `zcode_dispatch`

一个工具 + `action` 参数，与面板上的操作一一对应：

```
dispatch | list | kill | dismiss | tail | quota | status | switch | channels | channel | retry | fallback
```

- `dispatch`：`kind=prompt|task|target` + 对应内容字段；可选 `model` / `provider` / `mode` /
  `timeoutMin` / `memoryBench` / `tag` / `lock` / `cwd` / `resume`
- `list` / `tail(id,n)` / `quota`：监视与用量
- `kill(id)` / `dismiss(id)`：终止；把 paused/终态 job 从列表移除
- `status` / `switch(enabled)`：读 / 切换派发总开关
- `channels` / `channel` / `retry` / `fallback`：通道、续跑、降级链

> **派发优先级（写进了工具描述，模型选工具就看这段）**：
> 凡是「把任务交给一个 agent 去做」的诉求，**能用派发台就优先用派发台**——
> 用 `action=dispatch`，任务才会出现在面板里、才受派发总开关约束。
> **仅当派发台不可用**（开关已关闭、`dispatch` 返回 `ok:false`：未配置 runner/workRoot、锁冲突等，
> 或用户明确要求「你自己去做」）才退回 DSH 自带的 `subagent` / 后台 jobs，
> 且**要说明为什么没用派发台**，不静默切换。

---

## 悬浮面板

右下角浮层（`shell.overlay` 槽位），可拖拽 / 固定位置 / 调整宽高（均持久化）/ 折叠 / 最小化为胶囊。

- **通道**：通道 + 模型两个下拉（固定两行版式），自动降级链
- **派发**：类型 / 模式 / 内容 / 超时 / `--memory-bench` / 派发按钮
- **进程**：按状态分 **Tab**（进行中 / 需处理 / 异常 / 已完成），每页只渲染最近 5 条 + 可展开；
  点击行头展开详情（派发要素、会话 id、最近输出），行动作（终止 / 重跑 / 续接 / 关闭）都在展开区里
- **用量**：5 小时窗口 / 本周 / 今日三张卡；**单写者**：锁持有者与队列长度
- 面板空白区不挡应用（`pointer-events` 精细控制）；主题令牌取自 DSH 主题，无字面色值

---

## 复跑证据

```bash
node tools/verify-plugin.mjs      # 插件形态与契约探针（20 项）
node tools/verify-switch.mjs      # 派发总开关独立复现（8 项，用临时目录密封）
cd zcode-dispatch
node test/core.test.mjs           # 派发核心自测（12 项）
node test/channel-retry.test.mjs  # 通道 / 续跑 / 降级链自测（9 项）
node test/quota-rpc.test.mjs      # 额度 RPC 自测（16 项）
node test/tail-scroll.test.mjs    # 输出框滚动决策（13 项：不闪烁 / 不弹回 / 底部跟随）
node test/pill.test.mjs           # 最小化胶囊（16 项：标题字样 / locale 对称）
node test/pill-position.test.mjs  # 胶囊定位与视口钳制（15 项：固定右下角 / 脏 pos 不出屏）
node --test test/file-lock.test.mjs    # 细粒度文件锁（9 项：write 声明 / 回退底线 / 归一化 / 防死锁）
node --test test/wait-action.test.mjs  # wait 动作（6 项：等终态 / paused 也返回 / 超时不谎报）
node test/section-order.test.mjs  # 分区顺序（9 项：单写者紧跟进程 / 用量置末）
node test/panel-reclamp.test.mjs  # 面板位置可见性（9 项）
node test/panel-anchor.test.mjs  # 面板锚定语义（22 项：缩窗不挤中间 / 放大回原位）
node test/elapsed-format.test.mjs  # 耗时展示格式（15 项：XX时XX分XX秒）
node test/ctx-format.test.mjs  # 上下文占用展示（23 项：180.9k / 200k）
node --test test/lock-model.test.mjs  # 锁模型（8 项：删 memory / 不同文件集可并发）
node test/lock-ui.test.mjs  # 派发区锁控件与中文锁名（26 项）
node --test test/lock-priority.test.mjs  # 调度优先级（4 项：文件锁任务优先放行）
node test/lock-badge.test.mjs  # 进程行锁徽标 + 全仓防复发扫描（34 项）
Z2_HOST_REPO=<宿主项目> node test/z2-verify.mjs   # 端到端验收（不设则跳过越界检查并如实标注）
```

门禁阈值只升不降；原始输出与未决项记录在 `tasks/` 下各轮的交付文档里。

---

## 第三方材料声明

`refs/dsh-tools/**` 是从本机 DSH 安装包**只读提取**的 `@deepseek-ai/dsh-tools` 包副本
（MIT 许可，`refs/dsh-tools/LICENSE` 随附），保留在此处是为了给插件开发提供**形态对照**。
其余 DSH 自带材料的提取副本（`refs/extracted/`、`refs/dsh-typert/`、`refs/plugin-whale-pet/` 等）
遵守 **不入库** 纪律，见 `.gitignore` 与 `refs/README.md`。

---

## 许可

本仓库**尚未指定开源许可**（未附 `LICENSE` 文件）。在补上之前，默认保留所有权利；
第三方材料沿用其各自许可（见上节）。
