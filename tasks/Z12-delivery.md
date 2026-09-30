---
round: Z12
seq: "01"
from: zcode
to: dsh
type: delivery
status: done
created: 2026-09-30T15:40:00+08:00
---

# Z12-01 交付：插件侧接入「ZCode 派发总开关」+ 让其他会话可查可控

> 任务包：`tasks/Z12-01-task.md`。改动只落在 `F:\My Code\dsh-plugins\zcode-dispatch\**`（+ pitfall 登记），
> 未动 宿主仓库任何文件，未安装、未写 `$DSH_HOME`、未 npm 依赖、**未做任何 git 操作**（任务包硬约束）。

## 一、改动清单（逐条对着任务包「四件」）

### 1. 宿主读取开关（带缓存）✅

| 文件 | 改动 |
|---|---|
| `wire.host.mjs` | 新增**全包唯一**读写实现并导出：`readSwitch(path)`（`existsSync→statSync(mtime)→缓存命中即不读盘`；缺失→`{enabled:true, source:'default(无文件=开启)'}`；损坏→`source:'default(读取失败)'`，**永不抛**）、`writeSwitch(enabled,{by,note},path)`（`mkdir→tmp-${pid}→writeFileSync→renameSync` 原子写，键序/2 空格缩进/尾 `\n`/contract 行与 CLI `zcode-switch.mjs` 的 `writeDispatchSwitch` 逐字段一致；写后主动失效缓存）。另导出 `DEFAULT_SWITCH_PATH` / `SWITCH_CONTRACT` / `SWITCH_OFF_ERROR` / `switchFileOf(config)` |
| `index.js` | config 新增第 6 个字段 **`switchPath`**（string）：`DEFAULTS.switchPath = DEFAULT_SWITCH_PATH`；schemastery 主 schema 与 `fallbackConfig()` 手写 Standard Schema 都补该字段（非串归一为空串→回退默认值）；**既有 5 个字段原样保留** |
| `cordis.patch.yml` | config 显式写 `switchPath: '<HOST_REPO>\collab\zcode-dispatch.switch.json'` |

### 2. dispatch 动作强制校验 + 暴露状态 + `switch` 动作 ✅

`wire.host.mjs` 的 `createActionHandler`（单实现点，agent 工具与 Remote face 共用）：

- `dispatch` 分支**入口第一行**读开关：关闭 → `{ ok:false, error:'ZCode 派发总开关已关闭（collab/zcode-dispatch.switch.json）', switch }`，**不创建 job、不 spawn**（runner 侧 `zcode-run.mjs` 是第二道）。
- `retry` 分支同样加门禁（见「未确定项 §3」：retry 也会 spawn runner，不锁则必产 exit-3 死 job）。
- 新增 `status` 动作：`{ok:true, switch:{enabled,updatedAt,updatedBy,note,source}}`。
- 新增 `switch` 动作：`{action:'switch', enabled:true|false, by?, note?}` → `writeSwitch` 原子写 → `{ok:true, switch}`（写后即时回读）；`enabled` 非布尔 → `{ok:false, error, switch}`；写失败 → `{ok:false, error:'写开关文件失败：…'}`。**写文件代码全包仅 `writeSwitch` 一处**，UI 与工具共用。
- `createRemoteFace().snapshot()` 增加 `switch` 字段（同上结构），UI 徽标与禁用判据直接读它（mtime 缓存，1s 轮询无读盘压力）。
- face 新增方法 `switchGet()` / `switchSet(next)`，并同步进 `REMOTE_METHODS`、`FACE_METHOD_TABLE`、`TYPERT`（方法标记）。

### 3. 面板开关（UI）✅

`client.js`：

- 标题栏新增 `SwitchBadge`（位于标题与连接徽标之间）：带状态色点（`--dsw-alias-state-success-primary` 开 / `--dsw-alias-state-error-primary` 关，未知=灰）+ 文案「派发：开 / 关 / 未知」。
  - `conn==='live'` → 渲染为可点 button，点击 `wire.switchSet({enabled:!当前})`，成功后由 1s 轮询带回新快照自动翻转（失败走派发区错误反馈行）；点击经 `onPointerDown` stopPropagation，不会被标题栏拖拽吃掉（Z9 教训回扣）。
  - 非 live → 渲染为只读 span + tooltip `switchHintOffline`「未连接宿主：请在终端执行 zcode-switch.mjs 切换」；快照不带 switch 时如实显示「派发：未知」（浏览器读不到宿主文件，不谎报可控、不猜方向）。
