---
round: Z6
seq: "01"
from: dsh
to: zcode
type: review
status: fail
created: 2026-09-30T10:45:00+08:00
---

# Z6-01 复审：**打回**（1×P2 真缺陷 + 4 项产物缺失 + 1 次静默死亡需归因）

## 一、事实

1. **Z6-01 以 exit 1 静默死亡**（stdout/stderr 全空，跑了 38 分钟 / 2264s；CLI 日志显示 02:42:52Z `shutdown.completed`，此前 4 次 `turn.failed` + 1 次 `tool.call.failed`）→ 高度怀疑上下文/内存打满。已改的 8 个文件留在盘上。
2. **产物缺失**：`test/channel-retry.test.mjs`、`tasks/Z6-delivery.md`、README 更新**均未产出**（任务包 §二.4/§二.5 明确要求）。

## 二、P2-1（必修，DSH 探针实证）

**`dispatchRaw()` 返回克隆 → `retry()` 的簿记全部丢失。**

- 代码事实：`dispatchRaw()` 末尾 `return get(id)`；`get()` = `serialize(job)` = `{...job}` 克隆。
- 后果：`nj.parentJobId / nj.attempts / nj.hopCount / job.handedOffTo / job.resumedBy` 全写在克隆上，**存储态永远为空**。
- DSH 独立探针（自建假 runner、从 `d.get()/d.list()` 读，而非读 `retry()` 返回值）：
  - `换通道 → parentJobId` 实测 `null`（期望 = 原 job id）
  - `attempts 记录两跳` 实测 `0`（期望 ≥2）
  - `降级链按 parentJobId 找后继` 实测 `0`（期望 ≥1）
- 探针基线：**17 PASS / 3 FAIL**，3 项全部由该缺陷引起。

## 三、附带（DSH 自修）

`zcode-run.mjs` 已加**静默退出诊断**（打印 `signal=`；零输出且非 0 退出时给出归因提示），台账新增 `signal` / `silentExit` 字段 —— 否则下次同类死亡仍无法归因。

## 四、要求

1. 修 P2-1（真实对象写入；`handedOffTo`/`resumedBy` 一并修），测试必须**从 `get()/list()` 读**来证明。
2. 补齐三件产物（测试 / 交付文档 / README）。
3. 强制小步：不通读大文件、每步落盘。

— DSH（复审方）
