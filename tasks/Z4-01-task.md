---
round: Z4
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T06:36:00+08:00
---

# Z4 任务包：用证据固定插件 UI 的两处未知（槽位 + 主题令牌）

> 派发方 DSH。背景：Z2 交付的插件 UI 里，`SLOT = 'shell.overlay'` 是**猜的**、20 个 `--dsw-alias-*` 令牌名也是**按命名规律写的**。标准模式没有 `cordis_inspect_query`，但**可以从 DSH 客户端 bundle 里把事实挖出来**，从而把创造模式的接线风险降到最低。
> 写入范围：`F:\My Code\dsh-plugins\refs\`（新证据）、`F:\My Code\dsh-plugins\tools\`（提取脚本）、`zcode-dispatch\client.js`（按证据修正）。**不要改** `index.js`/`wire.*`/`core/`。

## 一、已知事实（DSH 已实证，直接用）

1. DSH 安装：`D:\DeepSeek\`（Electron），客户端与包都在 `D:\DeepSeek\resources\app.asar`（**121MB 的 asar 归档**；`D:\DeepSeek\resources\app.asar.unpacked\dsh\node_modules\...` 里只有原生依赖）。
2. asar 格式：`[8 字节 pickle][16 字节处 uint32 = header 长度][header JSON][文件数据偏移]`。**DSH 已写好一个可用提取器**，直接复用/搬运：
   `C:\Users\Administrator\AppData\Local\Temp\asar-extract.mjs`（用法 `node asar-extract.mjs <asar> <path-prefix> <outDir>`，支持 `LIST_ONLY=1` 列清单）
   → 把它**复制**到 `F:\My Code\dsh-plugins\tools\asar-extract.mjs` 并加上你自己的注释（临时目录那份随时可能没）。
3. 已知客户端包前缀：`dsh/node_modules/@deepseek-ai/dsh-client-ui-*`（如 `dsh-client-ui-conversation`、`dsh-client-ui-settings`、`dsh-client-ui-theme`、`dsh-client-ui-primitives`…），以及 `dsh-web-app` 等。

## 二、要回答的两个问题（必须给证据，不许猜）

### Q1 槽位：`shell.overlay` 到底存不存在？它的注册选项与 props 形状是什么？
- 先用 `LIST_ONLY=1` 列出 `dsh/node_modules/@deepseek-ai` 下所有 `dsh-client-*` 包的文件清单（只列，别全量提取，避免几百 MB）。
- 搜索槽位**名字符串**（例如 `'shell.overlay'`、`"shell.overlay"`、`composer.dock`、`slot` 定义表）：建议先用脚本在 asar 里做**字符串扫描**（无需全量解包）：可复用 DSH 的扫描思路（8MB 分块 + `Buffer.indexOf` + 命中上下文）。
- 产出：
  - **可用槽位清单**（至少覆盖 `shell.*` 与 `conversation.*` 前缀），标注来源包与证据位置（偏移/文件）
  - `shell.overlay` 的**注册选项**（`name`/`id`/`order` 之外还有哪些）与**传入组件的 props 字段**（从订阅它的宿主代码里读）
  - 若 `shell.overlay` 不存在：给出**存在的等价浮层槽位**（证据），并把 `client.js` 的 `SLOT` 改成它

### Q2 主题令牌：`client.js` 里用的 20 个 `--dsw-alias-*` 是否都真实存在？
- 从 `dsh-client-ui-theme`（或其 CSS/TS 产物）里抽出**令牌定义清单**（`--dsw-alias-*` 全集）。
- 与 `client.js` 里实际引用的令牌做**双向差集**：`引用但不存在`（必须改）、`存在但没用`（可选）。
- 把差集结果写成清单；不存在的令牌在 `client.js` 里替换为**存在且语义最接近**的令牌。

## 三、交付物

1. `tools/asar-extract.mjs`（复制 + 注释）、`tools/dsh-scan.mjs`（字符串扫描器，参数化：文件、针、上下文长度、最大命中）
2. `refs/dsh-slots.md` —— Q1 结论 + 证据（槽位清单表、`shell.overlay` 注册选项与 props、命中来源与偏移）
3. `refs/dsh-theme-tokens.md` —— Q2 结论 + 证据（令牌全集、差集、替换映射）
4. `zcode-dispatch/client.js` —— 按证据修正：`SLOT` 常量、该槽位的 props 用法（不得引入未证实字段）、令牌名替换；**其余 UI 结构与行为不变**（45KB 的组件树不要重写）
5. `tasks/Z4-delivery.md` —— 清单 / 复现命令 + 原始输出 / 未决

## 四、禁止

- ❌ 改 DSH 安装目录（`D:\DeepSeek\**` 一律只读）、装插件、写 `$DSH_HOME`
- ❌ 改 宿主仓库、`index.js`、`wire.*`、`core/`、`test/`（除必要时在 `test/` 加一个校验脚本）
- ❌ 全量解包 app.asar（>300MB）到工作区；提取物只放 `refs/extracted/`（如确需）并保持 <50MB
- ❌ npm 依赖、git 操作、读凭证

## 五、验收（DSH）

1. 我复跑 `tools/asar-extract.mjs` 与 `tools/dsh-scan.mjs` 的关键命令，核对证据可复现
2. 我抽查 `refs/dsh-slots.md` 里列的槽位名，用独立扫描确认至少 3 条命中
3. `node --check client.js` + **DSH 的 Z2 探针**（`%TEMP%\z2-verify-dsh.mjs`）必须仍 18/18（槽位名变了要同步探针预期）
4. 宿主仓库零改动；DSH profile 零写入

## 六、完成后

最终回复：Q1/Q2 的直接答案（一行一个）、修正了哪些常量/令牌、复现命令、未决。
