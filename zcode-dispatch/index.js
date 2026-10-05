/**
 * @local/zcode-dispatch —— Host 半边（cordis bundle 的 Host 入口）。
 *
 * 职责：按 config 创建 Z1 派发核心单例（core/dispatch-core.mjs，勿改），注册卸载清理
 * （杀子进程 + 落状态 + 释放 wire），并把「派发台操作」以 agent 工具 `zcode_dispatch`
 * 暴露给 agent —— 工具与 UI 悬浮窗共用 wire.host.mjs 的 createActionHandler 单实现
 * （references/user-actions.md「一个操作两个调用方」）。
 *
 * 说明两点（creator 会话如遇激活/注册问题按此排查）：
 * 1. Config 是 Standard Schema v1——cordis 的 resolveConfig 只认 Config['~standard'].validate，
 *    裸 JSON Schema 会在激活时抛「Cannot read properties of undefined (reading 'validate')」。
 *    首选宿主随包出货的 schemastery（官方插件同款）；解析不到时降级为 fallbackConfig() 的
 *    手写 Standard Schema，激活永不因 schema 崩。字段与默认值不变。
 * 2. agent 工具走官方契约注册：ctx.tools.register(defineTool({...}))（证据：refs/dsh-tools/
 *    tool-fs-example/index.js:261 注册调用、:1176 inject=['tools','fs','systemPrompt']、
 *    :1212 export；defineTool 契约：refs/dsh-tools/lib/index.js:838）。defineTool 经动态
 *    import 解析（与 loadConfig 同款降级），宿主缺包或 ctx.tools 不可用时只 warn 不抛——
 *    激活安全第一，UI 与派发核心不受影响。
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDispatcher } from './core/dispatch-core.mjs';
import { createSettleNotifier } from './notify.mjs';
import { DEFAULT_SWITCH_PATH, attachHostWire, createActionHandler, readSwitch, switchFileOf } from './wire.host.mjs';

/** 本文件所在目录（激活信标的兜底落点；config.workRoot 缺席时用）。 */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

/** 插件 config 默认值（与 cordis.patch.yml 的 config 字段一一对应，均带默认值）。 */
const DEFAULTS = {
  demo: false,
  maxConcurrent: 1,
  runnerPath: '',
  ledgerPath: '',
  workRoot: '',
  // runner 子进程的工作目录。runner 已迁至通用工具仓库（dsh-plugins/collab-kit），
  // 不再能从自身位置推出宿主项目根；显式给 cwd 最稳（runner 也支持从绝对 --task 反推，双保险）。
  // 留空 = 用 DSH 进程的 cwd（旧行为）。
  runnerCwd: '',
  // Z12：派发总开关真值文件（契约：宿主仓库 collab/PROTOCOL.md §7）；缺省为空 = 未接入宿主仓库
  switchPath: DEFAULT_SWITCH_PATH,
  // ZB-22：任务落地自动唤醒（会话不必自己回来轮询）。默认开；关掉只影响「叫醒会话」，
  // 派发/面板/工具动作一字不变。
  notifyOnSettle: true,
  // ZB-22：连续唤醒上限。0 = 不限（与 DSH 后台任务默认同语义）；>0 时"用户没说话期间"
  // 最多连续唤醒这么多次，超出改为注入下一步（等用户说话后预算清零）。
  maxConsecutiveWakes: 0,
  // ZB-22：往 system prompt 注入一段「派发台优先」提示（新会话的 agent 因此不易退回 DSH 自带 subagent）。
  systemPromptHint: true,
};

/**
 * 无依赖降级：手写 Standard Schema v1（cordis 只认 Config['~standard'].validate）。
 * 语义与 schemastery 主路径对齐：补默认值、demo 收敛为布尔、maxConcurrent 夹在 1..8、
 * 三个路径字段非字符串一律回空串——只归一不抛 issues，激活不被配置打崩。
 */
function fallbackConfig() {
  return {
    '~standard': {
      version: 1,
      vendor: 'zcode-dispatch',
      validate(raw) {
        const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
        cfg.demo = !!cfg.demo;
        cfg.maxConcurrent = Math.min(8, Math.max(1, Number(cfg.maxConcurrent) || 1));
        cfg.notifyOnSettle = cfg.notifyOnSettle !== false;
        cfg.systemPromptHint = cfg.systemPromptHint !== false;
        cfg.maxConsecutiveWakes = Math.max(0, Math.floor(Number(cfg.maxConsecutiveWakes) || 0));
        for (const k of ['runnerPath', 'ledgerPath', 'workRoot', 'runnerCwd', 'switchPath']) cfg[k] = typeof cfg[k] === 'string' ? cfg[k] : '';
        return { value: cfg };
      },
    },
  };
}

