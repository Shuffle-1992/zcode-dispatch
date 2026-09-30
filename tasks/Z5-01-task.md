---
round: Z5
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T06:57:00+08:00
---

# Z5 任务包：安装前的收尾打磨（小活，四件）

> 派发方 DSH。Z1–Z4 已全部 passed；本单只做**安装前必须收敛的四处**，让创造模式会话能"装上就看"。
> 写入范围：`F:\My Code\dsh-plugins\zcode-dispatch\`（client.js / bin/zcd.mjs / package.json / test / README）。

## 一、四件事（都有 P3 依据）

1. **额度卡片文案拆分**（Z3-P3-1）——`client.js` 用量区必须让人一眼分清：
   - **本地用量（可核对）**：台账 5h 滚动窗口、引擎本周已用（`plan-quota`）
   - **套餐剩余额度：未接入**，并给一句来源说明（以 ZCode 客户端为准；CLI RPC 面无此方法，app-server `usage/stats` 语义是"本地已用"）
   - 禁止把"引擎本地 token 合计"写成"套餐已用"
2. **`bin/zcd.mjs quota --json` 并入 `planQuota`**（Z3 未决 4）：`quota` 输出里同时给 `local`（现 `aggregate`）与 `planQuota`（`fetchPlanQuota` 结果），任一失败不互相影响；`quota`（人类可读）也各打印一行。保持既有字段不变（**加字段可以，改/删不行**）。
3. **清运行产物**（Z2-P3-4 / Z4 提及）：删除 `test/z2-verify.output.txt`；`work/`（jobs.json、logs）与未来 `.data/` 的定位在 `README.md` 写清"运行期数据，不随包分发"，并在 `package.json` 的 `files` 里**不要**包含 `work`/`.data`/`test/*.output.txt`。
4. **静态证据的时效提示**（Z4-P3-1）：`README.md` 加一行"槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核"。

## 二、禁止

- ❌ 改 UI 结构/组件树（只动文案与数据接线）；❌ 改 `core/`（除 `quota.mjs` 若必须暴露导出，需说明）；❌ 改 `wire.*` 语义
- ❌ 安装插件、写 `$DSH_HOME`、改 宿主仓库、改 DSH 安装目录、npm 依赖、git 操作

## 三、验收（DSH）

1. `node test/core.test.mjs`、`node test/quota-rpc.test.mjs`、`node test/z4-token-check.mjs` 全绿
2. `node bin/zcd.mjs quota --json` → 同时含 `local` 与 `planQuota` 且各自字段完整；人类可读输出两段
3. **我方 Z2 探针 18/18**（`%TEMP%\z2-verify-dsh.mjs`）+ `node --check client.js`
4. 宿主仓库零改动；`$DSH_HOME` 零写入
5. 交付文档 `tasks/Z5-delivery.md`：清单 / 复现命令 / 原始输出 / 未决

## 四、完成后

最终回复：四项逐条落地证据 + 复现命令 + 未决。
