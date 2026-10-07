# ZB-31 交付：思考强度「漏档」根因调查与修复

## 用户问题（原文）

> 检查下。为什么"deepseek-flash"没有思考强度，低，高，最高的选项。GLM5.3系也没有，是派发台走CLI不支持，还是漏了。
> Zcode里面，GLM5.3和5.3 Flash都是低、高、最高三档，"deepseek-flash"是关闭、低、高、最高。根据这个调查下。

## 结论（一句话）

**不是 CLI 不支持，是派发台的探测器漏了两处** —— 两处都在我们自己的代码里，ZCode 侧的声明一直是对的：

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| ① | 匹配式与 ZCode 不一致：我们 `new RegExp(match).test(id)`（**无锚点、无 i**），ZCode 是 `new RegExp('^(?:'+match+')$','i')`（**锚定 + 忽略大小写**） | `collab-kit/zcode-run.mjs` `reasoningLevelsFor` | GLM-5.3 系只剩 `disabled,enabled`（用户看到的现场） |
| ② | 枚举面漏了个人通道：`--list-providers` 只遍历桌面端 `config.json` 的 `provider[*].models`，而 `deepseek-flash` 只出现在个人通道 `provider_config.json` 的 `personalModelIds` | `collab-kit/zcode-run.mjs` `listProviders` + `core/dispatch-core.mjs` `listChannels` | personal 通道**一条 `reasoning-levels` 行都没有** ⇒ 面板无档位选项 |

用户所述的真值（低/高/最高；关闭/低/高/最高）与 ZCode 内置声明**完全一致** —— 修好后派发台给出的正是这三档/四档。

## 根因 ①：匹配式（`i` 标志缺失 + 未锚定）

ZCode 侧证据（`F:\Program Files\ZCode\resources\glm\zcode.cjs`）：

```js
// 匹配函数本体
function vWt(e,t,n=!1){return new RegExp(`^(?:${e})$`,n?"i":void 0).test(t)}

// ModelConfigRules.resolve() 的 overlay 主循环（调用点传 n=!0 ⇒ 忽略大小写）
vWt(s.modelMatch, t.modelId, !0) && (… n = n.overlay(s.config))
```

内置声明（`resources\config\provider\zcode-builtin.json` 的 `modelConfigRules.modelRules`，**顺序即优先级，后者覆盖前者**）：

```
[ 1] .*glm-5(?:[.\-:/\[].*)?                     -> ["disabled","enabled"]
[ 5] .*glm-5\.3(?:-flash)?(?:[.\-:/\[].*)?       -> ["low","high","max"]     ← 真正该生效的
```

- **ZCode 行为**：忽略大小写 ⇒ 两条都命中 `GLM-5.3` ⇒ 第 5 条（`.3`）覆盖 ⇒ **`low,high,max`** ✅
- **派发台旧行为**：大小写敏感 ⇒ 小写的 `glm-5.3` 那条**永不命中** `GLM-5.3` ⇒ 只剩第 1 条 ⇒ **`disabled,enabled`** ❌

实测对照（同一份内置配置）：

| 模型 | 旧匹配式（无 i） | 加 i | ZCode 真式 |
|---|---|---|---|
| GLM-5.3 | `disabled,enabled` ❌ | `low,high,max` | `low,high,max` |
| GLM-5.3-Flash | `disabled,enabled` ❌ | `low,high,max` | `low,high,max` |
| GLM-5.2 | `disabled,high,max` | 同 | 同 |
| deepseek-flash | `disabled,low,high,max` | 同 | 同 |

> 注：deepseek 系之所以"看起来对"，是因为它的规则恰好是小写、且没有更早的宽规则抢覆盖 —— 但它在**枚举面**上栽了（根因 ②）。

## 根因 ②：枚举面（个人通道模型不在 `config.json` 里）

`--list-providers` 的模型集合原本只有：

```js
for (const p of Object.values(appProviders))          // appCfg = ~/.zcode/v2/config.json
  for (const m of Object.keys(p?.models ?? {})) allModels.add(m);
```

而实测两份配置的分工是：

