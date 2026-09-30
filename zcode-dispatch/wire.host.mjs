/**
 * zcode-dispatch —— Host 半边接线适配器（Z8 全接线版）。
 *
 * 职责：把 dispatcher 的状态以「Remote 面」暴露给客户端，并保留进程内动作入口。
 * 动作实现全包只有一份（createActionHandler），agent 工具 `zcode_dispatch`
 * （index.js）与 Remote 面共用它，对应 references/user-actions.md 的「一个操作两个调用方」。
 *
 * ── Remote 形态（Z8 静态证据驱动，证据见 tasks/Z8-delivery.md）──────────────
 * 宿主侧「最后一跳」按官方 typert 三件套的两条并存路径落地：
 *
 * A) typert-loader 自动发现（strict 注册表路径）：
 *    dsh-base 组合挂载 typert / typert-loader / typert-gateway 三服务
 *    （refs/extracted/dsh-base/cordis.patch.yml:46-53）。loader 对每个 Loader entry
 *    读包的 exports["./typert"]（本包= ./wire.host.mjs，loader/lib/index.js:39-40），
 *    import 后取 TYPERT 校验并 ctx.typert.register(manifest)
 *    （loader/lib/index.js:69-117,315 附近）。因此本文件的 TYPERT 必须全字段过验：
 *    每个 codec 都要 {mode:'strict', typeSymbol, create}（loader/lib/index.js:206-211）。
 *
 * B) typertGateway 的 SRC 接收器路径（manifest 缺席/未注册时的兜底）：
 *    网关遍历 ctx.reflect.props 找「带 typertRemote 绑定 + 原型方法标记」的 cordis
 *    服务来认领并派发 <namespace>/<method> 端点（extracted/dsh-api-gateway/lib/index.js
 *    :702-716 collectSrcClaims、:1008-1075 resolveSrcDescriptor、:1451-1464 绑定校验、
 *    :1465-1495 方法源码参数必须是唯一简单标识符）。协议包明确「已有其他基类时仍可
 *    改用 bindTypertRemote()」（api-gateway README §Host 服务）；本文件按
 *    protocol/lib/index.js 的 bindTypertRemote(:146-157) 与 mark(:248-268) 的落盘形状
 *    手写同一结构，不 import 协议包（绑定={service,serviceKey,namespace} 冻结对象；
 *    标记键为字符串常量 REMOTE_METHOD_DESCRIPTOR，协议 README 声明该键跨副本稳定）。
 *    注册动作 = ctx.provide(FACE_NAME, face)（cordis reflect.provide，登记即被
 *    ctx.effect 所在 fiber 持有，卸载自动撤销；attachHostWire 的 dispose 兜底再调一次）。
 *
 * 派发终点两路一致：网关 ctx.get('zcodeDispatch') 取 face 实例 → 调公开方法
 * （gateway lib/index.js:986-988）。客户端半边见 wire.client.mjs 与 client.js（内联
 * 传输层 + ctx.remote.$mount 自挂 remote.zcodeDispatch 子服务）。
 * 探测不到远端面时客户端逐级回退：外部数据源 → 内置 demo 引擎，绝不白屏。
 */
import { aggregate, fetchPlanQuota } from './core/quota.mjs';

/** UI / 工具 tail 的默认行数（任务包规定 30），上限受 dispatcher TAIL_CAP 约束。 */
export const TAIL_DEFAULT_LINES = 30;
/** Host→客户端推送节流：dispatcher 每解析一行都可能 emit，这里限频。 */
const PUSH_THROTTLE_MS = 300;
/** Remote 面服务名（官方惯例为小驼峰，如 pluginRegistryProbe / pluginManager）。 */
export const FACE_NAME = 'zcodeDispatch';
/** 宿主→客户端变更事件名（官方命名惯例："<区域>/<事件>"，如 plugin-manager/changed）。 */
export const EVENT_NAME = 'zcode-dispatch/changed';
/**
 * 协议包 Remote 方法标记的原型属性键（protocol/lib/index.js:135 的字符串常量，
 * 协议 README 声明其跨安装副本稳定；此处按值手写以免 import 协议包）。
 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';
/** snapshot() 里 channels 的缓存时长（任务包规定 5s）：通道清单靠 runner 子进程探测，昂贵。 */
const CHANNELS_TTL_MS = 5000;