- `wire.client` 各数据源补 `switchGet`/`switchSet`：live（远端信封归一化，与 `channelSet` 同形）、ext（`call()` 降级）、demo/offline（`{ok:false,error}` 拒绝——假数据不伪装开关、更不写真值）、DEAD_WIRE 兜底。
- 关闭态派发按钮禁用（`disabled: busy||active||swBlocked`）并在派发区显示原因 `switchOffBlocked`。
- 新 locale key（`STRINGS` zh/en 内嵌 + `locale/{zh,en}.json` 双份同源）：`switchOn` / `switchOff` / `switchUnknown`（任务包 4 键之外为「诚实空态」补的）/ `switchTitle` / `switchHintOffline` / `switchOffBlocked`。
- 主题令牌纪律不变（无字面色值，探针 0 命中）；新 CSS 仅 `.zcd-switch` 系（复用 `.zcd-conn` 形态 + hover/disabled 过渡）。

`wire.client.mjs`：`TYPERT_REMOTE.descriptors` 增加 `switchGet`/`switchSet`（与宿主 TYPERT 一一对应，`$mount` 校验必需）；`createClientWire` 三分支同形方法。

### 4. 其他会话怎么知道（工具面 + 文档）✅

`index.js`：

- 工具描述改为**注册时动态生成**（`buildToolDescription(switchFile)`），首行即任务包要求句式：
  `操作「ZCode 派发台」：把任务派发给 ZCode 子代理（当前：已开启）。action=status 查开关状态；action=switch 切换 enabled=true|false；action=dispatch 派发（关闭时会被拒绝）。…`（状态以 `action:status` 实时返回为准，描述里已注明）。
- `action` 枚举加入 `status`、`switch`，并补上 Z11 漏列的既有动作 `dismiss`；新增参数 `enabled`（boolean，必填语义）、`by`、`note` 的说明。
- `README.md`：新增「派发总开关（Z12）」一节（真值文件/CLI/三入口/插件侧唯一读写/UI 行为/未连接降级/工具动作/宿主半边需重启），并同步 config 表（`switchPath` 行）与 agent 工具 action 清单。

### 附带（纪律性修复，非任务包明列）

- `test/z2-verify.mjs` 的 e2e cfg 显式 `switchPath` 指向临时文件——门禁落地后该探针的 dispatch 原本会隐式依赖真值文件为开（Z5-1 教训变体），恢复密封。
- `pitfalls.md` 登记 2 条（URL pathname 不解码 `%20`；加门禁给探针引入运行期真值依赖）。

## 二、复现命令 + 原始输出

### 1. `node --check` 四件

```
$ cd zcode-dispatch && node --check index.js && node --check client.js && node --check wire.host.mjs && node --check wire.client.mjs && echo ALL_OK
ALL_OK
```

### 2. `Z2_ALLOW_PROFILE_WRITE=1 node tools/verify-plugin.mjs` → 20/20

```
PASS  manifest: name/exports/dsh.bundle.patch  @local/zcode-dispatch
PASS  manifest: dsh.client 平台/立即加载  {"platform":"web","immediately":true,"inject":["@deepseek-ai/dsh-client-ui-conversation"]}
PASS  manifest: meta 标题/描述/图标  ZCode 派发台
PASS  patch: 插入行 id/name/config          demo: false | maxConcurrent: 1 | runnerPath: '…zcode-run.mjs' | led…
PASS  纪律: 不 import DSH 客户端包  no @deepseek-ai/dsh-client
PASS  纪律: 不操作 document.body  no document.body
PASS  纪律: client.js 无字面色值（仅主题令牌）  none
PASS  纪律: client.js 不用 JSX/模块 import  createElement 次数=2
PASS  纪律: 使用 --dsw-alias-* 主题令牌  令牌引用 41 处，去重 22 个
PASS  index.js 导出 apply  apply found
PASS  index.js 声明 Config（可配置）  Config found
PASS  Config 是 Standard Schema（cordis 激活判据）  {"demo":false,"maxConcurrent":1,"runnerPath":"","ledgerPath":"","workRoot":"","switchPath":"<HOST_REPO>\\collab\\zcode-dispatch.switch.json"}
PASS  index.js 引用 core dispatcher  imports core
PASS  client.js 通过 __ModuleLoader__.load 注册  id=@local/zcode-dispatch
PASS  factory 只 require react  react only
PASS  factory 返回 {inject, apply}  inject=["slots","remote"]
PASS  boot 安全: inject 不自声明 remote 命名空间  inject=["slots","remote"]
PASS  apply 注入槽位并注册组件  slot=shell.overlay 注册数=1
PASS  组件函数可执行（浅渲染不抛错）  根节点 type=class PanelBoundary …
PASS  越界: $DSH_HOME profile 近 1h 无写入  （Z2_ALLOW_PROFILE_WRITE=1 放行：用户已安装插件，属预期）
[DSH Z2 探针] 20 项，失败 0 项
```

### 3. 既有测试不回归

```
$ node test/core.test.mjs          → tests 11, pass 11, fail 0  (exit 0)
$ node test/channel-retry.test.mjs → tests 8,  pass 8,  fail 0  (exit 0)
$ node test/quota-rpc.test.mjs     → exit 0（附带跑，未回归）
```

