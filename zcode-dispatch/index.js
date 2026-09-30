/**
 * @local/zcode-dispatch —— Host 半边（cordis bundle 的 Host 入口）。
 *
 * 职责：按 config 创建 Z1 派发核心单例（core/dispatch-core.mjs，勿改），注册卸载清理
 * （杀子进程 + 落状态 + 释放 wire），并把「派发台操作」以 agent 工具 `zcode_dispatch`
 * 暴露给 agent —— 工具与 UI 悬浮窗共用 wire.host.mjs 的 createActionHandler 单实现
 * （references/user-actions.md「一个操作两个调用方」）。
 *
 * 说明两点（creator 会话如遇激活/注册问题按此排查）：
 * 1. Config 用 JSON Schema（draft-07 语境）声明；references/practices.md 提到
 *    Config.listConfigs 返回文档含 $defs 引用，即 JSON Schema。若实际加载器要求
 *    cordis Schema 包装形态，只需改写本文件 Config 常量（字段与默认值不变）。
 * 2. agent 工具的注册 API 未经 inspection 确认（标准模式无 cordis_inspect_query），
 *    registerZcodeDispatchTool() 按候选顺序防御式尝试；工具本体（动作实现）不受影响。
 */
import { createDispatcher } from './core/dispatch-core.mjs';
import { attachHostWire, createActionHandler } from './wire.host.mjs';

/** 插件 config schema（与 cordis.patch.yml 的 config 字段一一对应，均带默认值）。 */
export const Config = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    demo: { type: 'boolean', default: false, description: 'UI 演示模式：客户端用内置假数据渲染悬浮窗，不触达 dispatcher' },
    maxConcurrent: { type: 'integer', default: 1, minimum: 1, maximum: 8, description: '同时运行的 run 上限（单写者互斥语义下的并发度）' },
    runnerPath: { type: 'string', default: '', description: 'runner 脚本绝对路径（宿主仓库 scripts/collab/zcode-run.mjs，只读使用）；留空则不创建 dispatcher' },
    ledgerPath: { type: 'string', default: '', description: '台账 zcode-runs.jsonl 绝对路径；留空则跳过台账回读与用量聚合' },
    workRoot: { type: 'string', default: '', description: '派发器工作根目录（locks/、state/jobs.json、logs/ 落在这里）；留空则不创建 dispatcher' },
  },
};

const ACTIONS = ['dispatch', 'list', 'kill', 'tail', 'quota', 'channels', 'channel', 'retry', 'fallback'];

/** 工具参数 schema（JSON Schema；工具与 UI 共用 createActionHandler 的入参形状）。 */
const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS, description: '操作类型' },
    kind: { type: 'string', enum: ['prompt', 'task', 'target'], description: 'dispatch：派发类型' },
    prompt: { type: 'string', description: 'dispatch(kind=prompt)：发给 ZCode 的提示词' },
    task: { type: 'string', description: 'dispatch(kind=task)：任务文件绝对路径' },
    target: { type: 'string', description: 'dispatch(kind=target)：目标描述' },
    model: { type: 'string', enum: ['GLM-5.3', 'GLM-5.3-Flash'], description: 'dispatch：模型' },
    provider: { type: 'string', enum: ['plan', 'personal'], description: 'dispatch：plan=套餐通道 / personal=个人 Key' },
    mode: { type: 'string', enum: ['build', 'edit', 'plan', 'yolo'], description: 'dispatch：ZCode 运行模式，默认 edit' },
    timeoutMin: { type: 'number', exclusiveMinimum: 0, description: 'dispatch：超时分钟（正数）' },
    memoryBench: { type: 'boolean', description: 'dispatch：附加 --memory-bench（仅 kind=prompt 支持）' },
    tag: { type: 'string', description: 'dispatch：台账 tag（缺省由 runner 生成）' },
    lock: { type: 'string', enum: ['repo', 'memory', 'both'], description: 'dispatch：单写者锁集合，默认 both' },
    cwd: { type: 'string', description: 'dispatch：runner 工作目录' },
    resume: { type: 'string', description: 'dispatch：要续跑的 sessionId' },
    id: { type: 'string', description: 'kill/tail/retry：job id（形如 j-xxxx）' },
    n: { type: 'integer', minimum: 1, description: 'tail：行数，默认 30，上限 200' },
    retryModel: { type: 'string', description: 'retry：目标模型（同通道续跑时不允许传——--resume 带 --model 必失败）' },
    chain: { type: 'array', items: { type: 'string' }, description: 'fallback：降级链（通道 id 数组，顺序即优先级；空数组=关闭）' },
  },
  required: ['action'],
};