const trunc = (s, n = 200) => {
  const str = s == null ? '' : String(s);
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

/**
 * 裁剪 job：UI 与工具结果只带展示字段；tailLines 只回条数（tail 动作按需取），
 * captureOut/captureErr（本进程捕获文件路径）不出网，parseWarnings 只留末 5 条。
 */
export function slimJob(job) {
  if (!job) return null;
  const { tailLines, captureOut, captureErr, parseWarnings, spec, usage, ...rest } = job;
  const bodyField = spec?.kind === 'task' ? 'task' : spec?.kind === 'target' ? 'target' : 'prompt';
  return {
    ...rest,
    spec: {
      kind: spec?.kind ?? null,
      body: trunc(spec?.[bodyField]),
      model: spec?.model ?? null,
      provider: spec?.provider ?? null,
      mode: spec?.mode ?? null,
      lock: spec?.lock ?? 'both',
      timeoutMin: spec?.timeoutMin ?? null,
      memoryBench: Boolean(spec?.memoryBench),
      tag: spec?.tag ?? null,
    },
    usage: { ...(usage ?? {}) },
    tailCount: Array.isArray(tailLines) ? tailLines.length : 0,
    parseWarnings: (parseWarnings ?? []).slice(-5),
  };
}

/** 用量聚合裁剪成 UI 需要的三窗口字段；ledger 不可用时返回 available:false，不抛错。 */
export function quotaWindows(ledgerPath) {
  if (!ledgerPath) return { available: false, reason: 'ledgerPath 未配置', windows: null };
  try {
    const agg = aggregate({ ledgerPath });
    const pick = (w) => ({
      runs: w.runs,
      requests: w.requests,
      inputTokens: w.inputTokens,
      outputTokens: w.outputTokens,
      cacheReadTokens: w.cacheReadTokens,
      totalTokens: w.totalTokens,
    });
    return {
      available: agg.available,
      generatedAt: agg.generatedAt,
      ledgerPath: agg.ledgerPath,
      skippedLines: agg.skippedLines,
      windows: {
        last5h: pick(agg.windows.last5h),
        week: pick(agg.windows.week),
        today: pick(agg.windows.today),
      },
    };
  } catch (e) {
    return { available: false, reason: e?.message ?? String(e), windows: null };
  }
}

/**
 * 动作处理器（唯一实现点；agent 工具与 Remote 面共用）。
 * @param {object|null} dispatcher createDispatcher() 实例；null 时所有动作返回可读错误
 * @param {object} config 插件 config（需要 ledgerPath 供 quota 动作使用）
 * @returns {(action: string, params?: object) => Promise<{ok: boolean, error?: string, [k: string]: unknown}>}
 */
export function createActionHandler(dispatcher, config = {}) {
  return async function handleAction(action, params = {}) {
    try {
      if (!dispatcher) {
        return { ok: false, error: 'dispatcher 未初始化：请在插件 config 配置 runnerPath 与 workRoot 后重载插件' };
      }
      const p = params && typeof params === 'object' ? params : {};
      switch (action) {
        case 'dispatch': {
          const spec = { kind: p.kind ?? 'prompt' };
          if (spec.kind === 'task') spec.task = p.task;
          else if (spec.kind === 'target') spec.target = p.target;
          else spec.prompt = p.prompt;
          for (const k of ['model', 'provider', 'mode', 'tag', 'cwd', 'resume']) {
            if (p[k] != null && p[k] !== '') spec[k] = p[k];
          }
          if (p.lock != null && p.lock !== '') spec.lock = p.lock;
          if (p.timeoutMin != null && p.timeoutMin !== '') spec.timeoutMin = Number(p.timeoutMin);
          if (p.memoryBench != null) spec.memoryBench = Boolean(p.memoryBench);
          const job = dispatcher.dispatch(spec); // 参数不合法时 core 抛 TypeError，走 catch 返回 error
          return { ok: true, job: slimJob(job) };
        }
        case 'list':
          return { ok: true, jobs: dispatcher.list().map(slimJob) };
        case 'kill': {
          const id = p.id ?? p.jobId;
          if (!id) return { ok: false, error: 'kill 需要参数 id' };
          const ok = dispatcher.kill(id, `kill requested via ${p.via ?? 'ui/tool'}`);
          return ok
            ? { ok: true, job: slimJob(dispatcher.get(id)) }
            : { ok: false, error: `kill 失败：job 不存在或已是终态（id=${id}）` };
        }
        case 'tail': {
          const id = p.id ?? p.jobId;
          if (!id) return { ok: false, error: 'tail 需要参数 id' };
          const n = Math.min(200, Math.max(1, Number(p.n) || TAIL_DEFAULT_LINES));
          const lines = dispatcher.tail(id, n);
          return lines == null ? { ok: false, error: `找不到 job：${id}` } : { ok: true, id, lines };
        }
        case 'quota': {
          const quota = quotaWindows(config.ledgerPath);
          let planQuota;
          try {
            planQuota = await fetchPlanQuota();
          } catch (e) {
            planQuota = { available: false, reason: e?.message ?? String(e) };
          }
          return { ok: true, quota, planQuota };
        }
        /* ---- Z6 增量动作：通道 / 续跑 / 降级链（既有动作语义不变） ---- */
        case 'channels': {
          const r = await dispatcher.listChannels();
          return { ok: true, channels: r.channels, warnings: r.warnings ?? [] };
        }
        case 'channel': {
          if (p.provider != null && p.provider !== '') {
            const channel = dispatcher.setChannel({ provider: p.provider, model: p.model ?? null });
            return { ok: true, channel };
          }
          return { ok: true, channel: dispatcher.getChannel() };
        }
        case 'retry': {
          const id = p.id ?? p.jobId;
          if (!id) return { ok: false, error: 'retry 需要参数 id' };
          const job = dispatcher.retry(id, { provider: p.provider, model: p.model ?? p.retryModel });
          return { ok: true, job: slimJob(job) };
        }
        case 'fallback': {
          if (p.chain !== undefined) {
            const list = Array.isArray(p.chain) ? p.chain : String(p.chain).split(',');
            dispatcher.setFallbackChain(list);
          }
          return { ok: true, ...dispatcher.getFallbackChain() };
        }
        default:
          return { ok: false, error: `未知 action：${action}（可用 dispatch|list|kill|tail|quota|channels|channel|retry|fallback）` };
      }
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  };
}

/**
 * Remote 面（任务包 Z7 §二.1 规定的方法面；动作实现在 createActionHandler 单点复用）。
 *
 * 返回形状约定：任务包给定了形状的方法严格照做（snapshot() 返回数据对象、
 * tail() 返回 string[]，出错时 reject Error——官方远端方法同样以 reject 表达失败）；
 * 未规定形状的动作方法统一 { ok:true, … } / { ok:false, error }（与 createActionHandler
 * 信封一致，JSON 可序列化）。
 *
 * Z8：face 从对象字面量改为类实例——网关 SRC 路径要求「原型上有方法」（方法标记
 * 挂原型、签名解析读 Function.prototype.toString），对象字面量没有独立原型。
 * 方法签名一律简单标识符参数（不得带默认值/解构/剩余参数，见 gateway
 * methodParameterNames 的 /^[$A-Z_a-z][$\w]*$/u 校验）；缺省语义移到方法体内。
 *
 * @param {object|null} dispatcher createDispatcher() 实例；null 时方法返回可读错误/reject
 * @param {object} config 插件 config（需要 ledgerPath 供 quota/quotaPlan 使用）
 */
export function createRemoteFace(dispatcher, config = {}) {
  const handleAction = createActionHandler(dispatcher, config);
  let channelsCache = null; // { at, value } —— listChannels 每次起 runner 子进程探测，缓存 5s
  const NOT_READY = 'dispatcher 未初始化：请在插件 config 配置 runnerPath 与 workRoot 后重载插件';

  async function channelsCached() {
    if (channelsCache && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.value;
    const r = await dispatcher.listChannels();
    const value = { channels: r?.channels ?? [], warnings: r?.warnings ?? [] };
    channelsCache = { at: Date.now(), value };
    return value;
  }

  /** 动作方法：透传 createActionHandler 信封（它已把一切异常折成 {ok:false,error}）。 */
  const viaAction = (action, params) => handleAction(action, params);

  /** 各方法的闭包实现（RemoteFace 类的方法体只做转发，保持签名可被 SRC 解析）。 */
  const impl = {
    async snapshot() {
      if (!dispatcher) throw new Error(NOT_READY);
      const snap = dispatcher.snapshot();
      const { channels } = await channelsCached();
      return { ...snap, jobs: snap.jobs.map(slimJob), channels };
    },
    async quota() {
      return { quota: quotaWindows(config.ledgerPath) };
    },
    async quotaPlan() {
      try {
        return { planQuota: await fetchPlanQuota() };
      } catch (e) {
        return { planQuota: { available: false, reason: e?.message ?? String(e) } };
      }
    },
    async channels() {
      if (!dispatcher) return { channels: [], warnings: [NOT_READY] };
      const c = await channelsCached();
      return { channels: c.channels, warnings: c.warnings };
    },
    async channel() {
      if (!dispatcher) throw new Error(NOT_READY);
      return dispatcher.getChannel();
    },
    async fallbackChain() {
      if (!dispatcher) throw new Error(NOT_READY);
      return dispatcher.getFallbackChain();
    },
    dispatch: (spec) => viaAction('dispatch', spec && typeof spec === 'object' ? spec : {}),
    kill: (id) => viaAction('kill', { id }),
    retry: (id, opts) => viaAction('retry', { id, ...(opts && typeof opts === 'object' ? opts : {}) }),
    async tail(id, n) {
      const r = await viaAction('tail', { id, n });
      if (!r.ok) throw new Error(r.error ?? `tail 失败（id=${id ?? ''}）`);
      return r.lines;
    },
    async setChannel(next) {
      if (!next || next.provider == null || next.provider === '') {
        return { ok: false, error: 'setChannel 需要 provider（读当前通道用 channel()）' };
      }
      return viaAction('channel', { provider: next.provider, model: next.model });
    },
    /**
     * setFallbackChain(list|null)：null/undefined = 清空降级链（core.setFallbackChain
     * 语义）；注意 createActionHandler 的 fallback 动作对 null chain 会误拆成 ["null"]，
     * 这里不走它、直调 core。
     */
    async setFallbackChain(list) {
      if (!dispatcher) return { ok: false, error: NOT_READY };
      try {
        const r = dispatcher.setFallbackChain(list == null ? [] : list);
        return { ok: true, ...r };
      } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
      }
    },
  };

  /**
   * face 类：原型供方法标记与签名解析，实例带 typertRemote 绑定
   * （协议 bindTypertRemote 的落盘形状：冻结的 {service, serviceKey, namespace}）。
   */
  class RemoteFace {
    constructor() {
      this.typertRemote = Object.freeze({ service: this, serviceKey: FACE_NAME, namespace: FACE_NAME });
    }
    /** → 快照数据对象（含 channels；jobs 已裁剪，不带本进程文件路径）。 */
    snapshot() { return impl.snapshot(); }
    /** → { quota } 本地台账三窗口（便宜，轮询安全）。 */
    quota() { return impl.quota(); }
    /** → { planQuota } 套餐剩余适配器（慢 ≈2s，客户端只在订阅开始取一次）。 */
    quotaPlan() { return impl.quotaPlan(); }
    /** → { channels, warnings } 通道清单（5s 缓存）。 */
    channels() { return impl.channels(); }
    /** → 当前默认通道数据对象（出错 reject）。 */
    channel() { return impl.channel(); }
    /** → { enabled, chain } 当前降级链（出错 reject）。 */
    fallbackChain() { return impl.fallbackChain(); }
    /** dispatch(spec) → { ok:true, job } | { ok:false, error }。 */
    dispatch(spec) { return impl.dispatch(spec); }
    /** kill(id) → { ok:true, job } | { ok:false, error }。 */
    kill(id) { return impl.kill(id); }
    /** retry(id, opts) → { ok:true, job } | { ok:false, error }。 */
    retry(id, opts) { return impl.retry(id, opts); }
    /** tail(id, n) → string[]（找不到 job 时 reject Error）。 */
    tail(id, n) { return impl.tail(id, n); }
    /** setChannel(next) → { ok:true, channel } | { ok:false, error }。 */
    setChannel(next) { return impl.setChannel(next); }
    /** setFallbackChain(list|null) → { ok:true, enabled, chain } | { ok:false, error }。 */
    setFallbackChain(list) { return impl.setFallbackChain(list); }
  }

  // 方法标记写原型（协议 mark() 的落盘形状：版本化冻结描述符，键跨副本稳定）；
  // typertGateway 的 collectSrcClaims/resolveSrcDescriptor 靠它认领并派发端点。
  Object.defineProperty(RemoteFace.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(REMOTE_METHODS.map((method) => Object.freeze({
        method,
        invocation: Object.freeze({ kind: 'direct' }),
      }))),
    }),
  });

  return new RemoteFace();
}