| 文件 | 内容 |
|---|---|
| `~/.zcode/v2/config.json` 的 `provider[*].models` | `GLM-5.3, GLM-5.3-Flash, deepseek-v4-flash-vision-exp, deepseek-v4.1-flash-expires-on-0910` —— **没有 `deepseek-flash`** |
| `~/.zcode/v2/provider_config.json` 的 `personalModelIds` | `["deepseek-flash"]` ← 它只在这里 |

于是 `deepseek-flash` 一条 `reasoning-levels` 行都没有；core 的 `levelsOf()` 对 personal 通道返回 `null`，且 personal 通道连 `thinkingLevels` 字段都没有 ⇒ 面板退回通用提示。

## 改动清单

| 文件 | 改动 |
|---|---|
| `collab-kit/zcode-run.mjs` | ① 新增 `zcodeModelMatch(matchRe, modelId)` —— 与 ZCode 的 `vWt(...,!0)` **逐字同式**（`^(?:match)$` + `i`），坏正则跳过；② `reasoningLevelsFor` 改用它（旧的内联 `new RegExp(re).test()` 已删除）；③ 新增 `personalModelIds()` 读个人通道配置（尊重 `--personal-config`）；④ `--list-providers` 的模型集合补上个人通道模型；⑤ `personalPath` 声明**上移**到 `listProviders` 之前（否则 `--list-providers` 读它触发 TDZ —— 修复过程中实测踩到，已修）；⑥ 文件头补 ZB-31 两处根因的完整说明 |
| `core/dispatch-core.mjs` | `listChannels()` 的 personal 通道接上同一份探测表（`thinkingLevels: levelsOf(personal.models)`）；原先该通道根本没有这个字段 |
| `client.js` | **连带防护**：失效档位（存值不在当前 levels 里，如修复前存下的 GLM-5.3 `disabled`）显式列为 option 并标注「已失效」—— 否则 `<select value="X">` 找不到匹配项时浏览器**静默显示首项「Agent决定」**，与真实存值不符且派发会被 runner 拒绝。通道分区与降级目标分区都加了；新增 `thinkingStale` / `thinkingStaleHint` 两键 |
| `locale/zh.json`、`locale/en.json` | 补 `thinkingStale` / `thinkingStaleHint` |
| `index.js` | 工具说明与参数注释里的档位示例同步为实测值（GLM-5.3 系 `low\|high\|max`；deepseek 系四档；`agent` 解析目标 GLM-5.3 系 ⇒ `max`）；判断准则的"低档/高档"示例改为 `low`/`high`/`max`（旧的 `disabled`/`enabled` 对 GLM-5.3 已非法） |
| `README.md` | 「思考强度」一节补两条**必须遵守的探测纪律**（匹配式与 ZCode 逐字同式 + 枚举面含个人通道）；档位实测值与 `agent` 解析目标更新；新增「失效档位显式可见」；测试表补新文件 |
| `test/thinking-levels-coverage.test.mjs` | **新增** 6 项（见下） |
| `test/thinking-level.test.mjs` | personal 通道断言由「字段必须缺席」改为「`== null` 且不是数组」（语义等价：无探测数据不猜） |

## 验收证据

### 现场值（真实配置，面板将看到的下拉内容）

```
plan                               ["low","high","max"]
personal                           ["disabled","low","high","max"]
builtin:bigmodel                   ["low","high","max"]
builtin:bigmodel-coding-plan       ["low","high","max"]
7438da80-…（deepseek 个人直连）     ["disabled","low","high","max"]
```

与用户所述 ZCode 内一致：**GLM-5.3 / 5.3-Flash = 低、高、最高**；**deepseek-flash = 关闭、低、高、最高**。

### runner 探测输出（修复后）

```
[zcode-run] reasoning-levels GLM-5.3=low,high,max
[zcode-run] reasoning-levels GLM-5.3-Flash=low,high,max
[zcode-run] reasoning-levels deepseek-flash=disabled,low,high,max
[zcode-run] reasoning-levels deepseek-v4-flash-vision-exp=disabled,low,high,max
[zcode-run] reasoning-levels deepseek-v4.1-flash-expires-on-0910=disabled,low,high,max
```

（修复前：GLM-5.3 系 = `disabled,enabled`，且**完全没有 deepseek-flash 行**。）

