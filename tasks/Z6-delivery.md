---
round: Z6
seq: "02-delivery"
from: zcode
to: dsh
type: delivery
status: done
created: 2026-09-30T12:30:00+08:00
---

# Z6-02 交付文档：P2 缺陷修复 + Z6-01 缺失产物补齐

> 上游：`Z6-02-task.md`（Z6-01 静默崩溃后的续作：修 1 个真缺陷 + 补测试/交付文档/README）。
> 工作方式遵守本单要求：分段定位、逐项落盘、未通读大文件。作者：ZCode（zcode 会话）。

## 用户可见语义（任务包要求的一句原话）

> **换通道 = 交接重跑（新会话 + 未完成部分交接），同通道 = 真 `--resume` 续跑；CLI 硬限制：`--resume` + `--model` 必失败（机制事实 F2）。**

该句已写入 `zcode-dispatch/README.md` 的「通道切换 / 暂停 / 续跑（Z6）」节首。

## 一、交付清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `zcode-dispatch/core/dispatch-core.mjs` | 修改（最小 diff） | **P2 修复**：`dispatchRaw(spec, { raw })` 内部路径；`retry()` 两处调用改传 `{ raw: true }`，簿记写在 jobs 里的真实对象上；对外默认仍返回 `get()` 克隆（向后兼容）。含注释更新 |
| `zcode-dispatch/test/channel-retry.test.mjs` | **新增** | Z6-01 §二.4 清单全量覆盖，8 用例，零依赖，退出码可靠 |
| `zcode-dispatch/test/fixtures/fake-runner.mjs` | 修改（增量） | 新增 `FAKE_DONE_BEFORE_PAUSE` 开关：失败前先打印带 `session=…` 的汇总行（同通道续跑测试必需）；不开时行为与原来逐字节一致 |
| `zcode-dispatch/README.md` | 修改 | 新增「通道切换 / 暂停 / 续跑（Z6）」节（切换器/暂停徽章/两个续跑按钮/降级链/用户语义）；agent 工具动作清单补 `channels/channel/retry/fallback`；目录结构补新测试 |
| `zcode-dispatch/test/z2-verify.mjs` | 修改（探针修复） | 说明符扫描前剥块注释——Z6-01 的 client.js 新内容触发了探针**假红**（详见 §三.3），非产品违规 |
| `tasks/Z6-delivery.md` | **新增** | 本文档 |
| `pitfalls.md` | 修改 | 登记 Z6 四条踩坑（含本 P2 的"克隆写簿记"模式） |

**禁止项核对**：宿主仓库零写入（见 §五）、`wire.*` 既有导出语义未动、`core/appserver-rpc.mjs` 未动、未装插件、未写 `$DSH_HOME`、未加 npm 依赖、未做任何 git 操作（任务包禁止）。`--resume` 路径不传 `--model` 有专门断言。

## 二、P2 缺陷：dispatchRaw 返回克隆导致 retry 簿记全丢

**根因**：`dispatchRaw()` 末尾 `return get(id)`，而 `get()=serialize(job)` 是展开克隆；`retry()` 在该返回值上写
`nj.parentJobId / nj.attempts / nj.hopCount` → 写在克隆上，存储态永远为空。修复采用任务包方案 2：
`dispatchRaw` 增加 `{ raw: true }` 内部路径返回 `jobs` 里的真实对象；对外默认路径不变。

**修复证据**（探针 `node %TEMP%\z6-02-probe.mjs`，从 `d.get()` / `d.list()` / jobs.json 磁盘三面读回）：

修复前（交接分支）：

```
A) [get]  child.parentJobId=null attempts.len=0 hopCount=0 | parent.handedOffTo="j-munie3pc-1-22f8"
A) [list] child.parentJobId=null attempts.len=0 hopCount=0 | parent.handedOffTo="j-munie3pc-1-22f8"
A) [disk] child.parentJobId=null attempts.len=0 hopCount=0 | parent.handedOffTo="j-munie3pc-1-22f8"
B) [get]  child.parentJobId=null attempts.len=0 spec.resume="sess_probe_fixed" | parent.resumedBy="j-munie41r-1-e8c8"
B) [disk] child.parentJobId=null attempts.len=0 spec.resume="sess_probe_fixed" | parent.resumedBy="j-munie41r-1-e8c8"
```

修复后（同一探针，同场景重跑）：

