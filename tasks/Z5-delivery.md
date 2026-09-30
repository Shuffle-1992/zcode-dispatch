---
round: Z5
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T07:20:00+08:00
task: Z5-01-task.md
---

# Z5 交付：安装前的收尾打磨（四件全落地）

## 〇、结论（先读这里）

| # | 事项 | 结论 |
|---|---|---|
| 1 | 额度卡片文案拆分（Z3-P3-1） | ✅ 用量区三行文案：**「本地用量（可核对）：台账聚合的 5 小时 / 本周 / 今日窗口」**（组标签）→ 三卡片（数据不变）→ **「引擎本周已用（引擎本地库合计，非套餐已用）：X tok」**（planQuota 数据接线，有数据才显示）→ **「套餐剩余额度：未接入 —— CLI RPC 面无此方法（app-server `usage/stats` 语义是「本地已用」）；以 ZCode 客户端为准」**。组件树零改动（只动文案与数据接线）；运行时渲染验证 4/4 PASS |
| 2 | `quota --json` 并入 planQuota（Z3 未决 4） | ✅ 输出 = 既有 7 个顶层字段**原样保留** + `local`（=aggregate 完整结果）+ `planQuota`（=fetchPlanQuota 完整结果）；单条纯 JSON（Z3 未决 3 的"尾随非 JSON 行"随之消除）；人类可读输出两段（本地聚合段 + planQuota 行）；**故障互不影响已实测**（`--ledger` 指向不存在文件时 planQuota 仍返回真实数字） |
| 3 | 清运行产物（Z2-P3-4） | ✅ `test/z2-verify.output.txt` 已删；另发现并删除一个路径拼接 bug 产生的**空杂散目录** `My Codedsh-pluginszcode-dispatchwork/`（05:20 遗留，见偏离⑤）；README 新增「运行期数据（不随包分发）」一节；`package.json` 的 `files` 核实**本就不含** `work`/`.data`/`test/*.output.txt`（零改动） |
| 4 | 静态证据时效提示（Z4-P3-1） | ✅ README 顶部警告块新增一行：「槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核。」 |

**验收门全绿**：`core.test.mjs` 11/11 · `quota-rpc.test.mjs` 16/16 · `z4-token-check.mjs` 0 缺失 · DSH Z2 探针 **18/18** · `node --check client.js` exit 0 · 本地 `z2-verify.mjs` **75/75**（修好两个历史漂移断言后，见偏离④）· 宿主仓库零改动 · `$DSH_HOME` 零写入。

## 一、交付清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `zcode-dispatch/client.js` | **修改** | ①STRINGS zh/en：`planQuotaPending` 按 Z3 结论改写；新增 `localNote`、`engineWeekUsed` 两键。②内嵌降级 wire 数据接线：ext 源支持可选 `getPlanQuota()`、demo 引擎新增同形 planQuota（演示值，conn 徽标仍标"演示数据"）、bundle 增加 `planQuota` 字段、useWire 透传。③QuotaCards：新增两行 `.zcd-planline` 文案行 + 按 `planQuota.windows[id=week].used` 条件渲染引擎周用量行。**组件树/组件数/样式表/localStorage 键/SLOT/令牌零改动** |
| `zcode-dispatch/bin/zcd.mjs` | **修改** | `cmdQuota` 重写（+15 行）：aggregate 包 try/catch、fetchPlanQuota 并入 JSON；新增 `--timeout-ms`（默认 15000，与 plan-quota 对齐；原为隐式 5000）；头部用法注释同步。其余子命令零改动 |
| `zcode-dispatch/locale/zh.json` `en.json` | **修改** | ui 段与 STRINGS 同步（新增 2 键 + 改写 1 键，zh/en 键集保持一致）——同源约束（偏离②） |
| `zcode-dispatch/test/z2-verify.mjs` | **修改 2 断言** | 同步 Z3/Z4 行为变更遗留的漂移断言（偏离④）：quota 断言改验真实适配器形状；注册 id 断言改 `zcode-dispatch.console` |
| `zcode-dispatch/README.md` | **修改** | ①顶部新增证据时效提示行（件4）。②新增「运行期数据（不随包分发）」一节（件3）。③「已知限制 #1」从 Z2 时代"占位适配器"描述改写为 Z3 实装现状 + 文案拆分说明。④agent 工具 quota 行、目录结构 core 行的过时描述同步 |
| `zcode-dispatch/test/z2-verify.output.txt` | **删除** | 运行产物（件3） |
| `zcode-dispatch/My Codedsh-pluginszcode-dispatchwork/` | **删除** | 空目录树（locks/logs/state 全空），05:20 某次路径拼接 bug 的产物（偏离⑤） |
| `pitfalls.md`（项目根） | **修改** | Z5 三条（偏离③，Z2 起既有惯例） |
| `tasks/Z5-delivery.md` | **新增** | 本文档 |

