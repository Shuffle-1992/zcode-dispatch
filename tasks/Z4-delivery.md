---
round: Z4
seq: "01"
from: zcode
to: dsh
type: delivery
status: delivered
created: 2026-09-30T07:10:00+08:00
---

# Z4 交付：插件 UI 两处未知的证据固定（槽位 + 主题令牌）

## 一、Q1/Q2 直接答案

- **Q1**：`shell.overlay` **存在**。声明于 `dsh-client-ui-layout` 的 root children 表：
  `{ kind: "list", scope: "root" }`；由 `AppFrame` 渲染进专用 `overlayLayer` 图层（`renderSlot("shell.overlay", {})`，
  owner props 为空）。list 型注册硬约束：`id` 必填（同 priority 唯一）、`order` 参与排序；注册选项全集
  `name/key/id/order/label/priority/select/inject/children/store/locale/registrant`。组件 props =
  `{...kit, ...injected, ...slotInjected.props, ...ownerProps}`，对本插件（无 children/store/locale/inject）
  即全局标准钩子 + `{}`，`FloatingPanel` 不取 props，零兼容风险。官方先例 6 处
  （chat.quota-notice / plugin-manager.refresh-toast / workspace.session-rename / -session-archive / -row-toast / +shell.leading 的 sidebar）。
  详见 `refs/dsh-slots.md`。
- **Q2**：**16/19 不存在，已全部替换**。真实体系：文本=`--dsw-alias-label-*`、边框=`-border-l1..l4`、
  状态=`-state-*-primary`、主按钮=`-button-primary-fill`、悬停=`-interactive-bg-hover`、阴影=`--dsw-shadow-lv3`、
  等宽=`--ds-font-family-code`（`--ds-` 前缀）。仅 `bg-layer-1/2/3` 原名保留。修正后复检 **0 缺失**。
  详见 `refs/dsh-theme-tokens.md`。

## 二、修正了哪些常量/令牌（`zcode-dispatch/client.js`）

| 位置 | 修正 |
|---|---|
| `SLOT` 常量（原第 24 行） | **值不变**（`'shell.overlay'`）；注释从"猜 + 回退候选"改为证据摘要 |
| 注册 `id`（apply 内） | `'zcode-dispatch'` → `'zcode-dispatch.console'`（对齐先例 `<功能>.<物>` 惯例）；`order: 20` 保留 |
| `T.hover` | `-fill-control-hover` → `-interactive-bg-hover` |
| `T.accent` | `-fill-brand,-bg-brand,-text-primary` 链 → `-button-primary-fill,-brand-primary` |
| `T.onAccent` | `-text-on-brand` → `-label-primary-foreground` |
| `T.border` | `-border-default,-border` → `-border-l2,-border-l1` |
| `T.shadow` | `-alias-shadow-overlay` → `--dsw-shadow-lv3`（字面回退链保留，无 `#` 字面色） |
| `T.text/text2/text3` | `-text-primary/secondary/tertiary` → `-label-primary/secondary/tertiary` |
| `T.danger` | `-text-critical` → `-state-error-primary` |
| `T.mono` | `-alias-font-family-mono` → `--ds-font-family-code` |
| `T.sunken` | `-bg-layer-1` → `-bg-module-platform`（回退 `-bg-layer-1`；theme 包设置页控件井实证用色） |
| `T.stQueued/stIdle` | `-text-tertiary/secondary` → `-label-tertiary/secondary` |
| `T.stRunning/stDone/stFailed/stKilled/stInterrupted` | `-text-info/success/critical/warning/disabled` → `-state-business/success/error/warn/idle-primary` |

**未动**：组件树、行为、文案、localStorage 键、z-index、`index.js`、`wire.*`、`core/`、`cordis.patch.yml`、宿主仓库、`D:\DeepSeek\**`、`$DSH_HOME`。

## 三、交付清单

| 文件 | 说明 |
|---|---|
| `tools/asar-extract.mjs` | DSH 临时提取器的固化副本 + asar 格式/用法注释（逻辑与原版一致） |
| `tools/dsh-scan.mjs` | 参数化扫描器：`<asar> <needle…> [--ctx N] [--max M] [--enc utf8\|utf16\|both] [--path s]`；8MB 分块 + `Buffer.indexOf`（双编码）+ header 区间反查"文件+文件内偏移" + 按需读上下文 |
| `refs/dsh-slots.md` | Q1 结论 + 槽位清单表（shell.\* 5 个、conversation.\* 21 个、抽样 2 个）+ 注册选项/props 契约 + 证据偏移 |
| `refs/dsh-theme-tokens.md` | Q2 结论 + 权威来源位置 + 16 项替换映射 + 暗色要点 + 复跑命令 |
| `refs/extracted/`（5 个包，共 ≈0.9MB） | `dsh-client-ui-slots`、`-theme`、`-layout`、`-conversation`（lib）、`-renderer`（lib）、`-cordis` —— 第一手证据源码 |
| `zcode-dispatch/client.js` | 按证据修正（仅 SLOT 注释、id、T 令牌对象、两处注释；组件树零改动） |
| `zcode-dispatch/test/z4-token-check.mjs` | 令牌差集校验脚本（验收可复跑；按任务包许可存放于 test/，不需要可删） |
| `tasks/Z4-delivery.md` | 本文件 |

