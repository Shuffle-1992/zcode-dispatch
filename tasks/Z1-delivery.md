---
round: Z1
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T05:55:00+08:00
task: Z1-01-task.md
---

# Z1 交付：ZCode 派发核心（standalone Node，零依赖）

## 一、交付清单

| 文件 | 说明 |
|---|---|
| `zcode-dispatch/core/dispatch-core.mjs` | 派发核心：`createDispatcher(options)` → `dispatch/list/get/tail/kill/snapshot/subscribe/restore`。文件锁 + 进程内 FIFO 队列双保险互斥；`[zcode-run]` 汇总行解析；台账回读合并；`<workRoot>/state/jobs.json` 原子持久化（临时文件 + rename）；测试注入 `ZCD_FAKE_RUNNER` / `options.spawnImpl` / `options.now` |
| `zcode-dispatch/core/quota.mjs` | `aggregate({ledgerPath, now})` 纯函数窗口聚合（5h 半开 / 本地周一 00:00 起 / 本地当日 / 全部）+ `fetchPlanQuota({planKey, timeoutMs})` 占位适配器（`{available:false, reason:'pending-app-server-rpc'}`） |
| `zcode-dispatch/bin/zcd.mjs` | 独立 CLI：`--help / list / dispatch / watch / quota / kill / tail`，零依赖手写参数解析，env `ZCD_RUNNER/ZCD_LEDGER/ZCD_WORK_ROOT/ZCD_RUNNER_CWD` 与同名 flag 可覆盖默认路径 |
| `zcode-dispatch/test/core.test.mjs` | 零依赖自测（node:test），11 个用例覆盖任务包要求的全部六项 |
| `zcode-dispatch/test/fixtures/fake-runner.mjs` | 测试假 runner（打印与真实 runner 同格式汇总行；路径故意含空格；env 开关控制睡眠/退出码/跳过行/固定 session） |

运行期产物（自动生成）：`zcode-dispatch/work/`（`locks/repo.lock`、`locks/memory.lock`、`state/jobs.json`、`logs/<jobId>.{out,err}.log`）。

## 二、可复跑命令 + 原始输出

以下命令均在 `F:\My Code\dsh-plugins\zcode-dispatch` 下、Node v24.14.1 实跑，未做任何删改。

### 1. `node bin/zcd.mjs --help` → exit 0

```text
#!/usr/bin/env node
/**
 * zcd — ZCode 派发核心的独立 CLI（零依赖）。
 *
 * 用法：
 *   node bin/zcd.mjs --help
 *   node bin/zcd.mjs list [--json]
 *   node bin/zcd.mjs dispatch --kind prompt --prompt "只回答 OK" --model GLM-5.3-Flash --tag z1-smoke
 *   node bin/zcd.mjs dispatch --kind task --task <abs path> --mode yolo --timeout-min 30
 *   node bin/zcd.mjs watch            # 每 1s 打印 snapshot 摘要，Ctrl+C 退出
 *   node bin/zcd.mjs quota [--json]
 *   node bin/zcd.mjs kill <id>
 *   node bin/zcd.mjs tail <id> [-n 50]
 *
 * dispatch 附加：--kind task|prompt|target --prompt/--task/--target --model --provider
 *   --mode build|edit|plan|yolo --tag --timeout-min --cwd --resume --memory-bench
 *   --lock repo|memory|both --max-concurrent <n> --no-wait
 *
 * 路径默认值（可用环境变量或参数覆盖）：
 *   ZCD_RUNNER / --runner        runner 脚本（默认 宿主仓库 zcode-run.mjs，只读使用）
 *   ZCD_LEDGER / --ledger        台账 zcode-runs.jsonl
 *   ZCD_WORK_ROOT / --work-root  派发器工作根目录（默认 <zcode-dispatch>/work）
 *   ZCD_RUNNER_CWD / --runner-cwd  子进程工作目录（默认当前目录）
 * 测试注入：ZCD_FAKE_RUNNER 覆盖 runner 路径（见 test/core.test.mjs）。
```

### 2. `node test/core.test.mjs` → exit 0（11/11）

```text
✔ 并发 3 个 dispatch（maxConcurrent=1）→ 执行区间不重叠且 FIFO (1169.1168ms)
✔ repo/memory 锁互斥：跨锁可并行、同锁与 both 排队 FIFO、锁文件内容与释放 (1167.9949ms)
✔ kill()：running → killed 且退出码非 0；queued → 直接 killed 不再启动 (20.4445ms)
✔ dispatcher 看门狗：超过 timeoutMin+grace 强杀并标 timedOut (1228.624ms)
✔ 台账回读合并：补缺字段、坏行不崩、sessionId 不匹配时不误绑 (765.5618ms)
✔ quota.aggregate：窗口边界（5h 半开/周一起/当日零点）、坏行计数、文件缺失不崩 (2.5013ms)
✔ restore()：上次残留 running/queued → interrupted（记录原因），队列继续可用 (398.6385ms)
✔ snapshot() 纯 JSON 可序列化（无循环引用），终态后依旧 (374.4892ms)
✔ runner 路径无效 → state=failed、exitCode 记录、有 warning 不崩 (57.4787ms)
✔ parseRunnerLine 单元：真实 runner 各种行格式（含 - 值与三行分开的 out/err/result） (0.4847ms)
✔ 清理临时目录 (8.713ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5200.2189
```