/** face 方法面（标记/描述符/文档共用这一份表）：[方法名, 参数名数组, 签名, 结果说明]。 */
const REMOTE_METHODS = ['snapshot', 'dispatch', 'kill', 'retry', 'tail', 'setChannel', 'setFallbackChain', 'quota', 'quotaPlan', 'channels', 'channel', 'fallbackChain'];

const FACE_METHOD_TABLE = [
  ['snapshot', [], 'snapshot(): Promise<snapshot>', '快照数据对象 {generatedAt, counts, locks, queue, jobs[], channels[], workRoot, maxConcurrent}', []],
  ['dispatch', ['spec'], 'dispatch(spec): Promise<{ok, job}|{ok:false, error}>', '{ok:true, job}|{ok:false, error}', []],
  ['kill', ['id'], 'kill(id): Promise<{ok, job}|{ok:false, error}>', '{ok:true, job}|{ok:false, error}', []],
  ['retry', ['id', 'opts'], 'retry(id, opts?): Promise<{ok, job}|{ok:false, error}>', '{ok:true, job}|{ok:false, error}', ['opts']],
  ['tail', ['id', 'n'], 'tail(id, n?): Promise<string[]>', 'string[]（reject Error 表示 job 不存在）', ['n']],
  ['setChannel', ['next'], 'setChannel(next): Promise<{ok, channel}|{ok:false, error}>', '{ok:true, channel}|{ok:false, error}', ['next']],
  ['setFallbackChain', ['list'], 'setFallbackChain(list?): Promise<{ok, enabled, chain}|{ok:false, error}>', '{ok:true, enabled, chain}|{ok:false, error}（null=清空）', ['list']],
  ['quota', [], 'quota(): Promise<{quota}>', '{quota} 本地台账三窗口', []],
  ['quotaPlan', [], 'quotaPlan(): Promise<{planQuota}>', '{planQuota} 套餐剩余适配器（慢，客户端低频取）', []],
  ['channels', [], 'channels(): Promise<{channels, warnings}>', '{channels, warnings}（5s 缓存）', []],
  ['channel', [], 'channel(): Promise<channel>', '当前通道数据对象', []],
  ['fallbackChain', [], 'fallbackChain(): Promise<{enabled, chain}>', '{enabled, chain}', []],
];

