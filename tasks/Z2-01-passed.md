---
round: Z2
seq: "01"
from: dsh
to: zcode
type: passed
status: ok
created: 2026-09-30T06:00:00+08:00
---

# Z2 验收：DSH 插件「ZCode 派发台」—— **通过 ✅**（可安装形态成立；3 步接线留给创造模式）

## 一、DSH 独立证据

| 检查 | 结果 |
|---|---|
| 我方探针 `%TEMP%\z2-verify-dsh.mjs` | **18/18 PASS，exit 0** |
| manifest / patch | `@local/zcode-dispatch`；`exports .`+`./client`；`dsh.bundle.patch`；`dsh.client={platform:web, immediately:true}`；`meta.title`+`icon.svg`；patch 含 `id/name/config(runnerPath,ledgerPath,workRoot,demo,maxConcurrent)` |
| 静态纪律（产品文件） | 无 `@deepseek-ai/dsh-client` import；无 `document.body`；`client.js` **零字面色值**、未用 JSX/模块 import；`--dsw-alias-*` 令牌 38 处 / 20 个去重 |
| Host 半边 | `index.js` 导出 `apply` + `Config`，import `core/dispatch-core.mjs` |
| 客户端加载 | 桩 `window.__ModuleLoader__` → `load({id:'@local/zcode-dispatch'})` 命中；factory **只 require react**；返回 `{inject:['slots'], apply}` |
| 槽位注册 | `apply(fakeCtx)` → 注入槽位 **`shell.overlay`**、注册 1 个组件；组件浅渲染不抛错（根节点 `div`） |
| 实现方自验 `test/z2-verify.mjs` | **75 PASS / 0 FAIL**：首帧渲染 **192 节点**、快照更新后 **257 节点**、卸载后无残留定时器、宿主仓库指纹前后一致 |
| 越界 | `$DSH_HOME\profiles\desktop` 近 1h 零写入；宿主仓库仅 DSH 自己的既有改动 |
| 语法/结构 | 10 个 JS 文件 `node --check` 全过；`package.json`、`locale/{zh,en}.json` 可解析 |

## 二、P3 登记

1. `client.js` 的 `SLOT` 默认写死 `shell.overlay`：**未在真机 inspection 下确认**（标准模式无 `cordis_inspect_query`）→ 创造模式会话按 `Slots.listSubTree` 校正（只改常量）。
2. `wire.host.mjs` / `wire.client.mjs` 的客户端↔Host 通道为**适配器 + TODO**，降级路径是 demo 数据（保证 UI 可渲染不白屏）。
3. 套餐剩余额度未接入（Z3 已在跑）。
4. `work/`（jobs.json、logs）在包目录内，建议加 ignore。

## 三、出口

- **通过**：插件包达到"可安装形态"——manifest/patch/Host/UI/文案/图标/README 齐备，静态纪律与槽位注册经双向取证。
- **下一步（必须切创造模式）**：`F:\My Code\dsh-plugins\CREATOR-HANDOFF.md` 的四步：inspection → 填 `wire.*` 与 `SLOT` → `plugin_manager install_bundle` → 页面验证。标准模式没有 `plugin_manager`/`cordis_inspect_*`，无法在此完成。

— DSH（总控/复审方）
