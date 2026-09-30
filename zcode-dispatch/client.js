/**
 * @local/zcode-dispatch —— Client 半边：DSH Web 页面里的「ZCode 派发台」悬浮窗。
 * 纯 JS + React.createElement（无构建 / 无 JSX / 无 npm 依赖）；唯一外部模块为 react（经宿主模块表注入）。
 *
 * 行为：右下角贴边悬浮窗，标题栏可拖拽（pointer events），可折叠，可最小化为圆角小胶囊；
 * 位置/尺寸/折叠态存 localStorage（key 带插件前缀）。五个分区：通道（切换器+降级链）/
 * 派发栏 / 进程列表（含 paused 暂停态与同通道续跑/换通道交接重跑）/ 用量卡片 / 单写者状态。
 * 样式仅走主题令牌（--dsw-alias-* / --dsw-shadow-* / --ds-font-family-code，集中在 TOKENS 常量，
 * 见下），不 import 任何 DSH 宿主客户端包，不碰宿主 body 节点，卸载时清理监听器与定时器。
 *
 * Z6 语义（用户可见口径）：**换通道=交接重跑**——新开会话，把原任务与中断点交接过去；
 * 同通道且有会话才是原会话续跑（--resume，不带 --model）。不可用通道只如实标注，不假装能切。
 *
 * 接线状态（Z8 全接通）：本模块在 apply 里用官方公开 API ctx.remote.$mount() 挂载
 * remote.zcodeDispatch 子服务（描述符与 wire.client.mjs 的 TYPERT_REMOTE 同源），
 * 内嵌同源远端传输层调用 ctx.remote.zcodeDispatch.<方法>()。宿主侧 face 已注册为
 * cordis 服务（wire.host.mjs，ctx.provide + exports["./typert"] 经 typert-loader 注册）。
 * 远端缺席/挂载失败时逐级回退：window 外部数据源 → 内置 demo 引擎，绝不白屏。
 *
 * 真数据 vs demo 判据（面板标题栏徽标，connLabel）：
 * - 「已连接」（conn='live'）：数据来自 ctx.remote.zcodeDispatch 远端面——真 ZCode
 *   子进程与真用量台账（宿主 face 已注册时才有）；
 * - 「外部数据」（conn='ext'）：window.__zcodeDispatchDemo 注入的外部数据源；
 * - 「演示数据」（conn='demo'）：内置演示引擎（纯前端假数据）；
 * - 「连接中」：尚未收到任何数据包（连接建立前的一次渲染）。
 */
