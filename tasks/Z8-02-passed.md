---
round: Z8
seq: "02"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T13:10:00+08:00
---

# Z8-02 复审：**通过 ✅**（最后一跳按静态证据接上；运行时终验待装配）

## 一、DSH 独立复跑

| 检查 | 结果 |
|---|---|
| `node --check` ×4（wire.host / wire.client / client.js / index.js） | 全 0 ✅ |
| **DSH 探针** `Z2_ALLOW_PROFILE_WRITE=1 z2-verify-dsh.mjs` | **18 PASS / 0 FAIL**（Z8-01 遗留的 `createWire is not defined` 已修） |
| 既有测试回归 | `core.test.mjs` 11/11、`channel-retry.test.mjs` 8/8 ✅ |
| **关键判据**：`client.js` 模块 inject | **`['slots', 'remote', 'remote.zcodeDispatch']`** —— Z7 指出的必需两项已补 ✅ |
| 宿主 face 注册 | 采 `bindTypertRemote()` + `mark()`，出处 `refs/dsh-typert/protocol/lib/index.js:146-157 / 248-268`（证据带行号） |
| 交付文档 | `tasks/Z8-delivery.md`（12.9KB，含「未确定项」如实申报）✅ |

## 二、结论（实现方自述，DSH 认可其证据口径）

> **最后一跳已接上（静态证据 + 形状校验 + 桩装配级冒烟）**：客户端 inject 声明 `remote`/`remote.zcodeDispatch`；`apply` 里 `ctx.remote.$mount` 自挂子服务；内嵌传输层经 `resolveRemote()` 调 `ctx.remote.zcodeDispatch.*`。
> **保留项**：运行时终验待真实装配 —— 安装后判据 = 徽标显示「**已连接**」。

DSH 认可该口径：Z8-02 在"不安装、不写 `$DSH_HOME`"的硬约束下已做到可验证上限；真机判据明确（徽标四态：演示数据 / 外部数据 / 已连接 / 连接中）。

## 三、交接给 Z9

UI 两处硬 bug（按钮 pointerdown 被标题栏 `setPointerCapture` 吃掉、`max-height:72vh` 顶满 + `min-height:0` 缺失导致裁切）已由 DSH 定位并派 Z9 修复。Z9 落地后由用户重载一次性验证三件事：按钮可用 / 布局正常 / 徽标是否「已连接」。

## 四、待用户决定

- `F:\My Code\dsh-plugins` 是独立 git 仓库且 `main` **尚无 commit**；是否要首次提交（仅该目录，不碰 宿主仓库）请用户明确指示（按项目纪律，git 操作先问）。

— DSH（总控/复审方）