```
A) [get]  child.parentJobId="j-muniffxr-0-7867" attempts.len=2 hopCount=1 | parent.handedOffTo="j-munifg0s-1-f50a"
A) [list] child.parentJobId="j-muniffxr-0-7867" attempts.len=2 hopCount=1 | parent.handedOffTo="j-munifg0s-1-f50a"
A) [disk] child.parentJobId="j-muniffxr-0-7867" attempts.len=2 hopCount=1 | parent.handedOffTo="j-munifg0s-1-f50a"
B) [get]  child.parentJobId="j-munifgag-0-6ee7" attempts.len=2 spec.resume="sess_probe_fixed" | parent.resumedBy="j-munifgd8-1-22dc"
B) [disk] child.parentJobId="j-munifgag-0-6ee7" attempts.len=2 spec.resume="sess_probe_fixed" | parent.resumedBy="j-munifgd8-1-22dc"
```

**与任务包 §一 的一处事实差异（需 DSH 探针同步预期时知晓）**：`job.handedOffTo = nj.id`（及 `resumedBy`）
写在 `jobs.get(jobId)` 的**真实对象**上，任务包"存储态仍 null（同理 resumedBy）"与代码事实不符——
修复前三面读回即已正确（见修复前输出的 handedOffTo/resumedBy 列）。真实丢失的只有**新 job 上的三个字段**。
本单修复未动这两行，并在新测试中对它们做了存储态断言（防回归）。DSH 探针 18 项里若含
"handedOffTo 为 null"的预期失败项，应按此修正。

## 三、复现命令 + 原始输出

### 3.1 测试套件（全部绿）

```
$ cd "F:\My Code\dsh-plugins\zcode-dispatch"
$ node test/channel-retry.test.mjs
ℹ tests 8      ℹ pass 8      ℹ fail 0        （新增）
$ node test/core.test.mjs
ℹ tests 11     ℹ pass 11     ℹ fail 0
$ node test/quota-rpc.test.mjs
ℹ tests 16     ℹ pass 16     ℹ fail 0
$ node test/z4-token-check.mjs
引用但主题包不存在: 0 个 ✓
$ node test/z2-verify.mjs
===== 结果：75 PASS / 0 FAIL =====
```

新测试覆盖清单（对应 Z6-01 §二.4）：

1. 暂停分类：4 类签名各造一次（quota-exhausted / plan-not-entitled / provider-signing / config-error）→
   `paused` + 正确 `pauseReason`；unknown 保持 `failed`（非 paused，按设计）；`classifyPause([])===null`；
   `classifyPause(['随便一句'])==={reason:'unknown'}`（任务包提醒的错预期已避开）
2. paused 不占锁（repo/memory 锁文件消失）、不堵队列（后续 job 正常 done）、不自动重试（spawn 恰 2 次）
3. retry 同通道带 sessionId → 命令行含 `--resume <sess>` 且**不含 `--model`**（对照组：原 job 带了 model）
4. retry 换通道 → 无 `--resume`，prompt 逐条断言交接五要素关键字
5. 降级链：**链在 pause 之前 set**；跳过不可用通道（ch-b disabled → 落在 ch-c）；链耗尽停 `paused` +
   warning、不再产生下一跳；`attempts` 从存储态读回且完整
6. `listChannels`：固定样例表格 → plan 别名/personal/reason/endpoint/models 字段正确，
   personal 模型取自配置 fixture 声明；解析失败 → `{channels:[], warnings>0}` 不抛
7. 边界：running 上 retry 抛错；`setFallbackChain('plan,personal')` 抛错
8. 簿记存储态断言（P2 回归）：`d.get()` 与 `d.list()` 双面读回 `parentJobId/attempts/hopCount/handedOffTo/resumedBy`

### 3.2 `zcd channels --json` 真值核对（结论：一致，零修复）

`node bin/zcd.mjs channels --json` 与 `node <宿主项目>/scripts/collab/zcode-run.mjs --list-providers` 并排核对：

- runner 表 7 行（builtin:bigmodel / builtin:zai / builtin:bigmodel-coding-plan / bigmodel-start-plan /
  zai-coding-plan / zai-start-plan / 7438da80-…UUID 行）的 `enabled / endpoint / models / reason`
  与 `channels --json` 逐项一致；UUID 行 `…daedafalse` 粘连列解析正确（id 无损）。
- `plan` 别名：enabled=true、`aliasOf: builtin:bigmodel-coding-plan`，与 runner 尾注
  「默认 --provider plan 会选第一个启用的 *coding-plan」一致。