/** 首选官方形态（schemastery 即 Standard Schema v1，官方插件同款）；解析不到时降级。 */
async function loadConfig() {
  try {
    const { default: z } = await import('@deepseek-ai/schemastery');
    return z.object({
      demo: z.boolean().default(false).description('UI 演示模式：客户端用内置假数据渲染悬浮窗，不触达 dispatcher'),
      maxConcurrent: z.number().min(1).max(8).default(1).description('同时运行的 run 上限（单写者互斥语义下的并发度）'),
      runnerPath: z.string().default('').description('runner 脚本绝对路径（通用工具仓库 dsh-plugins/collab-kit/zcode-run.mjs，只读使用）；留空则不创建 dispatcher'),
      ledgerPath: z.string().default('').description('台账 zcode-runs.jsonl 绝对路径；留空则跳过台账回读与用量聚合'),
      workRoot: z.string().default('').description('派发器工作根目录（locks/、state/jobs.json、logs/ 落在这里）；留空则不创建 dispatcher'),
      runnerCwd: z.string().default('').description('runner 子进程工作目录（通常设为宿主项目根，如 F:\\My Code\\keysion dac vue）；留空 = 用 DSH 进程 cwd'),
      switchPath: z.string().default(DEFAULT_SWITCH_PATH).description('ZCode 派发总开关真值文件绝对路径（宿主仓库 collab/zcode-dispatch.switch.json，契约见其 PROTOCOL.md §7）；文件缺失/损坏视为开启；留空则开关不可写'),
      notifyOnSettle: z.boolean().default(true).description('ZB-22：任务落地（done/failed/killed/interrupted/paused）时自动唤醒发起会话（空闲=开新一轮，忙碌=注入下一步），与 DSH 后台任务同款；false=只派发不唤醒'),
      maxConsecutiveWakes: z.number().min(0).default(0).description('ZB-22：用户没说话期间允许的连续唤醒次数上限；0=不限；超出后改为注入（等用户说话后预算清零）'),
      systemPromptHint: z.boolean().default(true).description('ZB-22：向 system prompt 注入「派发台优先于 DSH 自带 subagent」提示段；false=不注入'),
    });
  } catch {
    return fallbackConfig();
  }
}

/** 插件 config schema（Standard Schema v1；cordis resolveConfig 经 Config['~standard'].validate 取值）。 */
export const Config = await loadConfig();

/* ─────────────── 官方 defineTool 的解析（ZB-01：裸 import 在本包必然失败）───────────────
 * 事实（2026-09-30 实测 + asar 头解析，见 tasks/ZB-01-delivery.md）：
 *   - 本包位于 F:\My Code\dsh-plugins，**不在 DSH 安装目录内**；profile 的 node_modules 只有
 *     @local / dsh-plugin-whale-pet，**没有 @deepseek-ai 作用域**；
 *   - 故裸 import('@deepseek-ai/dsh-tools') 从本文件向上逐级找 node_modules 必然
 *     ERR_MODULE_NOT_FOUND → loadDefineTool() 返回 null → 工具静默不注册（Z13 现场症状）；
 *   - 反例（真实可用的第三方插件）：refs/plugin-whale-pet/lib_index.js 的宿主半边
 *     **完全不 import 任何 @deepseek-ai/***（只用注入的 agents 服务）——第三方目录下裸 import 无先例。
 * 修法：裸 import 之后追加「绝对路径回退」（env 覆盖 → process.resourcesPath 推导 → 硬编码安装路径），
 * 每个候选先试 ESM import()、再试 CJS require()（Node 24 支持 require(esm)；asar 的 fs 补丁对两者
 * 都生效，双策略让「asar 内 ESM 装载」这一不确定性有兜底）。全失败再降级 null——激活安全第一。
 * 路径证据：asar 头 JSON 解析确认 dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js 存在
 * （157954 字节，与 refs/dsh-tools/lib/index.js 同尺寸）。 */
const DSH_TOOLS_REL = ['dsh', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'];

/** 绝对路径候选表（顺序即优先级；source 仅用于信标/日志，不参与逻辑）。 */
function dshToolsCandidates() {
  const out = [];
  const env = process.env.ZCD_DSH_TOOLS;
  if (typeof env === 'string' && env) out.push({ source: 'env:ZCD_DSH_TOOLS', path: env });
  const res = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (res) {
    out.push({ source: 'resourcesPath/app.asar', path: join(res, 'app.asar', ...DSH_TOOLS_REL) });
    out.push({ source: 'resourcesPath/app.asar.unpacked', path: join(res, 'app.asar.unpacked', ...DSH_TOOLS_REL) });
  }
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar', path: join('D:/DeepSeek/resources/app.asar', ...DSH_TOOLS_REL) });
  out.push({ source: 'abs:D:/DeepSeek/resources/app.asar.unpacked', path: join('D:/DeepSeek/resources/app.asar.unpacked', ...DSH_TOOLS_REL) });
  return out;
}

/** 解析尝试记录（写进激活信标；任何时刻只追加，绝不抛）。 */
const DEFINE_TOOL_PROBE = [];
const probeErr = (e) => (e && e.code ? `${e.code}: ${e.message}` : String((e && e.message) || e));
const accept = (mod) => (mod && typeof mod.defineTool === 'function' ? mod.defineTool : null);

/**
 * 官方工具定义器：随 dsh 出货的 @deepseek-ai/dsh-tools（包导出面见 refs/dsh-tools/lib/index.js:3714，
 * defineTool 实现同文件 :838）。解析不到时降级 null——模块照常加载、激活不受影响。
 * @returns {Promise<{defineTool: Function|null, source: string|null}>}
 */
async function loadDefineTool() {
  try {
    const fn = accept(await import('@deepseek-ai/dsh-tools'));
    if (fn) {
      DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: true });
      return { defineTool: fn, source: 'bare|import' };
    }
    DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: '导入成功但无 defineTool 导出' });
  } catch (e) {
    DEFINE_TOOL_PROBE.push({ source: 'bare', strategy: 'import', ok: false, error: probeErr(e) });
  }
  const require = createRequire(import.meta.url);
  for (const cand of dshToolsCandidates()) {
    try {
      const fn = accept(await import(pathToFileURL(cand.path).href));
      if (fn) {
        DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: true, path: cand.path });
        return { defineTool: fn, source: `${cand.source}|import` };
      }
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: false, path: cand.path, error: '导入成功但无 defineTool 导出' });
    } catch (e) {
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'import', ok: false, path: cand.path, error: probeErr(e) });
    }
    try {
      const fn = accept(require(cand.path));
      if (fn) {
        DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: true, path: cand.path });
        return { defineTool: fn, source: `${cand.source}|require` };
      }
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: false, path: cand.path, error: '加载成功但无 defineTool 导出' });
    } catch (e) {
      DEFINE_TOOL_PROBE.push({ source: cand.source, strategy: 'require', ok: false, path: cand.path, error: probeErr(e) });
    }
  }
  return { defineTool: null, source: null };
}
const DEFINE_TOOL_RESOLVED = await loadDefineTool();
const defineTool = DEFINE_TOOL_RESOLVED.defineTool;
const DEFINE_TOOL_SOURCE = DEFINE_TOOL_RESOLVED.source;

