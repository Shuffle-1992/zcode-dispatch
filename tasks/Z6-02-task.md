---
round: Z6
seq: "02"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T10:50:00+08:00
---

# Z6-fix 任务包：修 1 个真缺陷 + 补齐缺失产物（**小步快跑，别再撑爆上下文**）

> 背景：Z6-01 跑到 38 分钟**静默死掉**（exit 1、stdout/stderr 全空，CLI 日志显示 10:42:52 正常 shutdown → 高度怀疑上下文/内存打满）。
> 代码改了大半（`core/dispatch-core.mjs` 52KB、`bin/zcd.mjs` 17KB、`client.js` 69KB、`index.js`、`wire.*`、`locale/*` 都动了），但**缺失：新测试文件、交付文档、README 更新**，并且 DSH 探针抓到一个**真缺陷**。
> ⚠️ **工作方式要求（本单强制）**：不要通读这些大文件；用 `Select-String`/分段读取定位。**每完成一项立刻落盘**。单次回复不要贴大段代码。

## 一、必修缺陷（DSH 探针实证，P2）

**`dispatchRaw()` 返回克隆，导致 retry 的簿记全部丢失。**

- 事实：`dispatchRaw(spec)` 末尾 `return get(id)`；而 `get()` = `serialize(job)` = `{...job, ...}` → **返回的是克隆，不是 `jobs` 里的对象**。
- 后果：`retry()` 里这几行都写在克隆上，**存储态永远为空**：
  ```js
  nj.parentJobId = job.id;      // 存储态仍 null
  nj.attempts = [...];          // 存储态仍 []
  nj.hopCount = ...;            // 存储态仍 0
  job.handedOffTo = nj.id;      // 存储态仍 null（同理 resumedBy）
  ```
- DSH 探针证据：换通道重跑后，`d.get(child.id).parentJobId === null`、`attempts.length === 0`（而 `retry()` 的**返回值**是对的，所以只测返回值测不出来）。
- 修复建议（择一，保持向后兼容）：
  1. `retry()`里改为对**真实对象**写：`const live = jobs.get(nj.id); live.parentJobId = ...`；或
  2. `dispatchRaw()` 增加内部返回真实对象的路径（例如 `dispatchRaw(spec, { raw: true })`），对外仍返回 `get(id)`；或
  3. 让 `serialize()` 浅拷贝但 `parentJobId/attempts/hopCount/handedOffTo/resumedBy` 走引用（不推荐，易踩）
- **必须**同时修 `handedOffTo` / `resumedBy`（旧 job 上的标记）。
- 修复后**必须**有测试证明是从 `d.get(id)` / `d.list()` 读出来的（不是读 `retry()` 返回值）。

## 二、补齐 Z6-01 缺的产物

1. **`test/channel-retry.test.mjs`**（Z6-01-task §二.4 的原始要求，照那个清单写；零依赖、退出码可靠）
   - 至少覆盖：暂停分类（4 类签名 + unknown）、paused 不占锁不堵队列、**retry 同通道带 sessionId → 命令行含 `--resume` 且不含 `--model`**、**换通道 → 不含 `--resume` 且 prompt 含五要素**、降级链（**链必须在 pause 之前 set**，见下）、`listChannels` 解析失败不抛
   - 注意：`classifyPause(['随便一句'])` 按设计返回 `{reason:'unknown'}`（不是 null），只有**完全无输出**才返回 `null` —— 别照着错预期写
   - 同通道续跑测试里，假 runner **必须先打印带 `session=…` 的汇总行再失败**，否则 job 没有 sessionId，`retry` 会正确地走交接分支
2. **`tasks/Z6-delivery.md`**：清单 / 复现命令 + 原始输出 / 未决；必须写明**用户可见语义**："换通道 = 交接重跑（新会话 + 未完成部分交接），同通道 = 真 `--resume` 续跑；CLI 硬限制：`--resume` + `--model` 必失败"
3. **`README.md`**：通道切换器、暂停徽章、两个续跑按钮、降级链（默认关 + 会消耗下游额度）、以及上面那句用户可见语义
4. **`zcd channels --json` 真值核对**：确认输出与 `zcode-run.mjs --list-providers` 的通道/可用性/原因一致（不一致就修）；`personal` 通道模型列表以**个人配置实际声明**为准（当前是 `deepseek-flash` 等，不要硬编码）

## 三、禁止

- ❌ 改 宿主仓库、`wire.*` 既有导出语义、`core/appserver-rpc.mjs`、安装插件、写 `$DSH_HOME`、npm 依赖、git
- ❌ 在 `--resume` 时传 `--model`（机制事实 F2）
- ❌ 通读大文件 / 重写既有实现（只做本单列的四件事）

## 四、验收（DSH）

1. `node test/channel-retry.test.mjs` + 既有 `core.test.mjs`/`quota-rpc.test.mjs`/`z4-token-check.mjs`/`z2-verify.mjs` 全绿
2. **DSH 探针**（`%TEMP%\z6-verify.mjs`，我自建）必须从 **18 项 5 失败** 变成 **0 失败**（其中 2 项是我探针预期错，我会同步修正；剩下 3 项就是本单 P2 的实证）
3. 我方 Z2 探针 18/18；`node --check` 全部 JS；宿主仓库零改动

## 五、完成后

最终回复（**简短**）：P2 修复证据（贴 `d.get(id)` 的 parentJobId/attempts 输出）/ 新测试通过数 / 交付文档与 README 已写 / 未决。
