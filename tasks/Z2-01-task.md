---
round: Z2
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T05:10:00+08:00
---

# Z2 任务包：DSH 插件「ZCode 派发台」（悬浮窗 UI + Host 半边）

> 派发方 DSH。前置：Z1 已交付 `F:\My Code\dsh-plugins\zcode-dispatch\core\{dispatch-core,quota}.mjs`（本单直接 import 它，**不要重写**）。
> 本单产出 **DSH 插件包**（cordis bundle）：Host 半边跑进程调度，UI 半边在 DSH Web 页面里渲染一个悬浮窗。
> ⚠ **本单不安装、不写 `$DSH_HOME`**（标准模式没有 `plugin_manager`；安装由创造模式会话执行）。

## 一、必读（先读再写）

1. `F:\My Code\dsh-plugins\refs\SKILL.md`、`references/host-plugin.md`、`references/ui-plugin.md`、`references/practices.md`、`references/user-actions.md`、`references/verification.md`
2. `F:\My Code\dsh-plugins\refs\templates\decoration\*`（四个文件：manifest / patch / host / client 的最小可用形态）
3. Z1 的产出：`zcode-dispatch/core/dispatch-core.mjs`、`core/quota.mjs`（读它们的导出签名，别改）

## 二、交付物（写入范围：`F:\My Code\dsh-plugins\zcode-dispatch\`）

### 1. `package.json`
```json
{
  "name": "@local/zcode-dispatch",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js", "./package.json": "./package.json", "./locale/*.json": "./locale/*.json" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  },
  "meta": { "title": "ZCode 派发台", "description": "在 Harness 里派发/监视多个 ZCode 无头进程（单写者互斥、用量与上下文、套餐通道）" },
  "icon": "./icon.svg",
  "files": ["index.js", "client.js", "core", "locale", "icon.svg", "README.md"]
}
```

### 2. `cordis.patch.yml`
```yaml
- insert:
    - id: zcode-dispatch
      name: '@local/zcode-dispatch'
      config:
        demo: false
        maxConcurrent: 1
        runnerPath: '<HOST_REPO>\scripts\collab\zcode-run.mjs'
        ledgerPath: '<HOST_REPO>\collab\logs\zcode-runs.jsonl'
        workRoot: 'F:\My Code\dsh-plugins\zcode-dispatch\.data'
```

### 3. `index.js`（Host 半边）
- `export function apply(ctx, config)`；`Config` 用 schema 声明上面 config 字段（有默认值）
- 用 `createDispatcher({...})` 建单例；`ctx.effect(() => () => dispatcher.dispose?.())` 保证卸载时**杀掉子进程并落状态**
- **导出 agent 工具** `zcode_dispatch`（一个工具 + `action` 参数：`dispatch|list|kill|tail|quota`），语义与 UI 操作一一对应（见 `references/user-actions.md`「一个操作两个调用方」）；工具描述用中文写清参数与限制
- Host 侧对 UI 的暴露走 **`wire.host.mjs`**（见下）

### 4. `wire.host.mjs` / `wire.client.mjs`（**唯一允许留 TODO 的模块**）
标准模式下无法运行 `cordis_inspect_query`，所以真实接线方式未知。要求：
- 两个文件各自导出**稳定的适配器接口**：
  - `wire.host.mjs`: `export function attachHostWire(ctx, dispatcher, config)` —— 负责把 `dispatcher.snapshot()` 推给客户端、并接收客户端动作（dispatch/kill/tail）
  - `wire.client.mjs`: `export function createClientWire(ctx, config)` —— 返回 `{ subscribe(cb), dispatch(spec), kill(id), tail(id) }`
- 两个文件里都要有**显著注释块**，列出创造模式会话要做的三步：
  1. `cordis_inspect_query` → `Service` / `Event`：找 Host 侧可被客户端调用的入口（如 session command / remote service）
  2. `cordis_inspect_query` → `Slots.listSubTree`：确认悬浮窗槽位（首选 `shell.overlay`）与它的 props
  3. 按 inspection 结果替换 `wire.*` 的 TODO 实现，并删除注释块
- 在 TODO 未完成时，**必须**有降级路径：`wire.client.mjs` 的 `subscribe` 用 `setInterval` 轮询 `window.__zcodeDispatchDemo`（若存在）或返回 demo 数据，使 UI 仍可渲染（不报错、不白屏）