const TOOL_DESCRIPTION = [
  '操作「ZCode 派发台」：派发并监视 ZCode 无头进程（node zcode-run.mjs），与页面右下角悬浮窗是同一套操作（一操作两调用方）。',
  '- action=dispatch：派发一个 run。kind=prompt|task|target 必须带对应内容字段 prompt|task|target（task 为任务文件绝对路径）。可选：model（GLM-5.3 / GLM-5.3-Flash）、provider（plan=套餐通道 / personal=个人 Key）、mode（build|edit|plan|yolo，默认 edit）、timeoutMin（正数分钟）、memoryBench（true 附加 --memory-bench，仅 kind=prompt）、tag、lock（repo|memory|both，默认 both）、cwd、resume。',
  '- action=list：列出全部 run（running/queued 优先，含状态/锁/用量/上下文占用；不含 tail 内容）。',
  '- action=kill：按 id 终止。queued 直接移除；running 发终止信号后落 killed。',
  '- action=tail：按 id 取最近输出，参数 n 默认 30（上限 200）。',
  '- action=quota：台账用量聚合（5 小时滚动 / 本周 / 今日）+ 套餐剩余额度适配器（当前恒 available:false，待接 app-server RPC）。',
  '- action=channels：通道清单（含 enabled/原因/端点/模型；解析失败返回空数组+warnings，不猜）。',
  '- action=channel：读默认通道（无参）或设置（provider 必带，model 可选）——之后未显式指定通道的 dispatch 都用它。',
  '- action=retry：同通道且有 sessionId → --resume 续跑（不要传 retryModel：--resume 带 --model 必失败）；换通道（或无 sessionId）→ 交接重跑（新会话+交接提示词），新 job 带 parentJobId/attempts。可用 provider / retryModel（或 model）。',
  '- action=fallback：读降级链（无参）或设置 chain（通道 id 数组，空数组=关闭）。开启后额度耗尽/未开通/需签名会自动交接重跑到链上下一个可用通道（会消耗下游通道额度）。',
  '限制：单写者互斥（repo/memory 文件锁 + FIFO 队列，同锁串行，冲突只会排队不会报错）；memoryBench 仅 kind=prompt；timeoutMin 必须 >0；本工具不授予或确认任何权限。',
].join('\n');

/**
 * 防御式注册 agent 工具：注册 API 未经 inspection 确认，按候选顺序尝试，
 * 全部失败则打日志说明 creator 该怎么修（动作实现不受影响）。
 * @returns {(() => void)|null} 注销函数（若注册成功），否则 null
 */
function registerZcodeDispatchTool(ctx, log, handleAction) {
  const definition = {
    name: 'zcode_dispatch',
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    async execute(args) {
      const params = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
      const result = await handleAction(params.action, params);
      return JSON.stringify(result); // 工具结果统一回 JSON 字符串，调用方自行解析
    },
  };
  const candidates = [
    ['ctx.tools.define(def)', () => ctx.tools?.define?.(definition)],
    ['ctx.tools.register(name, def)', () => ctx.tools?.register?.(definition.name, definition)],
    ['ctx.tools.add(def)', () => ctx.tools?.add?.(definition)],
    ['ctx.tool.define(def)', () => ctx.tool?.define?.(definition)],
  ];
  for (const [label, tryRegister] of candidates) {
    try {
      const r = tryRegister();
      if (r !== undefined && r !== false) {
        log('info', `agent 工具 zcode_dispatch 已注册（${label}）`);
        return () => {
          for (const m of ['remove', 'unregister', 'undefine', 'dispose']) {
            try {
              if (typeof ctx.tools?.[m] === 'function') {
                ctx.tools[m](definition.name);
                return;
              }
            } catch { /* 尝试下一个 */ }
          }
        };
      }
    } catch (e) {
      log('warn', `工具注册候选 ${label} 失败：${e?.message ?? e}`);
    }
  }
  log('warn', '未能注册 agent 工具 zcode_dispatch：ctx.tools 注册 API 未经 inspection 确认。'
    + 'creator 会话请用 cordis_inspect_query → Tool 查看现有工具的注册方式，'
    + '然后只调整 index.js 的 registerZcodeDispatchTool() 候选列表（动作实现 createActionHandler 无需改动）。');
  return null;
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
 * Host 入口。返回 { dispatcher, wire, handleAction } 便于测试与 creator 调试。
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
    });
    log('info', `dispatcher 就绪：work=${dispatcher.workRoot} maxConcurrent=${config.maxConcurrent ?? 1}`);
  } else {
    log('warn', '缺少 runnerPath / workRoot 配置，dispatcher 未创建（UI 将进入 demo 降级；工具动作返回可读错误）');
  }

  const handleAction = createActionHandler(dispatcher, config);
  const wire = attachHostWire(ctx, dispatcher, config);
  const disposeTool = registerZcodeDispatchTool(ctx, log, handleAction);

  const disposeAll = () => {
    try {
      disposeTool?.();
    } catch { /* 已注销 */ }
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

  return { dispatcher, wire, handleAction };
}
