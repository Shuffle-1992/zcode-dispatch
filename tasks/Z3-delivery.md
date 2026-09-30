---
round: Z3
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T06:35:00+08:00
task: Z3-01-task.md
---

# Z3 交付：接入「ZCode 套餐真实额度」（app-server usage/stats RPC）

## 〇、结论（先读这里）

| # | 事项 | 结论 |
|---|---|---|
| 1 | **app-server RPC 层** | ✅ **打通**。协议逆向完成（裸 `{id,method,params}` NDJSON，无握手），客户端实现 + 16 项单测 + 真实 CLI 实跑全过，端到端 **1.77s**（≤30s 约束内），进程树收尾无泄露 |
| 2 | **套餐真实剩余额度（5h/1w 的 limit/remaining/resetAt）** | ❌ **未打通 —— 原因不是鉴权，而是该 CLI 版本（zcode.cjs 0.13.3）的 RPC 面根本不提供**。三类证据见 §四。fetchPlanQuota 按任务包「尽量映射，映射不了放 raw 并标 mapped:false」执行：`week.used` 给**真实数字**（引擎本地库本自然周 token 合计），limit/remaining/resetAt 置 null + `mapped:false` + note，**不假装有剩余额度** |
| 3 | UI（client.js 用量卡片） | 未动（本单范围外）。`fetchPlanQuota` 形状已按任务包约定备好，DSH 接 UI 时可直接消费 |

一句话给验收：`node bin/zcd.mjs plan-quota --json` 给出 `available:true + week.used=1,359,147,837（真实）`，同时明确告知 5h 与"剩余"字段为何为 null。

## 一、交付清单