/**
 * 激活信标：把「defineTool 是否解析到 / 工具是否注册 / 远端面是否注册」落成一个 JSON 文件，
 * 供重启后一眼定位（ZB-01 §2.1）。路径 = config.workRoot/state/activation.json
 * （默认即 zcode-dispatch/.data/state/activation.json）；写失败**绝不抛**。
 *
 * ZB-22：改为**与已有内容合并**（原来整文件覆盖）。原因：唤醒能力要靠 ctx.inject 异步
 * 拿到 agents 服务后才成立，那一刻已是 apply 之后——只覆盖就写不进「唤醒是否真的启用」，
 * 而这条恰恰是排障时最需要一眼看到的。`at` 记录最后一次写入时间。
 */
function beaconFile(config) {
  const root = config && typeof config.workRoot === 'string' && config.workRoot ? config.workRoot : join(PLUGIN_DIR, '.data');
  return join(root, 'state', 'activation.json');
}
function writeActivationBeacon(config, patch) {
  try {
    const file = beaconFile(config);
    mkdirSync(dirname(file), { recursive: true });
    let prev = {};
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') prev = parsed;
    } catch { /* 首次写入 / 文件损坏：从空对象起步 */ }
    writeFileSync(file, `${JSON.stringify({ ...prev, at: new Date().toISOString(), name: 'zcode-dispatch', ...patch }, null, 2)}\n`, 'utf8');
  } catch { /* 信标只是诊断，写不了不影响激活 */ }
}
/** 工具注册失败原因（供信标；不改变 registerZcodeDispatchTool 的返回值语义）。 */
let TOOL_REGISTER_ERROR = null;

/** cordis 插件名（loader 诊断用；官方插件同款导出，refs/dsh-tools/tool-fs-example/index.js:1174）。 */
export const name = 'zcode-dispatch';

/** 依赖的宿主服务：tools 由 dsh 基础 bundle 提供（同款：tool-fs-example/index.js:1176 inject 含 'tools'）。 */
export const inject = ['tools'];

/* Z12：ACTIONS 补 dismiss（Z11 漏列的既有动作）并新增 status / switch（派发总开关）。 */
/* ZB-08：新增 wait（等待 job 落地，让调用方不必轮询）。追加在尾部保持既有顺序稳定。 */
const ACTIONS = ['dispatch', 'list', 'kill', 'dismiss', 'tail', 'quota', 'status', 'switch', 'channels', 'channel', 'retry', 'fallback', 'wait'];

/**
 * 工具参数 spec（@deepseek-ai/dsh-tools 官方 DSL，非 JSON Schema）：逐字段 {type, required?, description?}，
 * 由 parameterSchemaSpecToJsonSchema 编译（refs/dsh-tools/lib/index.js:802）。DSL 词汇=注解+
 * required:true+type 专属键（enum/const/items/properties/additionalProperties）——数字范围类
 * 约束（timeoutMin>0、n≥1）无对应键，写进 description 由 execute 侧语义兜底。
 * 字段与 createActionHandler 实际入参一一对应（实现与 schema 不漂移；action 必填，其余可选）。
 */
