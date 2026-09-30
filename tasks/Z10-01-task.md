---
round: Z10
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T13:32:00+08:00
---

# Z10 任务包：修复插件**激活失败**（Config 必须是 Standard Schema）

> 用户重载后实测报错（截图原文）：
> ```
> 启用失败：dsh: warning: 1 entry did not activate zcode-dispatch (@local/zcode-dispatch):
> TypeError: Cannot read properties of undefined (reading 'validate') at resolveConfig
> (@deepseek-ai/cordis/lib/index.js:958:45) at Fiber._resolveConfig ...
> ```
> **这是真 bug，只差这一处，宿主半边就活了。**

## 一、根因（DSH 已定位到源码行，勿再猜）

cordis `lib/index.js:956-962`：
```js
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config["~standard"].validate(config);   // ← 要求 Standard Schema v1
  if ("then" in result) throw new TypeError("Async config validation is not supported");
  if (result.issues) throw new ValidationError(result.issues);
  else return result.value;
}
```
我们 `index.js:20` 导出的 `Config` 是**裸 JSON Schema（draft-07）**，没有 `~standard` → `undefined.validate(...)` → 报错。

官方写法（`refs/dsh-typert/plugin-manager/lib/index.js:1`）：`import z from "@deepseek-ai/schemastery"; Config = z.object({...})`。

## 二、DSH 已经替你验好的证据（可直接复用，别重做）

1. schemastery **随 dsh 出货**：`D:\DeepSeek\resources\app.asar` → `dsh/node_modules/@deepseek-ai/schemastery`（已提取到 `refs/dsh-typert/schemastery`）。
2. 它**实现了 Standard Schema**：`lib/index.mjs` 里有 `Object.defineProperty(Schema.prototype, "~standard", { get() {...} })`。
3. DSH 已建好本地解析（junction，`node_modules/` 已被 gitignore）：
   `F:\My Code\dsh-plugins\node_modules\@deepseek-ai\{schemastery,cosmokit}` → `refs/dsh-typert/*`
   → 于是**从插件目录裸 import 就能解析**（运行期 DSH 也会从安装目录解析同一包）。
4. DSH 端到端实测（`maxConcurrent` 等 5 字段）：
   ```
   Config["~standard"] 存在: true | validate 是函数: true
   validate({})              → {"value":{"demo":false,"maxConcurrent":1,"runnerPath":"","ledgerPath":"","workRoot":""}}
   validate({maxConcurrent:3}) → {"value":{...,"maxConcurrent":3,...}}
   类型错误                   → {"issues":[{"message":"$.demo expected boolean but got oops","path":["demo"]}]}
   ```

## 三、要做的（只改 `zcode-dispatch/index.js`，必要时 `README.md`/`pitfalls.md`）

把 `export const Config = {…JSON Schema…}` 换成 **Standard Schema**，**字段与默认值逐字保持**（`demo:false`、`maxConcurrent:1`、`runnerPath:''`、`ledgerPath:''`、`workRoot:''`），并做**双路径**：

```js
const DEFAULTS = { demo: false, maxConcurrent: 1, runnerPath: '', ledgerPath: '', workRoot: '' };

/** 无依赖降级：手写 Standard Schema（cordis 只认 Config['~standard'].validate） */
function fallbackConfig() {
  return {
    '~standard': {
      version: 1,
      vendor: 'zcode-dispatch',
      validate(raw) {
        const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
        cfg.demo = !!cfg.demo;
        cfg.maxConcurrent = Math.min(8, Math.max(1, Number(cfg.maxConcurrent) || 1));
        for (const k of ['runnerPath', 'ledgerPath', 'workRoot']) cfg[k] = typeof cfg[k] === 'string' ? cfg[k] : '';
        return { value: cfg };
      },
    },
  };
}

/** 首选官方形态；解析不到时降级，保证"激活永不因 schema 崩" */
let Config;
try {
  const { default: z } = await import('@deepseek-ai/schemastery');   // 顶层 await（cordis 用 import() 装载，支持）
  Config = z.object({
    demo: z.boolean().default(false).description('UI 演示模式：客户端用内置假数据渲染悬浮窗，不触达 dispatcher'),
    maxConcurrent: z.number().min(1).max(8).default(1).description('同时运行的 run 上限'),
    runnerPath: z.string().default('').description('runner 脚本绝对路径；留空则不创建 dispatcher'),
    ledgerPath: z.string().default('').description('台账 zcode-run.jsonl 绝对路径；留空则跳过台账回读'),
    workRoot: z.string().default('').description('派发器工作根目录；留空则不创建 dispatcher'),
  });
} catch {
  Config = fallbackConfig();
}
export { Config };
```
（`.min/.max` 在 schemastery 上可用——官方源码里就有 `Schema.number().step(1).min(0)`；若某方法名实测不存在，就退到只用 `.default()`，并在交付文档写明。）

**其余一律不动**：`apply(ctx, config)`、工具注册、`wire.host.mjs`、`core/*`、客户端文件。

## 四、自检（贴原始输出，缺一不可）

1. `node --check index.js`
2. **主路径**：从 `F:\My Code\dsh-plugins`（或 `zcode-dispatch`）跑一个临时脚本 `import { Config } from './zcode-dispatch/index.js'`：
   - `typeof Config['~standard'].validate === 'function'` → true；
   - `Config['~standard'].validate({})` → value 含 5 个默认值；
   - `Config['~standard'].validate({maxConcurrent:3,demo:true,...})` → 值保留。
3. **降级路径**：临时把 `F:\My Code\dsh-plugins\node_modules\@deepseek-ai\schemastery` 改名（或复制 index.js 到无解析的临时目录导入）→ 仍能拿到 `Config['~standard'].validate` 且返回同样默认值；**测完把 junction 复原**（`New-Item -ItemType Junction`）。
4. `Z2_ALLOW_PROFILE_WRITE=1 node "C:\Users\Administrator\AppData\Local\Temp\z2-verify-dsh.mjs"` → **18/18**
5. `node test/core.test.mjs`（11/11）、`node test/channel-retry.test.mjs`（8/8）不回归
6. 临时脚本跑完即删，不留痕

## 五、交付

`tasks/Z10-delivery.md`：改动清单 / 复现命令 + 原始输出（含主路径与降级路径）/ 未确定项。最终回复简短给出同四段。**不要 git、不要安装、不要写 `$DSH_HOME`。**
