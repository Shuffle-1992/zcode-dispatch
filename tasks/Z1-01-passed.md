---
round: Z1
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T05:27:00+08:00
---

# Z1 验收：ZCode 派发核心 —— **通过 ✅**

## 一、DSH 独立证据（不复用实现方测试）

| 检查 | 命令 | 结果 |
|---|---|---|
| 实现方自测 | `node zcode-dispatch/test/core.test.mjs` | **11/11 pass，exit 0**（串行/FIFO、双锁、kill、看门狗、台账合并、窗口边界、restore、snapshot、坏 runner 路径、解析单元） |
| 我方反向控制 | `node %TEMP%\z1-verify.mjs`（**DSH 自建假 runner**，写入 start/end 时间戳独立取证） | **7/7 PASS**：3 job 全 done、执行区间**零重叠**、FIFO 顺序 `mine-1,2,3`、字段解析 `provider=plan:fake model=FAKE in=100 ctx=100`、kill → `state=killed`、snapshot 可 JSON 序列化、结束后无残留锁文件 |
| 真实端到端 | `node bin/zcd.mjs dispatch --kind prompt --prompt "只回答一个词：ZCD_OK" --model GLM-5.3-Flash --tag z1-smoke2` | `state=done exit=0 elapsed=7.6s`，`provider=plan:bigmodel-coding-plan`、`model=GLM-5.3-Flash`、`endpoint=open.bigmodel.cn`、`billing=zcode-plan`、`usage requests=1 in=27729 out=42` |
| 台账一致性 | 台账最后一行 vs job 记录 | `sessionId/tag/exit/elapsedSec/tokens` 全部对上 ✅ |
| CLI 可用性 | `node bin/zcd.mjs --help` / `quota --json` | 帮助完整；`quota --json` 真实聚合出 5h 窗口 `runs=9 requests=40 in=2903270` |
| 越界检查 | 宿主仓库 `git status` | 仅 DSH 自己的既有改动，Z1 **零改动** ✅ |

## 二、P3 登记（不阻塞）

1. `kill` 后 `exitCode` 为 `null`（实现方自测断言的是"记录正确"，我方观察到 null）——建议后续统一为 `null` + `signal` 字段，UI 侧按 `signal` 展示。
2. `work/state/jobs.json` 与 `work/logs/` 落在包目录内（`zcode-dispatch/work/`）：建议后续加进 `files` 忽略或改到 `.data/`，避免随包分发。

## 三、出口

- **通过**：核心可独立运行、可被插件 import、单写者互斥与串行化经双向取证成立。
- 下一步：Z2（DSH 插件包）已派发，使用 `GLM-5.3-Flash`（套餐免费窗口）。

— DSH（总控/复审方）
