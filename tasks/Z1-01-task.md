---
round: Z1
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T05:00:00+08:00
---

# Z1 任务包：ZCode 派发核心（standalone Node，零依赖）

> 派发方 DSH。目标：为「DSH 悬浮窗插件（ZCode 多进程派发台）」打地基——把**进程调度/单写者互斥/状态与用量采集**做成**与 DSH 无关的纯 Node 模块**，这样它既能被 DSH 插件（Host 半边）直接 import，也能被我（DSH）在命令行独立验收。
> 工作目录：`F:\My Code\dsh-plugins`（**不是** 宿主仓库；以下路径均以此为根，除注明外只读 宿主仓库）。

## 一、背景（可自行核验）

1. 现有派发器：`<HOST_REPO>\scripts\collab\zcode-run.mjs`（**只读，不许改**）。它的接口与输出约定（务必先读它）：
   - 参数：`--task <file>` / `--prompt <text>` / `--target <text>`（三者互斥规则见脚本头）、`--resume <sess>`、`--mode build|edit|plan|yolo`、`--cwd`、`--provider plan|personal|<id>`、`--model <id>`、`--tag`、`--timeout-min`、`--memory-bench`、`--list-providers`
   - 控制台汇总行（**要解析这些**）：
     ```
     [zcode-run] provider=<id> model=<id> …
     [zcode-run] done exit=<n> elapsed=<s>s session=<sess_…> provider=<…> model=<…> responseChars=<n>
     [zcode-run] endpoint=<url>
     [zcode-run] usage requests=<n> in=<n> out=<n> cacheRead=<n>
     [zcode-run] context used=<n> (x.x% of N) turnCount=<n>
     [zcode-run] out=<path> err=<path> result=<path>
     ```
   - 台账：`<HOST_REPO>\collab\logs\zcode-runs.jsonl`（每行一个 JSON，字段：`at,tag,task,mode,kind,billing,provider,endpoint,model,sessionId,traceId,exit,timedOut,elapsedSec,requests,inputTokens,outputTokens,cacheReadTokens,contextUsed,contextWindow,responseChars`）
