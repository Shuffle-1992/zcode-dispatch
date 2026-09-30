# DSH 主题令牌实证（Q2：`--dsw-alias-*` 真实性核对）

> Z4 证据文档。权威来源：`dsh-client-ui-theme/lib/client.js`（从 `D:\DeepSeek\resources\app.asar` 提取，
> 落盘 `refs/extracted/dsh-client-ui-theme/`）。生成：2026-09-30（Z4）。

## 一、直接结论

1. 修正前 `client.js` 引用的 **19 个去重 `--dsw-alias-*` 令牌中，只有 3 个真实存在**
   （`--dsw-alias-bg-layer-1/2/3`），**16 个不存在** —— 任务包的怀疑成立。
2. 真实令牌体系（权威调色板在 theme 包内）：
   - 文本族真名是 **`--dsw-alias-label-*`**（`-primary/-secondary/-tertiary/-caption/-dimmed/…`），
     **不存在 `--dsw-alias-text-*`**；
   - 边框族真名是 **`--dsw-alias-border-l1/l2/l3/l4`**（另有 `-inverted/-inverted2/-l2-darkmode-thin`），
     **不存在 `-border-default` / 裸 `-border`**；
   - 状态色族真名是 **`--dsw-alias-state-{error,success,warn,idle,business}-primary`**（另有 secondary/tertiary），
     **不存在 `-text-{success,error,critical,warning,info,disabled}`**；
   - 品牌填充是 **`--dsw-alias-button-primary-fill`**（= `--dsw-alias-brand-primary`，亮色近黑/暗色近白，
     **不是蓝色**；产品蓝是 `--dsw-alias-state-business-primary` / `--dsw-alias-button-info-fill`）；
   - 悬浮投影是 **`--dsw-shadow-lv3`**（非 alias 族；`--dsw-alias-bg-overlay` 存在但是**填充色**不是阴影）；
   - 悬停反馈是 **`--dsw-alias-interactive-bg-hover`**（不存在 `-fill-control-hover`）；
   - 等宽字体是 **`--ds-font-family-code`**（注意前缀 `--ds-`，定义于 `:root`；不存在 `-alias-font-family-mono`）；
   - 控件井底色实证用 **`--dsw-alias-bg-module-platform`**（theme 包设置页 stepper 即用它）。
3. 修正后复检：`client.js` 的 20 个去重 `var()` 令牌引用 **0 缺失**（18 个 alias + `--dsw-shadow-lv3` +
   `--ds-font-family-code`）。复跑：`node test/z4-token-check.mjs`（在 `zcode-dispatch/` 下，退出码 0）。

## 二、权威来源位置（`refs/extracted/dsh-client-ui-theme/lib/client.js`）

| 区域 | 位置 | 内容 |
|---|---|---|
| 调色板（alias + static 全量定义） | 第 1148 行 `design_platform_css_default` | `body{…}` 亮色 / `body[data-ds-dark-theme]{…}` 暗色，全部 alias 令牌的逐主题取值 |
| 阴影/渐变 | ≈偏移 71349（`gradient-shadow-text.css.mjs` 区域） | `--dsw-shadow-lv1: 0 2px 4px 0 #0000000d`、`-lv1-blur`、`-lv2: 0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a`、**`-lv3: 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014`**、`--dsw-elevation-stroke-color: var(--dsw-alias-border-l4)` |
| 字体 | ≈偏移 48283（`:root` css） | `--dsw-font-family`（无衬线栈）、`--dsw-font-family-brand`（Montserrat）、**`--ds-font-family-code: "SF Mono","JetBrains Mono","Fira Code",Consolas,"Liberation Mono",Menlo,Courier,…`** |
| alias 出现面 | 全文件 | **107 个**去重 `--dsw-alias-*`（含使用）；主题应用机制见 layout 包 `ThemePresenter.apply`（把 `ctx.theme.getSnapshot().active.tokens` 逐个 `body.style.setProperty`） |

## 三、双向差集与替换映射

**引用但不存在（修正前，16 个）→ 替换为（全部有定义处背书）：**