/**
 * 透传 codec 工厂产物：face 的边界契约就是「JSON 可序列化」——宿主网关 strict 解码
 * 调 create().parse(value) 后仍做 JSON 安全断言（gateway decode→assertJsonValue），
 * 透传 parse + 网关断言合起来即真实契约。无 zod/schemastery 依赖（任务包约束），
 * 不提供 encode/decode（缺省即原样透传，与官方 JSON 结果路径一致）。
 */
const JSON_ANY = Object.freeze({ parse: (value) => value });

/** strict codec（loader/lib/index.js:206-211 与 registry validateCodec 的必需字段）。 */
const strictCodec = (method, field) => ({
  mode: 'strict',
  typeSymbol: `@local/zcode-dispatch#${FACE_NAME}/${method}:${field}`,
  create: () => JSON_ANY,
});

/**
 * 宿主 face 模型描述符（exports["./typert"]；dsh-typert-loader 自动发现并
 * ctx.typert.register —— 见文件头 A 路径）。字段形态对齐官方产物
 * refs/dsh-plugin-manager/lib/typert.host.js，差异仅两处、均为依赖约束所致：
 * ① codec.create 返回透传校验器（无 zod；见 JSON_ANY 注释）；
 * ② 可选参数带 acceptsUndefined:true（网关 assertExactArguments 据此允许缺参，
 *    registry/loader 对 JSON 参数均允许该字段）。
 */