写入范围：`zcode-dispatch\core\`、`test\`、`tasks\`，另有 §七 三条已声明的最小偏离。

| 文件 | 状态 | 说明 |
|---|---|---|
| `core/appserver-rpc.mjs` | **新增** | `createAppServerClient({cliPath?, env?, timeoutMs=20000, spawnImpl?, onNotification?})` → `{call(method,params,{timeoutMs}), close(), stderrTail(), stats, pid}`。逐行 NDJSON（4MB 无换行熔断）、按 id 匹配（int/string 均回显）、坏行计数不致命、每 call 独立超时（unref）、进程退出/spawn 失败使挂起请求明确收尾；`close()` Windows 先 `taskkill /PID x /T /F` 树杀（已退出=非0 属正常）再 `child.kill()`，幂等。默认环境变量：builtin 配置从 cliPath 推导（`…/resources/glm → …/resources/config/provider/zcode-builtin.json`），personal 用 `~/.zcode/v2/provider_config.json`；**不读、不打印、不落盘任何凭证内容**。零 npm 依赖 |
| `core/quota.mjs` | **修改** | 仅 `fetchPlanQuota` 换真实实现 + 头注释；`aggregate()` 及其余代码**零改动**。真实调用 `usage/stats {range:'all', timeZone:<本机IANA>}`，按日桶映射 `week.used`（Intl 对齐周界，锚点 +12h 防负偏移时区推日）；5h 日粒度不可导出 → null。任何异常 → `{available:false, reason:'<短因>'}`（timeout / spawn-failed / app-server-exited / rpc-error:-32601 / stdin-write-failed / client-closed / unexpected-usage-stats-shape / error），绝不抛错。支持 `client` 注入（注入方负责 close）、`spawnImpl` 注入 |
| `test/quota-rpc.test.mjs` | **新增** | 16 项断言：帧形状（无 jsonrpc 包装、id 自增）、id 并发匹配、通知/坏行计数、call 超时、close 树杀（/T /F + kill + 挂起收尾 + 幂等）、-32601、进程退出、spawn 失败、fetchPlanQuota 映射（fixture 周界/裁剪/raw）、五类故障全返回 `available:false` 不抛、client 注入不代 close、timeoutMs 契约。全部 spawnImpl 假进程，不真起 CLI |
| `test/core.test.mjs` | **修改 1 处** | 唯一改动：`fetchPlanQuota 占位`断言（断言返回 `pending-app-server-rpc`）随行为失效，改为「注入不存在 CLI → `available:false` + 短因 ∈ {app-server-exited, spawn-failed, timeout}」。aggregate 相关断言**零改动** |
| `bin/zcd.mjs` | **修改** | 偏离项①：新增 `plan-quota` 子命令（任务包验收项 2「新增 node bin/zcd.mjs plan-quota --json（若你实现）」——若不落 bin 则该验收项无载体，故实现并在此报备）。`quota` 命令零改动 |
| `tasks/Z3-delivery.md` | **新增** | 本文档 |
| `pitfalls.md`（项目根） | **修改** | 偏离项③：Z2 起既有的全局规则登记惯例，新增 Z3 六条 |

## 二、协议逆向结论（ZCode Protocol stdio）

> 勘察对象：`F:\Program Files\ZCode\resources\glm\zcode.cjs`（14.8MB minified，version 0.13.3）。全部为只读 grep，未改任何文件。

1. **报文形状 = 裸 `{id, method, params}`，没有 JSON-RPC 的 `jsonrpc:"2.0"` 包装**。带 `jsonrpc` 字段直接 `-32600 Invalid ZCode Protocol message`。服务端 -32600 报错的 zod union issues 反向暴露了全部四种合法形状：请求 `{id, method, params}`、通知 `{method, params}`、响应 `{id, result}`、错误响应 `{id, error}`。
2. **stdio 面无握手**。bundle 里的 `hello`/`clientHello`（protocolVersion=3）是桌面 WebSocket 面的消息（`clientMode:"desktop-continuous"` 等）；stdio 直接发业务请求即可。启动后服务端先推 5 条 `startup/storageState` 通知（storage 迁移进度），随后静默。
3. **id 原样回显**（int/string 均可），按 id 匹配；协议级错误形如 `{"error":{"code":-32601,"message":"Method not found: x"},"id":<回显>}`；无法解析的报文以 `id:"invalid-message"` 回 -32600。
4. **方法表全枚举**（va 映射，60+ 方法）：`runtime/capabilities`、`session/*`（create/resume/list/read/messages/events/subscribe/send/stop/fork/compact/goal/close/setModel/setThoughtLevel/setMode/debug/subagents/cancelBackgroundTask）、`workspace/*`、`provider/updateAccountConfig`、`provider/testModelConnectivity`、`mcp/list`、`plugins/*`、`skills/referenceCatalog`、`workflows/*`、`automation/*`、`offPeak/*`、`usage/stats`、`session/usage`、`process/childProcesses`、`interaction/*`、`computer-use/operation-event`。**没有任何套餐余额/剩余/重置类方法**。
5. **`usage/stats` 的语义 = 本地 agent-db 聚合，不是套餐额度**：源码 `kRn` 走 `deps.sessionStore.queryAppUsage({since,until,tzOffsetMs})`，参数 `{range:'7d'|'30d'|'all', timeZone}`，返回 `{range, generatedAt, timeZone, source:'agent-db', summary, heatmap, dailyModelUsage, models, tools}`——**日粒度**的本地会话库统计。

## 三、逐条原始收发报文（脱敏）

> 两轮真实探测（临时脚本放 %TEMP%，跑完已删）。脱敏规则：≥32 字符疑似令牌/uuid/长 hex 替换 `<redacted-*>`；`usage/stats` 返回体为用量统计，无令牌类字段。环境变量仅传**路径**，未读取凭证文件内容。

### 第一轮：JSON-RPC 假设被否（关键教训，2 条即回撤）

```text
+6024ms C->S {"jsonrpc":"2.0","id":1,"method":"runtime/capabilities","params":{}}
+6027ms S->C {"error":{"code":-32600,"data":{"issues":[
          [{"code":"unrecognized_keys","keys":["jsonrpc"],"message":"Unrecognized key: \"jsonrpc\""}],
          [{"code":"unrecognized_keys","keys":["jsonrpc","id"],...}],
          [{"code":"invalid_type","expected":"nonoptional","path":["result"],...},{"code":"unrecognized_keys","keys":["jsonrpc","method","params"],...}],
          [{"expected":"object","code":"invalid_type","path":["error"],...},{"code":"unrecognized_keys","keys":["jsonrpc","method","params"],...}]
        ],"message":"Invalid input"},"message":"Invalid ZCode Protocol message"},"id":"invalid-message"}
        （四个 union 分支 = 请求/通知/响应/错误响应，均无 jsonrpc 键）

+8535ms C->S {"kind":"clientHello","protocolVersion":3,"clientId":"zcode-dispatch-z3-probe","clientKind":"desktop","appVersion":"0.0.0-probe"}
+8535ms S->C {"error":{"code":-32600,...四个分支全部 unrecognized_keys ["kind","protocolVersion","clientId","clientKind","appVersion"]...},"id":"invalid-message"}
        （证明 stdio 面不收 clientHello：无握手）
```

### 第二轮：裸帧全通（逐条）

启动通知流（业务请求之前）：

```text
+1255ms S->C {"method":"startup/storageState","params":{"schemaVersion":1,"attemptId":"<redacted-uuid>","sequence":1,"databaseId":"<redacted-hex>","databaseKind":"session","phase":"checking","elapsedMs":0}}
        …（同形通知 sequence 2/3/4/5，phase: checking→checking→committing→ready，elapsedMs 0~7ms；共 5 条后静默）
```

业务报文（注意 C→S 均为裸三键）：

```text
+4010ms C->S {"id":1,"method":"runtime/capabilities","params":{}}
+4013ms S->C {"id":1,"result":{"independentPlanState":true}}

+5514ms C->S {"id":2,"method":"usage/stats","params":{"range":"7d","timeZone":"Asia/Shanghai"}}
+5753ms S->C {"id":2,"result":{"range":"7d","generatedAt":1790719930518,"timeZone":"Asia/Shanghai","source":"agent-db",
  "summary":{"totalTokens":2533603673,"inputTokens":2529813183,"outputTokens":3790490,"reasoningTokens":0,
   "cacheCreationTokens":0,"cacheReadTokens":2509499200,"cacheHitRate":0.99197...,"totalSessions":32,"totalTurns":385,
   "toolCallCount":6983,...,"activeDays":8,"peakDayTokens":889747487,"favoriteModel":{"modelId":"GLM-5.3-Flash",...}},
  "heatmap":{"startDate":"2026-09-23","endDate":"2026-09-30","maxTokens":889747487,"weeks":[…按日 totalTokens/turnCount/toolCallCount…]},
  "dailyModelUsage":[{"date":"2026-09-23","models":[{"modelId":"GLM-5.3","totalTokens":15283089},{"modelId":"GLM-5.3-Flash","totalTokens":153766614}]}, …共8天…],
  "models":[{…requestCount/share…}],"tools":[{…callCount/errorRate/avgDurationMs…}]}}
  （完整 JSON ≈ 9KB，结构如上，全量可复跑获取）

+8025ms C->S {"id":3,"method":"usage/stats","params":{"range":"all","timeZone":"Asia/Shanghai"}}
+8425ms S->C {"id":3,"result":{"range":"all",…同 7d 结构，回溯至 2026-08-31，summary.totalTokens=5785853295…}}

+10536ms C->S {"id":4,"method":"session/usage","params":{"sessionId":"no-such-session"}}
+10539ms S->C {"id":4,"result":{"sessionId":"no-such-session","totalTokens":0,"inputTokens":0,"outputTokens":0,"reasoningTokens":0,"cacheCreationTokens":0,"cacheReadTokens":0,"modelRequestCount":0,"modelErrorCount":0,"inputBaselineBySource":{}}}

+12551ms C->S {"id":5,"method":"coding-plan/status","params":{}}
+12552ms S->C {"error":{"code":-32601,"message":"Method not found: coding-plan/status"},"id":5}

+13760ms C->S {"id":6,"method":"plan/quota","params":{}}
+13760ms S->C {"error":{"code":-32601,"message":"Method not found: plan/quota"},"id":6}

+14969ms C->S {"id":7,"method":"process/childProcesses","params":{}}
+14969ms S->C {"id":7,"result":{"processes":[]}}

+16472ms [probe] taskkill /PID <pid> /T /F
+16502ms [probe] exit code=null sig=SIGTERM
+16567ms [probe] taskkill exit=128   ← 进程已被 SIGTERM 先杀掉，taskkill 报"找不到"，属正常
```

## 四、「套餐剩余未打通」的三类证据

1. **静态**：方法表全枚举（§二.4）无任何 plan/balance/reset 类方法；`runtime/capabilities` 仅返回 `{independentPlanState:true}`。bundle 内另有 `/coding-plan/personal/overview`、`/api/v1/zcode-plan/billing/balance` 等 URL 构造器与桌面端套餐字段结构（quota/subscription/remaining 快照），但**消费方在桌面端共享代码，CLI 侧无 RPC 出口**（`startPlanEntitlement` 全 bundle 仅 1 处被动引用）。
2. **动态**：`coding-plan/status`、`plan/quota` 实测 -32601（§三轮第二组）。
3. **语义**：`usage/stats` 源码走本地 `sessionStore.queryAppUsage`（`source:"agent-db"`），只有日粒度本地统计——它回答"用了多少"，不回答"还剩多少"。桌面端"5h/1w 剩余"来自签名 HTTP（DSH 已证裸 Key/OAuth 全 401），复刻签名头不在本单授权内（DSH 明示"别再走 HTTP 路"）。

## 五、真实复跑证据（本机 2026-09-30 06:21 +08）

`node bin/zcd.mjs plan-quota --json --timeout-ms 20000`（real 0m1.770s，输出节选，全量可复跑）：

```json
{
  "available": true,
  "plan": "bigmodel-coding-plan",
  "source": "app-server:usage/stats",
  "generatedAt": "2026-09-29T22:21:44.212Z",
  "windows": [
    { "id": "5h", "used": null, "limit": null, "remaining": null, "percentUsed": null, "resetAt": null, "mapped": false,
      "note": "usage/stats 仅日粒度聚合（滚动5h不可导出）；套餐 limit/remaining/resetAt 不在本引擎 RPC 面（…）" },
    { "id": "week", "used": 1359147877, "usedDays": 3, "usedSince": "2026-09-28",
      "limit": null, "remaining": null, "percentUsed": null, "resetAt": null, "mapped": false,
      "note": "used=引擎本地库(Asia/Shanghai)本自然周token合计；…" }
  ],
  "raw": { "range": "all", "timeZone": "Asia/Shanghai", "source": "agent-db",
           "summary": { "totalTokens": 5787742139, "totalSessions": 93, "totalTurns": 701, … }, … }
}
```

`node bin/zcd.mjs quota --json`：本地聚合照常（last5h runs=11 requests=98 …），**不回归**；人读模式 `node bin/zcd.mjs plan-quota` 同步验证通过。

## 六、测试与验收对照（DSH 验收单）

| 验收项 | 结果 | 证据 |
|---|---|---|
| 1. `node test/quota-rpc.test.mjs` 全绿 | ✅ 16/16 | node --test 输出 pass 16 fail 0（duration 858ms） |
| 1. 既有 `node test/core.test.mjs` 全绿不回归 | ✅ 11/11 | pass 11 fail 0（5.26s，aggregate 断言零改动） |
| 2. `quota --json` 正常 | ✅ | §五 |
| 2. `plan-quota --json` 真实数字 / 明确 available:false+reason | ✅ 真实数字 | `available:true + week.used=1,359,147,837`；不可达场景 reason 见 16 项单测 |
| 3. 独立复跑 + 进程泄露检查 | ✅ | `Get-Process node` 仅剩 7 个本会话开始前（≤06:03）即存在的 ZCode 自身进程，无 06:21 后新起 |
| 4. 宿主仓库零改动 | ✅ | 本会话对 宿主项目 仅只读 grep；其现存未提交改动 mtime=04:44-04:45（早于本会话 06:10 开始，系 DSH R35 工作） |

## 七、偏离项报备（3 条，请核可）

1. **`bin/zcd.mjs` 新增 plan-quota 子命令**（+25 行，`quota`/`list`/`dispatch` 等零改动）。理由：验收项 2 点名该命令为其载体；bin 不属 UI（client.js/index.js 未动）。
2. **`core.test.mjs` 一处断言同步**：占位断言与 Z3 目标行为互斥（占位要求返回 `pending-app-server-rpc`，本单使命就是替换它），按新契约改写；未触碰任何 aggregate 断言。
3. **`pitfalls.md` 登记**（项目根，Z2 起既有惯例）。

## 八、复现命令

```powershell
cd F:\My Code\dsh-plugins\zcode-dispatch
node test/quota-rpc.test.mjs                 # 16/16
node test/core.test.mjs                      # 11/11
node bin/zcd.mjs plan-quota --json           # 真实数字（~1.8s，自动起停引擎）
node bin/zcd.mjs plan-quota                  # 人读模式
node bin/zcd.mjs quota --json                # 本地聚合回归检查
powershell "Get-Process node | Select Id,StartTime"   # 泄露检查：应无测试后新起的 node
```

## 九、未决问题

1. **套餐"剩余额度"的后续路径**（按推荐序）：① 升级 ZCode 后复查方法表（本单已把探测成本降为一条命令）；② 逆向桌面端签名头（可行但随版本漂移，维护成本高）；③ 等 z.ai 官方开放额度接口。在拿到真实 limit 前，建议 UI 显示 `week.used`（真实本地用量）而非假装有百分比。
2. **5h 窗口真实值**：`usage/stats` 仅日粒度。曾考虑 `session/list`+`session/usage` 按会话枚举，但会话级总量无法回溯滚动 5h 内的 token（会话可跨窗），只能近似，故不采用（KISS）。工程上正确的路是 `session/subscribe` 事件流逐 turn 累积——超出本单，留待 UI 接入时一并定。
3. **`quota --json` 末尾仍追加 planQuota 行**：Z1 起既有行为（JSON 之后跟一行非 JSON），本单让它变成真实数据且耗时 +1.7s；若 DSH 的纯 JSON 消费方介意，建议后续把 planQuota 并入 JSON 或加 `--no-plan` 开关（属 UI/CLI 契约变更，未擅动）。
4. **高频轮询**：当前 `fetchPlanQuota` 每次独立起停引擎（~1.8s/次）。若 UI 要 1s 级刷新，应复用长连 client（`createAppServerClient` 已支持），但长连与任务包「每次调用 ≤30s、收尾必杀干净」约束冲突，需 DSH 定策略。
