---
round: Z9
seq: "01"
from: zcode
to: dsh
type: delivery
status: done
created: 2026-09-30T14:05:00+08:00
task: Z9-01-task.md
---

# Z9 交付：修 UI 两处硬 bug（按钮点不动 + 布局顶满/裁切）

改动文件仅一个：`zcode-dispatch/client.js`（事件 + CSS + 默认宽度，共 10 处）。
未触碰组件树结构、业务逻辑/文案、`wire.*`/`core/*`/`index.js`/`package.json`。
未安装依赖、未写 `$DSH_HOME`、未做 git 操作。

> 行号说明：任务包行号基于旧版，当前文件实际行号整体偏移约 +7（CSS 数组 L86-146、startDrag L1295+、标题栏 L1379+）。全部按特征串定位修改，无结构重排。

## 一、P1 按钮点不动（指针捕获吃掉 click）

| # | 位置（现行号） | 改动 |
|---|---|---|
| 1 | L1295 前 | 新增 `isInteractive` 辅助函数：`closest('button,input,select,textarea,a,[role="button"]')` 判定，含 `typeof el.closest === 'function'` 防御（桩/老内核无 closest 不炸） |
| 2 | `startDrag` L1297 | `if (e.button !== 0) return;` 之后新增 `if (isInteractive(e.target)) return;`，其余原逻辑未动 |
| 3 | 折叠按钮 L1384-1385 | `onPointerDown: (e) => e.stopPropagation(),`（无 preventDefault） |
| 4 | 最小化按钮 L1392 | 同上 |

## 二、P1 布局（顶满/裁切/卡片过窄）——逐条对表

| 任务包条目 | 现行号 | 改动 | 状态 |
|---|---|---|---|
| `.zcd-root` 宽度 | L87 | `width:min(var(--zcd-w,440px),calc(100vw - 32px))` | ✅ |
| `.zcd-panel` 高度 | L89 | `max-height:min(72vh,560px)` | ✅ |
| `.zcd-body` | L96 | 追加 `min-height:0;overscroll-behavior:contain;` | ✅ |
| `.zcd-note` | L131 | 追加 `white-space:normal;overflow-wrap:anywhere;` | ✅ |
| `.zcd-planline` | L140 | 追加 `white-space:normal;overflow-wrap:anywhere;line-height:1.45;` | ✅ |
| `.zcd-cards` | L135 | `display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px;` | ✅ |
| `.zcd-job-head` | L113 | 追加 `flex-wrap:wrap;` | ✅ |
| `.zcd-sec` | L97 | 追加 `min-width:0;` | ✅ |
| `.zcd-kv` | L138 | 追加 `min-width:0;` | ✅ |
| 可选 `WIDTH.def` 400→440 | L48 | `const WIDTH = { min: 320, max: 600, def: 440 };`（`clampWidth` 自动生效） | ✅ 已做 |

注：`.zcd-card` 原有 `flex:1;min-width:0;` 在 grid 容器下 `flex:1` 失效但无害，按「不做无关重构」保留。

## 三、复现命令 + 原始输出

### 1. `node --check client.js`

```
$ node --check "F:\My Code\dsh-plugins\zcode-dispatch\client.js" && echo "SYNTAX-OK"
SYNTAX-OK
```

### 2. DSH 验收探针（18/18）

```
$ Z2_ALLOW_PROFILE_WRITE=1 node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,"inject":["@deepseek-ai/dsh-client-ui-conversation"]}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config          demo: false |         maxConcurrent: 1 |         runnerPath: '<HOST_REPO>\scripts\collab\zcode-run.mjs' |         led
PASS  纪律: 不 import DSH 客户端包  no @deepseek-ai/dsh-client
PASS  纪律: 不操作 document.body  no document.body
PASS  纪律: client.js 无字面色值（仅主题令牌）  none
PASS  纪律: client.js 不用 JSX/模块 import  createElement 次数=2
PASS  纪律: 使用 --dsw-alias-* 主题令牌  令牌引用 41 处，去重 22 个
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  index.js 引用 core dispatcher  imports core
PASS  client.js 通过 __ModuleLoader__.load 注册  id=@local/zcode-dispatch
PASS  factory 只 require react  react only
PASS  factory 返回 {inject, apply}  inject=["slots","remote","remote.zcodeDispatch"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=div
PASS  越界: $DSH_HOME profile 近 1h 无写入  .plugin-manager,node_modules,package.json,pnpm-lock.yaml
   （已按 Z2_ALLOW_PROFILE_WRITE=1 放行：用户已安装插件，profile 写入属预期）

[DSH Z2 探针] 18 项，失败 0 项
```

