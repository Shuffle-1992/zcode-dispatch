# ZB-34 免费额度通道的「工具执行能力」实测：与付费套餐派发对齐

> 起因：用户问「派发出去的 Agent 执行任务功能是完整的么？比如它能执行相关 ZCode 的工具。跟 Coding Plan 的派发完全同等功能？」
> 结论：**在工具执行层面已实测等同**（原生工具 + MCP 都真机验证过）；过程中修掉了**一个真实缺陷**（权限被拒）。
> 日期：2026-10-11 ｜ 方法：全部通过派发台工具 `zcode_dispatch` 真机派发，读 agent 回复 + 落盘产物 + `result.json` 交叉验证。

## 一、实测矩阵（同一免费额度通道 `account:bigmodel-start-plan` / GLM-5.3-Flash）

| # | 任务 | 模式 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | 创建 `zb34-tool-proof.md` | `yolo` | ✅ | 文件落盘，内容 `ZCode 原生工具可用。`（字节级核对） |
| 2 | 创建 `zb34-tool-proof-edit.md` | `edit`（默认） | ❌ **写被拒** | agent 回复「**Write 工具调用被拒绝了，文件未创建**」；`toolEventCount=0` |
| 3 | 创建 `zb34-tool-proof-edit2.md` | `edit` | ✅（修复后） | 文件落盘 + `toolEventCount=4`、`toolNames=["Bash"/Write …]` |
| 4 | Bash `echo … > zb34-bash-proof.txt` + 说明 MCP 工具 | `yolo` | ✅ | 文件落盘；`toolNames=["Bash"]`；agent 列出 MCP 服务器 `node_repl` / `web_reader` |
| 5 | 调 `mcp__node_repl__js` 算 `1+1` | `yolo` | ✅ | `toolNames=["mcp__node_repl__js"]`，返回 `=> 2` |
| 6 | 调远程 MCP `mcp__web_reader__webReader` 抓 example.com | `yolo` | ✅ | 返回 `title: "Example Domain"`（服务端内置工具，`requests=1`、`toolEventCount=0`，见下"口径"） |

## 二、修掉的缺陷：权限被拒（真机 #2 暴露）

**现象**：`--mode edit`（派发 runner 的**默认模式**）下 agent 的工具调用被拒 —— 与付费套餐 print 模式**不等价**。

**根因**：`collab-kit/appserver-gift.mjs` 里服务端请求 `interaction/requestPermission` 的应答写成了

```js
write({ id: msg.id, result: { decision: opts.mode === 'yolo' ? 'allow' : 'deny' } }); // ← 旧
```

即"仅 yolo 放行"。而**派发语义是无人值守**（print 模式无人可批；姊妹项目 dsh-connect-zcode 桥接用的是
`appServerToolPolicy: allow-all`）。故修正为：

```js
const allow = opts.mode !== 'plan';   // 默认放行；唯一例外 = plan（该模式契约就是"只规划不执行"）
logger.info?.(`[gift] 权限请求 ${msg.method} → ${allow ? 'allow' : 'deny'}（mode=…）…`);
```

**修复后**：#3 立刻通过（同一条通道、同一个模型、同一个默认模式）。

## 三、顺带补的可观测性（同一轮）

1. **工具事件匹配太窄**：原只认 `tool.call` / `tool.started` / `tool.completed`（都是猜的）⇒ `toolEventCount` **恒为 0**。
   实测真实事件类型是 **`tool.updated`**（另有 `turn.started` / `session.titleUpdated` / `streamRecovery.updated`）。
   现改为 `^tool[._-]` 前缀匹配 + **首次出现的每个事件类型打一行 `[gift] event=<type>`**（不带 `[zcode-run]`
   前缀，不污染派发台的输出行解析）。
2. **产物里带工具名**：`result.json` 增 `toolNames`（本次用过的工具）与 `eventTypes` —— 否则"这次到底用没用工具、
   用了哪些"只能读 agent 的自我报告。

> **口径提醒（别误读）**：`toolNames`/`toolEventCount` 只覆盖**在 agent 进程内执行**的工具；
> `web_reader` 这类**服务端内置工具**走 ZCode 云端执行（回复里会出现 `🌐 Z.ai Built-in Tool:` 段落），
> 不产生本地 `tool.updated` 事件 ⇒ 那一单显示 `toolEventCount=0`，但**功能是成功的**。