const TOOL_PARAMETERS = {
  action: { type: 'string', required: true, enum: ACTIONS, description: '操作类型' },
  enabled: { type: 'boolean', description: 'switch：目标状态（true=开启派发 / false=关闭派发，写入真值文件）' },
  by: { type: 'string', description: 'switch：操作者标识（写入 updatedAt/updatedBy，缺省 ui/tool）' },
  note: { type: 'string', description: 'switch：切换原因备注（写入 note）' },
  kind: { type: 'string', enum: ['prompt', 'task', 'target'], description: 'dispatch：派发类型' },
  prompt: { type: 'string', description: 'dispatch(kind=prompt)：发给 ZCode 的提示词' },
  task: { type: 'string', description: 'dispatch(kind=task)：任务文件绝对路径' },
  target: { type: 'string', description: 'dispatch(kind=target)：目标描述' },
  model: { type: 'string', enum: ['GLM-5.3', 'GLM-5.3-Flash'], description: 'dispatch：模型' },
  provider: { type: 'string', enum: ['plan', 'personal'], description: 'dispatch：plan=套餐通道 / personal=个人 Key' },
  mode: { type: 'string', enum: ['build', 'edit', 'plan', 'yolo'], description: 'dispatch：ZCode 运行模式，默认 edit' },
  timeoutMin: { type: 'number', description: 'dispatch：超时分钟（必须 > 0）' },
  memoryBench: { type: 'boolean', description: 'dispatch：附加 --memory-bench（仅 kind=prompt 支持）' },
  tag: { type: 'string', description: 'dispatch：台账 tag（缺省由 runner 生成）' },
  lock: { type: 'string', enum: ['repo', 'none'], description: 'dispatch：仓库写锁。repo（默认）= 锁仓库；none = 明确不取锁。**锁哪些文件用 write 指定**（memory/both 已于 ZB-16 删除）' },
  cwd: { type: 'string', description: 'dispatch：runner 工作目录' },
  resume: { type: 'string', description: 'dispatch：要续跑的 sessionId' },
  /* ZB-08/16：**仓库锁的粒度**。声明 ⇒ 只锁这些文件（不同文件集可并发 —— 这正是用户要的）；
   * 不声明 ⇒ 锁整个仓库（粗粒度；单写者纪律本义）。 */
  write: {
    type: 'array',
    items: { type: 'string' },
    description: 'dispatch：该任务预计会写入的文件绝对路径列表（声明后按文件级加锁，不冲突即可并发；不声明则锁整个仓库）',
  },
  id: { type: 'string', description: 'kill/tail/retry：job id（形如 j-xxxx）' },
  n: { type: 'integer', description: 'tail：行数（≥ 1，默认 30，上限 200）' },
  retryModel: { type: 'string', description: 'retry：目标模型（同通道续跑时不允许传——--resume 带 --model 必失败）' },
  chain: { type: 'array', items: { type: 'string' }, description: 'fallback：降级链（通道 id 数组，顺序即优先级；空数组=关闭）' },
};