| # | 旧（不存在 ✗） | 新（存在 ✓） | 证据/语义 |
|---|---|---|---|
| 1 | `--dsw-alias-fill-control-hover` | `--dsw-alias-interactive-bg-hover` | 调色板：亮 `#2631480f` / 暗 `#ffffff14`，标准悬停反馈 |
| 2 | `--dsw-alias-fill-brand` | `--dsw-alias-button-primary-fill` | 调色板定义为 `var(--dsw-alias-brand-primary)`，主按钮填充 |
| 3 | `--dsw-alias-bg-brand` | （并入上一行回退链）`--dsw-alias-brand-primary` | 同族回退 |
| 4 | `--dsw-alias-text-primary` | `--dsw-alias-label-primary` | 主文本 |
| 5 | `--dsw-alias-text-on-brand` | `--dsw-alias-label-primary-foreground` | 调色板：亮 bluish-00 / 暗 bluish-1000，"品牌填充上的文字" |
| 6 | `--dsw-alias-border-default` | `--dsw-alias-border-l2` | 调色板：亮 `#0000001a` / 暗 `#ffffff1f`，theme 包 CSS 最高频 hairline |
| 7 | `--dsw-alias-border`（裸） | `--dsw-alias-border-l1`（回退） | 更淡的一档 |
| 8 | `--dsw-alias-shadow-overlay` | `--dsw-shadow-lv3` | 大范围悬浮投影（见上表取值） |
| 9 | `--dsw-alias-text-secondary` | `--dsw-alias-label-secondary` | 次文本 |
| 10 | `--dsw-alias-text-tertiary` | `--dsw-alias-label-tertiary` | 三级文本 |
| 11 | `--dsw-alias-text-critical` | `--dsw-alias-state-error-primary` | 错误红（亮 red-600 / 暗 red-400） |
| 12 | `--dsw-alias-font-family-mono` | `--ds-font-family-code` | `:root` 定义；注意 `--ds-` 前缀 |
| 13 | `--dsw-alias-text-info`（running 点） | `--dsw-alias-state-business-primary` | 亮 deepseek-500 / 暗 deepseek-400，信息蓝 |
| 14 | `--dsw-alias-text-success`（done 点） | `--dsw-alias-state-success-primary` | green-500 |
| 15 | `--dsw-alias-text-warning`（killed 点） | `--dsw-alias-state-warn-primary` | amber-500 |
| 16 | `--dsw-alias-text-disabled`（interrupted 点） | `--dsw-alias-state-idle-primary` | 中性灰（亮 neutral-300 / 暗 neutral-600），匹配"非活动"语义 |

**引用且存在、保持不变（3 个）：** `--dsw-alias-bg-layer-1 / -2 / -3`（亮色全为 bluish-00、暗色 875/850/800，
面板表面语义不变）。另把输入井底色 `sunken` 从 `bg-layer-1` 升级为 **`--dsw-alias-bg-module-platform`**
（亮 bluish-60 / 暗 bluish-800）——theme 包设置页控件井的实证用色，比"与面板同色"更接近宿主观感；
回退链保留 `bg-layer-1`。

**存在但没用（89 个 alias，信息项，不动）：** 全集 107 − 引用 18。可选项，例：`-label-caption/-dimmed`、
`-bg-base/-bg-overlay`、`-menu-icon`、`-toast-bg/-toast-label`、`-tooltip-bg`、`-markdown-*`、`-scrollbar-*` 等。

## 四、暗色主题要点（复核过）

- 亮/暗切换的开关是 `body[data-ds-dark-theme]` 属性（layout 包 `ThemePresenter` 设置），**同一批令牌名**，
  只换取值 —— 插件零分支即可双主题正确。
- `--dsw-shadow-lv3` 定义在主题无关的 `body{…}` 上（黑色低透明度，双主题通用）。
- `brand-primary` 亮色是近黑（bluish-1000）、暗色是近白（bluish-50）——配
  `label-primary-foreground`（亮 bluish-00 / 暗 bluish-1000）正好构成"主按钮底+字"反色对，
  与插件 accent/onAccent 的用法一致。

## 五、复现命令

```bash
# 差集复跑（退出码 0 = 无缺失）
cd zcode-dispatch && node test/z4-token-check.mjs

# 主题包提取（如 refs/extracted 缺失时重建）
node tools/asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-client-ui-theme" "refs/extracted/dsh-client-ui-theme"

# 独立抽查：任一令牌在主题包源码中的定义处（示例）
node tools/dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "--dsw-alias-state-business-primary" "--ds-font-family-code" "--dsw-shadow-lv3" --ctx 60 --max 3 --path dsh-client-ui-theme
```

修正前差集原始输出（`z4-token-check.mjs` 前身，19 个去重 alias 引用）：

```
=== 引用但主题包不存在（16 个）===
--dsw-alias-fill-control-hover / -fill-brand / -bg-brand / -text-primary / -text-on-brand /
-border-default / -border / -shadow-overlay / -text-secondary / -text-tertiary / -text-critical /
-font-family-mono / -text-info / -text-success / -text-warning / -text-disabled
=== 引用且真实存在（3 个）===
--dsw-alias-bg-layer-2 / -1 / -3
```

修正后（`node test/z4-token-check.mjs`）：

```
client.js var() 引用令牌（去重）: 20
  …（20 行全部 OK，见上文第三节）…
引用但主题包不存在: 0 个 ✓
其中 --dsw-alias-* 引用: 18 个；主题包 alias 全集 107 个，插件未使用 89 个（存在但没用，可选项）
```
