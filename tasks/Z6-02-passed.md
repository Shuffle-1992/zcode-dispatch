---
round: Z6
seq: "02"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T11:15:00+08:00
---

# Z6-02 复审：**通过 ✅**（P2 已闭环；通道切换 / 暂停 / 续跑 / 交接重跑 / 降级链全链路可用）

## 一、DSH 独立验收（不复用实现方测试）

| 检查 | 结果 |
|---|---|
| **DSH 自建探针**（`%TEMP%\z6-verify.mjs`，22 项） | **22 PASS / 0 FAIL，exit 0** |
| 其中：P2 回归项 | `同通道续跑 → parentJobId=原 job` ✅；`attempts 两跳` ✅；`降级链按 parentJobId 找到后继` ✅ → **Z6-01 P2-1 闭环** |
| 暂停分类 | `quota_exceeded→quota-exhausted`、`not_entitled→plan-not-entitled`、`ClientRequestSigningV4Error→provider-signing`、未命中→`unknown`、空输入→`null` ✅ |
| 暂停语义 | 半途失败仍保留 `sessionId`；`paused` **释放锁**、**不堵队列**（后续 job 正常 done）✅ |
| 同通道续跑 | 命令行**含 `--resume <sessionId>`** 且**不含 `--model`**（机制事实 F2）✅ |
| 换通道交接重跑 | **不含 `--resume`**、provider/model 正确、交接提示**五要素齐全**（原任务/中断点/新通道说明/硬约束/禁止）✅ |
| 降级链 | 链在 pause 之前 set → 自动跳链上**可用**通道（personal）、后继为交接重跑 ✅ |
| 实现方新增测试 | `test/channel-retry.test.mjs` **8/8 pass** |
| 回归 | `core.test.mjs` 11/11、`quota-rpc.test.mjs` 16/16、`z4-token-check` 0 缺失 ✅ |
| 通道真值 | `zcd channels --json` 与 `zcode-run.mjs --list-providers` 的 builtin 条目**逐条一致**（enabled/reason/模型）；无 warnings ✅ |
| 交付文档 / README | `tasks/Z6-delivery.md`（11.5KB）、`README.md`（13KB，含**用户可见语义**与两个续跑按钮说明）✅ |
| 越界 | 宿主仓库零改动、`$DSH_HOME` 零写入 ✅ |

## 二、用户可见语义（已写入 README L73-74）

> **换通道 = 交接重跑**（新会话 + 未完成部分交接）；**同通道 = 真 `--resume` 续跑**；
> CLI 硬限制：`--resume` + `--model` 必失败（F2），故同通道续跑绝不带 `--model`。

## 三、P3 登记（不阻塞）

1. `channels --json` 里**原始 app-config provider 条目**（如 `7438da80-…` 深度求索）显示"不可用且无原因"，但运行器的 `personal` 通道（读个人配置文件 `~/.zcode/v2/provider_config.json`）**是可用的** → 建议在 `channels` 输出里把"运行器通道"与"账号侧 provider 条目"分组标注，避免误读。
2. Z6-01 的**静默死亡**已由 DSH 侧工具补上诊断（`signal` / `silentExit`）；本单 1670s 正常收尾，未复现。
3. `client.js` 的 `SLOT`/线序仍待创造模式现场复核（Z4 证据已备）。

## 四、出口

- **通过**：Z6 全链路（通道切换 / 额度暂停 / 同通道续跑 / 换通道交接重跑 / 可选降级链）可用且有双向取证。
- 派发台（插件）侧仍等创造模式安装；**任务执行侧**另有更优通道已就绪：`bridge/`（客户端「自动化」按周期执行，可用 Start Plan 免费额度）——见 `bridge/README.md`。

— DSH（总控/复审方）