const TOOL_DESCRIPTION_BODY = [
  '- action=dispatch：派发一个 run。**立即返回**，不等任务跑完（返回时 state 通常是 queued）。拿结果有两条路：等**落地自动唤醒**（见下条，推荐），或主动 action=wait / action=tail。kind=prompt|task|target 必须带对应内容字段 prompt|task|target（task 为任务文件绝对路径）。可选：model（GLM-5.3 / GLM-5.3-Flash）、provider（plan=套餐通道 / personal=个人 Key）、mode（build|edit|plan|yolo，默认 edit）、timeoutMin（正数分钟）、memoryBench（true 附加 --memory-bench，仅 kind=prompt）、tag、lock（repo|none，默认 repo）、**write（本任务要写的文件列表 —— 锁的粒度就是它）**、cwd、resume。总开关关闭时被拒绝（返回 ok:false + switch 状态），不创建 job。',
  /* ZB-22：落地自动唤醒 —— 这是「派发台能不能像 DSH 后台任务一样用」的关键。
   * 现场症状：派发后会话不等待、直接往下走/结束，任务跑完没人叫醒它，用户得自己再发一句。 */
  '- **落地自动唤醒（默认开）**：dispatch/retry 建出的 job 一旦落地（done / failed / killed / interrupted / **paused**），**发起它的会话会被自动唤醒**并收到一条通知——会话空闲就开新一轮，会话正忙就插进下一步（与 DSH 后台任务同款）。因此派发之后**不要轮询、不要 sleep**：继续做别的独立步骤，或直接结束本轮即可；收到「zcode-dispatch」通知后再用 action=tail / action=list 读结果。你自己 action=kill 掉的、或自己 action=wait 已经读到的 job 不会再发通知（避免自己叫醒自己）。配置 notifyOnSettle=false 可关掉唤醒。',
  /* ZB-16：锁模型（本轮重设计）。
   * 仓库锁的**粒度由 write 决定**：声明 write ⇒ 只锁那些文件（不同文件集可并发）；
   * 不声明 ⇒ 锁整个仓库（粗粒度）。memory 锁已删除。 */
  '- **锁与并发**：并发数 = min(配置 maxConcurrent, 锁闸)。锁闸按**文件集**判定：**声明 write 的任务只锁它要写的文件** —— 不同文件集可并发，写同一文件（或与"整仓库锁"重叠）才排队。**不声明 write ⇒ 锁整个仓库**，与其它任务互斥。想让多个任务真正并发，就为每个任务声明它要写的文件。lock=none 表示明确不取锁（确认无竞写关系时用）。',
  '- **记忆写入（默认约束）**：派发时**默认注入提示词**，要求子代理不执行 ZCode 记忆写入/自动 Memory 提取（不写 ~/.zcode）。注意 kind=task 的任务包内容由宿主 runner 读取内联，插件注入不进去 ⇒ 该任务的 job.memoryBanApplied=false（如实标记，未受禁令保护）。',
  '- action=wait：等待 job 落到终态或 paused（id 必填，timeoutSec 可选，缺省取该任务 timeoutMin 的秒数）。paused 也返回（不干等，让调用方决定 retry 续跑还是换通道交接）；超时返回 timedOut:true 与当前状态，不谎报完成。**已经 wait 到落地的 job 不再发落地通知**（结果你已拿到）。',
  '- action=list：列出全部 run（running/queued 优先，含状态/锁/用量/上下文占用；不含 tail 内容）。',
  '- action=kill：按 id 终止。queued 直接移除；running 发终止信号后落 killed。**自己 kill 的 job 不发落地通知**。',
  '- action=dismiss：把 paused/终态 job 从列表移除（queued/running 必须先 kill）。',
  '- action=tail：按 id 取最近输出，参数 n 默认 30（上限 200）。',
  '- action=quota：台账用量聚合（5 小时滚动 / 本周 / 今日）+ 套餐剩余额度适配器（当前恒 available:false，待接 app-server RPC）。',
  '- action=status：读 ZCode 派发总开关状态（返回 switch={enabled, updatedAt, updatedBy, note, source}；文件缺失/损坏=开启）。',
  '- action=switch：切换派发总开关（enabled 必填布尔；by=操作者、note=原因可选）。原子写真值文件（与 CLI zcode-switch.mjs 同一格式）；关闭后所有派发入口（zcode-run.mjs / 本工具 dispatch|retry / 面板 / bridge.mjs）一律拒绝。任何会话都可通过 status 查到最新状态。',
  '- action=channels：通道清单（含 enabled/原因/端点/模型；解析失败返回空数组+warnings，不猜）。',
  '- action=channel：读默认通道（无参）或设置（provider 必带，model 可选）——之后未显式指定通道的 dispatch 都用它。',
  '- action=retry：同通道且有 sessionId → --resume 续跑（不要传 retryModel：--resume 带 --model 必失败）；换通道（或无 sessionId）→ 交接重跑（新会话+交接提示词），新 job 带 parentJobId/attempts。可用 provider / retryModel（或 model）。总开关关闭时同样被拒绝。',
  '- action=fallback：读降级链（无参）或设置 chain（通道 id 数组，空数组=关闭）。开启后额度耗尽/未开通/需签名会自动交接重跑到链上下一个可用通道（会消耗下游通道额度）。',
  '限制：仓库写锁互斥（同锁排队、不报错；**文件锁任务优先放行**，同类内保持 FIFO）；memoryBench 仅 kind=prompt；timeoutMin 必须 >0；本工具不授予或确认任何权限。',
].join('\n');

/**
 * 工具描述：首段说清**什么时候必须用本工具**（模型选工具的唯一依据就是这段文字）+
 * 显式排除 DSH 自带 subagent/jobs；末段动态携带开关当前状态（注册时按 readSwitch() 生成一次；
 * 运行中状态以 action=status 的实时返回为准）。
 *
 * ZB-02（用户现场报告「新会话里让它派发 zcode，走的还是 DSH 后台，不在派发台里」）：
 * 旧首行是「操作「ZCode 派发台」：把任务派发给 ZCode 子代理（当前：已开启）。action=status 查开关状态；…」，
 * 有两处硬伤：① 首行把动作重心放在 status/switch 上，读起来像状态管理工具而非派发入口；
 * ② 用了「子代理」一词，与 DSH 自带 `subagent`（Delegate a self-contained task to a subagent）
 * 概念直接撞车——模型看到「派发/子代理」就顺手调了 subagent，任务于是跑在 DSH 后台、不产生派发台 job。
 * 现改为：触发条件先讲、「ZCode 无头进程」替代「子代理」、并点名禁止替代品。
 */
function buildToolDescription(switchFile) {
  const sw = readSwitch(switchFile);
  const state = sw.enabled ? '已开启' : '已关闭';
  return [
    '【派发优先级：能用派发台就优先用派发台】凡是「把任务交给一个 agent 去做」的诉求——用户说「派发给 ZCode / 让 ZCode 做 / 用 ZCode 跑 / zcode 派发 / 在派发台派一个」，或只是笼统地说「派发这个任务」——**先**用本工具的 action=dispatch：它才会在「ZCode 派发台」面板里生成一个可监视的 job（独立 ZCode 进程、独立额度与会话，可查输出/终止/续跑/换通道）。',
    '✅ **仅当派发台不可用时**才退回 DSH 自带的 subagent / spawn_teammate / subagent_fork / 后台 jobs：即 action=status 显示开关已关闭、dispatch 返回 ok:false（未配置 runner/workRoot、锁冲突等），或用户明确要求「你自己（DSH）去做」。此时要**说明为什么没用派发台**，不要静默切换。',
    `当前派发总开关：${state}（实时状态用 action=status）。action=switch 切换开关；action=list/tail 监视；与页面右下角悬浮窗是同一套操作（一操作两调用方）。`,
  ].join('\n') + `\n${TOOL_DESCRIPTION_BODY}`;
}

