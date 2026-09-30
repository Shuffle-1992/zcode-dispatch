---
round: Z4
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T06:55:00+08:00
---

# Z4 验收：槽位与主题令牌定证 —— **通过 ✅**（两处"猜的"变成"有证据的"）

## 一、DSH 独立复核（不复用实现方工具）

| 检查 | 方式 | 结果 |
|---|---|---|
| `shell.overlay` 真实存在 | **DSH 自己的扫描器**（`ctx-scan.mjs`，与实现方 `dsh-scan.mjs` 不同源）扫 `D:\DeepSeek\resources\app.asar` | **3 命中**：① 技能文档正文引用；② `dsh-client-ui-chat` 的 frame-wide 条目"注册在 `shell.overlay`"（`+19176019`）；③ 同段中文文案（`+19197782`）→ 官方包确实用该槽位 |
| 新令牌真实存在 | 同上，独立扫两个替换令牌 | `--dsw-alias-button-primary-fill` 命中于 chip 样式（`+21228163`）；`--dsw-alias-bg-module-platform` 命中于 selector 样式（`+18620636`）✅ |
| 令牌差集 | `node test/z4-token-check.mjs` | **0 缺失**（18 个 alias 引用全部命中主题包 107 个全集），exit 0 |
| 我方 Z2 探针（回归） | `node %TEMP%\z2-verify-dsh.mjs` | **18/18**，槽位仍 `shell.overlay`，`$DSH_HOME` 近 1h 零写入 |
| 语法/纪律 | `node --check client.js`；字面色值/DSH 客户端包 grep | 通过；client.js 无字面色值、无 `@deepseek-ai/dsh-client` import |
| 越界 | 宿主仓库 `git status` | 零改动 ✅ |

## 二、结论（写进交接单的事实）

1. **Q1**：`shell.overlay` 存在且是**官方浮层标准位**（list 型、`scope:"root"`、注册必须带 `id`；官方先例 6 处）。`SLOT` 常量维持，注册 `id` 改为 `zcode-dispatch.console`。
2. **Q2**：`client.js` 原 19 个令牌里 **16 个不存在**，已全部替换为真实令牌（`--dsw-alias-label-*`、`-border-l1..l4`、`-state-*-primary`、`-button-primary-fill`、`--dsw-shadow-lv3`、`--ds-font-family-code` 等）；复检 0 缺失。
3. 证据原件：`refs/dsh-slots.md`、`refs/dsh-theme-tokens.md`、`refs/extracted/`（≈0.9MB 六包源码）、工具 `tools/{asar-extract,dsh-scan}.mjs`（可复跑）。

## 三、P3 登记

1. 静态证据对应客户端 `0.2.0-rc.2` 一代包 → 创造模式接线时**仍建议用 `Slots.listSubTree` 现场复核**（升级后槽位表可能变动）。
2. `order:20` 与官方 5 个浮层占位的观感共存需页面确认（`position:fixed` 自定位，理论不干扰）。
3. 输入井底色 `bg-module-platform` 为实证最优但非唯一解，观感不合可回落 `bg-layer-1`。

## 四、出口

- **通过**：Z2 的"猜测项"全部改为证据项，创造模式接线从"查+改+装+验"降为"现场复核 + 装 + 看"。
- 下一步：等用户在创造模式会话执行 `CREATOR-HANDOFF.md`；如需继续用免费窗口，可另立增强单（记忆快照还原、流水线串接、额度卡片文案拆分等）。

— DSH（总控/复审方）