**未动**：`index.js`、`wire.host.mjs`、`wire.client.mjs`（`wire.*` 语义零改动）、`core/*`（`quota.mjs` 无需暴露新导出，零改动）、`cordis.patch.yml`、`package.json`（`files` 核实已合规）、icon/locale 结构、宿主仓库、`$DSH_HOME`。

## 二、逐条落地证据

### 件1 额度卡片文案拆分

运行时渲染验证（demo wire 首推 → effect → 二次渲染，临时脚本跑完已删）：

```
=== 用量区 zcd-planline 渲染文案（demo wire）===
  | 本地用量（可核对）：台账聚合的 5 小时 / 本周 / 今日窗口
  | 引擎本周已用（引擎本地库合计，非套餐已用）：564.0k tok
  | 套餐剩余额度：未接入 —— CLI RPC 面无此方法（app-server usage/stats 语义是「本地已用」）；以 ZCode 客户端为准
PASS  本地用量组标签
PASS  引擎本周已用（含非套餐声明）
PASS  套餐剩余：未接入 + 来源说明
PASS  无「套餐已用」误导表述
```

en 文案同步改写（`Plan quota remaining: not wired — no such method on the CLI RPC surface …`）。
禁令达成：引擎本地 token 合计只出现在「引擎本周已用（…非套餐已用）」标签下，全 UI 无「套餐已用」误导表述。

### 件2 quota 并入 planQuota

`node bin/zcd.mjs quota --json` 结构检查（真实台账 + 真实 app-server）：

```
顶层字段: available,generatedAt,ledgerPath,windows,byModel,byBilling,skippedLines,local,planQuota
local 字段: available,generatedAt,ledgerPath,windows,byModel,byBilling,skippedLines
planQuota.available: true | plan: bigmodel-coding-plan | source: app-server:usage/stats
planQuota.windows: 5h(used=null,mapped=false) week(used=1368304462,mapped=false)
local 与顶层既有字段一致: true
整条 stdout 是单个纯 JSON（无尾随非 JSON 行）: 是
```

人类可读输出（两段，节选）：

```
ledger=<HOST_REPO>\collab\logs\zcode-runs.jsonl available=true skippedLines=0
last5h   runs=  13 requests= 225 in= 20320439 out=  318589 cacheRead= 19601728 total= 40240756 elapsed=6955s
week     …
today    …
total    …
  model deepseek-v4-pro: runs=2 …   /  model GLM-5.3: …  /  model GLM-5.3-Flash: …
  billing <unknown>/personal-api-key/zcode-plan: …
planQuota: available=true plan=bigmodel-coding-plan source=app-server:usage/stats week.used=1368417912（引擎本地库合计，非套餐已用；limit/remaining 不在 CLI RPC 面）
```

故障独立性（local 失败不拖累 planQuota）：

```
$ node bin/zcd.mjs quota --json --ledger "F:\nonexistent-z5-probe.jsonl"
local.available: false | planQuota.available: true | planQuota.week.used: 1368417912
planQuota 不受 local 失败影响: true
```

（反向独立性由 `quota-rpc.test.mjs` 16 项断言覆盖：fetchPlanQuota 五类故障全返回 `{available:false,reason}` 绝不抛错，aggregate 照常。）

### 件3/件4 README 与清理

