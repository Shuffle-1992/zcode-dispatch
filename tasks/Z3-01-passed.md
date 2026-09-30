---
round: Z3
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T06:32:00+08:00
---

# Z3 验收：套餐额度接入 —— **通过 ✅**（RPC 层打通；"剩余额度"经证据判定为 CLI 面不可得）

## 一、DSH 独立复跑

| 检查 | 命令 | 结果 |
|---|---|---|
| 新增 RPC 测试 | `node test/quota-rpc.test.mjs` | **16/16 pass，exit 0** |
| 既有核心测试（回归） | `node test/core.test.mjs` | **11/11 pass，exit 0**（无回归） |
| 真实调用 | `node bin/zcd.mjs plan-quota --json > file`（完整落盘，**exit 0**） | `available:true`、`source=app-server:usage/stats`、`week.used=1,360,361,328`（引擎本地库本自然周 token 合计）、`5h.used=null` + `mapped:false` + 具名原因 |
| 进程泄露 | `Get-CimInstance Win32_Process` 过滤 `app-server` | **0 残留**（现存 4 个 node 均为项目 dev 服务：vite 5173 / server.js / nest dist / npm，与本单无关） |
| 越界 | 宿主仓库 `git status` | 零改动（仅 DSH 自己的既有文件）✅ |
| 交付文档 | `tasks/Z3-delivery.md`（16KB） | 含协议帧逐条原始报文（脱敏）、三类证据、方法与复现命令 ✅ |

## 二、结论（可直接对外说的一句话）

**ZCode CLI（zcode.cjs 0.13.3）的 RPC 面不提供"套餐剩余额度"**：方法表 60+ 全枚举无余额/重置类方法；候选 `coding-plan/status`、`plan/quota` 实测 `-32601 Method not found`；`usage/stats` 语义是"本地引擎已用多少"（`sessionStore.queryAppUsage`，日粒度），不是"还剩多少"。桌面端的剩余额度来自**签名 HTTP**（DSH 侧裸 Key/OAuth 6 种 header 全 401，本单未越权重试）。
→ 现状解法：插件显示**本地台账 5h 滚动 / 引擎本周已用**（真实、可核对）；"套餐剩余百分比+重置时间"请以 ZCode 客户端为准（或后续按 `Z3-delivery.md §九` 的候选序推进）。

## 三、P3 登记

1. `week.used` 语义 = **本地引擎**自然周 token 合计（含 GUI 会话与派发台），UI 文案必须写"本地引擎用量"，不得写成"套餐已用"。
2. `test/z2-verify.output.txt` 是输出物落在包内，建议移入 `.data/` 或删除。
3. `bin/zcd.mjs plan-quota` 为隐式新增子命令（任务包只"建议"），核可。
4. `core.test.mjs` 有一处断言随契约同步（`aggregate` 零改动），核可。

## 四、出口

- **通过**：RPC 客户端与额度接口按契约交付，失败路径全部返回 `available:false/具名原因` 且不抛；测试双向取证（假进程 + 真调用）、无进程泄露。
- 后续（可选）：① 创造模式里插件 UI 把额度卡片文案区分为"本地用量/套餐剩余（未接入）"；② 若确需剩余额度 → 升级客户端后复查 RPC 面，或另立"签名头逆向"评估单。

— DSH（总控/复审方）