### 真派发（端到端）

```
GLM-5.3-Flash + high   => paused（档位被接受，注入确认 applied=high target=…/GLM-5.3-Flash）
deepseek-flash + high  => done   applied=high  target=7438da80-…/deepseek-flash
deepseek-flash + disabled => done  applied=disabled
```

修复前 `GLM-5.3 + high` 会被 fail-fast 拒绝（`high 不在模型 GLM-5.3 声明的取值里（disabled|enabled）`）；
修复后报错信息也修正为 `（low|high|max）`。

### 新增测试 6 项（`test/thinking-levels-coverage.test.mjs`）

```
✔ A. ★ --list-providers 覆盖个人通道模型（deepseek-flash 原先一条档位行都没有）
✔ B. ★ 匹配式与 ZCode 逐字同式（^(?:match)$ + i）；大小写不同也命中
✔ C. ★ core listChannels：plan 别名与 personal 通道都带上同一份探测表的 thinkingLevels
✔ D. ★ 真实内置配置：GLM-5.3/Flash = low,high,max；deepseek-flash = disabled,low,high,max
✔ F. ★ 面板：失效档位显式列为 option（否则 <select> 会静默显示「Agent决定」）
✔ E. 非法档位 fail-fast 报错列出修正后的可用档位（low|high|max）
```

D 段同时断言**旧匹配式的错误答案**（`disabled,enabled`）与正确答案不同 —— 证明该修不是形式主义。

### 全量门禁

```
失败文件=0 断言通过=443 文件数=27
[DSH Z2 探针] 21 项，失败 0 项
node --check 全绿（7 个文件）
```

## 生效方式

- `collab-kit/zcode-run.mjs`：**下次派发/探测即生效**（runner 每次 spawn 新进程，无需重启）。
- `core/dispatch-core.mjs`（listChannels）：**需完整重启 DSH**（宿主半边）。
- `client.js` + locale：**刷新页面**即生效。

> ⚠️ 由于 core 改动，**请重启 DSH** 后再刷新页面，才能看到 personal 通道的四档。

## 附带发现（已修，但值得记一笔）

修复探测后，**修复前存下的档位可能变成非法值**。实测：把 `GLM-5.3-Flash` 的通道默认档位存成 `disabled`（旧探测误判合法），修复后派发会被 runner fail-fast 拒绝（exit 1）。
更隐蔽的是**显示层**：`<select value="disabled">` 在 option 列表里找不到匹配项时，浏览器会显示首项「Agent决定」，用户看到的是"没问题"，实际存值却是会被拒绝的失效档位。
已加显式「已失效」option + tooltip 说明（通道分区与降级目标分区都加了），并有测试 F 段钉住。

## 未确定项

1. **只读了 `modelRules` 一张表**：ZCode 的 `ModelConfigRules.resolve()` 实际按
   `modelRules → modelApiRules → providerSiteRules → templateModelRules → builtinProviderModelRules`
   顺序 overlay，且后两张表带 `apiTypeMatch` / `baseUrlMatch` 过滤条件。本次调查用**全部 5 张表 + 真实 apiType/baseUrl** 复核过结论一致（GLM-5.3 系 `low,high,max`、deepseek-flash 四档），
   故探测仍只读 `modelRules`（无 apiType/baseUrl 上下文时无法正确求值后两张表；多读反而可能**错覆盖**）。
   若将来出现"某 provider-site 规则给出更窄取值"的模型，需带 apiType/baseUrl 求值 —— 属独立一轮。
2. **`--list-providers` 不打印 apiType/baseUrl**：面板只按通道取档位并集，同通道多模型档位不同时
   并集可能含某模型不支持的档位（与 ZB-30 一致的既有行为），最终由 runner fail-fast 校验。
3. **`none` / `medium` / `xhigh` 等档位没有中文标签**：`THINKING_LABEL_KEY` 只映射
   `disabled/enabled/low/high/max`；未知档位按 ZB-29e 既定纪律**原样显示**（不隐藏、不猜语义）。
   本轮出现的模型（GLM-5.3 系 / deepseek 系）都不涉及这些档位，故未扩表。