### 4. 新增本地冒烟（任务包 §四.4；脚本 `test/z12-switch.smoke.mjs` **已按规跑完即删**）

用 `%TEMP%` 临时开关文件；CLI 格式对照是直接 `import` 宿主仓库 `zcode-switch.mjs` 模块（只读复用其 `writeDispatchSwitch`，有 argv 守卫不会触发其 main，也不触碰真值文件）：

```
PASS  缺失文件 → enabled:true  {"enabled":true,…,"source":"default(无文件=开启)"}
PASS  CLI 写关后读到 enabled:false  {"enabled":false,…,"source":"file"}
PASS  关闭态 dispatch → ok:false + 总开关文案 + 带 switch  {"ok":false,"error":"ZCode 派发总开关已关闭（collab/zcode-dispatch.switch.json）","switch":{…enabled:false…}}
PASS  关闭态 dispatch 未创建 job  jobs=0
PASS  关闭态 retry → 同样被拒（门禁先于 job 查找）
PASS  switch 动作 → ok:true + switch.enabled=true
PASS  写出的键名/顺序与 CLI 一致  enabled,updatedAt,updatedBy,note,contract
PASS  缩进/尾换行与 CLI 一致（2 空格 + 末尾 \n）
PASS  与 CLI 参照文件键序完全一致
PASS  contract 行与 CLI 常量一致  collab/PROTOCOL.md §ZCode 派发总开关；false = 任何会话都不得把任务派发给 ZCode
PASS  开启态 dispatch → ok:true 且入队  {"ok":true,"job":{"id":"j-munrp8dw-0-e65b",…,"state":"running",…}}
PASS  fake runner 跑完落 done  state=done
PASS  face.snapshot().switch 与文件一致
PASS  face.switchGet() 与文件一致
PASS  switch 关 → 文件/switchGet/snapshot 三面一致
PASS  同 mtime 命中缓存（同一对象）
PASS  外部写后 mtime 变化 → 读到新值
PASS  损坏 → enabled:true + source=default(读取失败)
PASS  再次缺失 → enabled:true + source=default(无文件=开启)
PASS  wire.client switchGet 缺席远端 → {ok:false} 不抛
PASS  wire.client switchSet 缺席远端 → {ok:false} 不抛
[Z12 冒烟] 全部通过（21/21）
```

冒烟后核验真值文件原样未动：`enabled:true / updatedBy:dsh-selftest / note:自检结束`（与本单开工前一致）。

## 三、必写的一句

**面板开关的真实点击需用户刷新页面确认**：本单的 UI 验证是探针浅渲染 + 桩加载（启动路径安全），真机浏览器里徽标渲染、点击翻转、关闭态禁用三件事，待用户刷新页面（或按 README 重启 DSH 后）目验；宿主半边（`wire.host.mjs`/`index.js`）改动需完全退出 DSH 再启动才生效（pitfalls 既有结论），仅刷页面只能生效客户端半边。

## 四、未确定项 / 边界声明

1. **面板真实点击待人工目验**（见上节）。自动验证覆盖到 wire/动作/格式层为止。
2. **`status`/`switch` 动作要求 dispatcher 已初始化**：`createActionHandler` 的「dispatcher 未初始化」早退在所有动作之前——`runnerPath`/`workRoot` 缺失的部署里，工具查/切开关会拿到该可读错误（总开关仍可经 CLI 操作）。若要求「无 dispatcher 也能查/切」，需把这两个 case 提到早退之前（一行级改动，本轮未做，遵守任务包最小面）。
3. **`retry` 门禁是任务包语义（「拒绝任何派发」）的延伸**：retry 同样 spawn runner，不锁则关闭态会产出一个必被 runner exit-3 拒绝的死 job。如认为超范围，删 `retry` case 开头三行即可回退。
4. **工具描述里的状态是注册时快照**：重启 DSH / 重载插件后才更新措辞；运行中以 `action:status` 为准（任务包已知设计）。会话级工具描述缓存若存在，可能滞后到下次会话。
5. **`z2-verify.mjs` §7 是既有红**（Z11 已记录：React 桩无 `Component`——其实探针已补、该结论以 Z11 记录为准），本轮未动其结构，仅密封了 cfg；该脚本不在现行验收门禁内。
6. **git 未操作**（任务包硬约束「不 git」）。工作区现有本轮改动：`zcode-dispatch/{wire.host.mjs, wire.client.mjs, index.js, client.js, cordis.patch.yml, README.md, locale/zh.json, locale/en.json, test/z2-verify.mjs}` + `pitfalls.md` + 本文档；同工作区还有前序轮次未提交改动（`tools/bridge.mjs` 等），提交时注意区分。