### 3. 真实冒烟（唯一 1 次，GLM-5.3-Flash 走套餐）→ exit 0

命令：`node bin/zcd.mjs dispatch --kind prompt --prompt "只回答 OK" --model GLM-5.3-Flash --provider plan --tag z1-smoke --timeout-min 5`

```text
[zcd] job=j-mun6jkgs-0-cdaa state=running queuedAt=2026-09-29T21:19:52.924Z
[zcd] job=j-mun6jkgs-0-cdaa running…
[zcd] job=j-mun6jkgs-0-cdaa state=done exit=0 elapsed=7.7s session=sess_43d79941-07dc-457d-b904-422d6bb121f1
[zcd] provider=plan:bigmodel-coding-plan model=GLM-5.3-Flash billing=zcode-plan
[zcd] usage requests=1 in=27724 out=16 cacheRead=1536 responseChars=2
[zcd] result=<HOST_REPO>\collab\logs\zcode-run-z1-smoke-2026-09-29T21-19-52-998Z.result.json
[zcd] out=<HOST_REPO>\collab\logs\zcode-run-z1-smoke-2026-09-29T21-19-52-998Z.out.log
[zcd] parseWarnings:
  unparsed [zcode-run] line: [zcode-run] cli=F:\Program Files\ZCode\resources\glm\zcode.cjs
```

> 说明：冒烟跑在 `cli=` 行识别修复**之前**，该 warning 已固化在这条历史 job 记录里；修复后新增用例断言 `cli=`/`task=` 行识别不再告警（测试第 10 项）。复跑冒烟不会有此行。

**job 与台账一致性核验（临时脚本，跑后已删）→ ALL-MATCH**：

```text
snapshot 可序列化: 2776 字节, jobs=1, counts={"done":1}
OK  exitCode: job=0 ledger=0
OK  sessionId: job="sess_43d79941-…" ledger="sess_43d79941-…"
OK  provider: job="plan:bigmodel-coding-plan" ledger="plan:bigmodel-coding-plan"
OK  model: job="GLM-5.3-Flash" ledger="GLM-5.3-Flash"
OK  usage.requests: job=1 ledger=1
OK  usage.inputTokens: job=27724 ledger=27724
OK  usage.outputTokens: job=16 ledger=16
OK  usage.cacheReadTokens: job=1536 ledger=1536
OK  contextUsed: job=27740 ledger=27740
OK  contextWindow: job=200000 ledger=200000
OK  responseChars: job=2 ledger=2
ALL-MATCH
```

### 4. `node bin/zcd.mjs list` / `node bin/zcd.mjs quota`（读真实台账）→ exit 0

```text
id              state       tag           model            elapsed  exit lock      session
共 0 条；work=F:\My Code\dsh-plugins\zcode-dispatch\work        ← list（冒烟前）

ledger=<HOST_REPO>\collab\logs\zcode-runs.jsonl available=true skippedLines=0
last5h   runs=   7 requests=  12 in=   341416 out=    3411 cacheRead=   219200 total=   564027 elapsed=87s
week     runs=   7 requests=  12 in=   341416 out=    3411 cacheRead=   219200 total=   564027 elapsed=87s
today    runs=   7 requests=  12 in=   341416 out=    3411 cacheRead=   219200 total=   564027 elapsed=87s
total    runs=   7 requests=  12 in=   341416 out=    3411 cacheRead=   219200 total=   564027 elapsed=87s
  model deepseek-v4-pro: runs=2 in=55958 out=117 cacheRead=0
  model GLM-5.3: runs=4 in=257730 out=3255 cacheRead=210880
  model GLM-5.3-Flash: runs=1 in=27728 out=39 cacheRead=8320
  billing <unknown>: runs=1 in=27974 out=49
  billing personal-api-key: runs=1 in=27984 out=68
  billing zcode-plan: runs=5 in=285458 out=3294
planQuota: {"available":false,"reason":"pending-app-server-rpc"}
```

（台账里 7 条历史记录都在近 5h 内，故四窗口数值相同；`<unknown>` billing 是历史真实数据缺字段，稳态处理。）

### 5. 越界检查：宿主仓库零改动