export const TYPERT = {
  package: '@local/zcode-dispatch',
  face: 'host',
  generator: 'hand-written (Z8)：无 typert 生成器与 zod 依赖；strict codec 用透传校验器，字段形态对齐官方产物',
  service: FACE_NAME,
  schemas: [],
  invocations: FACE_METHOD_TABLE.map(([method, parameters, , resultNote, optionals]) => ({
    id: `@local/zcode-dispatch#${FACE_NAME}/${method}`,
    service: FACE_NAME,
    namespace: FACE_NAME,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map((name) => ({
      name,
      wire: name,
      source: 'json',
      ...(optionals.includes(name) ? { acceptsUndefined: true } : {}),
      codec: strictCodec(method, name),
    })),
    result: strictCodec(method, 'result'),
  })),
  model: {
    services: [
      {
        description: 'ZCode 派发台远端面：派发/监视 ZCode 无头进程，通道/降级链/用量查询（与 agent 工具 zcode_dispatch 同一动作实现）。',
        summary: 'ZCode 派发台远端面（与 agent 工具同一动作实现）。',
        tags: [],
        key: FACE_NAME,
        exportName: 'createRemoteFace',
        members: FACE_METHOD_TABLE.map(([method, parameters, signature]) => ({
          kind: 'method',
          name: method,
          signature,
        })),
        types: [],
      },
    ],
    events: [
      {
        name: EVENT_NAME,
        signature: '() => void',
        description: '快照变更推送（尽力而为）：宿主侧转发事件依赖装配级事件源，未接通时客户端以 1s 轮询兜底。',
        tags: [],
      },
    ],
    objects: [],
  },
};