### 3. 回归测试（不回归）

```
$ node test/core.test.mjs
ℹ tests 11
ℹ pass 11
ℹ fail 0

$ node test/channel-retry.test.mjs
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

### 4. 新增冒烟（`test/z9-smoke.test.mjs`，跑完已删）

25/25 全部通过，关键断言原始输出：

```
PASS  浅渲染不抛错  节点数=210
PASS  标题栏有 2 个 zcd-iconbtn  found=2
PASS  CSS 含 max-height:min(72vh（面板不顶满整屏）
PASS  CSS 含 min-height:0（flex 列可收缩，不再裁切）
PASS  CSS 含 overscroll-behavior（滚动不外溢）
PASS  CSS 含 repeat(auto-fit,minmax(（卡片自适应列）
PASS  CSS 含 overflow-wrap（长句可断行）
PASS  .zcd-root 含窄屏收缩宽度 min(...,calc(100vw - 32px))
PASS  .zcd-sec 含 min-width:0
PASS  .zcd-kv 含 min-width:0
PASS  .zcd-note 含 white-space:normal
PASS  .zcd-planline 含 overflow-wrap:anywhere
PASS  守卫生效：target=button 时无 setPointerCapture/addEventListener  calls=(none)
PASS  守卫不误伤：target=空白处时拖动照常启动  calls=capture,listen,listen,listen
PASS  非左键仍不启动拖动（原行为保持）
PASS  iconbtn#0（折叠 / 展开）onPointerDown 调 stopPropagation 不抛错
PASS  iconbtn#1（最小化为胶囊）onPointerDown 调 stopPropagation 不抛错
[Z9 冒烟] 全部通过
```

冒烟方法说明：沿用 z2-verify.mjs 的最小 React 桩（桩在 factory 之前装好、函数组件递归求值），把桩中 FloatingPanel 唯一的 `rootRef` 槽 `current` 换成带记录器的假 DOM 节点，使 `startDrag` 走完整路径——`setPointerCapture`/`addEventListener` 是否被调用可运行时观察。测试文件已按纪律删除，test/ 目录恢复原状。

## 四、Review / 优化 / Simplify 结论

- **Review**：10 处改动全部落在任务包指定特征串上，无结构重排；`startDrag` 除新增守卫行外逐行未动；两个按钮仅加 `onPointerDown`，`onClick`/`aria-*` 原样。
- **强制性优化**：性能（grid 自适应列替代 flex 三等分，窄屏不再挤断）；安全（无新增输入面，`isInteractive` 有类型防御不引入注入面）；健壮性（`closest` 缺失时守卫放行不挡拖动、`overscroll-behavior:contain` 防滚动链、`min(...)` 双上限防溢出）。
- **Simplify**：`isInteractive` 单行辅助 + 两处一行守卫，无新状态、无新分支树；未引入任何新依赖或新令牌。

## 五、未确定项

1. **真实浏览器点击行为本环境无法验证**：桩环境无真实 DOM/事件派发，`closest` 守卫与 `stopPropagation` 的组合已用桩断言验证，但**需用户重载插件后在页面上点一次折叠/最小化按钮确认**（这是唯一需要人工验收的点）。
2. `min-height:min(72vh,560px)` 的 560px 上限是任务包给定值，若用户屏幕下半屏高度偏好更大面板，需 DSH 侧确认是否调整。
3. `WIDTH.def=440` 后，已保存过旧宽度（localStorage `zcd.size`）的用户不受影响（沿用各自保存值）；仅新用户/未保存者拿 440。
4. `.zcd-cards` 改 grid 后 `minmax(112px,1fr)` 在极窄（<~250px 内容宽）时可能降为单列纵向排布——属 auto-fit 预期行为，非缺陷。