```text
BEFORE-fingerprint: 714dea6df2f6aafd   ← (git status --porcelain + git diff --stat | sha256sum)
AFTER-fingerprint : 714dea6df2f6aafd
PORCELAIN-IDENTICAL                    ← 两次 porcelain 文件逐字节 diff 为空
```

开工前仓库已有的改动（`collab/PROTOCOL.md`、`scripts/collab/zcode-run.mjs` 的 M 状态与若干 untracked）是 DSH 自己的，保持原样未触碰；台账与 `collab/logs/*` 均在 `.gitignore`（`logs/`）内，冒烟写入不影响 git 状态。

## 三、实现要点与决策记录

- **互斥语义**：`spec.lock`（默认 `both`）决定需要的锁集合；同进程 FIFO 队列 head-of-line 保证排队顺序（队头拿不到锁即停，不越过）；文件锁 `openSync('wx')` 独占创建做跨进程原子仲裁，拿不全即全放（固定 repo→memory 顺序防死锁）。锁内容 `{jobId,pid,at,lock}`；启动时与获取时清理过期锁（>2h 或 pid 已死；内容损坏按 mtime 年龄兜底）。
- **解析以 runner 源码为准**：真实 runner 的 `out=/err=/result=` 是三行分开打印（任务包示例是一行），两种都兼容；`usage` 各值可能为 `-`（→ null）；`done` 行除 exit/elapsed 外均可选；`done` 行的 provider/model 是 traceId 反查的**实际值**，覆盖启动行声明值；`cli=`/`task=` 为已知信息行。
- **台账合并**：按 tag 匹配；已知 sessionId 时只精确匹配（同 tag 旧 run 不误绑）；只补 job 缺失字段，stdout 已解析值不被覆盖；坏行计数进 parseWarnings。
- **决策 1（偏差说明）**：`restore()` 把残留 `queued` 也标记为 `interrupted`（原因：进程重启后原队列上下文不存在，留着永远无法终态）。任务包只要求处理 `running`；如需"重启后自动续跑队列"，属后续增量。
- **决策 2**：`totalTokens = input + output + cacheRead`。如 DSH 计费口径要 in+out，改 `quota.mjs` 的 `finalize()` 一处即可。
- **决策 3**：dispatcher 看门狗 = `timeoutMin + timeoutGraceSec(默认120s)`，先让 runner 自己的超时机制（exit 124，正常写台账）生效，dispatcher 只兜底防挂死；看门狗触发 → `killed` + `timedOut:true`。
- **多进程共存**：`persist()` 写前采纳磁盘上本进程不认识的 job（缓解 host + CLI 同 workRoot 互相覆盖）；容量上限 1000 条，只淘汰最老终态记录。kill 仍限本进程（跨进程 kill 需按锁文件 pid 处理，见未决问题）。
- **安全**：spawn 数组参数无 shell（prompt/路径含空格安全）；不读不打任何凭证（凭证由 runner 自己的临时配置机制管理）；锁/状态文件仅落 `workRoot`。

## 四、Review / 强制优化 / Simplify 自查

- **Review 闭环**：测试先抓出 2 个真实缺陷并修复——历史 job 缺 `parseWarnings` 数组导致 serialize 崩（补 `normalizeJob()` + 防御展开）；流式解析半行会在下个 chunk 重复上抛（改为仅在流 end 时 flush 残尾）。
- **性能**：job 体纯 JSON + child/watchdog 侧表分离；tailLines 200 行、jobs.json 1000 条双上限；每行 persist 的读改写在该量级（单 run ~10 行输出）可忽略。
- **健壮性**：坏台账/坏锁/坏 jobs.json、spawn 失败、runner 缺失、半行流、含空格路径、`-` 占位、未来时间戳记录均有测试或显式处理。
- **Simplify**：4 个文件、无重复抽象；`aggregate` 保持同步纯函数；注入点仅 3 个（ZCD_FAKE_RUNNER / spawnImpl / now）。

## 五、未决问题

1. **`fetchPlanQuota` 待接 app-server RPC**：接口签名与返回形状已按任务包约定固化（`{available:true, plan, windows:[{id:'5h'|'week', used, limit, resetAt}], raw}`），等 ZCode app-server `usage/stats` RPC 可用后替换实现，调用方无感。
2. **跨进程 kill**：CLI 与 host 共用 workRoot 时，`kill` 只能杀本进程派发的 child；跨进程建议读锁文件里的 pid 处理。v1 未做（DSH 单 host 调度可避开）。
3. **jobs.json 多进程写竞争**：采纳机制缓解了覆盖丢数据，但读-合-写本身无锁，双进程同时 persist 理论上仍有小窗口；建议约定单写者（host），CLI 只做只读命令或独立 workRoot。
4. **`totalTokens` 口径**：当前 = in+out+cacheRead，如计费口径不同请指出，一行可改。
5. **重启后自动续跑队列**：现按保守处理（queued → interrupted），如需恢复续跑请确认语义后再加。