## 四、复现命令 + 原始输出（摘要）

```bash
cd "F:\My Code\dsh-plugins\tools"
node dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "shell.overlay" --ctx 120 --max 12
node dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "composer.dock" --ctx 90 --max 8 --path dsh-client-ui
cd ..\zcode-dispatch && node test/z4-token-check.mjs
node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"
node --check client.js
```

关键原始输出：

```
[u8] "shell.overlay" @ dsh-client-ui-layout/lib/client.js +29942
    "rightbar": { kind: "single", scope: "root" }, "shell.overlay": { kind: "list", scope: "root" }, "shell.leading": …
[u8] "shell.overlay" @ dsh-client-ui-layout/lib/client.js +17145
    const overlays = react.useMemo(() => renderSlot("shell.overlay", {}), [renderSlot]);
[u8] "shell.overlay" @ dsh-client-ui-workspace/lib/client.js +198618 / +198868 / +199055
    ctx.slots.register({ name: "shell.overlay", id: "workspace.session-rename|session-archive|row-toast", … })
[u8] "shell.overlay" @ dsh-client-ui-chat/lib/client.js +563810   （id: "chat.quota-notice"）
[u8] "shell.overlay" @ dsh-client-ui-plugin-manager/lib/client.js +181660（id: "plugin-manager.refresh-toast"）
扫描完成：12 次命中

[u8] "composer.dock" @ dsh-client-ui-conversation/lib/client.js +710633
    "conversation.composer.dock": { kind: "list", scope: "session" }
[u8] "composer.dock" @ dsh-client-ui-conversation/lib/client.js +684399（宿主渲染）
[u8] "composer.dock" @ dsh-client-ui-chat/lib/client.js +564507（id: "stats", order: 0）
扫描完成：4 次命中
```

```
$ node test/z4-token-check.mjs
client.js var() 引用令牌（去重）: 20   （20 行全部 OK）
引用但主题包不存在: 0 个 ✓
其中 --dsw-alias-* 引用: 18 个；主题包 alias 全集 107 个，插件未使用 89 个

$ node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"
PASS ×18 … PASS 越界: $DSH_HOME profile 近 1h 无写入  clean
[DSH Z2 探针] 18 项，失败 0 项
```

## 五、验收对照（任务包·五）

1. 两个工具的关键命令均可复跑（上文第四节；扫描器对 121MB 归档约数秒/针）。
2. 槽位名抽查：`refs/dsh-slots.md` 每行带偏移；`shell.overlay`(12 命中)、`conversation.composer.dock`(4)、
   `conversation.session.header.actions`(4)、`sidebar.footer.action`(2)、`tool.call.toolview`(4) 已实测命中。
3. `node --check` 通过；Z2 探针 **18/18**（槽位名未变，探针预期无需同步；探针对槽位名本为动态打印）。
4. 宿主仓库零改动；DSH profile 零写入（探针第 18 项 PASS）；`D:\DeepSeek\**` 只读。

## 六、未决问题

1. **`--dsw-alias-bg-module-platform` 的取值是实证推断的最优解，非唯一解**：theme 包用它做设置页控件井；
   若创造模式验收时观感与宿主浮层有出入，备选 `--dsw-alias-bg-overlay`（注意它是填充色）或回落 `bg-layer-1`。
2. **`order: 20` 的实际观感**待页面验收：当前 `shell.overlay` 已有 5 个官方占用（toast/对话框类），
   list 渲染顺序由 priority(默认 0)→order 决定；悬浮台是 `position:fixed` 自定位，理论上与相邻占位互不干扰。
3. **`conversation.composer.dock` 未采用**（虽存在）：`scope:"session"` 且宿主仅在有会话的 composer 变体渲染，
   不满足"全应用悬浮台"需求——若未来要做"输入框 dock 条"，它是正确目标。
4. `refs/extracted/dsh-client-ui-conversation`、`-renderer` 因提取器前缀规则平铺落盘（无 lib/ 子目录），
   内容完整；如需目录形态，重跑提取命令时给前缀加尾斜杠亦可。
5. 创造模式接线时仍应以 `Slots.listSubTree` 现场复核一次（运行时快照），本证据来自静态 bundle，
   版本演进可能增删槽位（本归档为 0.2.0-rc.2 一代的客户端包）。

## 七、Z4 踩坑登记（已同步 pitfalls.md）

- asar header 里文件 offset 是**相对数据区基址**的，扫描器映射时必须先减 `baseOffset` 再二分。
- 提取器输出接管道 `head/tail` 会 EPIPE 崩（退出码≠0 但文件已写全）——看文件别看退出码。
- 提取器对无尾斜杠前缀**平铺落盘**（`…/lib` 前缀 → 文件直接在 outDir 下）。
- 令牌差集要只认 `var(…)` 引用：注释里的通配写法（`--dsw-alias-bg-layer-*`）会制造伪命中。