/**
 * 注册 agent 工具（官方契约：refs/dsh-tools/tool-fs-example/index.js:261
 * ctx.tools.register(defineTool({ name, description, parameters, output, execute }))；
 * ctx.tools 由 inject=['tools'] 从宿主取得）。
 * 激活安全：ctx.tools 不可用、defineTool 未解析（宿主缺包）、注册抛错——一律
 * log warn + 返回 null，UI 与派发核心不受影响。
 * @param {object} ctx cordis Context
 * @param {(level: string, msg: string) => void} log
 * @param {(action: string, params: object) => Promise<object>} handleAction
 * @param {string} switchFile 开关真值文件（工具描述首行的注册时快照用）
 * @param {object} [hooks] ZB-22 落地唤醒钩子：{ notifier: {current}, log }
 * @returns {(() => void)|null} 注销函数（若注册成功），否则 null
 */
function registerZcodeDispatchTool(ctx, log, handleAction, switchFile, hooks = {}) {
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
    TOOL_REGISTER_ERROR = 'ctx.tools.register 不可用（inject=[\'tools\'] 未满足？）';
    log('warn', 'ctx.tools.register 不可用：agent 工具 zcode_dispatch 未注册（非致命，UI 与派发核心不受影响）');
    return null;
  }
  if (typeof defineTool !== 'function') {
    TOOL_REGISTER_ERROR = '@deepseek-ai/dsh-tools 未解析（defineTool 为 null；候选见激活信标 defineToolAttempts）';
    log('warn', '@deepseek-ai/dsh-tools 不可用（defineTool 未解析）：agent 工具 zcode_dispatch 未注册（非致命，UI 与派发核心不受影响）');
    return null;
  }
  TOOL_REGISTER_ERROR = null;
  try {
    const registered = ctx.tools.register(defineTool({
      name: 'zcode_dispatch',
      description: buildToolDescription(switchFile),
      parameters: TOOL_PARAMETERS,
      // output 不可省略：defineTool 无条件读 options.output.render/.schema（refs/dsh-tools/lib/index.js:842/:849）。
      // schema 用 DSL 最小合法形态 {type:'json'}（:688 注解即无约束 JSON，execute 的任意 JSON 返回值都合法）。
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
      },
      async execute(args, exec) {
        const params = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
        const result = await handleAction(params.action, params);
        /* ZB-22：把这次动作翻译成唤醒簿记。execute 的第二个参数 exec 带发起会话
         * （exec.agent.id）——这是「谁派发的、落地后叫醒谁」的唯一来源。簿记失败绝不影响工具结果。 */
        noteOwnerAction(hooks, params, result, exec);
        return JSON.stringify(result); // 工具结果统一回 JSON 字符串，调用方自行解析
      },
    }));
    log('info', 'agent 工具 zcode_dispatch 已注册（官方 ctx.tools.register + defineTool）');
    return () => {
      try {
        if (typeof registered === 'function') {
          registered();
          return;
        }
      } catch { /* 已注销 */ }
      for (const m of ['remove', 'unregister', 'undefine', 'dispose']) {
        try {
          if (typeof ctx.tools?.[m] === 'function') {
            ctx.tools[m]('zcode_dispatch');
            return;
          }
        } catch { /* 尝试下一个 */ }
      }
    };
  } catch (e) {
    TOOL_REGISTER_ERROR = `defineTool/register 抛错：${e?.message ?? e}`;
    log('warn', `agent 工具 zcode_dispatch 注册失败：${e?.message ?? e}（非致命，UI 与派发核心不受影响）`);
    return null;
  }
}

/**
 * ZB-22：把一次工具动作翻译成唤醒簿记。
 *
 * 只有**真正的派发**（dispatch / retry 成功）才登记 job→会话 的归属；其余动作只做抑制：
 *   · kill 成功   ⇒ 模型自己终止的 job 不必再叫醒它（等价 dsh-tool-jobs 的 killedByModel）；
 *   · wait 到落地 ⇒ 结果已由本次工具调用返回，不必再发通知（等价其 event.awaited）；
 *   · wait 超时   ⇒ **不**抑制（job 仍在跑，落地时应当唤醒）。
 * 所有异常一律吞掉：簿记是增强，绝不能影响工具返回。
 *
 * @param {object} hooks { notifier: {current}, log }
 * @param {object} params 工具入参（含 action / id）
 * @param {object} result handleAction 的返回信封
 * @param {object} exec 官方工具执行上下文（exec.agent.id = 发起会话）
 */
export function noteOwnerAction(hooks, params, result, exec) {
  try {
    const notifier = hooks?.notifier?.current;
    if (!notifier) return;
    const action = params?.action;
    const id = typeof params?.id === 'string' ? params.id : (typeof params?.jobId === 'string' ? params.jobId : '');
    if ((action === 'dispatch' || action === 'retry') && result?.ok === true && typeof result.job?.id === 'string') {
      const ownerId = typeof exec?.agent?.id === 'string' ? exec.agent.id : '';
      notifier.track(result.job.id, ownerId);
      return;
    }
    if (action === 'kill' && result?.ok === true && id) {
      notifier.markKilled(id);
      return;
    }
    if (action === 'wait' && result?.ok === true && result.timedOut === false && id) {
      notifier.markAwaited(id);
    }
  } catch (e) {
    try { hooks?.log?.('warn', `落地唤醒簿记失败（action=${params?.action}）：${e?.message ?? e}`); } catch { /* 日志失败也不影响 */ }
  }
}