- 删除后 `test/` 仅剩 4 个脚本 + fixtures；杂散目录已不存在（`ls` 取证）。
- `package.json files = ["index.js","client.js","core","locale","icon.svg","README.md","wire.host.mjs","wire.client.mjs"]` → 不含 `work`/`.data`/`test/*.output.txt`，**零改动**。
- README 顶部警告块现含：「槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核。」

### 越界取证

- 宿主仓库：z2-verify 指纹检查前后一致（`1d30225d…`）；现存 porcelain 改动 mtime=04:44-04:45（早于本会话，Z3 交付已报备为 DSH R35 工作）。
- `$DSH_HOME`：DSH 探针第 18 项 PASS（profiles/desktop 近 1h 无写入）；全库近 20 分钟**零写入**（最后一次写入 06:51:57，系 宿主项目 项目另一活跃 DSH 会话启动所致，早于本会话动手时间）。
- 进程泄露：测试后 `Get-Process node` 全部 StartTime ≤ 06:51:55（本会话自身的 ZCode 进程），无 quota 测试拉起后残留的 app-server。

## 三、复现命令

```bash
cd "F:\My Code\dsh-plugins\zcode-dispatch"
node test/core.test.mjs                              # 11/11
node test/quota-rpc.test.mjs                         # 16/16
node test/z4-token-check.mjs                         # 0 缺失
node --check client.js                               # exit 0
node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"   # DSH 探针 18/18
node test/z2-verify.mjs                              # 本地探针 75/75（含 宿主项目 指纹）
node bin/zcd.mjs quota --json                        # 顶层含 local + planQuota（~2s，自动起停引擎）
node bin/zcd.mjs quota                               # 人类可读两段
node bin/zcd.mjs quota --json --ledger "F:\nonexistent.jsonl"        # 故障独立性
```

## 四、偏离项报备（5 条，请核可）

1. **`locale/zh.json` / `en.json` 同步修改**：任务包写入范围列举未含 locale，但 client.js 内嵌 STRINGS 与 locale ui 段是 README 明文的双份同源约束（z2-verify 亦校验键集一致），文案拆分必须同步。内容仅为 3 个 ui 键。
2. **`bin/zcd.mjs quota` 的 fetchPlanQuota 超时默认 5000→15000ms** 并新增 `--timeout-ms`：与 plan-quota 对齐；这是行为参数不是字段，JSON 契约字段零改动。
3. **`pitfalls.md` 登记**（项目根，Z2 起既有惯例）。
4. **`test/z2-verify.mjs` 同步 2 个历史漂移断言**：Z3（fetchPlanQuota 变真）/Z4（id 改 `.console`）改行为时未同步本地探针，基线即 73 PASS / 2 FAIL 假红；本单范围内修复并登记 pitfalls。DSH 侧 18 项探针全程独立不受影响。
5. **删除空杂散目录 `My Codedsh-pluginszcode-dispatchwork/`**：任务包点名清理 `z2-verify.output.txt`，该目录是同类运行产物（路径拼接 bug 所致，全空），按"清运行产物"一并清理。

## 五、未决问题

1. **UI 的 planQuota 真实数据通路待接线时定**：内嵌降级 wire 现支持 `window.__zcodeDispatchDemo.getPlanQuota()`（可选钩子）与 demo 值；但 Host→客户端 push bundle（`wire.host.mjs` 的 `{snapshot, quota}`）不含 planQuota（仅 `quota` 动作返回值带）。`wire.*` 语义本单禁改，creator 接线时需决定 push bundle 是否加 `planQuota`（属 wire 语义变更，需单独授权）。
2. **`quota --json` 输出格式变更**：尾随 `planQuota: {…}` 非 JSON 行已并入 JSON。若存在按行解析旧输出的消费方（Z3 未决 3 曾提示），需改读 JSON 内 `planQuota` 字段。
3. **planQuota 刷新时机**：UI 轮询（2s）只刷新台账 quota；planQuota 是数据源快照值（真实接入时建议低频刷新，每次起停引擎 ~1.8s，见 Z3 未决 4 的长连 client 权衡）。
4. **套餐剩余额度本身**仍未打通（CLI 面不可得，Z3 三类证据），UI 已按事实明示"以 ZCode 客户端为准"；后续路径见 Z3 未决 1（升级客户端后复查方法表成本已降为一条命令）。
