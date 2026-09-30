---
round: Z9
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T13:20:00+08:00
---

# Z9 复审：**通过 ✅**（两处 P1 硬 bug 修复，DSH 逐条核对）

## 一、DSH 独立核对（读源码 + 复跑，不只信自证）

| 判据 | 我看到的 |
|---|---|
| 拖动手势守卫 | `isInteractive` 出现 2 处（定义 + `startDrag` 内 `if (isInteractive(e.target)) return;`）✅ |
| 按钮不被拖动吃掉 | 两个 `zcd-iconbtn` 各有 `onPointerDown: (e) => e.stopPropagation()`（共 2 处，无 preventDefault）✅ |
| 面板不再顶满 | `.zcd-panel` → `max-height:min(72vh,560px)`（L89）✅ |
| 内容可滚不裁切 | `.zcd-body` 追加 `min-height:0;overscroll-behavior:contain`（L96）✅ |
| 长句换行 | `.zcd-note`（L131）/ `.zcd-planline`（L140）`white-space:normal;overflow-wrap:anywhere` ✅ |
| 用量卡片自适应列 | `.zcd-cards` → `display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr))`（L135）✅ |
| 进程行不溢出 | `.zcd-job-head` 加 `flex-wrap:wrap`（L113）；`.zcd-sec`/`.zcd-kv` 加 `min-width:0` ✅ |
| 宽度与窄屏 | `.zcd-root` → `width:min(var(--zcd-w,440px),calc(100vw - 32px))`；`WIDTH.def` 400→440（L48/L87）✅ |
| 语法 / 探针 / 回归 | `node --check` 0；**DSH 探针 18/18**（`Z2_ALLOW_PROFILE_WRITE=1`）；core 11/11；channel-retry 8/8 ✅ |
| 实现方自建冒烟 | 25/25（含"target=button 时无 setPointerCapture"、"空白处拖动照常启动"、"非左键不启动"）✅ |
| 越界 | 只改 `client.js`（10 处），未动组件结构/业务逻辑/`wire.*`/`core/*`/`package.json` ✅ |

## 二、P3 / 保留项

1. **真实浏览器点击未验**：DSH 与本单都无法在真实页面点按钮；判据已下放到用户重载后的目视确认（折叠/最小化生效）。实现方已在交付文档如实标注。
2. 布局数值（`560px` 上限、`440px` 默认宽）是工程折中；若用户观感仍偏挤/偏窄，下一轮按实际截图微调即可（改 3 个常量）。

## 三、出口

- **通过**：用户报告的"按钮点不动 + 布局顶满/裁切"两条均已按根因修复，等用户重载验证。
- 与本单同批：`dsh-plugins` 独立 git 仓库首次提交（Z1–Z9 全量 + 审计链）。

— DSH（总控/复审方）