function makeLogger(ctx) {
  return (level, msg) => {
    try {
      const logger = ctx?.logger;
      if (logger && typeof logger[level] === 'function') logger[level](`[zcode-dispatch] ${msg}`);
      else console[level === 'info' ? 'log' : level === 'warn' ? 'warn' : 'error'](`[zcode-dispatch] ${msg}`);
    } catch { /* 日志失败不影响主流程 */ }
  };
}

/**
 * ZB-22：注入 system prompt 的「派发台」提示段。
 *
 * 现场症状「新会话的 agent 不太用派发台」的根因是**它压根没被告知**：工具的 description
 * 只在模型主动读工具清单时起作用，而 DSH 自带 subagent 是系统提示里已有的熟路。
 * 本段与 dsh-tool-jobs 的 `tool:jobs` 段同级，位置紧跟 TOOL_JOBS（1600+5），排在 TOOL_SUBAGENT 之前。
 * 比工具 description 短：系统提示每轮都占 token，工具清单只在模型看工具时占。
 */
const SYSTEM_PROMPT_SECTION = [
  '【ZCode 派发台】要把一个独立任务交给另一个 agent 去做时（用户说「派发 / 交给 ZCode / 让 ZCode 做 / 用 ZCode 跑 / 在派发台派一个」，或笼统说「派发这个任务」），用工具 zcode_dispatch 的 action=dispatch，**不要**改用 DSH 自带的 subagent / spawn_teammate / subagent_fork / 后台 jobs —— 只有前者会在「ZCode 派发台」面板里生成可监视的 job（独立 ZCode 进程、独立额度与会话）。',
  '派发是 fire-and-forget：**不要**轮询、不要 sleep。job 落地（done / failed / killed / interrupted / paused）时本会话会被自动唤醒并收到一条 zcode-dispatch 通知，届时用 action=tail / action=list 读结果。',
  '例外：用户明确要你自己做，或 action=status 显示开关已关闭 / dispatch 返回 ok:false —— 这时按工具说明退回 DSH 自带手段，并说明原因。',
].join('\n');

/**
 * Host 入口。返回 { dispatcher, wire, handleAction, notifier } 便于测试与 creator 调试
 * （notifier 是 ZB-22 落地唤醒器的持有者，供集成测试与排障读取；插件外无需依赖它）。
 * @param {object} ctx cordis Context
 * @param {object} config 已校验的插件 config（见 Config）
 */