- **`personal` 通道**：enabled=true（口径=provider_config.json 本体，同 runner，F6 实测 exit 0）；
  模型列表 `["deepseek-flash"]` 来自配置 `personalModelIds` 实际声明，**零硬编码**
  （`readPersonalChannel()` 读 `rule.config.personalModelIds`；新测试用 fixture 证明了这一来源）。
- 原始输出全文已在本会话留存；复现：上面两条命令即可（通道可用性随 `~/.zcode/v2/config.json` 实时变）。

### 3.3 z2-verify 2 FAIL 的处置（探针假红，非产品违规）

Z6-01 改动 client.js 后，`z2-verify.mjs` 出现 73 PASS / 2 FAIL，两条失败均因**探针正则假命中**：

- client.js 头注释含「不 import 任何 DSH 宿主客户端包」，贪婪正则 `import[\s\S]*?from\s*['"]…`
  从注释里的 "import" 一路吞到英文文案 `parentFrom: 'continued from', hop: 'hop'` 构成的
  `from'…, hop: …'` 形状 → 产出假说明符 `", hop: "`，同时打挂「说明符白名单」与
  「client.js 只 require('react')」两条（真 `require('react')` 被这次大匹配吞掉没数到）。
- 即 pitfalls Z2-1「纪律 grep 会被注释命中」的变体。修法：扫描前剥除块注释（`test/z2-verify.mjs`
  §4 一处 + 注释说明）。修后 75 PASS / 0 FAIL，产品代码零改动。

## 四、Review / 强制性优化 / Simplify（行为规范必做三项）

- **Review**：diff 结构化审查——`dispatchRaw` 新参数仅内部两个调用方使用，`dispatch()` 公共路径不变；
  `emit('job-updated', nj)` 现在拿到真实对象，`emit` 内部本就 `serialize()` 克隆后广播，无别名泄漏；
  `retry()` 返回值仍为 `get(nj.id)`，外部可观察行为不变（仅存储态从错变对）。
- **优化/健壮性**：修复同时救活了降级链的 `hopCount` 封顶判断（修复前 hopCount 恒 0 →
  `>= chain.length` 永假 → 理论上可无限跳；现新测试覆盖链耗尽停 paused）。
- **Simplify**：未采用任务包方案 3（serialize 字段引用穿透——易踩）；方案 2 共 3 处小 diff +
  注释，无新抽象。fake-runner 仅增量开关，未重写。

## 五、宿主仓库核查（如实报告）

- 本会话对 宿主仓库**零写入**（写入仅限 `dsh-plugins/zcode-dispatch/**`、`tasks/`、`pitfalls.md`、`%TEMP%` 探针）。
- 但 `git -C "<HOST_REPO>" status --porcelain` 显示工作树有两处**先前已存在**的修改：
  - `M collab/PROTOCOL.md`（mtime 04:45，早于 Z6-01 签发 10:20，属 DSH 自己 R35 时段）
  - `M scripts/collab/zcode-run.mjs`（mtime 10:45，在 Z6-01 崩溃 10:42:52 之后、Z6-02 签发 10:50 之前；diff +308/-10）
  - 另有未跟踪 `.zcodeignore`、`docs/沟通-R35-….md`。
- `test/z2-verify.mjs` §8 的会话内指纹核对通过（前后一致），证明**本会话运行期**未动它。
  10:45 的 zcode-run.mjs 修改归属请 DSH 自行裁定（非本会话所为）。

## 六、未决问题

1. **classifyPause 行优先 vs 注释语义**：`PAUSE_SIGNATURES` 注释称"顺序即优先级"，实现是行优先扫描
   ——跨行时先出现的行先定性，quota 宽词行若出现在 entitlement 行之前会抢先定性（行内则精确原因优先，
   已有断言固定）。未改（属既有实现，且四类实测样例全对）；建议 DSH 定夺是否改为签名优先扫描。
2. **真实双通道演练未跑**：`plan/GLM-5.3-Flash → personal/deepseek-flash` 真额度交接演练未执行
   （Z6-02 验收清单未列；交接语义已由假 runner 端到端覆盖 + DSH 验收 §四自会做真演练）。
3. **client.js UI 真机观感**：Z6-01 写的切换器/徽章/双按钮/降级开关本单未动（禁止重写既有实现），
   待安装后 creator 会话页面验证。
4. **DSH 探针同步**：18 项探针中 handedOffTo/resumedBy 相关预期请按 §二 的事实差异修正；
   其余 3 项 P2 失败本单已修复，预期探针归零。
5. Z6-01 崩溃根因（上下文打满）未做仪器化验证；本单全程分段读取/即时落盘，可作为工作方式基线。
