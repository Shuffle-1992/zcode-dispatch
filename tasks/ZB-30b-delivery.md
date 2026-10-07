# ZB-30b 交付：降级目标的下拉与「通道」分区完全一致（去掉「沿用原任务」）

## 用户要求（原文）

> 不要沿用原任务。就跟上面完全一致的选项逻辑即可。

（配图为 ZB-30 的降级目标三下拉：通道 = BigModel - Coding Plan、模型 = GLM-5.3-Flash、
思考强度 = **（沿用原任务思考强度）** ← 红箭头指的就是这一项。）

## 一句话结论

降级目标的 `模型` / `思考强度` 两个下拉改为与上面「通道」分区**逐字相同**的选项集与默认值：
模型首项 `（通道默认模型）`（值 `''`）、思考强度首项 `Agent决定（按任务判断）`（值 `'agent'`），
档位并集、中文标签、禁用判据也全部对齐。「沿用原任务…」两个文案键**彻底删除**。

## 改动清单

| 文件 | 改动 |
|---|---|
| `client.js` | ① `fbThinking` 默认值 `''` → `'agent'`（与上面 `channel.reasoningLevel ?? 'agent'` 同式）；② 模型首项 `t('fallbackKeepModel')` → `t('chanDefaultModel')`（同一个文案键）；③ 档位首项 `t('fallbackKeepThinking')` → `t('thinkingAgent')`（同一个文案键，值 `'agent'`）；④ 两个下拉的 `disabled` 判据对齐上面（模型跟 `fbSel.enabled`、档位再加 `channels.length===0`）；⑤ `saveTarget` 的 base 由存值改为**下拉显示值**（`fbThinking \|\| 'agent'`），保证「显示什么就写什么」；⑥ 开启开关 / 换通道时的默认值改为 `channel.reasoningLevel ?? 'agent'` / `'agent'`；⑦ 徽标在 `agent` 时显示「Agent决定」短标签（与上面 `chanNewTask` 提示行同一写法）；⑧ `fallbackHint` 重写（说明与上面一致）；⑨ 删 `fallbackKeepModel`/`fallbackKeepThinking` 两键 |
| `locale/zh.json`、`locale/en.json` | 删 `fallbackKeepModel` / `fallbackKeepThinking`；`fallbackHint` 改写为「选项逻辑与上面「通道」完全一致…」 |
| `README.md` | 「自动降级」一节改写：明确「三个下拉与上面「通道」分区完全一致的选项逻辑」；`null`（沿用原任务）标注为 **core/CLI 兼容语义，面板不再产生** |
| `index.js` | `action=fallback` 说明行补齐三种取值的语义（`""`⇒provider 默认模型 / `agent`⇒按 ZCode 默认规则 / `null`⇒沿用原任务） |
| `test/fallback-target.test.mjs` | D 段改为断言「与上面同一个文案键」+「沿用原任务键已删除」+「禁用判据一致」；E 段改为断言两个旧键在 locale 中**不存在** |
| `test/fallback-ui.test.mjs` | ③ 段改为断言两侧选项集**逐项相等**；新增 ⑥ 段（写值 = 显示值） |

## 关键设计点

1. **「完全一致」是可验证的字面相等**：真渲染测试里让**上下两个分区选中同一个通道**
   （`personal/deepseek-flash`），然后断言两侧三个下拉的 option 列表 **JSON 逐字相等**：

   ```
   ["默认套餐","个人 API","（通道默认模型）","deepseek-flash",
    "Agent决定（按任务判断）","关闭思考","低强度","高强度","最高强度"]
   ```

   两侧完全一样 ⇒ 「选项逻辑一致」不是形容词，而是可执行的断言。

2. **`''` / `'agent'` 的实际语义**（与上面完全对齐）：
   - `model=''` ⇒ 面板写 `null` ⇒ 交接重跑**不传 `--model`** ⇒ 用该 provider 的默认模型。
   - `reasoningLevel='agent'` ⇒ runner 按 ZCode 自身默认规则解析（模型声明档位的**最后一档**），
     与上面「Agent决定」在未显式指定档位时走**同一条规则**（仅新建会话生效）。

3. **`null`（沿用原任务）保留在 core/CLI 侧，但面板不再产生**：`core.normFallbackTargets` 仍把
   `null` 归一为 `null`（旧调用方/`zcd fallback set a,b,c` 的兼容语义），`retry` 对 `null`
   沿用原任务。面板侧一次编辑即按显示值归一 —— 避免「下拉显示 Agent决定、实际存 null」两回事。
   ⑥ 段两条源码不变量专门钉这一点。

4. **换通道时档位回到 `'agent'`**：与上面切 provider 的语义对齐（上面切通道会落到该通道首个模型，
   这里保守地跟随「通道默认模型」+「Agent决定」，因为降级目标本就允许用 provider 默认值）。

## 验收证据

### 全量测试：26 个文件 / 437 项断言 / 0 失败

```
失败文件=0 断言通过=437 文件数=26
```

### 新增/改写的断言

`test/fallback-ui.test.mjs`（25 项，真渲染）：

```
✓ ★ 模型/档位首项与上面「通道」分区**逐字一致**（通道默认模型 / Agent决定）
✓ ★ 降级档位下拉首项 = Agent决定（与上面「通道」分区同一套选项逻辑）
✓ ★ 降级目标下拉里不再出现「沿用原任务…」（用户明确要求去掉）
✓ ★ 降级三下拉的选项与「通道」三下拉逐字相同（实际 [9 项，见上]）
✓ ⑥ 改模型触发一次写入
✓ ⑥ 模型选「（通道默认模型）」⇒ 写 null（交接时不传 --model）
✓ ★ 只改模型时档位按**下拉显示值**写回（实际 "high"）
✓ ★ saveTarget 的 base 不读存值（否则「显示 Agent决定、实存 null」两回事）
✓ ★ saveTarget 的 base 用下拉显示值，未设时落 agent
===== ZB-30 UI 渲染：25 PASS / 0 FAIL =====
```

`test/fallback-target.test.mjs`（6 项）：D 段「同一个文案键 `chanDefaultModel` / `thinkingAgent`」+
「`fallbackKeep*` 键已删除」+「禁用判据一致」；E 段「locale 中两个旧键不存在」。

### DSH 独立探针

```
[DSH Z2 探针] 21 项，失败 0 项
```

### 语法门禁

`node --check` 全绿（`index.js` / `client.js` / `wire.host.mjs` / `wire.client.mjs` /
`core/dispatch-core.mjs` / `bin/zcd.mjs`）。

## 生效方式

只改了 `client.js` + locale + 文档 + 测试 —— **刷新页面即生效**（无需重启 DSH）。

## 未确定项

1. **core/CLI 侧的 `null`（沿用原任务）未删除**：它是 ZB-30 已交付且被 `retry` 使用的兼容语义
   （`zcd fallback set a,b,c` 只给通道 id 时，模型/档位自然应沿用原任务）。面板不产生它，
   故用户可见行为已完全一致。若将来要彻底删掉该语义，需同时改 `retry` 的 `targetReasoning`
   回退逻辑与 `normFallbackTargets`，属独立一轮。
2. **档位并集仍按通道**（`channels[].thinkingLevels`），与上面完全同源 —— 同通道多模型档位不同时
   并集可能含某模型不支持的档位，最终由 runner 按 builtin 声明 fail-fast 校验。