export function apply(ctx, config = {}) {
  const log = makeLogger(ctx);

  let dispatcher = null;
  if (config.runnerPath && config.workRoot) {
    dispatcher = createDispatcher({
      runnerPath: config.runnerPath,
      ledgerPath: config.ledgerPath || undefined,
      workRoot: config.workRoot,
      maxConcurrent: config.maxConcurrent,
      ...(config.runnerCwd ? { runnerCwd: config.runnerCwd } : {}),
    });
    log('info', `dispatcher 就绪：work=${dispatcher.workRoot} maxConcurrent=${config.maxConcurrent ?? 1}`);
  } else {
    log('warn', '缺少 runnerPath / workRoot 配置，dispatcher 未创建（UI 将进入 demo 降级；工具动作返回可读错误）');
  }

  const handleAction = createActionHandler(dispatcher, config);
  const wire = attachHostWire(ctx, dispatcher, config);

  /* ───────── ZB-22：任务落地自动唤醒（会话不必自己回来轮询）─────────
   * agents 服务**既不写进静态 inject，也不用 ctx.inject 等它就绪**：投递那一刻才解析
   * （`ctx.get('agents')`，cordis 对未注册/未激活的服务返回 undefined 而不抛）。
   * 理由：唤醒是「有就更好」的增强——绝不能让它成不成立取决于服务解析时机是否恰好赶上
   * apply；真机排障只看信标 `wakeActive` / `agentsVisible` 两个字段。
   * 释放复用下方唯一那处 `ctx.effect(disposeAll)`（不再单独注册 effect）。 */
  const notifierHolder = { current: null };
  let wakeNote = null;
  let agentsVisible = null;
  if (dispatcher && config.notifyOnSettle !== false) {
    try {
      agentsVisible = !!ctx?.get?.('agents');
    } catch { agentsVisible = false; } // 解析抛错也只是「现在看不到」，投递时再试
    try {
      const agentsFacade = {
        get: (id) => {
          try { return ctx?.get?.('agents')?.get?.(id); } catch { return undefined; }
        },
      };
      notifierHolder.current = createSettleNotifier({ dispatcher, agents: agentsFacade, ctx, log, config });
      const cap = Number(config.maxConsecutiveWakes) > 0 ? `连续 ${config.maxConsecutiveWakes} 次` : '不限';
      log('info', `任务落地自动唤醒已启用：会话空闲时 followup 唤醒、忙碌时注入下一步（连续唤醒上限：${cap}；agents 服务当前${agentsVisible ? '可见' : '未解析到 —— 投递时再试'}）`);
    } catch (e) {
      wakeNote = `init-failed: ${e?.message ?? e}`;
      log('warn', `任务落地自动唤醒初始化失败：${e?.message ?? e}（派发与 UI 不受影响）`);
    }
  } else if (dispatcher) {
    wakeNote = 'disabled-by-config';
    log('info', '任务落地自动唤醒已关闭（config.notifyOnSettle=false）');
  }

  /* ───────── ZB-22：system prompt 提示段 ─────────
   * 现场症状「新会话的 agent 不太用派发台」的根因是**它压根没被告知**：工具的
   * description 只在模型主动看工具列表时起作用，而 DSH 自带 subagent 是系统提示里
   * 点名推荐过的熟路。这里补一段与 dsh-tool-jobs 的 tool:jobs 段同级的提示，
   * 位置紧跟 TOOL_JOBS 之后（1600+5），排在 TOOL_SUBAGENT 之前。 */
  if (config.systemPromptHint !== false && typeof ctx?.inject === 'function') {
    ctx.inject(['systemPrompt'], (spCtx) => {
      try {
        const base = spCtx.systemPrompt.getSectionOrder?.('TOOL_JOBS');
        spCtx.systemPrompt.section({
          name: 'tool:zcode-dispatch',
          order: Number.isFinite(base) ? base + 5 : 1605,
          text: SYSTEM_PROMPT_SECTION,
        });
        log('info', 'system prompt 已注入「ZCode 派发台」提示段');
        writeActivationBeacon(config, { systemPromptHintActive: true, systemPromptHintError: null });
      } catch (e) {
        log('warn', `system prompt 注入失败：${e?.message ?? e}（派发与 UI 不受影响）`);
        writeActivationBeacon(config, { systemPromptHintActive: false, systemPromptHintError: e?.message ?? String(e) });
      }
    });
  } else if (config.systemPromptHint === false) {
    writeActivationBeacon(config, { systemPromptHintActive: false, systemPromptHintError: 'disabled-by-config' });
  }

  const disposeTool = registerZcodeDispatchTool(ctx, log, handleAction, switchFileOf(config), { notifier: notifierHolder, log });

  /* ZB-01 激活信标（§2.1）：重启后读 .data/state/activation.json 一眼定位
   * 「包没解析到」还是「register 没成功」还是「远端面没注册」。 */
  if (typeof defineTool === 'function') log('info', `defineTool 已解析（来源 ${DEFINE_TOOL_SOURCE}）`);
  else log('warn', `defineTool 未解析；失败候选=${DEFINE_TOOL_PROBE.filter((p) => !p.ok).map((p) => `${p.source}/${p.strategy}`).join(', ')}`);
  writeActivationBeacon(config, {
    dispatcherReady: !!dispatcher,
    workRoot: dispatcher ? dispatcher.workRoot : null,
    switchPath: switchFileOf(config),
    ctxToolsRegisterAvailable: !!(ctx?.tools && typeof ctx.tools.register === 'function'),
    defineToolResolved: typeof defineTool === 'function',
    defineToolSource: DEFINE_TOOL_SOURCE,
    defineToolAttempts: DEFINE_TOOL_PROBE,
    toolRegistered: typeof disposeTool === 'function',
    toolRegisterError: TOOL_REGISTER_ERROR,
    remote: (wire && wire.diagnostics) || null,
    switchEnabled: readSwitch(switchFileOf(config)).enabled,
    // ZB-22：唤醒与提示段的配置快照 + 动态结果
    notifyOnSettle: config.notifyOnSettle !== false,
    maxConsecutiveWakes: Number(config.maxConsecutiveWakes) || 0,
    systemPromptHint: config.systemPromptHint !== false,
    wakeActive: !!notifierHolder.current,
    wakeNote,
    agentsVisible,
  });

  const disposeAll = () => {
    try {
      disposeTool?.();
    } catch { /* 已注销 */ }
    try {
      notifierHolder.current?.dispose?.();
      notifierHolder.current = null;
    } catch { /* 已释放 */ }
    try {
      wire.dispose?.();
    } catch { /* 已释放 */ }
    if (dispatcher) {
      for (const j of dispatcher.list()) {
        if (j.state === 'running' || j.state === 'queued') {
          try {
            dispatcher.kill(j.id, 'plugin unloading: dispatcher disposed');
          } catch (e) {
            log('warn', `卸载时 kill ${j.id} 失败：${e?.message ?? e}`);
          }
        }
      }
      dispatcher.dispose?.(); // Z1 dispatcher 暂无 dispose；预留调用点，Z1 增补后无感生效
    }
  };
  if (typeof ctx?.effect === 'function') ctx.effect(() => disposeAll);
  else log('warn', 'ctx.effect 不可用：卸载清理未注册（无法在插件卸载时杀子进程/落状态）');
  // 注：卸载时 running job 依赖 child 'close' 事件落终态并持久化；若整个进程直接退出，
  // 下次启动由 dispatcher.restore() 把残留 running/queued 兜底标为 interrupted，状态不悬空。

  return { dispatcher, wire, handleAction, notifier: notifierHolder };
}
