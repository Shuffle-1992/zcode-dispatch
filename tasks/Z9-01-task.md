---
round: Z9
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T13:05:00+08:00
---

# Z9 任务包：修 UI 两处硬 bug（按钮点不动 + 布局顶满/裁切）

> 用户实测反馈（附截图）：① 右上角**折叠（倒三角）与最小化按钮点击无反应**；② 面板**被顶满整屏、内容挤、长句右侧被切**。
> DSH 已定位根因（下方都是代码级事实）。**只改 `client.js`（事件 + CSS + 最小 DOM），不动组件结构与业务逻辑。**

## 一、P1：按钮点不动 —— 指针捕获吃掉 click

**根因**：`client.js:1357` 把 `onPointerDown: startDrag` 挂在**整个标题栏**；`startDrag`（L1273-1301）对 `e.currentTarget`（标题栏）调用 `setPointerCapture`。指针被标题栏捕获后，`pointerup` 落在标题栏 → click 派发给标题栏而非子按钮 → 两个按钮的 `onClick` 永不触发。

**修法（两处都要做）**：

1. `startDrag` 开头加交互元素守卫（放在 `e.button !== 0` 检查之后）：
   ```js
   // 交互元素上按下不启动拖动（否则标题栏的 setPointerCapture 会吃掉子按钮的 click）
   const isInteractive = (el) => !!(el && typeof el.closest === 'function' && el.closest('button,input,select,textarea,a,[role="button"]'));
   const startDrag = useCallback((e) => {
     if (e.button !== 0) return;
     if (isInteractive(e.target)) return;      // ← 新增
     ...原逻辑不动
   ```
2. 两个 `zcd-iconbtn`（L1361-1369）各加 `onPointerDown: (e) => e.stopPropagation(),`（双保险；不要 `preventDefault`）。

## 二、P1：布局 —— 顶满整屏 / 长句被切 / 卡片过窄

按序改这些 CSS 字符串（都在 `CSS` 数组 L79-140 内，逐条改；不要重排结构）：

| 位置 | 现在 | 改成 | 解决 |
|---|---|---|---|
| L80 `.zcd-root` | `width:var(--zcd-w,400px)` | `width:min(var(--zcd-w,` + WIDTH.def + `px),calc(100vw - 32px))` | 窄屏不溢出 |
| L82 `.zcd-panel` | `max-height:72vh` | `max-height:min(72vh,560px)` | 不再顶满整屏（用户窗口高时尤其明显） |
| L89 `.zcd-body` | `...overflow:auto;}` | 追加 `min-height:0;overscroll-behavior:contain;` | **flex 列里 `min-height:0` 缺失是"内容被切/滚不动"的经典原因** |
| L124 `.zcd-note` | 无换行控制 | 追加 `white-space:normal;overflow-wrap:anywhere;` | 长句（如"引擎本周已用…"）右侧被切 |
| L133 `.zcd-planline` | 无换行控制 | 追加 `white-space:normal;overflow-wrap:anywhere;line-height:1.45;` | 同上（套餐/额度说明行） |
| L128 `.zcd-cards` | `display:flex;gap:6px;` | `display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px;` | 三列卡片在 400px 宽下过窄、标签挤断 |
| L106 `.zcd-job-head` | 无换行 | 追加 `flex-wrap:wrap;` | 进程行徽标多时溢出 |
| L90 `.zcd-sec`、L131 `.zcd-kv` | 无 | 各追加 `min-width:0;` | 子项可收缩，长文本能换行 |

可选（同一单里做）：`WIDTH.def` 400 → **440**（`WIDTH={min:320,max:600,def:440}`），让三列卡片与进程行更舒展；`clampWidth` 自动生效，无需改别处。

## 三、硬约束

- ❌ 不改组件树结构、不改业务逻辑/文案、不改 `wire.*`/`core/*`/`index.js`/`package.json`
- ❌ 不安装、不写 `$DSH_HOME`、不改 宿主仓库、不 npm 依赖、不 git
- ✅ **每改一条立刻落盘**；不做无关重构；不通读大文件（用上面给的行号定位）

## 四、自检（贴原始输出）

1. `node --check client.js`
2. `Z2_ALLOW_PROFILE_WRITE=1 node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` → **18/18**（`$DSH_HOME` 那条现在是预期放行）
3. `node test/core.test.mjs`（11/11）、`node test/channel-retry.test.mjs`（8/8）不回归
4. **新增本地冒烟（跑完即删）**，用最小 React/DOM 桩断言：
   - 在按钮上 `pointerdown`（target 为 button）**不会**触发 `setPointerCapture`/拖动逻辑（即守卫生效）；
   - `CSS` 字符串包含 `max-height:min(72vh`、`min-height:0`、`overscroll-behavior`、`repeat(auto-fit,minmax(`、`overflow-wrap`;
   - 组件仍能浅渲染不抛错（沿用现有桩）
5. **明确写一句**：真实浏览器点击行为我无法在此环境验证，需用户重载后在页面上点一次确认。

## 五、交付

`tasks/Z9-delivery.md`：改动清单（逐条对着上表）/ 复现命令 + 原始输出 / 未确定项。最终回复简短给出同四段。
