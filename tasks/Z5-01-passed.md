---
round: Z5
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T07:18:00+08:00
---

# Z5 验收：安装前收尾打磨 —— **通过 ✅**（五项全绿）

## 一、DSH 独立复跑

| 检查 | 命令 | 结果 |
|---|---|---|
| 核心测试（回归） | `node test/core.test.mjs` | **11 pass / 0 fail** |
| RPC 测试（回归） | `node test/quota-rpc.test.mjs` | **16 pass / 0 fail** |
| 令牌差集 | `node test/z4-token-check.mjs` | **引用但不存在: 0 个 ✓** |
| 我方 Z2 探针 | `%TEMP%\z2-verify-dsh.mjs` | **18/18**，`$DSH_HOME` 零写入 |
| 语法 | `node --check client.js` | exit 0 |
| `quota --json` | `cmd /c "node bin/zcd.mjs quota --json > f"`（原始字节） | 顶层键 = **既有 7 字段原样保留** + `local` + `planQuota`；`local.available=true`、`planQuota.available=true`、`weekUsed=1,370,934,469`；exit 0 |
| 越界 | 宿主仓库 `git status` | 零改动 ✅ |

## 二、四件事逐条落地（我方直接读文件核对，非引用自证）

1. **额度文案拆分** ✅ `client.js` L141-143：
   - `本地用量（可核对）：台账聚合的 5 小时 / 本周 / 今日窗口`
   - `引擎本周已用（引擎本地库合计，非套餐已用）`
   - `套餐剩余额度：未接入 —— CLI RPC 面无此方法（app-server usage/stats 语义是「本地已用」）；以 ZCode 客户端为准`
2. **`quota` 并入 planQuota** ✅ 见上表；故障独立性有实测（Z5 交付文档 §二）。
3. **清运行产物** ✅ `test/z2-verify.output.txt` 已删；`package.json.files = ["index.js","client.js","core","locale","icon.svg","README.md","wire.host.mjs","wire.client.mjs"]`，**不含** work/.data/test 输出物。
4. **证据时效提示** ✅ `README.md` L10："槽位与令牌证据基于客户端 0.2.0-rc.2 一代包（2026-09-30 抓取），升级后请用 `Slots.listSubTree` 复核。"

## 三、P3 / 未决（转交创造模式会话）

1. **planQuota 真实数据通路未接 UI**：`wire.host.mjs` 的 push bundle 只含 `{snapshot, quota}`，不含 planQuota（本单禁改 wire）→ 创造模式接线时决定是否加入（建议低频刷新，每次起停引擎 ≈1.8s）。
2. `quota --json` 已把尾随行并入 JSON，旧式按行解析的消费方需改读字段。
3. 偏离报备 5 条（locale 同源改动、z2-verify 断言同步、pitfalls 登记、路径拼接 bug 目录清理等）**核可**。

## 四、出口

- **通过**：Z1–Z5 全部闭环，插件包处于"可安装 + 装上可读"状态；
- 安装与现场复核仍**只能由创造模式会话**执行（`CREATOR-HANDOFF.md`）。

— DSH（总控/复审方）