## 四、与付费套餐派发（print 模式）的差异清单（工具层以外）

| 维度 | 免费额度通道（app-server） | 付费套餐（print 模式） |
|---|---|---|
| agent 本体 / 原生工具 / MCP / 子代理 | **同一个 `zcode.cjs` agent** ⇒ 实测等同 | 同 |
| `--resume` 续跑 | ❌ 不支持（每次新建 CLI 会话）⇒ 同通道续跑只能重跑 | ✅ |
| `--target`（目标自续跑） | ❌ 不支持（print 模式 CLI 能力） | ✅ |
| `--memory-bench` | ❌ 不支持；且运行时偏好里 `memoryEnabled:false` | ✅（可开） |
| `--attach` | ⚠️ 忽略（但 agent 有自己的 Read 工具，能直接读工作目录 —— 实测文件读写正常） | ✅ |
| 权限 | 默认放行（`plan` 例外），**无人值守** ✓ | print 模式本身无人可批 |
| 额度余量可见 | ✅ 面板额度条 + `action=channels.quota` + `action=quota.giftQuota` | 付费套餐 limit/remaining 未接入 |
| 并发 | 一 job 一进程（`maxConcurrent` 内并行） | 同 |
| 未知的宿主请求 | 我们回 `{}`（若 ZCode 新增依赖宿主的工具，可能静默降级 —— **已知风险**，当前未触发） | 无此问题（不需要宿主） |

## 五、`yolo` vs `edit`（以及 `plan`）：差别在**审批链路**，不在能不能干活（ZB-35 实测）

同一任务（「建文件，内容一行」）、同一模型、同一通道，只改 `mode`：

| | `yolo` | `edit` |
|---|---|---|
| 文件落盘 | ✅ | ✅ |
| `toolNames` | `["Write"]` | `["Write"]` |
| **审批请求**（`result.json.permissionRequests`） | **`[]`** —— 根本不问 | **`[{method:'interaction/requestPermission', mode:'edit', decision:'allow'}]`** —— 问了一次，由宿主代批 |
| 事件流 | 无 `permission.*` | 多出 **`permission.requested` / `permission.resolved`** |

**机制**（扒 `zcode.cjs` 得到，2026-10-11）：
- `session/setMode` 只接受 `build | edit | plan | yolo`（CLI 内 `m.enum(["build","edit","plan","yolo"])`）；
  桌面端还有更宽的权限模式集合（`default / acceptEdits / auto / dontAsk / bypassPermissions / …`）。
- 每个工具自带 `needsApproval`：**`Read` = false**（"Read only inspects file content … no external side effects"）、
  **`Write` / `Edit` = true**（"…creates or overwrites files …"）。
- ⇒ `yolo` = **CLI 内部直接放行**，不产生审批请求；`edit`/`build` = 对 `needsApproval:true` 的工具
  **发 `interaction/requestPermission` 等批准** —— 桌面端由用户点，**托管派发由我们代批**（默认放行，
  仅 `plan` 拒绝）。

**派发建议**：无人值守请显式 `--mode yolo`（少一层往返、少一个失败点），或 `edit`/`build`（现已代批，
且保留可审计的 `permission.*` 事件）；**别用 `plan`** —— 它的契约就是"只规划不执行"。

> 顺带修正一条此前的乐观结论：MCP **不是"全可用"而是"部分可用"**。CLI 日志里每次会话都有
> `mcp.server.failed` 警告（有服务器连不上，`durationMs ≈ 1.2s`），但 `node_repl` / `web_reader`
> 实测调用成功 ⇒ 具体哪些服务器可用取决于桌面端 MCP 配置，**以实测为准**。

## 六、复跑方法（照抄即可）

```bash
# 通过派发台工具（Agent 侧）
zcode_dispatch action=dispatch kind=prompt mode=edit cwd=<临时目录> \
  prompt="在当前工作目录创建文件 proof.md，内容恰好一行：X。完成后给出绝对路径"
zcode_dispatch action=wait id=<jobId>
# 断言：目标文件存在且内容精确匹配；result.json 的 toolNames 非空、toolEventCount>0
```

**注意**：`--cwd` 落在**宿主项目外**时 runner 的台账会写到那个目录，派发台聚合匹配不到（`billing=-`）——
功能测试无妨，但**统计口径**测试要把 `cwd` 放在宿主项目内（见 ZB-33 文档的部署约定）。