2. DSH 插件形态（供你理解上层怎么用它）：Host 半边是 `export function apply(ctx, config){}`，UI 半边渲染在 Web 页面槽位里；见 `F:\My Code\dsh-plugins\refs\`（`SKILL.md`、`references/ui-plugin.md`、`references/host-plugin.md`、`references/practices.md`、`templates/decoration/*`）。**本单不写 DSH 插件文件**，只写可被它 import 的 core。

## 二、交付物（唯一允许的写入范围：`F:\My Code\dsh-plugins\zcode-dispatch\` 与 `F:\My Code\dsh-plugins\tasks\`）

### 1. `zcode-dispatch/core/dispatch-core.mjs`
纯 Node（Node 24）+ 零 npm 依赖 + ESM。导出：

```js
export function createDispatcher(options) // { runnerPath, runnerCwd, ledgerPath, workRoot, maxConcurrent=1, repoLockPath, memoryLockPath, spawnImpl? }
```

- `dispatch(spec) -> job`：spec = `{ kind:'task'|'prompt'|'target', task?|prompt?|target?, model?, provider?, mode?, tag?, timeoutMin?, cwd?, resume?, memoryBench?, lock?: 'repo'|'memory'|'both' }`（默认 `lock:'both'`）
- **单写者互斥（核心要求）**：同一时刻只允许一个持有 `repo` 锁和一个持有 `memory` 锁的 run；`maxConcurrent` 默认 1。锁用**文件锁 + 进程内队列**双保险：`<workRoot>/locks/repo.lock`、`<workRoot>/locks/memory.lock`（内容含 jobId/pid/时间戳；启动时清理过期锁 >2h 或 pid 已死）。请求不满足锁条件时**进队列**，不报错。
- job 记录字段：`id, tag, spec, lock, state('queued'|'running'|'done'|'failed'|'killed'|'interrupted'), queuedAt, startedAt, finishedAt, elapsedSec, exitCode, sessionId, provider, endpoint, model, usage{requests,inputTokens,outputTokens,cacheReadTokens}, contextUsed, contextWindow, responseChars, outLog, errLog, resultFile, tailLines[]`
- `list()` / `get(id)` / `tail(id, n=50)` / `kill(id)` / `snapshot()`（**纯 JSON 可序列化**，供 DSH 客户端渲染） / `subscribe(fn)`（返回取消函数；事件 `{type:'job-updated'|'queue-changed', job|snapshot}`，**不要**抛出异常打断订阅者）
- 状态持久化：`<workRoot>/state/jobs.json`（原子写：临时文件 + rename）；进程启动时 `restore()`：把上次残留的 `running` 标记为 `interrupted`（并记录原因），队列继续可用
- 解析：从子进程 stdout 逐行解析上面列出的 `[zcode-run]` 汇总行；**同时**在 job 结束时按 `tag` 回读台账 `zcode-runs.jsonl` 的最后一条匹配记录，两者取更完整者（解析失败不得崩，标记 `parseWarnings[]`）
- 测试注入：`options.spawnImpl` 可替换（默认 `node:child_process.spawn`）；`options.now` 可注入时钟

### 2. `zcode-dispatch/core/quota.mjs`
- `aggregate({ ledgerPath, now = new Date() })` → 纯函数，返回 `{ windows: { last5h, week, today, total }, byModel, byBilling }`；
  - `last5h` = 滚动 5 小时（含边界半开区间 `(now-5h, now]`）；`week` = 本周一 00:00（本地时区）至 now；`today` = 本地当日 00:00 起；
  - 每窗口字段：`runs, requests, inputTokens, outputTokens, cacheReadTokens, totalTokens, elapsedSec`
  - 台账文件不存在 → 返回零值 + `available:false`，不得抛错；坏行跳过并计数 `skippedLines`
- `fetchPlanQuota(options)` → **预留适配器**：本单返回 `{ available:false, reason:'pending-app-server-rpc' }`；接口签名留好（`{ planKey?, timeoutMs? }`），后续替换为 ZCode app-server `usage/stats` RPC 调用，返回值形状先约定：`{ available:true, plan:'bigmodel-coding-plan', windows:[{id:'5h',used,limit,resetAt},{id:'week',used,limit,resetAt}], raw }`

### 3. `zcode-dispatch/bin/zcd.mjs`（CLI，便于我与你都能独立驱动）
```
node bin/zcd.mjs --help
node bin/zcd.mjs list [--json]
node bin/zcd.mjs dispatch --kind prompt --prompt "只回答 OK" --model GLM-5.3-Flash --tag z1-smoke
node bin/zcd.mjs dispatch --kind task --task <abs path> --mode yolo --timeout-min 30
node bin/zcd.mjs watch            # 每 1s 打印 snapshot 摘要，Ctrl+C 退出
node bin/zcd.mjs quota [--json]
node bin/zcd.mjs kill <id>
node bin/zcd.mjs tail <id> [-n 50]
```

### 4. `zcode-dispatch/test/core.test.mjs`
零依赖自测（`node:test` 或自写断言均可，**退出码必须可靠**），至少覆盖：
- 并发 3 个 dispatch → 实际执行时间区间**不重叠**（用假 runner：`ZCD_FAKE_RUNNER` 指向一个 `sleep 300ms` 后打印合法汇总行的 Node 脚本）
- repo 锁与 memory 锁的互斥与排队顺序（FIFO）
- `kill()` 生效（假 runner 长睡眠 → kill 后状态 `killed`，退出码非 0 记录正确）
- 台账解析：给定样例 jsonl（含坏行）→ `aggregate` 数值正确、5h/周/日窗口边界正确（注入固定 `now`）
- `restore()`：伪造 jobs.json 含 `running` → 启动后变 `interrupted`
- `snapshot()` 能被 `JSON.stringify` 且无循环引用

### 5. `F:\My Code\dsh-plugins\tasks\Z1-delivery.md`
交付文档（front-matter 随意，含：交付清单 / 可复跑命令 + **原始输出** / 未决问题）。**必须**贴出 `node test/core.test.mjs` 与 `node bin/zcd.mjs --help` 的原始输出。

## 三、禁止

- ❌ 改 宿主仓库任何文件（`<HOST_REPO>\**` 一律只读；尤其别动 `scripts/collab/zcode-run.mjs`、`collab/state.json`、`collab/PROTOCOL.md`）
- ❌ 引入 npm 依赖、写 `package.json` 的 dependencies、跑 `npm install`
- ❌ git 任何操作（该目录不在 git 仓库内；如你发现它在某仓库里，也不要提交）
- ❌ 长时间真实派发做测试（真实冒烟最多 1 次 `--prompt`，模型用 `GLM-5.3-Flash`）
- ❌ 读写任何密钥/凭证文件

## 四、验收方式（DSH 独立执行）

1. 我独立跑 `node bin/zcd.mjs --help`、`node test/core.test.mjs`，要求 exit 0；
2. **反向我自建**：并发派发 3 个假 runner，核验时间区间不重叠；kill 后状态正确；删/坏台账文件不崩；
3. 真实冒烟 1 次（`GLM-5.3-Flash`，走套餐），核验 job 字段与台账一致、`snapshot()` 可序列化；
4. 越界检查：宿主仓库 `git status` 必须零改动；
5. 交付文档里的每条命令我都会重跑，不可复现即整单打回。

## 五、完成后

在最终回复里给出：交付清单 / 可复跑命令 / 原始输出 / 未决问题。