window.__ModuleLoader__.load({
  id: '@local/zcode-dispatch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    /* ─────────────── 槽位 ───────────────
     * shell.overlay 已从客户端 bundle 实证存在（详见 refs/dsh-slots.md）：
     * 声明于 dsh-client-ui-layout 的 root children 表 { kind:'list', scope:'root' }，
     * 由 AppFrame 渲染进专用 overlayLayer 图层；chat / plugin-manager / workspace
     * 三个官方包共 6 处先例都注册在此（list 型 → 注册必须带 id，order 参与排序）。 */
    const SLOT = 'shell.overlay';

    const LS = {
      pos: 'zcode-dispatch:panel:pos:v1', // 悬浮位置 {left, top}
      size: 'zcode-dispatch:panel:size:v1', // 宽度 {width}
      collapsed: 'zcode-dispatch:panel:collapsed:v1', // 折叠态 true/false
    };
    // z-index 仅约束浮层自身的层级（不写全局样式、不碰宿主 DOM），取固定较大值避免被页面浮层盖住
    const Z_INDEX = 2000000000;
    const WIDTH = { min: 320, max: 600, def: 440 };
    const EDGE = 8; // 拖拽时与视口边缘的最小间距

    /* ─────────────── TOKENS：主题令牌唯一出口 ───────────────
     * 纪律：JS 内零字面色值（#…），全部走主题令牌；每个值带同族回退链，
     * 最终回退只允许 currentColor / transparent / inherit 等关键字。
     * 全部令牌名已与 dsh-client-ui-theme 的权威调色板逐一核对（差集与映射见
     * refs/dsh-theme-tokens.md）：文本族真名是 --dsw-alias-label-*，边框是
     * -border-l1..l4，状态色是 -state-*-primary，阴影是 --dsw-shadow-lv3，
     * 代码字体是 --ds-font-family-code（--ds- 前缀，非 --dsw-alias-）。 */
    const T = {
      bg: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, inherit))',
      bgBar: 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, inherit))',
      sunken: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1, transparent))',
      hover: 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-3, transparent))',
      accent: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, currentColor))',
      onAccent: 'var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-1, inherit))',
      border: 'var(--dsw-alias-border-l2, var(--dsw-alias-border-l1, transparent))',
      shadow: 'var(--dsw-shadow-lv3, 0 10px 28px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.10))',
      text: 'var(--dsw-alias-label-primary, currentColor)',
      text2: 'var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, currentColor))',
      text3: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, currentColor))',
      danger: 'var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary, currentColor))',
      mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)',
      // 六态状态点（回退链保证降级可见；状态色族真名 --dsw-alias-state-*-primary）
      stQueued: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, currentColor))',
      stRunning: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-label-primary, currentColor))',
      stDone: 'var(--dsw-alias-state-success-primary, var(--dsw-alias-label-primary, currentColor))',
      stFailed: 'var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary, currentColor))',
      stKilled: 'var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-primary, currentColor))',
      stInterrupted: 'var(--dsw-alias-state-idle-primary, var(--dsw-alias-label-tertiary, currentColor))',
      stIdle: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, currentColor))',
      // Z6：paused 状态点用 warn-secondary（与 killed 的 warn-primary 区分），原因徽章用 warn-label
      stPaused: 'var(--dsw-alias-state-warn-secondary, var(--dsw-alias-state-warn-primary, currentColor))',
      warnLabel: 'var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary, currentColor))',
    };

    /* 样式：作为 React 元素渲染进组件树，组件卸载即随之移除（不碰全局样式表）。 */
    const CSS = [
      '.zcd-root{position:fixed;z-index:' + Z_INDEX + ';width:min(var(--zcd-w,' + WIDTH.def + 'px),calc(100vw - 32px));font-size:12px;line-height:1.5;color:' + T.text + ';}',
      '.zcd-root.zcd-min{width:auto;}',
      '.zcd-panel{display:flex;flex-direction:column;max-height:min(72vh,560px);background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:10px;box-shadow:' + T.shadow + ';overflow:hidden;animation:zcd-in .18s ease;}',
      '.zcd-titlebar{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;border-bottom:1px solid var(--zcd-border);background:' + T.bgBar + ';}',
      '.zcd-titlebar:active{cursor:grabbing;}',
      '.zcd-title{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.zcd-conn{flex:none;font-size:10px;line-height:1.6;padding:0 6px;border:1px solid ' + T.border + ';border-radius:8px;color:' + T.text2 + ';}',
      '.zcd-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:5px;background:transparent;color:' + T.text2 + ';cursor:pointer;transition:background-color .15s ease,color .15s ease;}',
      '.zcd-iconbtn:hover{background:' + T.hover + ';color:' + T.text + ';}',
      '.zcd-body{display:flex;flex-direction:column;gap:8px;padding:8px;overflow:auto;min-height:0;overscroll-behavior:contain;}',
      '.zcd-sec{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid ' + T.border + ';border-radius:8px;min-width:0;}',
      '.zcd-sec-title{font-size:11px;font-weight:600;letter-spacing:.02em;color:' + T.text2 + ';}',
      '.zcd-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.zcd-label{color:' + T.text2 + ';white-space:nowrap;}',
      '.zcd-select,.zcd-input,.zcd-ta{background:' + T.sunken + ';color:' + T.text + ';border:1px solid ' + T.border + ';border-radius:6px;padding:3px 6px;font:inherit;outline:none;transition:border-color .15s ease;}',
      '.zcd-select:focus,.zcd-input:focus,.zcd-ta:focus{border-color:' + T.text3 + ';}',
      '.zcd-ta{width:100%;min-height:52px;resize:vertical;}',
      '.zcd-btn{display:inline-flex;align-items:center;padding:4px 14px;border:none;border-radius:6px;background:' + T.accent + ';color:' + T.onAccent + ';font:inherit;font-weight:600;cursor:pointer;transition:filter .15s ease,transform .05s ease;}',
      '.zcd-btn:hover{filter:brightness(1.08);}',
      '.zcd-btn:active{transform:translateY(1px);}',
      '.zcd-btn:disabled{opacity:.5;cursor:default;}',
      '.zcd-feedback{min-height:15px;font-size:11px;color:' + T.text2 + ';}',
      '.zcd-feedback.zcd-err{color:' + T.danger + ';}',
      '.zcd-jobs{display:flex;flex-direction:column;gap:6px;}',
      '.zcd-empty{color:' + T.text3 + ';}',
      '.zcd-job{border:1px solid ' + T.border + ';border-radius:6px;padding:4px 6px;}',
      '.zcd-job-head{display:flex;align-items:center;gap:6px;min-height:20px;flex-wrap:wrap;}',
      '.zcd-job-tag{font-weight:600;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.zcd-dim{color:' + T.text3 + ';white-space:nowrap;}',
      '.zcd-spring{flex:1;}',
      '.zcd-badge{flex:none;font-size:10px;line-height:1.5;padding:0 4px;border:1px solid ' + T.border + ';border-radius:4px;color:' + T.text2 + ';white-space:nowrap;}',
      '.zcd-dot{flex:none;width:8px;height:8px;border-radius:50%;background:' + T.stIdle + ';}',
      '.zcd-dot.s-queued{background:' + T.stQueued + ';}',
      '.zcd-dot.s-running{background:' + T.stRunning + ';animation:zcd-pulse 1.2s ease-in-out infinite;}',
      '.zcd-dot.s-done{background:' + T.stDone + ';}',
      '.zcd-dot.s-failed{background:' + T.stFailed + ';}',
      '.zcd-dot.s-killed{background:' + T.stKilled + ';}',
      '.zcd-dot.s-interrupted{background:' + T.stInterrupted + ';}',
      '.zcd-dot.s-paused{background:' + T.stPaused + ';animation:zcd-pulse 2.4s ease-in-out infinite;}',
      '.zcd-badge.s-paused{color:' + T.warnLabel + ';border-color:' + T.warnLabel + ';}',
      '.zcd-btn2{display:inline-flex;align-items:center;padding:3px 10px;border:1px solid ' + T.border + ';border-radius:6px;background:transparent;color:' + T.text2 + ';font:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease;}',
      '.zcd-btn2:hover{background:' + T.hover + ';color:' + T.text + ';border-color:' + T.text3 + ';}',
      '.zcd-btn2:disabled{opacity:.45;cursor:default;}',
      '.zcd-btn2:active{transform:translateY(1px);}',
      '.zcd-note{font-size:10.5px;color:' + T.text3 + ';white-space:normal;overflow-wrap:anywhere;}',
      '.zcd-chain{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}',
      '.zcd-tailwrap{margin-top:4px;}',
      '.zcd-mono{max-height:140px;overflow:auto;padding:4px;background:' + T.sunken + ';border-radius:4px;font-family:' + T.mono + ';font-size:10.5px;white-space:pre-wrap;word-break:break-all;}',
      '.zcd-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:6px;}',
      '.zcd-card{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid ' + T.border + ';border-radius:6px;}',
      '.zcd-card-title{font-size:10px;font-weight:600;color:' + T.text2 + ';}',
      '.zcd-kv{display:flex;justify-content:space-between;gap:6px;font-size:10.5px;min-width:0;}',
      '.zcd-kv-k{color:' + T.text3 + ';}',
      '.zcd-planline{margin-top:2px;font-size:10.5px;color:' + T.text3 + ';white-space:normal;overflow-wrap:anywhere;line-height:1.45;}',
      '.zcd-grip{position:absolute;left:0;bottom:0;width:16px;height:16px;cursor:ew-resize;}',
      '.zcd-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid ' + T.border + ';border-radius:999px;background:' + T.bg + ';color:' + T.text + ';box-shadow:' + T.shadow + ';cursor:pointer;font:inherit;transition:transform .15s ease;}',
      '.zcd-pill:hover{transform:translateY(-1px);}',
      '@keyframes zcd-in{from{opacity:0;transform:translateY(6px) scale(.98);}}',
      '@keyframes zcd-pulse{50%{opacity:.35;}}',
    ].join('\n');

    /* ─────────────── 文案（与 locale/zh.json、locale/en.json 的 ui 段同源；接线后可改走宿主 locale 服务） ─────────────── */
    const STRINGS = {
      zh: {
        title: 'ZCode 派发台',
        connConnecting: '连接中', connDemo: '演示数据', connExt: '外部数据', connLive: '已连接',
        collapse: '折叠 / 展开', minimize: '最小化为胶囊', restore: '展开派发台', grip: '拖拽调整宽度',
        secDispatch: '派发', secJobs: '进程', secQuota: '用量', secLocks: '单写者',
        kind: '类型', kindPrompt: '提示词', kindTask: '任务文件', kindTarget: '目标',
        phPrompt: '输入要发给 ZCode 的提示词…', phTask: '任务文件绝对路径…', phTarget: '要达成的目标…',
        model: '模型', provider: '通道', providerPlan: '套餐', providerPersonal: '个人 Key',
        mode: '模式', timeout: '超时(分)', bench: '--memory-bench',
        dispatch: '派发', queuedBtn: '排队中…', runningBtn: '执行中…', sending: '提交中…',
        fbQueued: '已排队：', errPrefix: '失败：', errEmpty: '请先填写内容',
        content: '内容', noJobs: '暂无进程记录', exit: '退出', kill: '终止', tail: '输出', tailLoading: '读取中…', tailEmpty: '（无输出）',
        usage5h: '5 小时窗口', usageWeek: '本周', usageToday: '今日',
        runs: 'run 数', requests: '请求', inTok: '输入', outTok: '输出', cacheTok: '缓存读',
        localNote: '本地用量（可核对）：台账聚合的 5 小时 / 本周 / 今日窗口',
        engineWeekUsed: '引擎本周已用（引擎本地库合计，非套餐已用）',
        planQuotaPending: '套餐剩余额度：未接入 —— CLI RPC 面无此方法（app-server usage/stats 语义是「本地已用」）；以 ZCode 客户端为准',
        repoLock: 'repo 锁', memoryLock: 'memory 锁', queueLen: '队列', idle: '空闲', lockHeld: '持有单写者锁',
        secChannel: '通道', chanNewTask: '新任务将使用：', chanDisabled: '不可用', chanLoadFail: '通道清单加载失败',
        chanDefaultModel: '（通道默认模型）',
        paused: '已暂停', pQuota: '额度耗尽', pEntitled: '未开通', pSigning: '需签名', pConfig: '配置错误', pUnknown: '未知原因',
        resumeSame: '同通道续跑', retryHandoff: '换通道重跑', noSession: '无会话，不能同通道续跑',
        handoffConfirm: '换通道=交接重跑：会新开会话并把未完成部分交接过去', confirmHandoff: '确认交接重跑', cancel: '取消',
        parentFrom: '接续自', hop: '跳',
        fallbackTitle: '自动降级链', fallbackStateOff: '关', fallbackStateOn: '开',
        fallbackPh: '通道 id，逗号分隔，按顺序', fallbackSave: '开启降级链', fallbackOffBtn: '关闭降级链',
        fallbackConfirm2: '再次点击确认：会自动消耗下游通道额度', fallbackSaved: '降级链已更新：', fallbackEmptyErr: '请先填写至少一个通道 id',
      },
      en: {
        title: 'ZCode Dispatch Console',
        connConnecting: 'connecting', connDemo: 'demo data', connExt: 'external', connLive: 'live',
        collapse: 'Collapse / Expand', minimize: 'Minimize to pill', restore: 'Restore console', grip: 'Drag to resize width',
        secDispatch: 'Dispatch', secJobs: 'Processes', secQuota: 'Usage', secLocks: 'Single writer',
        kind: 'Kind', kindPrompt: 'Prompt', kindTask: 'Task file', kindTarget: 'Target',
        phPrompt: 'Prompt to send to ZCode…', phTask: 'Absolute path of task file…', phTarget: 'Goal to achieve…',
        model: 'Model', provider: 'Channel', providerPlan: 'Plan', providerPersonal: 'Personal key',
        mode: 'Mode', timeout: 'Timeout (min)', bench: '--memory-bench',
        dispatch: 'Dispatch', queuedBtn: 'Queued…', runningBtn: 'Running…', sending: 'Sending…',
        fbQueued: 'Queued: ', errPrefix: 'Failed: ', errEmpty: 'Content is required',
        content: 'Content', noJobs: 'No process records yet', exit: 'exit', kill: 'Kill', tail: 'Tail', tailLoading: 'Loading…', tailEmpty: '(no output)',
        usage5h: '5h window', usageWeek: 'This week', usageToday: 'Today',
        runs: 'runs', requests: 'req', inTok: 'in', outTok: 'out', cacheTok: 'cache',
        localNote: 'Local usage (verifiable): ledger-aggregated 5h / week / today windows',
        engineWeekUsed: 'Engine week used (engine-local DB total, not plan usage)',
        planQuotaPending: 'Plan quota remaining: not wired — no such method on the CLI RPC surface (app-server usage/stats is local-used only); defer to the ZCode client',
        repoLock: 'repo lock', memoryLock: 'memory lock', queueLen: 'queue', idle: 'idle', lockHeld: 'holds the single-writer lock',
        secChannel: 'Channels', chanNewTask: 'New tasks will use: ', chanDisabled: 'unavailable', chanLoadFail: 'Failed to load channels',
        chanDefaultModel: '(channel default model)',
        paused: 'Paused', pQuota: 'Quota exhausted', pEntitled: 'Not entitled', pSigning: 'Signing required', pConfig: 'Config error', pUnknown: 'Unknown',
        resumeSame: 'Resume (same channel)', retryHandoff: 'Rerun on new channel', noSession: 'No session to resume',
        handoffConfirm: 'Channel switch = handoff rerun: a new session starts and the unfinished part is handed over', confirmHandoff: 'Confirm handoff', cancel: 'Cancel',
        parentFrom: 'continued from', hop: 'hop',
        fallbackTitle: 'Auto fallback chain', fallbackStateOff: 'Off', fallbackStateOn: 'On',
        fallbackPh: 'Channel ids, comma separated, in order', fallbackSave: 'Enable fallback', fallbackOffBtn: 'Disable fallback',
        fallbackConfirm2: 'Click again to confirm: downstream channel quota will be consumed', fallbackSaved: 'Fallback chain updated: ', fallbackEmptyErr: 'At least one channel id is required',
      },
    };
    const LANG = (() => {
      let s = 'zh';
      try {
        s = (typeof navigator !== 'undefined' && navigator.language) || (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'zh';
      } catch { /* 保留默认 */ }
      return String(s).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    })();
    const t = (k) => STRINGS[LANG][k] ?? STRINGS.zh[k] ?? k;

    /* ─────────────── 小工具 ─────────────── */
    const loadJson = (key, fallback) => {
      try {
        const v = window.localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback; // 隐私模式 / 被禁用：用默认值
      }
    };
    const saveJson = (key, value) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch { /* 写不进就算了 */ }
    };
    const clampWidth = (n) => Math.min(WIDTH.max, Math.max(WIDTH.min, Number(n) || WIDTH.def));
    const fmtTokens = (n) => {
      if (n == null) return '—';
      if (n < 1000) return String(n);
      if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 2 : 1)}k`;
      return `${(n / 1000000).toFixed(2)}M`;
    };
    const fmtSec = (s) => (s == null ? '—' : `${Number(s).toFixed(1)}s`);
    const shortId = (id) => (id ? String(id).slice(0, 12) : '—');
    const ctxPct = (j) => (j && j.contextUsed != null && j.contextWindow ? `${Math.round((j.contextUsed / j.contextWindow) * 100)}%` : '—');

    /* apply(ctx) 捕获的客户端 ctx：createWire 用它探测远端面（模块级唯一；
     * apply 先于组件挂载执行，浅渲染等无 ctx 场景保持 null = 远端缺席 → 降级）。 */
    let MOD_CTX = null;

    /* ─────────────── 远端面传输层（Z8 接线段；同源实现：wire.client.mjs）───────────────
     * 官方调用链（证据见 tasks/Z8-delivery.md）：client 模块 inject 声明 "remote" 后，
     * apply 里 ctx.remote.$mount({package, descriptors}) 挂出 remote.zcodeDispatch
     * 子服务（官方包由 dsh 构建期内联进 api-remotes 聚合，第三方本地包须自挂——
     * extracted/dsh-api-remotes/lib/client.js:13513-13538 与 api-gateway client
     * $mount 的公开形态）。调用 ctx.remote.zcodeDispatch.<方法>(...) 返回
     * { ok:true, value } / { ok:false, error }（业务/载体失败折进 error 分支，
     * 绝不 reject——extracted/dsh-api-gateway/lib/client.js:1786-1806）。 */
    const REMOTE_POLL_MS = 1000;
    const REMOTE_JSON_ANY = Object.freeze({ parse: (value) => value });
    // 与 wire.host.mjs FACE_METHOD_TABLE 同源：[方法, 参数, 可选参数]
    const REMOTE_METHOD_TABLE = [
      ['snapshot', [], []],
      ['dispatch', ['spec'], []],
      ['kill', ['id'], []],
      ['retry', ['id', 'opts'], ['opts']],
      ['tail', ['id', 'n'], ['n']],
      ['setChannel', ['next'], ['next']],
      ['setFallbackChain', ['list'], ['list']],
      ['quota', [], []],
      ['quotaPlan', [], []],
      ['channels', [], []],
      ['channel', [], []],
      ['fallbackChain', [], []],
    ];
    const remoteCodec = (method, field) => ({
      mode: 'strict',
      typeSymbol: `@local/zcode-dispatch#zcodeDispatch/${method}:${field}`,
      create: () => REMOTE_JSON_ANY,
    });
    // $mount 贡献项（客户端注册表校验要求 strict codec 字段齐备；acceptsUndefined
    // 允许 JSON 可选参数缺参——网关 assertExactArguments 按它放行）
    const REMOTE_CONTRIBUTION = {
      package: '@local/zcode-dispatch',
      descriptors: REMOTE_METHOD_TABLE.map(([method, params, optionals]) => ({
        id: `@local/zcode-dispatch#zcodeDispatch/${method}`,
        service: 'zcodeDispatch',
        namespace: 'zcodeDispatch',
        method,
        invocation: { kind: 'direct' },
        parameters: params.map((name) => ({
          name,
          wire: name,
          source: 'json',
          ...(optionals.includes(name) ? { acceptsUndefined: true } : {}),
          codec: remoteCodec(method, name),
        })),
        result: remoteCodec(method, 'result'),
      })),
    };

    /** 探测 ctx 上的远端面子服务；有 snapshot() 即视为可用。 */
    function resolveRemote(ctx) {
      const svc = ctx?.remote?.zcodeDispatch ?? ctx?.remote?.['zcode-dispatch'];
      if (!svc || typeof svc.snapshot !== 'function') return null;
      const call = async (method, ...args) => {
        if (typeof svc[method] !== 'function') throw new Error(`远端面缺少方法 ${method}()`);
        const raw = await svc[method](...args);
        // 官方代理把返回值包成 { ok, value } / { ok:false, error }；本进程直连 face
        // 是域形状。有 value 键才按信封拆包（判据：boolean ok + own value 键）。
        if (raw && typeof raw === 'object' && typeof raw.ok === 'boolean' && 'value' in raw) {
          return raw.ok ? raw.value : { ok: false, error: raw.error?.message ?? String(raw.error ?? 'remote error') };
        }
        return raw;
      };
      return { call };
    }

    /** 远端数据源 wire（conn='live'，真数据）：1s 轮询快照 + $on 抢答，动作与 face 同形。 */
    function remoteWire(ctx, remote) {
      const subs = new Set();
      const emit = (bundle) => {
        for (const fn of subs) {
          try {
            fn(bundle);
          } catch { /* 订阅者异常不影响其他 */ }
        }
      };
      let pollTimer = null;
      let pushOff = null;
      let planQuota = null;
      let planTried = false;
      // 套餐剩余适配器慢（≈2s 起子进程）：每次 wire 生命周期只取一次，随下一个 tick 进包
      const refreshPlan = async () => {
        planTried = true;
        try {
          const r = await remote.call('quotaPlan');
          planQuota = r?.planQuota ?? null;
        } catch {
          planQuota = { available: false, reason: 'quotaPlan 调用失败' };
        }
      };
      const tick = async () => {
        try {
          const snapshot = await remote.call('snapshot');
          let quota = null;
          try {
            quota = (await remote.call('quota'))?.quota ?? null;
          } catch { /* 用量失败不挡快照 */ }
          emit({ conn: 'live', snapshot, quota, planQuota });
        } catch (e) {
          // 远端抖动：发一包空快照让 UI 渲染空态，绝不抛出、绝不白屏
          emit({ conn: 'live', snapshot: null, quota: null, planQuota, error: e?.message ?? String(e) });
        }
      };
      /* 与宿主 face 同形的调用（一一对应；错误照 face 契约 reject/折信封） */
      const face = {
        snapshot: () => remote.call('snapshot'),
        quota: () => remote.call('quota'),
        quotaPlan: () => remote.call('quotaPlan'),
        channels: () => remote.call('channels'),
        channel: () => remote.call('channel'),
        fallbackChain: () => remote.call('fallbackChain'),
        dispatch: (spec) => remote.call('dispatch', spec && typeof spec === 'object' ? spec : {}),
        kill: (id) => remote.call('kill', id),
        retry: (id, opts) => remote.call('retry', id, opts && typeof opts === 'object' ? opts : {}),
        tail: (id, n) => remote.call('tail', id, n),
        setChannel: (next) => remote.call('setChannel', next && typeof next === 'object' ? next : {}),
        setFallbackChain: (list) => remote.call('setFallbackChain', list == null ? null : list),
      };
      // 旧接口（UI 信封：永不 reject）。别名方法不能在对象字面量里互相引用方法名
      // （属性不是作用域绑定，pitfalls Z7-1），先落局部函数。
      const errOf = (e) => ({ ok: false, error: e?.message ?? String(e) });
      const channelSetImpl = async (c = {}) => {
        try {
          return await face.setChannel(c);
        } catch (e) {
          return errOf(e);
        }
      };
      const fallbackSetImpl = async (chain) => {
        try {
          return await face.setFallbackChain(chain ?? null);
        } catch (e) {
          return errOf(e);
        }
      };
      const stopPush = () => {
        if (pushOff != null) {
          try {
            pushOff();
          } catch { /* 已失效 */ }
          pushOff = null;
        }
      };
      return {
        subscribe(cb) {
          if (typeof cb !== 'function') throw new TypeError('subscribe(cb): cb 必须是函数');
          subs.add(cb);
          if (!planTried) refreshPlan();
          tick();
          if (pollTimer == null) pollTimer = setInterval(tick, REMOTE_POLL_MS);
          // 推送通道：$on 可用就挂上（官方事件订阅形状），到包即刷；轮询仍是正确性兜底
          if (pushOff == null && typeof ctx?.remote?.$on === 'function') {
            try {
              pushOff = ctx.remote.$on('zcode-dispatch/changed', () => {
                try {
                  tick();
                } catch { /* 抢答失败由轮询兜底 */ }
              });
            } catch {
              pushOff = null;
            }
          }
          return () => {
            subs.delete(cb);
            if (subs.size === 0) {
              if (pollTimer != null) {
                clearInterval(pollTimer);
                pollTimer = null;
              }
              stopPush();
            }
          };
        },
        async dispatch(spec = {}) {
          try {
            return await face.dispatch(spec);
          } catch (e) {
            return errOf(e);
          }
        },
        async kill(id) {
          try {
            return await face.kill(id);
          } catch (e) {
            return errOf(e);
          }
        },
        async retry(id, opts = {}) {
          try {
            return await face.retry(id, opts);
          } catch (e) {
            return errOf(e);
          }
        },
        async tail(id, n) {
          try {
            const lines = await face.tail(id, n);
            return { ok: true, id, lines };
          } catch (e) {
            return errOf(e);
          }
        },
        async channels() {
          try {
            const r = await face.channels();
            return { ok: true, channels: r?.channels ?? [], warnings: r?.warnings ?? [] };
          } catch (e) {
            return errOf(e);
          }
        },
        async channelGet() {
          try {
            return { ok: true, channel: await face.channel() };
          } catch (e) {
            return errOf(e);
          }
        },
        channelSet: (c) => channelSetImpl(c),
        async fallbackGet() {
          try {
            const r = await face.fallbackChain();
            return { ok: true, enabled: Boolean(r?.enabled), chain: Array.isArray(r?.chain) ? r.chain : [] };
          } catch (e) {
            return errOf(e);
          }
        },
        fallbackSet: (chain) => fallbackSetImpl(chain),
        // 与宿主 face 同名对齐（转发旧实现，语义一致）
        setChannel: (c) => channelSetImpl(c),
        setFallbackChain: (l) => fallbackSetImpl(l),
        dispose() {
          subs.clear();
          if (pollTimer != null) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          stopPush();
        },
      };
    }

    /* ─────────────── 降级 wire（ext/demo；同源实现：wire.client.mjs）───────────────
     * 远端面缺席时的降级顺序：1) 轮询 window.__zcodeDispatchDemo（宿主/creator 注入的
     * 外部数据源，形如 { getSnapshot(), getQuota?(), dispatch?(spec), kill?(id), tail?(id, n) }）；
     * 2) 内置 demo 引擎 —— UI 永远可渲染（不报错、不白屏）。 */
    function legacyWire() {
      const ext = typeof window !== 'undefined' ? window.__zcodeDispatchDemo : null;
      if (ext && typeof ext.getSnapshot === 'function') {
        const subs = new Set();
        let timer = null;
        const call = async (name, ...args) => {
          if (typeof ext[name] !== 'function') return { ok: false, error: `外部数据源未提供 ${name}()` };
          try {
            return await ext[name](...args);
          } catch (e) {
            return { ok: false, error: e?.message ?? String(e) };
          }
        };
        return {
          subscribe(cb) {
            subs.add(cb);
            const poll = () => {
              try {
                const bundle = {
                  conn: 'ext',
                  snapshot: ext.getSnapshot(),
                  quota: typeof ext.getQuota === 'function' ? ext.getQuota() : null,
                  planQuota: typeof ext.getPlanQuota === 'function' ? ext.getPlanQuota() : null,
                };
                for (const fn of subs) fn(bundle);
              } catch { /* 外部源抖动一拍不致命 */ }
            };
            poll();
            timer = setInterval(poll, 2000);
            return () => {
              subs.delete(cb);
              if (subs.size === 0 && timer != null) {
                clearInterval(timer);
                timer = null;
              }
            };
          },
          dispatch: (spec) => call('dispatch', spec),
          kill: (id) => call('kill', id),
          tail: (id, n) => call('tail', id, n),
          // Z6 增量：外部源未提供这些方法时 call() 返回 {ok:false,error}，UI 自行降级
          channels: () => call('channels'),
          channelGet: () => call('channel', {}),
          channelSet: (c) => call('channel', c ?? {}),
          retry: (id, opts) => call('retry', { id, ...(opts ?? {}) }),
          fallbackGet: () => call('fallback', {}),
          fallbackSet: (chain) => call('fallback', { chain }),
          dispose() {
            subs.clear();
            if (timer != null) {
              clearInterval(timer);
              timer = null;
            }
          },
        };
      }

      // 内置 demo 引擎：3 个进程起步；派发 / kill / tail 均可交互（纯前端假数据）
      const jobs = new Map();
      const seed = () => {
        const s = {
          generatedAt: '', workRoot: '(demo)', maxConcurrent: 1,
          counts: {}, locks: { repo: null, memory: null }, queue: [], jobs: [],
        };
        const mk = (id, tag, state, model, body, extra) => ({
          id, tag, state, lock: state === 'running' ? 'repo+memory' : null,
          spec: { kind: 'prompt', body, model, provider: 'plan', mode: 'edit', lock: 'both', timeoutMin: 15, memoryBench: false, tag },
          queuedAt: new Date().toISOString(), startedAt: state === 'queued' ? null : new Date().toISOString(),
          finishedAt: state === 'done' ? new Date().toISOString() : null,
          elapsedSec: state === 'running' ? 42 : state === 'done' ? 7.7 : null,
          exitCode: state === 'done' ? 0 : null, signal: null,
          sessionId: state === 'done' ? 'sess_demo-0000' : null,
          provider: state === 'queued' ? null : `plan:bigmodel-coding-plan`, model,
          usage: state === 'running'
            ? { requests: 3, inputTokens: 120340, outputTokens: 1502, cacheReadTokens: 40960 }
            : state === 'done'
              ? { requests: 1, inputTokens: 27724, outputTokens: 16, cacheReadTokens: 1536 }
              : { requests: null, inputTokens: null, outputTokens: null, cacheReadTokens: null },
          contextUsed: state === 'queued' ? null : state === 'running' ? 41300 : 27740,
          contextWindow: state === 'queued' ? null : 200000,
          turnCount: state === 'queued' ? null : 2,
          timedOut: false, tailCount: state === 'queued' ? 0 : 9, parseWarnings: [],
          pauseReason: null, pauseDetail: null, parentJobId: null, attempts: [], hopCount: 0, handedOffTo: null, resumedBy: null,
          ...extra,
        });
        s.jobs = [
          mk('j-demo-run', 'demo-running', 'running', 'GLM-5.3', '（演示）正在整理 collab 目录的周报…'),
          mk('j-demo-done', 'demo-done', 'done', 'GLM-5.3-Flash', '只回答 OK'),
          mk('j-demo-wait', 'demo-queued', 'queued', 'GLM-5.3', '（演示）排队中的代码评审任务'),
          // paused 演示：未占锁、有 sessionId、显示原因徽章与续跑按钮（Z6 语义的可视化）
          mk('j-demo-paused', 'demo-paused', 'paused', 'GLM-5.3-Flash', '（演示）Start Plan 上的整理任务', {
            sessionId: 'sess_demo-paused', provider: 'plan:bigmodel-start-plan', elapsedSec: 3.1, exitCode: 1,
            pauseReason: 'plan-not-entitled', pauseDetail: '[zcode-run] provider builtin:bigmodel-start-plan 未启用（coding_plan_not_entitled）',
            tailCount: 2,
          }),
        ];
        s.counts = { running: 1, queued: 1, done: 1, paused: 1 };
        const holder = s.jobs[0];
        s.locks.repo = { jobId: holder.id, pid: 4242, at: holder.startedAt, lock: 'demo' };
        s.locks.memory = { jobId: holder.id, pid: 4242, at: holder.startedAt, lock: 'demo' };
        s.queue = ['j-demo-wait'];
        return s;
      };
      let snap = seed();
      let seq = 0;
      const quota = {
        available: true, generatedAt: '', ledgerPath: '(demo)', skippedLines: 0,
        windows: {
          last5h: { runs: 3, requests: 5, inputTokens: 148064, outputTokens: 1518, cacheReadTokens: 42496, totalTokens: 192078 },
          week: { runs: 7, requests: 12, inputTokens: 341416, outputTokens: 3411, cacheReadTokens: 219200, totalTokens: 564027 },
          today: { runs: 2, requests: 3, inputTokens: 61420, outputTokens: 640, cacheReadTokens: 18432, totalTokens: 80492 },
        },
      };
      const subs = new Set();
      let timer = null;
      // demo 套餐面（与 core/quota.mjs fetchPlanQuota 同形）：week.used 是引擎本地库合计（演示值），剩余类字段恒 null
      const planQuota = {
        available: true, plan: 'bigmodel-coding-plan', source: 'app-server:usage/stats', generatedAt: '',
        windows: [
          { id: '5h', used: null, limit: null, remaining: null, percentUsed: null, resetAt: null, mapped: false },
          { id: 'week', used: 564027, limit: null, remaining: null, percentUsed: null, resetAt: null, mapped: false },
        ],
      };
      // Z6 demo 通道面（与真实 listChannels 同形；含不可用项——如实标注，不假装能切）
      const demoChannels = [
        { id: 'plan', name: '默认套餐（自动选择）', enabled: true, reason: null, endpoint: 'https://open.bigmodel.cn/api/anthropic', models: ['GLM-5.3', 'GLM-5.3-Flash'] },
        { id: 'personal', name: '个人 API（演示）', enabled: true, reason: null, endpoint: 'https://demo.example/v1', models: ['deepseek-flash'] },
        { id: 'builtin:bigmodel-start-plan', name: 'BigModel Start Plan（演示）', enabled: false, reason: 'coding_plan_not_entitled', endpoint: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic', models: ['GLM-5.3', 'GLM-5.3-Flash'] },
        { id: 'builtin:zai-coding-plan', name: 'Z.ai Coding Plan（演示）', enabled: false, reason: 'oauth_provider_inactive', endpoint: 'https://api.z.ai/api/anthropic', models: ['GLM-5.3', 'GLM-5.3-Flash'] },
      ];
      let demoChannel = { provider: 'plan', model: 'GLM-5.3-Flash' };
      let demoChain = [];
      const pendingTransitions = new Set(); // dispose 时连同派发编排的挂起定时器一起清
      const later = (fn, ms) => {
        const t = setTimeout(() => {
          pendingTransitions.delete(t);
          fn();
        }, ms);
        pendingTransitions.add(t);
        return t;
      };
      // demo 派发编排（dispatch 与 retry 共用）：queued→running（+1.2s）→ done（再 +5s）
      const scheduleRun = (id) => {
        later(() => {
          const running = snap.jobs.find((j) => j.id === id);
          if (!running || running.state !== 'queued') return;
          running.state = 'running';
          running.startedAt = new Date().toISOString();
          running.elapsedSec = 0;
          running.lock = 'repo+memory';
          snap.queue = snap.queue.filter((q) => q !== id);
          snap.counts = { ...snap.counts, queued: Math.max(0, (snap.counts.queued ?? 1) - 1), running: (snap.counts.running ?? 0) + 1 };
          const rec = { jobId: id, pid: 4242, at: running.startedAt, lock: 'demo' };
          snap.locks.repo = rec;
          snap.locks.memory = rec;
          emit();
        }, 1200);
        later(() => {
          const doneJob = snap.jobs.find((j) => j.id === id);
          if (!doneJob || doneJob.state !== 'running') return;
          doneJob.state = 'done';
          doneJob.exitCode = 0;
          doneJob.finishedAt = new Date().toISOString();
          doneJob.elapsedSec = Number(((Date.parse(doneJob.finishedAt) - Date.parse(doneJob.startedAt)) / 1000).toFixed(1));
          doneJob.lock = null;
          doneJob.usage = { requests: 1, inputTokens: 27724, outputTokens: 16, cacheReadTokens: 1536 };
          doneJob.contextUsed = 27740;
          doneJob.contextWindow = 200000;
          doneJob.tailCount = 5;
          snap.counts = { ...snap.counts, running: Math.max(0, (snap.counts.running ?? 1) - 1), done: (snap.counts.done ?? 0) + 1 };
          if (!snap.jobs.some((j) => j.state === 'running')) {
            snap.locks.repo = null;
            snap.locks.memory = null;
          }
          addUsage(doneJob.usage);
          emit();
        }, 6200);
      };
      const snapshot = () => ({
        ...snap,
        generatedAt: new Date().toISOString(),
        jobs: snap.jobs
          .map((j) => ({ ...j, spec: { ...j.spec }, usage: { ...j.usage } }))
          .sort((a, b) => {
            const rank = { running: 0, queued: 1, paused: 2 };
            return (rank[a.state] ?? 3) - (rank[b.state] ?? 3) || String(b.queuedAt).localeCompare(String(a.queuedAt));
          }),
      });
      const quotaNow = () => ({ ...quota, generatedAt: new Date().toISOString() });
      const planQuotaNow = () => ({ ...planQuota, generatedAt: new Date().toISOString() });
      const emit = () => {
        const bundle = { conn: 'demo', snapshot: snapshot(), quota: quotaNow(), planQuota: planQuotaNow() };
        for (const fn of subs) {
          try {
            fn(bundle);
          } catch { /* 单个订阅者异常不影响其他 */ }
        }
      };
      const job = (id) => snap.jobs.find((j) => j.id === id) ?? null;
      const addUsage = (u) => {
        for (const w of [quota.windows.last5h, quota.windows.week, quota.windows.today]) {
          w.runs += 1;
          w.requests += u.requests;
          w.inputTokens += u.inputTokens;
          w.outputTokens += u.outputTokens;
          w.cacheReadTokens += u.cacheReadTokens;
          w.totalTokens = w.inputTokens + w.outputTokens + w.cacheReadTokens;
        }
      };
      return {
        subscribe(cb) {
          subs.add(cb);
          emit();
          if (timer == null) {
            timer = setInterval(() => {
              let changed = false;
              for (const j of snap.jobs) {
                if (j.state === 'running') {
                  j.elapsedSec = Number((j.elapsedSec ?? 0) + 1);
                  changed = true;
                }
              }
              if (changed) emit();
            }, 1000);
          }
          return () => {
            subs.delete(cb);
            if (subs.size === 0 && timer != null) {
              clearInterval(timer);
              timer = null;
            }
          };
        },
        async dispatch(spec = {}) {
          const kind = spec.kind ?? 'prompt';
          const body = spec[kind];
          if (!body) return { ok: false, error: `kind=${kind} 需要对应的 ${kind} 字段（demo）` };
          seq += 1;
          const id = `j-demo-new-${seq}`;
          const tag = spec.tag ?? `demo-new-${seq}`;
          const nj = {
            id, tag, state: 'queued', lock: null,
            spec: { kind, body: String(body).slice(0, 80), model: spec.model ?? null, provider: spec.provider ?? null, mode: spec.mode ?? 'edit', lock: spec.lock ?? 'both', timeoutMin: spec.timeoutMin ?? null, memoryBench: Boolean(spec.memoryBench), tag },
            queuedAt: new Date().toISOString(), startedAt: null, finishedAt: null,
            elapsedSec: null, exitCode: null, signal: null, sessionId: null, provider: null,
            model: spec.model ?? null,
            usage: { requests: null, inputTokens: null, outputTokens: null, cacheReadTokens: null },
            contextUsed: null, contextWindow: null, turnCount: null, timedOut: false, tailCount: 0, parseWarnings: [],
            pauseReason: null, pauseDetail: null, parentJobId: null, attempts: [], hopCount: 0, handedOffTo: null, resumedBy: null,
          };
          snap.jobs.unshift(nj);
          snap.counts = { ...snap.counts, queued: (snap.counts.queued ?? 0) + 1 };
          snap.queue = [...snap.queue, id];
          emit();
          scheduleRun(id);
          return { ok: true, job: { ...nj } };
        },
        async kill(id) {
          const j = job(id);
          if (!j || ['done', 'failed', 'killed', 'interrupted'].includes(j.state)) {
            return { ok: false, error: `kill 失败：job 不存在或已是终态（id=${id}）（demo）` };
          }
          const wasQueued = j.state === 'queued';
          const wasRunning = j.state === 'running';
          const wasPaused = j.state === 'paused';
          j.state = 'killed';
          j.lock = null;
          j.finishedAt = new Date().toISOString();
          if (j.startedAt) j.elapsedSec = Number(((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000).toFixed(1));
          snap.queue = snap.queue.filter((q) => q !== id);
          snap.counts = {
            ...snap.counts,
            queued: Math.max(0, (snap.counts.queued ?? 0) - (wasQueued ? 1 : 0)),
            running: Math.max(0, (snap.counts.running ?? 0) - (wasRunning ? 1 : 0)),
            paused: Math.max(0, (snap.counts.paused ?? 0) - (wasPaused ? 1 : 0)),
            killed: (snap.counts.killed ?? 0) + 1,
          };
          if (!snap.jobs.some((x) => x.state === 'running')) {
            snap.locks.repo = null;
            snap.locks.memory = null;
          }
          emit();
          return { ok: true, job: { ...j } };
        },
        async tail(id, n = 30) {
          const j = job(id);
          if (!j) return { ok: false, error: `找不到 job：${id}（demo）` };
          const lines = [
            `[zcode-run] tag=${j.spec.tag ?? 'demo'} mode=${j.spec.mode ?? 'edit'} cwd=(demo)`,
            '[zcode-run] provider=plan:bigmodel-coding-plan (Fake Provider（ZCode 套餐）)',
            '[zcode-run] usage requests=1 in=100 out=50 cacheRead=10',
            '[zcode-run] context used=1234 (0.6% of 200000) turnCount=2',
          ];
          if (j.state === 'done') lines.push(`[zcode-run] done exit=0 elapsed=7.7s session=sess_demo-0000 provider=plan:bigmodel-coding-plan model=${j.model}`);
          if (j.state === 'running') lines.push(`[zcode-run] running… elapsed=${Math.round(j.elapsedSec ?? 0)}s（demo 流式输出）`);
          if (j.state === 'queued') lines.push('(queued: 等待单写者锁，demo)');
          if (j.state === 'killed') lines.push('[zcode-run] killed by user (demo)');
          if (j.state === 'paused') {
            lines.push(`[zcode-run] done exit=1 elapsed=3.1s provider=${j.provider ?? 'plan:bigmodel-start-plan'}`);
            lines.push(`[zcode-run] ${j.pauseDetail ?? 'coding_plan_not_entitled'}`);
          }
          return { ok: true, id, lines: lines.slice(-Math.max(1, Number(n) || 30)) };
        },
        /* ---- Z6 demo 增量：通道 / 续跑 / 降级链（与真实 dispatcher 语义同形） ---- */
        async channels() {
          return { ok: true, channels: demoChannels.map((c) => ({ ...c, models: [...c.models] })), warnings: [] };
        },
        async channelGet() {
          return { ok: true, channel: { ...demoChannel } };
        },
        async channelSet(c = {}) {
          demoChannel = {
            provider: String(c.provider ?? demoChannel.provider),
            model: c.model == null || c.model === '' ? null : String(c.model),
          };
          return { ok: true, channel: { ...demoChannel } };
        },
        async retry(id, opts = {}) {
          const j = job(id);
          if (!j) return { ok: false, error: `找不到 job：${id}（demo）` };
          if (j.state === 'queued' || j.state === 'running') return { ok: false, error: `job 仍在 ${j.state}，不能 retry（demo）` };
          const origProvider = j.spec.provider ?? 'plan';
          const targetProvider = opts.provider != null && opts.provider !== '' ? String(opts.provider) : null;
          const targetModel = opts.model != null && opts.model !== '' ? String(opts.model) : null;
          const sameChannel = targetProvider == null || targetProvider === origProvider;
          const prevAttempts = Array.isArray(j.attempts) ? j.attempts : [];
          const reason = j.pauseReason && j.pauseReason !== 'unknown' ? j.pauseReason : `manual-retry:${j.state}`;
          seq += 1;
          const nid = `j-demo-retry-${seq}`;
          const suffix = sameChannel ? `r${prevAttempts.length + 1}` : `h${prevAttempts.length + 1}`;
          const spec = sameChannel && j.sessionId
            ? { ...j.spec, tag: `${j.tag}-${suffix}` }
            : {
                kind: 'prompt',
                body: `（演示）交接重跑：${j.spec.body ?? j.tag}`,
                model: targetModel,
                provider: targetProvider ?? origProvider,
                mode: j.spec.mode ?? 'edit',
                lock: j.spec.lock ?? 'both',
                timeoutMin: j.spec.timeoutMin ?? null,
                memoryBench: false,
                tag: `${j.tag}-${suffix}`,
              };
          const nj = {
            id: nid, tag: `${j.tag}-${suffix}`, state: 'queued', lock: null, spec,
            queuedAt: new Date().toISOString(), startedAt: null, finishedAt: null,
            elapsedSec: null, exitCode: null, signal: null,
            sessionId: sameChannel && j.sessionId ? j.sessionId : `sess_demo-handoff-${seq}`,
            provider: null, model: spec.model ?? null,
            usage: { requests: null, inputTokens: null, outputTokens: null, cacheReadTokens: null },
            contextUsed: null, contextWindow: null, turnCount: null, timedOut: false, tailCount: 0, parseWarnings: [],
            pauseReason: null, pauseDetail: null, parentJobId: j.id,
            attempts: [
              ...prevAttempts,
              { jobId: j.id, provider: origProvider, model: j.spec.model ?? null, reason, at: new Date().toISOString() },
              { jobId: nid, provider: spec.provider ?? origProvider, model: spec.model ?? null, reason: sameChannel ? 'resume-same-channel' : 'handoff-retry', at: new Date().toISOString() },
            ],
            hopCount: sameChannel ? j.hopCount ?? 0 : (j.hopCount ?? 0) + 1,
            handedOffTo: null, resumedBy: null,
          };
          snap.jobs.unshift(nj);
          snap.counts = { ...snap.counts, queued: (snap.counts.queued ?? 0) + 1 };
          snap.queue = [...snap.queue, nid];
          if (sameChannel && j.sessionId) j.resumedBy = nid;
          else j.handedOffTo = nid;
          emit();
          scheduleRun(nid);
          return { ok: true, job: { ...nj } };
        },
        async fallbackGet() {
          return { ok: true, enabled: demoChain.length > 0, chain: [...demoChain] };
        },
        async fallbackSet(list) {
          const arr = Array.isArray(list) ? list : String(list ?? '').split(',');
          demoChain = arr.map((x) => String(x).trim()).filter(Boolean);
          return { ok: true, enabled: demoChain.length > 0, chain: [...demoChain] };
        },
        dispose() {
          subs.clear();
          if (timer != null) {
            clearInterval(timer);
            timer = null;
          }
          for (const t of pendingTransitions) clearTimeout(t);
          pendingTransitions.clear();
        },
      };
    }

    /* ─────────────── wire 工厂（数据源三选一；同源：wire.client.mjs createClientWire）───────────────
     * 优先级与判据：MOD_CTX 上探测到远端面（resolveRemote 有 snapshot()）→ remoteWire
     * （conn='live'，真数据）；否则 window.__zcodeDispatchDemo 外部源（conn='ext'）；
     * 再否则内置 demo 引擎（conn='demo'）。MOD_CTX 为 null（apply 未跑过，如纯组件桩
     * 浅渲染）等同远端缺席，走降级链，绝不抛错。 */
    function createWire() {
      try {
        const remote = MOD_CTX ? resolveRemote(MOD_CTX) : null;
        if (remote) return remoteWire(MOD_CTX, remote);
      } catch (e) {
        try { console.warn('[zcode-dispatch] 远端 wire 初始化失败，降级 demo：', e && e.message); } catch { /* ignore */ }
      }
      try {
        return legacyWire();
      } catch (e) {
        try { console.warn('[zcode-dispatch] 降级 wire 初始化失败：', e && e.message); } catch { /* ignore */ }
        return null; // 交给 DEAD_WIRE：只报错、不白屏
      }
    }

    /* 最后一道兜底 wire：连降级链都起不来时使用，保证组件永远有 wire（失败可见，不静默消失） */
    const DEAD_WIRE = {
      conn: 'error',
      subscribe(fn) {
        try { fn({ conn: 'error', snapshot: null, quota: null, planQuota: null }); } catch { /* ignore */ }
        return () => {};
      },
      dispose() {},
      dispatch: async () => ({ ok: false, error: 'wire 不可用' }),
      kill: async () => ({ ok: false, error: 'wire 不可用' }),
      retry: async () => ({ ok: false, error: 'wire 不可用' }),
      tail: async () => [],
      channels: async () => ({ channels: [] }),
      channelGet: async () => ({}),
      channelSet: async () => ({ ok: false, error: 'wire 不可用' }),
      fallbackGet: async () => ({}),
      fallbackSet: async () => ({ ok: false, error: 'wire 不可用' }),
    };

    /* ─────────────── 组件 ─────────────── */
    /* 渲染兜底：任何渲染期异常都转成一张可见的失败卡片，而不是静默消失。
     * （2026-09-30 实测：createWire 若抛错会让整块浮层不见且页面无报错，难以定位。） */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }

      static getDerivedStateFromError(err) {
        return { err };
      }

      componentDidCatch(err) {
        try { console.warn('[zcode-dispatch] 渲染失败（已降级显示）:', err && err.message); } catch { /* ignore */ }
      }

      render() {
        if (!this.state.err) return this.props.children;
        return h('div', {
          className: 'zcd-root',
          style: {
            position: 'fixed', right: '24px', bottom: '24px', zIndex: Z_INDEX, maxWidth: '340px',
            padding: '8px 10px', fontSize: '12px', lineHeight: 1.5,
            color: T.text, background: T.bg, border: '1px solid ' + T.border,
            borderRadius: '8px', boxShadow: T.shadow,
          },
        },
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'ZCode 派发台渲染失败'),
        h('div', { style: { color: T.text2, wordBreak: 'break-all' } }, String((this.state.err && this.state.err.message) || this.state.err)),
        h('button', {
          className: 'zcd-btn2', style: { marginTop: '6px' },
          onClick: () => this.setState({ err: null }),
        }, '重试'));
      }
    }

    function useWire() {
      const ref = useRef(null);
      if (ref.current == null) ref.current = createWire() ?? DEAD_WIRE;
      const wire = ref.current;
      const [state, setState] = useState({ conn: 'connecting', snapshot: null, quota: null, planQuota: null });
      useEffect(() => {
        const un = wire.subscribe((b) => setState(b));
        return () => {
          un();
          wire.dispose(); // 组件卸载：退订 + 停掉轮询/引擎定时器
        };
      }, [wire]);
      return {
        conn: state.conn, snapshot: state.snapshot, quota: state.quota, planQuota: state.planQuota,
        dispatch: wire.dispatch, kill: wire.kill, tail: wire.tail,
        channels: wire.channels, channelGet: wire.channelGet, channelSet: wire.channelSet,
        retry: wire.retry, fallbackGet: wire.fallbackGet, fallbackSet: wire.fallbackSet,
      };
    }

    const PAUSE_LABEL_KEY = { 'quota-exhausted': 'pQuota', 'plan-not-entitled': 'pEntitled', 'provider-signing': 'pSigning', 'config-error': 'pConfig' };
    const pauseLabel = (r) => t(PAUSE_LABEL_KEY[r] ?? 'pUnknown');

    function StatusDot({ state }) {
      const cls = ['queued', 'running', 'done', 'failed', 'killed', 'interrupted', 'paused'].includes(state) ? state : 'idle';
      return h('span', { className: `zcd-dot s-${cls}`, title: state, 'aria-label': state });
    }

    function IconChevron({ up }) {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: up ? 'M2 8 L6 4 L10 8' : 'M2 4 L6 8 L10 4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    function IconMinus() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M2.5 6 H9.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
    }
    function IconKill() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M3 3 L9 9 M9 3 L3 9', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
    }

    function Section({ title, children }) {
      return h('div', { className: 'zcd-sec' }, h('div', { className: 'zcd-sec-title' }, title), children);
    }

    /* 通道分区：切换器（provider+model，不可用项置灰带原因）+ 自动降级链开关（二次确认）。 */
    function ChannelSection({ channelsInfo, channel, fallback, onSwitch, onFallbackSet }) {
      const [chainInput, setChainInput] = useState('');
      const [confirming, setConfirming] = useState(false);
      const [fbFeedback, setFbFeedback] = useState(null);
      const channels = channelsInfo?.channels ?? [];
      const warnings = channelsInfo?.warnings ?? [];
      const sel = channels.find((c) => c.id === channel.provider) ?? null;
      const models = sel && Array.isArray(sel.models) ? sel.models : [];
      const modelValue = channel.model ?? '';

      const switchProvider = (id) => {
        const c = channels.find((x) => x.id === id);
        if (!c || !c.enabled) return; // 不可用项不允许选中（option 已 disabled）
        onSwitch({ provider: id, model: c.models && c.models.length ? c.models[0] : null });
      };
      const switchModel = (m) => onSwitch({ provider: channel.provider, model: m || null });

      const modelOptions = models.length
        ? models
        : (modelValue ? [modelValue] : []); // 通道没给模型表时至少显示当前值
      const chainText = (fallback?.chain ?? []).join(', ');

      const trySetChain = (list) => {
        if (list.length === 0) {
          setFbFeedback({ kind: 'err', text: t('fallbackEmptyErr') });
          return;
        }
        const unknown = list.filter((id) => !channels.some((c) => c.id === id));
        onFallbackSet(list);
        setConfirming(false);
        setFbFeedback({
          kind: unknown.length ? 'err' : 'ok',
          text: t('fallbackSaved') + list.join(' → ') + (unknown.length ? `（未知通道：${unknown.join(', ')}）` : ''),
        });
      };
      const saveClick = () => {
        const list = chainInput.split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) {
          setFbFeedback({ kind: 'err', text: t('fallbackEmptyErr') });
          return;
        }
        if (!confirming) {
          setConfirming(true); // 二次确认：会自动消耗下游通道额度
          return;
        }
        trySetChain(list);
      };
      const offClick = () => {
        onFallbackSet([]);
        setConfirming(false);
        setFbFeedback({ kind: 'ok', text: t('fallbackSaved') + t('fallbackStateOff') });
      };

      return h('div', null,
        warnings.length ? h('div', { className: 'zcd-feedback zcd-err' }, `${t('chanLoadFail')}: ${warnings[0]}`) : null,
        h('div', { className: 'zcd-row' },
          h('span', { className: 'zcd-label' }, t('provider')),
          h('select', {
            className: 'zcd-select', value: channel.provider,
            onChange: (e) => switchProvider(e.target.value), 'aria-label': t('provider'),
            disabled: channels.length === 0,
          },
            channels.length === 0 ? h('option', { value: channel.provider }, channel.provider) : null,
            channels.map((c) => h('option', { key: c.id, value: c.id, disabled: !c.enabled },
              `${c.name ?? c.id}${c.enabled ? '' : `（${t('chanDisabled')}：${c.reason ?? '-'}）`}`))),
          h('span', { className: 'zcd-label' }, t('model')),
          h('select', {
            className: 'zcd-select', value: modelValue,
            onChange: (e) => switchModel(e.target.value), 'aria-label': t('model'),
            disabled: !sel || !sel.enabled,
          },
            h('option', { value: '' }, t('chanDefaultModel')),
            modelOptions.map((m) => h('option', { key: m, value: m }, m))),
        ),
        h('div', { className: 'zcd-note', role: 'status' },
          `${t('chanNewTask')}${channel.provider}/${channel.model || t('chanDefaultModel')}`),
        h('div', { className: 'zcd-row', style: { marginTop: 2 } },
          h('span', { className: 'zcd-label' }, t('fallbackTitle')),
          h('span', { className: 'zcd-badge' }, fallback?.enabled ? t('fallbackStateOn') : t('fallbackStateOff')),
          (fallback?.chain ?? []).length ? h('span', { className: 'zcd-chain' },
            (fallback.chain).map((id, i) => h('span', { key: `${id}-${i}`, className: 'zcd-badge' }, id))) : null,
        ),
        h('div', { className: 'zcd-row' },
          h('input', {
            className: 'zcd-input', type: 'text', value: chainInput, placeholder: chainText || t('fallbackPh'),
            onChange: (e) => { setChainInput(e.target.value); setConfirming(false); },
            style: { flex: 1, minWidth: 120 }, 'aria-label': t('fallbackTitle'),
          }),
          h('button', { className: 'zcd-btn2', onClick: saveClick }, confirming ? t('fallbackConfirm2') : t('fallbackSave')),
          (fallback?.chain ?? []).length ? h('button', { className: 'zcd-btn2', onClick: offClick }, t('fallbackOffBtn')) : null,
        ),
        confirming ? h('div', { className: 'zcd-note', role: 'alert' }, t('fallbackConfirm2')) : null,
        fbFeedback ? h('div', { className: `zcd-feedback${fbFeedback.kind === 'err' ? ' zcd-err' : ''}`, role: 'status' }, fbFeedback.text) : null,
      );
    }

    function DispatchBar({ snapshot, lastJobId, feedback, busy, channel, onSubmit }) {
      const [kind, setKind] = useState('prompt');
      const [content, setContent] = useState('');
      const [mode, setMode] = useState('edit');
      const [timeoutMin, setTimeoutMin] = useState('15');
      const [bench, setBench] = useState(false);

      const lastJob = (snapshot?.jobs ?? []).find((j) => j.id === lastJobId) ?? null;
      const active = lastJob && (lastJob.state === 'queued' || lastJob.state === 'running');
      const label = busy ? t('sending') : active ? (lastJob.state === 'queued' ? t('queuedBtn') : t('runningBtn')) : t('dispatch');
      const ph = kind === 'prompt' ? t('phPrompt') : kind === 'task' ? t('phTask') : t('phTarget');

      const submit = () => {
        const body = content.trim();
        if (!body) {
          onSubmit(null);
          return;
        }
        // 通道/模型来自顶部通道切换器（唯一出口）；未选模型时交由通道默认值决定
        const spec = { kind, [kind]: body, provider: channel.provider, mode };
        if (channel.model) spec.model = channel.model;
        if (timeoutMin !== '' && Number(timeoutMin) > 0) spec.timeoutMin = Number(timeoutMin);
        if (bench) spec.memoryBench = true;
        onSubmit(spec);
      };

      return h('div', { className: 'zcd-dispatch' },
        h('div', { className: 'zcd-row' },
          h('span', { className: 'zcd-label' }, t('kind')),
          h('select', { className: 'zcd-select', value: kind, onChange: (e) => setKind(e.target.value), 'aria-label': t('kind') },
            h('option', { value: 'prompt' }, t('kindPrompt')),
            h('option', { value: 'task' }, t('kindTask')),
            h('option', { value: 'target' }, t('kindTarget'))),
          h('span', { className: 'zcd-label' }, t('mode')),
          h('select', { className: 'zcd-select', value: mode, onChange: (e) => setMode(e.target.value), 'aria-label': t('mode') },
            h('option', { value: 'build' }, 'build'),
            h('option', { value: 'edit' }, 'edit'),
            h('option', { value: 'plan' }, 'plan'),
            h('option', { value: 'yolo' }, 'yolo')),
        ),
        h('textarea', { className: 'zcd-ta', value: content, placeholder: ph, onChange: (e) => setContent(e.target.value), 'aria-label': t('content') }),
        h('div', { className: 'zcd-row' },
          h('span', { className: 'zcd-label' }, t('timeout')),
          h('input', { className: 'zcd-input', type: 'number', min: 1, value: timeoutMin, onChange: (e) => setTimeoutMin(e.target.value), style: { width: 56 }, 'aria-label': t('timeout') }),
          h('label', { className: 'zcd-row', style: { gap: 3 } },
            h('input', { type: 'checkbox', checked: bench, onChange: (e) => setBench(e.target.checked) }),
            h('span', { className: 'zcd-label' }, t('bench'))),
          h('span', { className: 'zcd-spring' }),
          h('button', { className: 'zcd-btn', disabled: busy || active, onClick: submit }, label),
        ),
        feedback ? h('div', { className: `zcd-feedback${feedback.kind === 'err' ? ' zcd-err' : ''}`, role: 'status' }, feedback.text) : null,
      );
    }

    function JobRow({ job, onKill, onTail, onRetry, channels, refreshKey }) {
      const [open, setOpen] = useState(false);
      const [tail, setTail] = useState(undefined); // undefined=未取 null=读取中 {...}=结果
      const [handoffOpen, setHandoffOpen] = useState(false); // 换通道交接重跑的选择器
      const [hoProvider, setHoProvider] = useState('');
      const [hoModel, setHoModel] = useState('');
      const [retryFb, setRetryFb] = useState(null);
      useEffect(() => {
        if (!open) return undefined;
        let alive = true;
        setTail(null);
        Promise.resolve(onTail(job.id, 30)).then((r) => {
          if (alive) setTail(r);
        });
        return () => {
          alive = false;
        };
      }, [open, refreshKey]); // 展开/收起与快照刷新时重取（运行中可见进度）
      const active = job.state === 'queued' || job.state === 'running';
      const paused = job.state === 'paused';
      const origProvider = (job.spec && job.spec.provider) || 'plan';
      const enabledChannels = (channels ?? []).filter((c) => c.enabled && c.id !== origProvider);
      const defaultHo = enabledChannels[0]?.id ?? '';
      const effHoProvider = hoProvider || defaultHo;
      const hoSel = (channels ?? []).find((c) => c.id === effHoProvider) ?? null;
      const doResume = () => {
        setRetryFb(t('sending'));
        Promise.resolve(onRetry(job.id, {})).then((r) => {
          setRetryFb(r && r.ok ? `${t('fbQueued')}${r.job?.id ?? ''}` : `${t('errPrefix')}${(r && r.error) || 'unknown'}`);
        });
      };
      const doHandoff = () => {
        setRetryFb(t('sending'));
        Promise.resolve(onRetry(job.id, { provider: effHoProvider, model: hoModel || null })).then((r) => {
          setRetryFb(r && r.ok ? `${t('fbQueued')}${r.job?.id ?? ''}` : `${t('errPrefix')}${(r && r.error) || 'unknown'}`);
        });
        setHandoffOpen(false);
      };
      return h('div', { className: 'zcd-job' },
        h('div', { className: 'zcd-job-head' },
          h(StatusDot, { state: job.state }),
          h('span', { className: 'zcd-job-tag', title: job.id }, job.tag ?? shortId(job.id)),
          h('span', { className: 'zcd-badge' }, job.model ?? '—'),
          paused ? h('span', { className: 'zcd-badge s-paused', title: job.pauseDetail ?? '' }, `${t('paused')}：${pauseLabel(job.pauseReason)}`) : null,
          job.parentJobId ? h('span', { className: 'zcd-badge', title: job.parentJobId }, `${t('parentFrom')} ${shortId(job.parentJobId)}`) : null,
          (job.hopCount ?? 0) > 0 ? h('span', { className: 'zcd-badge' }, `${job.hopCount} ${t('hop')}`) : null,
          h('span', { className: 'zcd-dim' }, fmtSec(job.elapsedSec)),
          h('span', { className: 'zcd-dim', title: `${job.contextUsed ?? '—'} / ${job.contextWindow ?? '—'}` }, ctxPct(job)),
          job.exitCode != null ? h('span', { className: 'zcd-dim' }, `${t('exit')} ${job.exitCode}`) : null,
          job.lock ? h('span', { className: 'zcd-badge', title: t('lockHeld') }, String(job.lock)) : null,
          h('span', { className: 'zcd-spring' }),
          active ? h('button', { className: 'zcd-iconbtn', title: t('kill'), 'aria-label': `${t('kill')} ${job.id}`, onClick: () => onKill(job.id) }, h(IconKill)) : null,
          h('button', { className: 'zcd-iconbtn', title: t('tail'), 'aria-label': `${t('tail')} ${job.id}`, 'aria-expanded': open, onClick: () => setOpen(!open) }, h(IconChevron, { up: open })),
        ),
        paused ? h('div', { className: 'zcd-row', style: { marginTop: 4 } },
          h('button', {
            className: 'zcd-btn2', onClick: doResume,
            disabled: !job.sessionId,
            title: job.sessionId ? `${t('resumeSame')}（--resume）` : t('noSession'),
          }, t('resumeSame')),
          h('button', { className: 'zcd-btn2', onClick: () => setHandoffOpen(!handoffOpen), 'aria-expanded': handoffOpen }, t('retryHandoff')),
          retryFb ? h('span', { className: 'zcd-note', role: 'status' }, retryFb) : null,
        ) : null,
        paused && handoffOpen ? h('div', { className: 'zcd-row', style: { marginTop: 4 } },
          h('select', {
            className: 'zcd-select', value: effHoProvider,
            onChange: (e) => { setHoProvider(e.target.value); setHoModel(''); }, 'aria-label': t('provider'),
          },
            (channels ?? []).filter((c) => c.enabled && c.id !== origProvider).map((c) => h('option', { key: c.id, value: c.id }, `${c.name ?? c.id}`))),
          h('select', {
            className: 'zcd-select', value: hoModel, onChange: (e) => setHoModel(e.target.value), 'aria-label': t('model'),
          },
            h('option', { value: '' }, t('chanDefaultModel')),
            (hoSel?.models ?? []).map((m) => h('option', { key: m, value: m }, m))),
          h('button', { className: 'zcd-btn', onClick: doHandoff, disabled: !effHoProvider }, t('confirmHandoff')),
          h('button', { className: 'zcd-btn2', onClick: () => setHandoffOpen(false) }, t('cancel')),
          h('span', { className: 'zcd-note', role: 'note' }, t('handoffConfirm')),
        ) : null,
        open ? h('div', { className: 'zcd-tailwrap' },
          h('div', { className: 'zcd-mono' },
            tail === null ? t('tailLoading')
              : tail === undefined ? t('tailEmpty')
                : tail && tail.ok ? (tail.lines && tail.lines.length ? tail.lines.join('\n') : t('tailEmpty'))
                  : `${t('errPrefix')}${tail && tail.error ? tail.error : 'unknown'}`)) : null,
      );
    }

    function JobList({ snapshot, onKill, onTail, onRetry, channels, refreshKey }) {
      const jobs = snapshot?.jobs ?? [];
      if (jobs.length === 0) return h('div', { className: 'zcd-empty' }, t('noJobs'));
      return h('div', { className: 'zcd-jobs' },
        jobs.map((j) => h(JobRow, { key: j.id, job: j, onKill, onTail, onRetry, channels, refreshKey })));
    }

    function QuotaCards({ quota, planQuota }) {
      const w = quota && quota.windows ? quota.windows : null;
      const kv = (k, v) => h('div', { className: 'zcd-kv' }, h('span', { className: 'zcd-kv-k' }, k), h('span', null, v));
      const card = (title, x) => h('div', { className: 'zcd-card' },
        h('div', { className: 'zcd-card-title' }, title),
        kv(t('runs'), x ? String(x.runs) : '—'),
        kv(t('requests'), x ? String(x.requests) : '—'),
        kv(t('inTok'), x ? fmtTokens(x.inputTokens) : '—'),
        kv(t('outTok'), x ? fmtTokens(x.outputTokens) : '—'),
        kv(t('cacheTok'), x ? fmtTokens(x.cacheReadTokens) : '—'));
      // 引擎本周已用（plan-quota 数据接线）：仅在数据源给出可用 week.used 时显示
      const wk = planQuota && planQuota.available && Array.isArray(planQuota.windows)
        ? planQuota.windows.find((x) => x && x.id === 'week')
        : null;
      return h('div', null,
        h('div', { className: 'zcd-planline' }, t('localNote')),
        h('div', { className: 'zcd-cards' },
          card(t('usage5h'), w && w.last5h),
          card(t('usageWeek'), w && w.week),
          card(t('usageToday'), w && w.today)),
        wk && wk.used != null ? h('div', { className: 'zcd-planline' }, `${t('engineWeekUsed')}：${fmtTokens(wk.used)} tok`) : null,
        h('div', { className: 'zcd-planline' }, t('planQuotaPending')));
    }

    function LockStatus({ snapshot }) {
      const holderOf = (rec) => {
        if (!rec) return t('idle');
        const j = (snapshot?.jobs ?? []).find((x) => x.id === rec.jobId);
        return (j && j.tag) ?? shortId(rec.jobId);
      };
      return h('div', { className: 'zcd-row' },
        h('span', { className: 'zcd-label' }, t('repoLock')),
        h('span', { className: 'zcd-badge' }, holderOf(snapshot && snapshot.locks && snapshot.locks.repo)),
        h('span', { className: 'zcd-label' }, t('memoryLock')),
        h('span', { className: 'zcd-badge' }, holderOf(snapshot && snapshot.locks && snapshot.locks.memory)),
        h('span', { className: 'zcd-label' }, t('queueLen')),
        h('span', { className: 'zcd-badge' }, String((snapshot && snapshot.queue ? snapshot.queue.length : 0))),
      );
    }

    function FloatingPanel() {
      const [pos, setPos] = useState(() => loadJson(LS.pos, null));
      const [width, setWidth] = useState(() => clampWidth(loadJson(LS.size, null)?.width));
      const [collapsed, setCollapsed] = useState(() => !!loadJson(LS.collapsed, false));
      const [minimized, setMinimized] = useState(false);
      const [lastJobId, setLastJobId] = useState(null);
      const [feedback, setFeedback] = useState(null);
      const [busy, setBusy] = useState(false);
      const {
        conn, snapshot, quota, planQuota, dispatch, kill, tail,
        channels, channelGet, channelSet, retry, fallbackGet, fallbackSet,
      } = useWire();
      const rootRef = useRef(null);
      // Z6：通道清单 / 默认通道 / 降级链（挂载时拉一次；切换即时回显，wire 返回后用权威值校正）
      const [channelsInfo, setChannelsInfo] = useState({ channels: [], warnings: [] });
      const [channel, setChannelState] = useState({ provider: 'plan', model: 'GLM-5.3-Flash' });
      const [fallback, setFallbackState] = useState({ enabled: false, chain: [] });
      useEffect(() => {
        let alive = true;
        Promise.resolve(channels()).then((r) => {
          if (alive && r && r.ok) setChannelsInfo({ channels: r.channels ?? [], warnings: r.warnings ?? [] });
        });
        Promise.resolve(channelGet()).then((r) => {
          if (alive && r && r.ok && r.channel && r.channel.provider) setChannelState(r.channel);
        });
        Promise.resolve(fallbackGet()).then((r) => {
          if (alive && r && r.ok) setFallbackState({ enabled: !!r.enabled, chain: r.chain ?? [] });
        });
        return () => {
          alive = false;
        };
      }, [channels, channelGet, fallbackGet]);

      const onSwitch = useCallback((c) => {
        setChannelState((prev) => ({ ...prev, ...c }));
        Promise.resolve(channelSet(c)).then((r) => {
          if (r && r.ok && r.channel) setChannelState(r.channel);
        });
      }, [channelSet]);
      const onRetry = useCallback((id, opts) => retry(id, opts), [retry]);
      const onFallbackSet = useCallback((list) => {
        Promise.resolve(fallbackSet(list)).then((r) => {
          if (r && r.ok) setFallbackState({ enabled: !!r.enabled, chain: r.chain ?? [] });
        });
      }, [fallbackSet]);

      const onSubmit = useCallback(async (spec) => {
        if (!spec) {
          setFeedback({ kind: 'err', text: t('errEmpty') });
          return;
        }
        setBusy(true);
        setFeedback({ kind: 'ok', text: t('sending') });
        try {
          const r = await dispatch(spec);
          if (r && r.ok) {
            setLastJobId(r.job.id);
            setFeedback({ kind: 'ok', text: `${t('fbQueued')}${r.job.id}` });
          } else {
            setFeedback({ kind: 'err', text: `${t('errPrefix')}${(r && r.error) || 'unknown'}` });
          }
        } catch (e) {
          setFeedback({ kind: 'err', text: `${t('errPrefix')}${(e && e.message) ?? e}` });
        } finally {
          setBusy(false);
        }
      }, [dispatch]);

      const onKill = useCallback((id) => {
        Promise.resolve(kill(id)).catch(() => { /* wire 已兜底返回 {ok:false}，这里只防未捕获 rejection */ });
      }, [kill]);

      // 交互元素上按下不启动拖动（否则标题栏的 setPointerCapture 会吃掉子按钮的 click）
      const isInteractive = (el) => !!(el && typeof el.closest === 'function' && el.closest('button,input,select,textarea,a,[role="button"]'));
      const startDrag = useCallback((e) => {
        if (e.button !== 0) return;
        if (isInteractive(e.target)) return;
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const offX = e.clientX - rect.left;
        const offY = e.clientY - rect.top;
        const target = e.currentTarget;
        const last = { left: rect.left, top: rect.top };
        const move = (ev) => {
          const w = el.offsetWidth || 1;
          const ht = el.offsetHeight || 1;
          last.left = Math.min(Math.max(EDGE, ev.clientX - offX), Math.max(EDGE, window.innerWidth - w - EDGE));
          last.top = Math.min(Math.max(EDGE, ev.clientY - offY), Math.max(EDGE, window.innerHeight - ht - EDGE));
          setPos({ left: last.left, top: last.top });
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          saveJson(LS.pos, { left: last.left, top: last.top });
        };
        try {
          target.setPointerCapture(e.pointerId);
        } catch { /* 无捕获也能拖（老内核） */ }
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }, []);

      const startResize = useCallback((e) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startW = rootRef.current ? rootRef.current.offsetWidth : WIDTH.def;
        const target = e.currentTarget;
        let w = startW;
        const move = (ev) => {
          w = clampWidth(startW - (ev.clientX - startX));
          setWidth(w);
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          saveJson(LS.size, { width: w });
        };
        try {
          target.setPointerCapture(e.pointerId);
        } catch { /* 同上 */ }
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }, []);

      // 主题令牌以 CSS 自定义属性注入，TOKENS(T) 是唯一替换点
      const cssVars = {
        '--zcd-w': `${width}px`,
        '--zcd-bg': T.bg, '--zcd-bgBar': T.bgBar, '--zcd-sunken': T.sunken, '--zcd-hover': T.hover,
        '--zcd-accent': T.accent, '--zcd-onAccent': T.onAccent, '--zcd-border': T.border, '--zcd-shadow': T.shadow,
        '--zcd-text': T.text, '--zcd-text2': T.text2, '--zcd-text3': T.text3, '--zcd-danger': T.danger, '--zcd-mono': T.mono,
        '--zcd-st-queued': T.stQueued, '--zcd-st-running': T.stRunning, '--zcd-st-done': T.stDone,
        '--zcd-st-failed': T.stFailed, '--zcd-st-killed': T.stKilled, '--zcd-st-interrupted': T.stInterrupted,
        '--zcd-st-idle': T.stIdle,
      };
      const rootStyle = pos
        ? { ...cssVars, left: `${pos.left}px`, top: `${pos.top}px` }
        : { ...cssVars, right: '24px', bottom: '24px' };

      if (minimized) {
        const running = (snapshot && snapshot.counts && snapshot.counts.running) || 0;
        const waiting = running + ((snapshot && snapshot.counts && snapshot.counts.queued) || 0);
        return h('div', { className: 'zcd-root zcd-min', style: rootStyle },
          h('style', null, CSS),
          h('button', { className: 'zcd-pill', title: t('restore'), onClick: () => setMinimized(false) },
            h(StatusDot, { state: running > 0 ? 'running' : 'idle' }),
            h('span', null, waiting > 0 ? String(waiting) : '·')));
      }

      const runningNow = ((snapshot && snapshot.counts && snapshot.counts.running) || 0) > 0;
      const connLabel = conn === 'demo' ? t('connDemo') : conn === 'ext' ? t('connExt') : conn === 'live' ? t('connLive') : t('connConnecting');

      return h('div', { ref: rootRef, className: 'zcd-root', style: rootStyle, role: 'region', 'aria-label': t('title') },
        h('style', null, CSS),
        h('div', { className: 'zcd-panel' },
          h('div', { className: 'zcd-titlebar', onPointerDown: startDrag },
            h(StatusDot, { state: runningNow ? 'running' : 'idle' }),
            h('span', { className: 'zcd-title' }, t('title')),
            h('span', { className: 'zcd-conn' }, connLabel),
            h('button', {
              className: 'zcd-iconbtn', title: t('collapse'), 'aria-label': t('collapse'), 'aria-expanded': !collapsed,
              onPointerDown: (e) => e.stopPropagation(),
              onClick: () => {
                const nv = !collapsed;
                setCollapsed(nv);
                saveJson(LS.collapsed, nv);
              },
            }, h(IconChevron, { up: collapsed })),
            h('button', { className: 'zcd-iconbtn', title: t('minimize'), 'aria-label': t('minimize'), onPointerDown: (e) => e.stopPropagation(), onClick: () => setMinimized(true) }, h(IconMinus)),
          ),
          collapsed ? null : h('div', { className: 'zcd-body' },
            h(Section, { title: t('secChannel') },
              h(ChannelSection, { channelsInfo, channel, fallback, onSwitch, onFallbackSet })),
            h(Section, { title: t('secDispatch') },
              h(DispatchBar, { snapshot, lastJobId, feedback, busy, channel, onSubmit })),
            h(Section, { title: t('secJobs') },
              h(JobList, { snapshot, onKill, onTail: tail, onRetry, channels: channelsInfo.channels, refreshKey: (snapshot && snapshot.generatedAt) || '' })),
            h(Section, { title: t('secQuota') },
              h(QuotaCards, { quota, planQuota })),
            h(Section, { title: t('secLocks') },
              h(LockStatus, { snapshot })),
          ),
        ),
        collapsed ? null : h('div', { className: 'zcd-grip', title: t('grip'), 'aria-label': t('grip'), onPointerDown: startResize }),
      );
    }

    return {
      // 只依赖宿主必定提供的 `slots` 与 `remote` 基础服务。
      // ⚠️ 绝不能把自家的 `remote.zcodeDispatch` 写进 inject：该命名空间正是 apply() 里
      // $mount 才挂上的——声明它等于"等自己"，条目会永远 pending，导致 web boot 直接失败：
      //   web boot: 1 entry did not activate
      //   @local/zcode-dispatch: pending (waiting for service: remote.zcodeDispatch)
      // 命名空间是否就绪改用运行时探测（createWire / MOD_CTX），缺席即降级 demo/ext。
      inject: ['slots', 'remote'],
      apply(ctx) {
        // 整个 apply 兜底：任何异常都不许冒泡（冒泡 = 条目激活失败 = web boot 失败）。
        // 2026-09-30 曾因 inject 自声明 remote 命名空间导致启动死锁，此后按"启动绝不因插件失败"设防。
        try {
          MOD_CTX = ctx; // createWire 据此探测远端面；apply 未跑或无 remote 时走 ext/demo 降级
          // 第三方本地包不被构建期内联进 api-remotes 聚合，须在 apply 自挂 remote.zcodeDispatch
          // 子服务（同形调用见 extracted/dsh-api-remotes/lib/client.js:13505-13540）。$mount
          // 返回「命名空间就绪后可用的 disposer」，随客户端 ctx 生命周期存续；这里不持有它
          // （客户端模块表未给 apply 提供卸载通道），拒绝路径用 catch 吞掉，不白屏。
          try {
            const mounted = ctx?.remote && typeof ctx.remote.$mount === 'function' && ctx.remote.$mount(REMOTE_CONTRIBUTION);
            if (mounted && typeof mounted.catch === 'function') mounted.catch(() => { /* 远端面挂载失败：wire 走降级 */ });
          } catch { /* 同上：远端面不可达不致命 */ }
          // list 型槽位：id 必填且同 priority 下唯一；id 遵循宿主先例的 <功能>.<物> 命名
          // （对照 chat.quota-notice / plugin-manager.refresh-toast / workspace.row-toast）
          ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: 'zcode-dispatch.console', order: 20 },
            () => h(PanelBoundary, null, h(FloatingPanel))));
        } catch (e) {
          try { console.warn('[zcode-dispatch] apply 降级（不阻塞启动）:', e && e.message); } catch { /* 连 console 都不可用就彻底静默 */ }
        }
      },
    };
  },
});