/**
 * 把推送能力与 Remote 面装到 Host ctx 上，并把 face 注册为 cordis 服务
 * （typertGateway SRC 路径的接收器；文件头 B 路径）。
 * @returns {{ handleAction, subscribe, getSnapshot, dispose, face, registered }}
 *   - face：createRemoteFace() 产物（RemoteFace 实例；registry/SRC 两路派发的同一终点）
 *   - subscribe(fn)：fn 收到 { snapshot, quota }；订阅即回一份当前态，返回退订函数
 *   - registered：face 是否已注册为 cordis 服务（false = ctx 上无 provide，如测试桩）
 *   - dispose()：插件卸载时由 index.js 的 ctx.effect 调用
 */
export function attachHostWire(ctx, dispatcher, config = {}) {
  const handleAction = createActionHandler(dispatcher, config);
  const face = createRemoteFace(dispatcher, config);

  /* ---- 最后一跳·宿主侧：face 注册为 cordis 服务 `zcodeDispatch` ----
   * ctx.provide 即官方注册口（cordis reflect.provide：登记进共享 props 表、
   * 实现由当前 fiber 的 effect 持有，插件卸载自动撤销）。provide 缺席/重名时
   * 降级为仅进程内 face（agent 工具不受影响，远端面不可达 → 客户端走 demo）。 */
  let disposeProvide = null;
  try {
    if (ctx && typeof ctx.provide === 'function') {
      disposeProvide = ctx.provide(FACE_NAME, face) ?? null;
    }
  } catch {
    disposeProvide = null; // 服务名已被占用等注册失败：不抛、不白屏，走降级
  }

  const subscribers = new Set();
  let latestSnapshot = null;
  let latestQuota = null;
  let pending = false;
  let timer = null;

  const publish = () => {
    pending = false;
    timer = null;
    if (subscribers.size === 0) return;
    latestQuota = quotaWindows(config.ledgerPath); // 节流点才算一次，避免每行输出都读台账
    const bundle = { snapshot: latestSnapshot, quota: latestQuota };
    for (const fn of subscribers) {
      try {
        fn(bundle);
      } catch { /* 单个订阅者异常不影响其他订阅者 */ }
    }
  };

  const schedulePublish = () => {
    if (pending || subscribers.size === 0) return;
    pending = true;
    timer = setTimeout(publish, PUSH_THROTTLE_MS);
  };

  const unsubscribeDispatcher = dispatcher
    ? dispatcher.subscribe((ev) => {
        if (ev?.type === 'queue-changed') {
          schedulePublish();
          return;
        }
        latestSnapshot = dispatcher.snapshot();
        schedulePublish();
      })
    : null;

  return {
    handleAction,
    face,
    registered: disposeProvide != null,
    subscribe(fn) {
      if (typeof fn !== 'function') throw new TypeError('subscribe(fn): fn 必须是函数');
      subscribers.add(fn);
      if (latestSnapshot == null && dispatcher) latestSnapshot = dispatcher.snapshot();
      try {
        fn({ snapshot: latestSnapshot, quota: latestQuota ?? quotaWindows(config.ledgerPath) });
      } catch { /* 与 emit 一致：单个订阅者异常不影响订阅关系与其他订阅者 */ }
      return () => subscribers.delete(fn);
    },
    getSnapshot() {
      if (latestSnapshot == null && dispatcher) latestSnapshot = dispatcher.snapshot();
      return latestSnapshot;
    },
    dispose() {
      try {
        disposeProvide?.(); // fiber effect 之外的双保险；幂等
      } catch { /* 已撤销 */ }
      disposeProvide = null;
      unsubscribeDispatcher?.();
      subscribers.clear();
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}