### 5. `client.js`（UI 半边，Web 页面里的悬浮窗）
- 形如 `window.__ModuleLoader__.load({ id: '@local/zcode-dispatch', factory(require) { const React = require('react'); … return { inject: ['slots'], apply(ctx) { ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: 'zcode-dispatch', order: 20 }, Panel)); } }; } })`
- `SLOT` 常量默认 `'shell.overlay'`，旁边注释写明回退候选 `'conversation.composer.dock'`（creator 会话按 inspection 结果改这一行即可）
- **悬浮窗行为**：可拖拽（标题栏按住拖动，`pointerdown/move/up`）、可折叠、可最小化成一个圆角小胶囊、右下角贴边；位置与尺寸存 `localStorage`（key 带插件前缀）；`z-index` 用固定较大值并注释说明"仅浮层自身"
- **面板内容（四个分区）**：
  1. **派发栏**：kind 选择（prompt / task / target）、内容输入（多行）、模型下拉（`GLM-5.3` / `GLM-5.3-Flash`）、provider（`plan` / `personal`）、mode（`build|edit|plan|yolo`，默认 `edit`）、超时分钟、`--memory-bench` 勾选、「派发」按钮；派发后按钮变「排队中/执行中」并给出行内反馈
  2. **进程列表**：每行 = 状态点（queued/running/done/failed/killed/interrupted 六色）、tag、model、耗时、上下文占用百分比（`contextUsed/contextWindow`，无数据显 `—`）、退出码、锁标记（repo/memory）；行内按钮：kill、展开 tail（最近 30 行，等宽小字）
  3. **用量卡片**：5 小时滚动窗口 / 本周 / 今日 三块，各显 run 数、请求数、input/output/cache tokens（来自 `quota.aggregate`）；另留一行「套餐剩余额度：待接入（需客户端签名接口）」并注明来源未定
  4. **单写者状态**：repo 锁与 memory 锁当前持有者（tag 或「空闲」）、队列长度
- **样式纪律**：仅用 `--dsw-alias-*` 主题令牌（`cordis_inspect_query` `Theme` 的清单在 creator 会话里核；本单按 `--dsw-alias-bg-layer-*`、`--dsw-alias-text-*`、`--dsw-alias-border-*` 这类命名写，并集中放在一个 `TOKENS` 常量对象里便于替换）；不 import 任何 `@deepseek-ai/*`；不操作 `document.body`；组件卸载清理监听器与定时器
- **demo 模式**：`config.demo === true` 或 `wire` 不可用时，用内置假数据渲染完整界面（3 个进程、2 条用量窗口），便于在安装后立即看到形态

### 6. `locale/zh.json` + `locale/en.json`（meta + 界面文案）、`icon.svg`（≤256KiB，简单几何图形）
### 7. `README.md`
安装（创造模式：`plugin_manager install_bundle` + `target` 指向本目录）、config 说明、**wire TODO 清单**、验证步骤、已知限制（套餐剩余额度未接入；标准模式不可安装）
### 8. `F:\My Code\dsh-plugins\tasks\Z2-delivery.md`
交付文档：清单 / 可复跑命令（`node --check` 全部 js、`node -e` 加载 core、JSON/YAML 解析校验）/ 原始输出 / 未决

## 三、禁止

- ❌ 安装或尝试安装插件、写 `$DSH_HOME`(`C:\Users\Administrator\.dsh`)、改 `cordis.yml`/profile 任何文件
- ❌ 改 宿主仓库、改 `refs/`、改 Z1 的 `core/`（除非接口缺失必须补，且要在交付文档里说明）
- ❌ npm 依赖、构建步骤、TypeScript、JSX（**纯 JS + `React.createElement`**，因为无构建）
- ❌ import `@deepseek-ai/dsh-client-ui-primitives` 或任何 DSH 客户端包
- ❌ git 操作、密钥读取

## 四、验收方式（DSH 独立执行）

1. `node --check` 逐个 JS 文件；`package.json` / `locale/*.json` 可 `JSON.parse`；`cordis.patch.yml` 可被 YAML 解析（用 Node 里最小解析或结构目检 + 关键字段 grep）
2. 静态纪律 grep：不得出现 `@deepseek-ai/dsh-client`、`document.body`、字面色值（`#` 开头颜色仅允许出现在 `icon.svg`）、`require('react')` 以外的外部模块
3. `client.js` 能在 Node 里**加载不报错**（用最小 `window.__ModuleLoader__` 桩 + `require` 桩，验证 factory 可执行、返回 `{inject, apply}`、`apply` 调用 `ctx.slots.inject/register` 时用假 ctx）
4. `index.js` 可被 `node --check` 且导出 `apply`；`Config` schema 合法
5. 越界：宿主仓库零改动；`$DSH_HOME` 零写入
6. 交付文档里的命令逐条重跑

## 五、完成后

最终回复给出：交付清单 / 可复跑命令 / 原始输出 / 未决问题 + **明确列出 creator 会话要做的 3 步接线**。
