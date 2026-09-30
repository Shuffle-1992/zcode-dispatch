/**
 * @local/zcode-dispatch —— Client 半边：DSH Web 页面里的「ZCode 派发台」悬浮窗。
 * 纯 JS + React.createElement（无构建 / 无 JSX / 无 npm 依赖）；唯一外部模块为 react（经宿主模块表注入）。
 *
 * 行为：右下角贴边悬浮窗，标题栏可拖拽（pointer events），可折叠，可最小化为圆角小胶囊；
 * 位置/尺寸/折叠态存 localStorage（key 带插件前缀）。五个分区均可折叠（通道/派发/单写者
 * 默认收起，进程/用量默认展开，折叠态存 localStorage）：通道（切换器+降级链）/ 派发栏 /
 * 进程列表（行头点击展开派发要素；paused 暂停态带同通道续跑/换通道交接重跑/关闭）/
 * 用量卡片 / 单写者状态。
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
 * 远端缺席/挂载失败时逐级回退：window 外部数据源 → 诚实空态（offline），绝不白屏；
 * 内置 demo 引擎默认不启用（Z11：仅当 window.__zcodeDispatchDemo === 'builtin' 时使用，便于排查）。
 *
 * 真数据 vs demo 判据（面板标题栏徽标，connLabel）：
 * - 「已连接」（conn='live'）：数据来自 ctx.remote.zcodeDispatch 远端面——真 ZCode
 *   子进程与真用量台账（宿主 face 已注册时才有）；
 * - 「外部数据」（conn='ext'）：window.__zcodeDispatchDemo 注入的外部数据源；
 * - 「演示数据」（conn='demo'）：内置演示引擎（纯前端假数据，需显式 'builtin' 开启）；
 * - 「未连接」（conn='offline'）：远端与外部源都没有——诚实空态，不渲染任何假行；
 * - 「连接中」：尚未收到任何数据包（连接建立前的一次渲染）。
 */
window.__ModuleLoader__.load({
  id: '@local/zcode-dispatch',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useLayoutEffect } = React;

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
      pinned: 'zcode-dispatch:panel:pinned:v1', // ZB-08：固定（锁定位置，禁止拖动）true/false
    };
    /* Z11：分区折叠——id 常量集中一处（勿散落魔法字符串），折叠态存
     * localStorage['zcode-dispatch:section:<id>']（复用 loadJson/saveJson，自带 try/catch）。 */
    const SEC = { channel: 'channel', dispatch: 'dispatch', jobs: 'jobs', quota: 'quota', locks: 'locks' };
    const secKey = (id) => `zcode-dispatch:section:${id}`;
    // 默认展开/收起：通道与派发收起（少滚动）；进程与用量展开（主信息）；单写者收起
    const SEC_DEFAULT_OPEN = { [SEC.channel]: false, [SEC.dispatch]: false, [SEC.jobs]: true, [SEC.quota]: true, [SEC.locks]: false };
    // z-index 仅约束浮层自身的层级（不写全局样式、不碰宿主 DOM），取固定较大值避免被页面浮层盖住
    const Z_INDEX = 2000000000;
    const WIDTH = { min: 320, max: 600, def: 440 };
    /* ZB-06：面板高度可调 + 持久化。未设置时 height=null → CSS 走 auto + max-height:min(72vh,560px)
     * （与旧行为完全一致，不改变老用户的观感）；一旦用户拖过就把高度固定，由 .zcd-body 内部滚动。
     * 上限随视口收敛，避免把面板拖到屏幕外。 */
    const HEIGHT = { min: 160 };
    const maxPanelHeight = () => {
      const vh = (typeof window !== 'undefined' && Number(window.innerHeight)) || 900;
      return Math.max(HEIGHT.min, Math.min(1200, vh - 80));
    };
    const clampHeight = (n) => Math.min(maxPanelHeight(), Math.max(HEIGHT.min, Math.round(Number(n) || HEIGHT.min)));
    /* ZB-07：进程分组内默认只展开最近 N 条 —— 进程累计上限是 1000 条（JOBS_FILE_CAP），
     * 全量渲染会让面板变成一条几百行的长列表。其余折进「还有 N 条更早的」按钮。 */
    const JOB_GROUP_PREVIEW = 5;
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
      /* ⚠️ Z14：官方 shell.overlay 浮层本身是 click-through（pointer-events:none）——
       * occupant 必须自行 opt-in 回 pointer events，否则面板内所有点击都会穿透到后面的应用
       * （这正是"按钮点了没反应"的真因；Z9 修的 setPointerCapture 只是第二因）。
       * 策略：root 保持 none（浮层空白区不挡应用），面板/胶囊/把手各自 auto（可点可拖）。 */
      '.zcd-root{position:fixed;z-index:' + Z_INDEX + ';pointer-events:none;width:min(var(--zcd-w,' + WIDTH.def + 'px),calc(100vw - 32px));font-size:12px;line-height:1.6;color:' + T.text + ';}',
      /* ZB-17：本面板子树统一 border-box。此前全文件**没有任何 box-sizing 规则**，
       * 而 `.zcd-ta{width:100%}` 同时带 `padding:5px 8px` + `border:1px` ⇒ 默认 content-box 下
       * 实际宽度 = 100% + 18px，输入框必然冲出右边界（用户报告）。
       * 作用域严格限定在 .zcd-root 之内：不碰宿主 shell，也不碰应用其他区域的样式。
       * 顺带消除同类隐患（所有带 padding 的 select/input/card 都受影响）。 */
      '.zcd-root,.zcd-root *{box-sizing:border-box;}',
      '.zcd-root.zcd-min{width:auto;}',
      '.zcd-panel{position:relative;display:flex;flex-direction:column;pointer-events:auto;height:var(--zcd-h,auto);max-height:var(--zcd-h,min(72vh,560px));background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:10px;box-shadow:' + T.shadow + ';overflow:hidden;animation:zcd-in .18s ease;}',
      '.zcd-titlebar{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;border-bottom:1px solid var(--zcd-border);background:' + T.bgBar + ';}',
      '.zcd-titlebar:active{cursor:grabbing;}',
      /* ZB-08：已固定 → 标题栏不再给出「可拖」的视觉承诺（拖动逻辑本身也会早退） */
      '.zcd-titlebar.zcd-locked{cursor:default;}',
      '.zcd-titlebar.zcd-locked:active{cursor:default;}',
      '.zcd-title{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.zcd-conn{flex:none;font-size:10px;line-height:1.7;padding:1px 7px;border:1px solid ' + T.border + ';border-radius:8px;color:' + T.text2 + ';}',
      // Z12 派发总开关徽标：非 live=只读 span；live=可点 button（hover 反馈，busy 半透明）
      '.zcd-switch{display:inline-flex;align-items:center;gap:4px;}',
      '.zcd-switch .zcd-dot{width:6px;height:6px;}',
      'button.zcd-switch{background:transparent;font:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease;}',
      'button.zcd-switch:hover{background:' + T.hover + ';color:' + T.text + ';}',
      'button.zcd-switch:disabled{opacity:.5;cursor:default;}',
      '.zcd-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:5px;background:transparent;color:' + T.text2 + ';cursor:pointer;transition:background-color .15s ease,color .15s ease;}',
      '.zcd-iconbtn:hover{background:' + T.hover + ';color:' + T.text + ';}',
      '.zcd-body{display:flex;flex-direction:column;gap:10px;padding:10px;overflow:auto;min-height:0;overscroll-behavior:contain;}',
      /* ZB-16：**分区内部**的纵向节奏容器。此前 ChannelSection / QuotaCards 的根是
       * `h('div', null, …)` —— 没有 class、没有 gap，于是 `.zcd-sec` 的 gap 完全管不到它们内部，
       * 两个下拉、说明文字全贴在一起（用户报告「2 个下拉框挨一起了」）。
       * DispatchBar 的 `.zcd-dispatch` 更彻底：连 CSS 规则都不存在。统一走这个 stack。 */
      '.zcd-stack{display:flex;flex-direction:column;gap:10px;min-width:0;}',
      '.zcd-dispatch{display:flex;flex-direction:column;gap:10px;min-width:0;}',
      '.zcd-sec{display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid ' + T.border + ';border-radius:8px;min-width:0;}',
      '.zcd-sec-title{font-size:11px;font-weight:600;letter-spacing:.02em;color:' + T.text2 + ';}',
      // Z11 可折叠分区：整条标题栏可点击切换（含 hover/键盘焦点态与倒三角指示）
      '.zcd-sec-head{display:flex;align-items:center;gap:8px;min-height:22px;cursor:pointer;user-select:none;-webkit-user-select:none;border-radius:4px;transition:background-color .15s ease;}',
      '.zcd-sec-head:hover{background:' + T.hover + ';}',
      '.zcd-sec-head:focus-visible{outline:1px solid ' + T.text3 + ';outline-offset:2px;}',
      '.zcd-sec-caret{flex:none;display:inline-flex;color:' + T.text3 + ';}',
      '.zcd-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.zcd-label{color:' + T.text2 + ';white-space:nowrap;}',
      /* ZB-14：通道/模型的固定两行表单（标签 + 下拉）。刻意**不换行**：
       * flex-wrap 会让 4 个元素随面板宽度改行，两个下拉的宽度又各随内容变 —— 版式就"乱跑"了。
       * 标签 nowrap 取自然宽；下拉 flex:1 且 min-width:0（否则 select 不会缩到内容宽以下而撑破行）。 */
      '.zcd-field{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;}',
      '.zcd-field-k{flex:none;white-space:nowrap;color:' + T.text2 + ';}',
      '.zcd-field-v{flex:1 1 auto;min-width:0;}',
      '.zcd-select,.zcd-input,.zcd-ta{background:' + T.sunken + ';color:' + T.text + ';border:1px solid ' + T.border + ';border-radius:6px;padding:5px 8px;font:inherit;outline:none;transition:border-color .15s ease;}',
      '.zcd-select:focus,.zcd-input:focus,.zcd-ta:focus{border-color:' + T.text3 + ';}',
      '.zcd-ta{width:100%;min-height:60px;resize:vertical;}',
      '.zcd-btn{display:inline-flex;align-items:center;padding:6px 16px;border:none;border-radius:6px;background:' + T.accent + ';color:' + T.onAccent + ';font:inherit;font-weight:600;cursor:pointer;transition:filter .15s ease,transform .05s ease;}',
      '.zcd-btn:hover{filter:brightness(1.08);}',
      '.zcd-btn:active{transform:translateY(1px);}',
      '.zcd-btn:disabled{opacity:.5;cursor:default;}',
      '.zcd-feedback{min-height:18px;font-size:11px;line-height:1.6;color:' + T.text2 + ';}',
      '.zcd-feedback.zcd-err{color:' + T.danger + ';}',
      '.zcd-jobs{display:flex;flex-direction:column;gap:8px;}',
      /* ZB-03：进程分组（进行中/需处理/异常/已完成）。分层用字号+缩进，不引入字面色值。 */
      '.zcd-group{display:flex;flex-direction:column;gap:8px;}',
      '.zcd-group-head{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:10.5px;font-weight:600;color:' + T.text3 + ';}',
      '.zcd-group-body{display:flex;flex-direction:column;gap:8px;padding-left:2px;}',
      /* ZB-09：进程状态分类改为 Tab 分页（不再把所有分组堆在同一页） */
      '.zcd-tabs{display:flex;gap:6px;flex-wrap:wrap;}',
      '.zcd-tab{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border:1px solid var(--zcd-border);border-radius:999px;background:transparent;color:var(--zcd-text3);font:inherit;font-size:11px;line-height:1.7;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease;}',
      '.zcd-tab:hover{background:var(--zcd-hover);color:var(--zcd-text);}',
      '.zcd-tab.zcd-tab-on{background:var(--zcd-hover);color:var(--zcd-text);border-color:var(--zcd-text3);}',
      '.zcd-tab-n{font-size:10px;opacity:.75;}',
      '.zcd-empty{color:' + T.text3 + ';}',
      /* ZB-16：行内也走容器 gap（原先靠各块自带 marginTop，头与反馈行之间是贴着的） */
      '.zcd-job{display:flex;flex-direction:column;gap:8px;border:1px solid ' + T.border + ';border-radius:6px;padding:7px 9px;}',
      '.zcd-job-head{display:flex;align-items:center;gap:8px;min-height:24px;flex-wrap:wrap;}',
      '.zcd-job-tag{font-weight:600;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.zcd-dim{color:' + T.text3 + ';white-space:nowrap;}',
      '.zcd-spring{flex:1;}',
      '.zcd-badge{flex:none;font-size:10px;line-height:1.6;padding:1px 5px;border:1px solid ' + T.border + ';border-radius:4px;color:' + T.text2 + ';white-space:nowrap;}',
      /* ZB-18：锁类型视觉区分（不引入字面色值，复用主题令牌）：
       *   整仓库锁 = 更"重"（实线边框 + 主文本色），文件锁 = 更"轻"（次要色），旧版记录 = 危险色提示。 */
      '.zcd-badge.zcd-lock-repo{color:' + T.text + ';border-color:' + T.text3 + ';}',
      '.zcd-badge.zcd-lock-file{color:' + T.text2 + ';}',
      '.zcd-badge.zcd-lock-legacy{color:' + T.danger + ';border-color:' + T.danger + ';}',
      '.zcd-dot{flex:none;width:8px;height:8px;border-radius:50%;background:' + T.stIdle + ';}',
      '.zcd-dot.s-queued{background:' + T.stQueued + ';}',
      '.zcd-dot.s-running{background:' + T.stRunning + ';animation:zcd-pulse 1.2s ease-in-out infinite;}',
      '.zcd-dot.s-done{background:' + T.stDone + ';}',
      '.zcd-dot.s-failed{background:' + T.stFailed + ';}',
      '.zcd-dot.s-killed{background:' + T.stKilled + ';}',
      '.zcd-dot.s-interrupted{background:' + T.stInterrupted + ';}',
      '.zcd-dot.s-paused{background:' + T.stPaused + ';animation:zcd-pulse 2.4s ease-in-out infinite;}',
      '.zcd-badge.s-paused{color:' + T.warnLabel + ';border-color:' + T.warnLabel + ';}',
      '.zcd-btn2{display:inline-flex;align-items:center;padding:4px 12px;border:1px solid ' + T.border + ';border-radius:6px;background:transparent;color:' + T.text2 + ';font:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease;}',
      '.zcd-btn2:hover{background:' + T.hover + ';color:' + T.text + ';border-color:' + T.text3 + ';}',
      '.zcd-btn2:disabled{opacity:.45;cursor:default;}',
      '.zcd-btn2:active{transform:translateY(1px);}',
      '.zcd-note{font-size:10.5px;line-height:1.6;color:' + T.text3 + ';white-space:normal;overflow-wrap:anywhere;}',
      '.zcd-chain{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}',
      '.zcd-tailwrap{margin-top:0;}',
      '.zcd-mono{max-height:160px;overflow:auto;padding:6px;background:' + T.sunken + ';border-radius:4px;font-family:' + T.mono + ';font-size:10.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all;}',
      '.zcd-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;}',
      '.zcd-card{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding:8px;border:1px solid ' + T.border + ';border-radius:6px;}',
      '.zcd-card-title{font-size:10px;font-weight:600;color:' + T.text2 + ';}',
      '.zcd-kv{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;line-height:1.55;min-width:0;}',
      '.zcd-kv-k{color:' + T.text3 + ';}',
      // Z11 行展开详情：子块容器 + 值列长值换行 + 行 hover 反馈（行头可点击展开）
      '.zcd-detail{display:flex;flex-direction:column;gap:5px;margin-top:6px;}',
      '.zcd-kv-v{overflow-wrap:anywhere;text-align:right;}',
      '.zcd-job{transition:border-color .15s ease;}',
      '.zcd-job:hover{border-color:' + T.text3 + ';}',
      '.zcd-job-head{cursor:pointer;}',
      '.zcd-planline{margin-top:4px;font-size:10.5px;color:' + T.text3 + ';white-space:normal;overflow-wrap:anywhere;line-height:1.55;}',
      /* ZB-11：缩放手柄**固定右下角**（用户要求「仅右下角可以控制」），并带一个三角标让它一眼可辨。
       * 手柄侧不再随锚定切换 —— 改为在拖拽开始时把面板钉成 left/top 锚定（见 startResize），
       * 于是"右移变宽、下移变高"永远成立，手柄与光标同向。 */
      '.zcd-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;pointer-events:auto;cursor:nwse-resize;display:flex;align-items:flex-end;justify-content:flex-end;color:var(--zcd-text3);}',
      '.zcd-grip:hover{color:var(--zcd-text);}',
      '.zcd-pill{display:inline-flex;align-items:center;gap:6px;pointer-events:auto;padding:5px 12px;border:1px solid ' + T.border + ';border-radius:999px;background:' + T.bg + ';color:' + T.text + ';box-shadow:' + T.shadow + ';cursor:pointer;font:inherit;transition:transform .15s ease;}',
      '.zcd-pill:hover{transform:translateY(-1px);}',
      /* ZB-06：胶囊要能一眼看出「这是什么」——标题常驻，计数与状态按需出现。 */
      '.zcd-pill-title{font-weight:600;white-space:nowrap;}',
      '.zcd-pill-n{flex:none;min-width:16px;text-align:center;font-size:10px;font-weight:600;padding:0 4px;border-radius:999px;background:' + T.hover + ';color:' + T.text + ';}',
      '.zcd-pill-state{color:' + T.text3 + ';white-space:nowrap;}',
      /* ZB-08：文件锁列表（哪个文件被哪个进程锁着、锁了多久） */
      '.zcd-locks{display:flex;flex-direction:column;gap:6px;}',
      '.zcd-filelocks{display:flex;flex-direction:column;gap:3px;}',
      '.zcd-filelock{display:flex;align-items:center;gap:6px;font-size:10.5px;min-width:0;}',
      '.zcd-filelock-f{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + T.text2 + ';}',
      '.zcd-filelock-who{flex:none;font-weight:600;color:' + T.text + ';}',
      '@keyframes zcd-in{from{opacity:0;transform:translateY(6px) scale(.98);}}',
      '@keyframes zcd-pulse{50%{opacity:.35;}}',
    ].join('\n');

    /* ─────────────── 文案（与 locale/zh.json、locale/en.json 的 ui 段同源；接线后可改走宿主 locale 服务） ─────────────── */
    const STRINGS = {
      zh: {
        title: 'ZCode 派发台',
        connConnecting: '连接中', connDemo: '演示数据', connExt: '外部数据', connLive: '已连接', connOffline: '未连接',
        collapse: '折叠 / 展开', minimize: '最小化为胶囊', restore: '展开派发台', grip: '拖拽调整宽高（自动保存）',
        pillRunning: '运行中', pillQueued: '排队中', pillIdle: '空闲',
        pin: '固定位置（固定后不可拖动）', unpin: '取消固定（恢复可拖动）',
        secDispatch: '派发', secJobs: '进程', secQuota: '用量', secLocks: '仓库文件锁',
        noFileLocks: '（当前没有文件锁：任务未声明 write，走仓库整锁）',
        kind: '类型', kindPrompt: '提示词', kindTask: '任务文件', kindTarget: '目标',
        phPrompt: '输入要发给 ZCode 的提示词…', phTask: '任务文件绝对路径…', phTarget: '要达成的目标…',
        model: '模型', provider: '通道', providerPlan: '套餐', providerPersonal: '个人 Key',
        mode: '模式', timeout: '超时(分)', bench: '--memory-bench',
        dispatch: '派发', queuedBtn: '排队中…', runningBtn: '执行中…', sending: '提交中…',
        fbQueued: '已排队：', errPrefix: '失败：', errEmpty: '请先填写内容',
        content: '内容', noJobs: '暂无进程记录', exit: '退出', kill: '终止', tail: '输出', tailLoading: '读取中…', tailEmpty: '（无输出）',
        closeJob: '关闭', cwd: '工作目录', createdAt: '创建于', sessionId: '会话',
        grpActive: '进行中', grpPaused: '需处理', grpFailed: '异常', grpDone: '已完成', grpOther: '其他',
        jobMore: '还有', jobMoreN: '条更早的', jobCollapse: '收起',
        rerun: '重跑', rerunTitle: '同会话重发原提示词（--resume；无 sessionId 则交接重跑）',
        continueBtn: '续接', continueTitle: '在同一会话里发一条新指令（--resume + 新提示词）',
        continueNoSession: '该任务没有 sessionId，无法续接（可先用「重跑」交接重跑）',
        continuePh: '输入要接续的指令…', continueSend: '发送',
        emptyOffline: '未连接宿主：无进程数据（真数据需完成 Remote 接线）',
        usage5h: '5 小时窗口', usageWeek: '本周', usageToday: '今日',
        runs: 'run 数', requests: '请求', inTok: '输入', outTok: '输出', cacheTok: '缓存读',
        localNote: '本地用量（可核对）：台账聚合的 5 小时 / 本周 / 今日窗口',
        engineWeekUsed: '引擎本周已用（引擎本地库合计，非套餐已用）',
        planQuotaPending: '套餐剩余额度：未接入 —— CLI RPC 面无此方法（app-server usage/stats 语义是「本地已用」）；以 ZCode 客户端为准',
        repoLock: '仓库锁', memoryLock: 'Zcode 记忆锁', queueLen: '队列', idle: '空闲', lockHeld: '持有仓库锁',
        repoLockCb: '仓库文件锁', writePh: '要写的文件（逗号或换行分隔；留空=锁整个仓库）', writeHint: '只锁这些文件 ⇒ 与写其它文件的任务可并发执行',
        writeFiles: '要写入的文件列表', lockNoneHint: '不取锁（确认无竞写关系时才用）',
        lockScopeHint: '只锁上面列出的文件；留空则锁整个仓库（与其它任务互斥）',
        secChannel: '通道', chanNewTask: '新任务将使用：', chanDisabled: '不可用', chanLoadFail: '通道清单加载失败',
        chanOfflineHint: '未连接宿主：通道/模型来自宿主远端面，连接后这两个下拉才可选',
        chanDefaultModel: '（通道默认模型）',
        paused: '已暂停', pQuota: '额度耗尽', pEntitled: '未开通', pSigning: '需签名', pConfig: '配置错误', pUnknown: '未知原因',
        resumeSame: '同通道续跑', retryHandoff: '换通道重跑', noSession: '无会话，不能同通道续跑',
        handoffConfirm: '换通道=交接重跑：会新开会话并把未完成部分交接过去', confirmHandoff: '确认交接重跑', cancel: '取消',
        parentFrom: '接续自', hop: '跳',
        fallbackTitle: '自动降级链', fallbackStateOff: '关', fallbackStateOn: '开',
        fallbackPh: '通道 id，逗号分隔，按顺序', fallbackSave: '开启降级链', fallbackOffBtn: '关闭降级链',
        fallbackConfirm2: '再次点击确认：会自动消耗下游通道额度', fallbackSaved: '降级链已更新：', fallbackEmptyErr: '请先填写至少一个通道 id',
        switchOn: '派发：开', switchOff: '派发：关', switchUnknown: '派发：未知',
        switchTitle: 'ZCode 派发总开关：点击切换（写入 collab/zcode-dispatch.switch.json，全部会话生效）',
        switchHintOffline: '未连接宿主：请在终端执行 zcode-switch.mjs 切换',
        switchOffBlocked: '派发总开关已关闭：所有派发入口都被拒绝；请先用标题栏开关或 zcode-switch.mjs 恢复',
      },
      en: {
        title: 'ZCode Dispatch Console',
        connConnecting: 'connecting', connDemo: 'demo data', connExt: 'external', connLive: 'live', connOffline: 'offline',
        collapse: 'Collapse / Expand', minimize: 'Minimize to pill', restore: 'Restore console', grip: 'Drag to resize (saved automatically)',
        pillRunning: 'running', pillQueued: 'queued', pillIdle: 'idle',
        pin: 'Pin position (no dragging while pinned)', unpin: 'Unpin (allow dragging again)',
        secDispatch: 'Dispatch', secJobs: 'Processes', secQuota: 'Usage', secLocks: 'Repo file locks',
        noFileLocks: '(no file locks: jobs did not declare write, using whole-repo lock)',
        kind: 'Kind', kindPrompt: 'Prompt', kindTask: 'Task file', kindTarget: 'Target',
        phPrompt: 'Prompt to send to ZCode…', phTask: 'Absolute path of task file…', phTarget: 'Goal to achieve…',
        model: 'Model', provider: 'Channel', providerPlan: 'Plan', providerPersonal: 'Personal key',
        mode: 'Mode', timeout: 'Timeout (min)', bench: '--memory-bench',
        dispatch: 'Dispatch', queuedBtn: 'Queued…', runningBtn: 'Running…', sending: 'Sending…',
        fbQueued: 'Queued: ', errPrefix: 'Failed: ', errEmpty: 'Content is required',
        content: 'Content', noJobs: 'No process records yet', exit: 'exit', kill: 'Kill', tail: 'Tail', tailLoading: 'Loading…', tailEmpty: '(no output)',
        closeJob: 'Close', cwd: 'Workdir', createdAt: 'Created', sessionId: 'Session',
        grpActive: 'Running', grpPaused: 'Needs action', grpFailed: 'Failed', grpDone: 'Completed', grpOther: 'Other',
        jobMore: 'Show', jobMoreN: 'older', jobCollapse: 'Collapse',
        rerun: 'Rerun', rerunTitle: 'Re-send the original prompt in the same session (--resume; without a sessionId it hands off)',
        continueBtn: 'Continue', continueTitle: 'Send a NEW instruction into the same session (--resume + new prompt)',
        continueNoSession: 'This task has no sessionId, so it cannot be continued (use Rerun to hand off instead)',
        continuePh: 'Instruction to continue with…', continueSend: 'Send',
        emptyOffline: 'Host not connected: no process data (live data needs the Remote wiring)',
        usage5h: '5h window', usageWeek: 'This week', usageToday: 'Today',
        runs: 'runs', requests: 'req', inTok: 'in', outTok: 'out', cacheTok: 'cache',
        localNote: 'Local usage (verifiable): ledger-aggregated 5h / week / today windows',
        engineWeekUsed: 'Engine week used (engine-local DB total, not plan usage)',
        planQuotaPending: 'Plan quota remaining: not wired — no such method on the CLI RPC surface (app-server usage/stats is local-used only); defer to the ZCode client',
        repoLock: 'Repo lock', memoryLock: 'Zcode memory lock', queueLen: 'queue', idle: 'idle', lockHeld: 'holds the repo lock',
        repoLockCb: 'Repo file lock', writePh: 'files to write (comma/newline separated; empty = whole repo)', writeHint: 'locks only these files, so tasks writing other files can run in parallel',
        writeFiles: 'files to write', lockNoneHint: 'no lock (only when no write conflict is possible)',
        lockScopeHint: 'locks only the files listed above; empty locks the whole repo (exclusive)',
        secChannel: 'Channels', chanNewTask: 'New tasks will use: ', chanDisabled: 'unavailable', chanLoadFail: 'Failed to load channels',
        chanOfflineHint: 'Host not connected: channel/model come from the host Remote face and unlock once connected',
        chanDefaultModel: '(channel default model)',
        paused: 'Paused', pQuota: 'Quota exhausted', pEntitled: 'Not entitled', pSigning: 'Signing required', pConfig: 'Config error', pUnknown: 'Unknown',
        resumeSame: 'Resume (same channel)', retryHandoff: 'Rerun on new channel', noSession: 'No session to resume',
        handoffConfirm: 'Channel switch = handoff rerun: a new session starts and the unfinished part is handed over', confirmHandoff: 'Confirm handoff', cancel: 'Cancel',
        parentFrom: 'continued from', hop: 'hop',
        fallbackTitle: 'Auto fallback chain', fallbackStateOff: 'Off', fallbackStateOn: 'On',
        fallbackPh: 'Channel ids, comma separated, in order', fallbackSave: 'Enable fallback', fallbackOffBtn: 'Disable fallback',
        fallbackConfirm2: 'Click again to confirm: downstream channel quota will be consumed', fallbackSaved: 'Fallback chain updated: ', fallbackEmptyErr: 'At least one channel id is required',
        switchOn: 'Dispatch: on', switchOff: 'Dispatch: off', switchUnknown: 'Dispatch: ?',
        switchTitle: 'ZCode dispatch master switch: click to toggle (writes collab/zcode-dispatch.switch.json, effective for all sessions)',
        switchHintOffline: 'Host not connected: run zcode-switch.mjs in a terminal to toggle',
        switchOffBlocked: 'Dispatch master switch is off: all dispatch entries are rejected; re-enable via the title-bar switch or zcode-switch.mjs',
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
    /* ZB-07：把保存的悬浮位置钳进当前视口（纯函数，便于独立测试）。
     * 为什么需要：localStorage 里的位置可能是脏值 —— 早期版本存的负数/越界值，
     * 或者存完之后用户把窗口缩小了。沿用脏值会让整个面板跑到屏幕外、彻底点不到。
     * 约束：left/top 都至少留 EDGE；上界为「视口 - 面板尺寸 - EDGE」，且不小于 EDGE
     * （面板比视口还大时退化为 EDGE，保证左上角可见而不是负数）。
     * @param {{left:number, top:number}|null} p
     * @param {{vw:number, vh:number, w:number, h:number}} view
     * @returns {{left:number, top:number}|null} null = 没存过位置（调用方走默认右下角）
     */
    /* ZB-11：浮动位置改为**锚定语义**（纯函数，便于独立测试）。
     *
     * 起因（用户报告）：「DSH 全屏时把派发台固定在右上角 → 缩到默认大小 → 派发台被挤到
     * 中间对话上面 → 再全屏，它仍留在中间」。
     *
     * 根因（★ 这正是 ZB-10「钳制」引入的反效果）：位置只存绝对 {left, top}。
     * 窗口缩小时钳制会把坐标**改写**进 pos 并落盘（left 被拉到视口内 ⇒ 落到中间）；
     * 再放大时钳制只保证"不越界"，**不会**把它还原回右上角 ⇒ 用户的意图被永久破坏。
     *
     * 正解：记住面板**贴的是哪条边**与**该方向的边距**，位置由「边距 + 当前视口」推导：
     *   贴右 ⇒ left = vw - w - rx   贴下 ⇒ top = vh - h - by
     *   贴左 ⇒ left = lx            贴上 ⇒ top = ty
     * 于是缩小窗口时它贴着右边一起收（仍在右上角），放大时自然回到右上角。
     * 四条边距在拖拽/固定时一次记录齐全，只有被锚定的那一对参与推导。
     *
     * @param {{left:number, top:number}} rect 面板当前矩形左上角
     * @param {{vw:number, vh:number, w:number, h:number}} view
     * @returns {{ax:'left'|'right', ay:'top'|'bottom', lx:number, ty:number, rx:number, by:number, left:number, top:number}}
     */
    function anchorOf(rect, view) {
      const vw = (view && view.vw) || 0, vh = (view && view.vh) || 0;
      const w = (view && view.w) || 0, h = (view && view.h) || 0;
      const left = Number(rect && rect.left) || 0;
      const top = Number(rect && rect.top) || 0;
      return {
        /* 面板中心落在视口哪一半 ⇒ 贴哪条边。
         * 用"中心过半"而不是"距边多近"：用户把面板放在右上角时中心在上半+右半，判定稳定；
         * 也天然覆盖"面板比视口还大"的退化情形（此时中心仍在某一半）。 */
        ax: left + w / 2 <= vw / 2 ? 'left' : 'right',
        ay: top + h / 2 <= vh / 2 ? 'top' : 'bottom',
        lx: left,
        ty: top,
        rx: Math.max(0, vw - left - w),
        by: Math.max(0, vh - top - h),
        left,
        top,
      };
    }

    /** 由锚定信息 + 当前视口推导实际位置；仍过一遍 clampPos 作安全网（绝不跑到视口外）。
     *  旧格式（只有 {left, top}，无 ax/ay）按"贴左+贴上"处理 —— 与旧行为一致，向后兼容。 */
    function resolvePos(p, view) {
      if (!p || typeof p !== 'object') return null;
      const vw = (view && view.vw) || 0, vh = (view && view.vh) || 0;
      const w = (view && view.w) || 0, h = (view && view.h) || 0;
      if (!vw || !vh) {
        // 拿不到视口尺寸时不猜，用记录里的绝对坐标
        return Number.isFinite(Number(p.left)) && Number.isFinite(Number(p.top))
          ? { left: Number(p.left), top: Number(p.top) }
          : null;
      }
      const left = p.ax === 'right' ? vw - w - (Number(p.rx) || 0) : (Number.isFinite(Number(p.lx)) ? Number(p.lx) : Number(p.left) || 0);
      const top = p.ay === 'bottom' ? vh - h - (Number(p.by) || 0) : (Number.isFinite(Number(p.ty)) ? Number(p.ty) : Number(p.top) || 0);
      return clampPos({ left, top }, view); // 安全网：贴边距若因面板变大而越界，仍钳回视口内
    }

    function clampPos(p, view) {
      if (!p || typeof p !== 'object') return null;
      const left = Number(p.left), top = Number(p.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      const vw = (view && view.vw) || 0, vh = (view && view.vh) || 0;
      const w = (view && view.w) || 0, h = (view && view.h) || 0;
      if (!vw || !vh) return { left, top }; // 拿不到视口尺寸时不猜，原样返回
      return {
        left: Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE)),
        top: Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - h - EDGE)),
      };
    }
    const fmtTokens = (n) => {
      if (n == null) return '—';
      if (n < 1000) return String(n);
      if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 2 : 1)}k`;
      return `${(n / 1000000).toFixed(2)}M`;
    };
    /* ZB-13（用户要求）：耗时展示改为「XX时XX分XX秒」——**三段恒定输出**，不省略零位。
     * 只改**展示层** —— 数据层的 elapsedSec/heldSec 仍是秒数（number），
     * 那是契约字段（core / wire / CLI 都按秒读写），不能在渲染里改语义。
     * 恒定三段的好处：列表里宽度一致、一眼可比（用户原话即此格式）。 */
    const fmtSec = (s) => {
      if (s == null) return '—';
      const total = Math.max(0, Math.floor(Number(s) || 0));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const sec = total % 60;
      return `${h}时${String(m).padStart(2, '0')}分${String(sec).padStart(2, '0')}秒`;
    };
    const shortId = (id) => (id ? String(id).slice(0, 12) : '—');
    /* ZB-18（用户要求：进程那里应该显示整仓库锁或者文件锁进行区分）：
     * 把 job 的锁归类成可读类型 + 受影响文件列表（纯函数，便于独立测试）。
     *
     * 输入是**已持久化的 job**，可能来自旧版本（如 lock='repo+memory' 的 ZB-15 记录），
     * 故这里按"能识别就识别、识别不出按原始值显示"处理，不假设字段一定存在。
     *
     * @returns {{kind:'repo'|'file'|'none'|'legacy', label:string, files:string[], detail:string}}
     *   kind:  repo=整仓库锁 / file=文件锁 / none=未持锁 / legacy=旧版本记录
     *   label: 徽标上显示的短文本
     *   files: 文件锁覆盖的文件（从 spec.write 或 lock 字符串里的 file: 前缀解析）
     */
    function lockKindOf(job) {
      const lock = job && job.lock != null ? String(job.lock) : '';
      const declared = Array.isArray(job && job.spec && job.spec.write) ? job.spec.write.filter(Boolean) : [];
      if (!lock) return { kind: 'none', label: '', files: [], detail: '' };
      /* 旧版本记录（含 memory）——如实标注为"旧版锁"，不假装是新模型 */
      if (/memory/.test(lock)) {
        return { kind: 'legacy', label: lock, files: declared, detail: `${lock}（旧版本记录：memory 锁已于 ZB-16 删除）` };
      }
      /* 文件锁：lock 形如 `file:<path>` 或多个用 + 连接；文件列表优先取 spec.write（更完整） */
      if (/(^|\+)file:/.test(lock)) {
        const fromLock = lock.split('+').filter((x) => x.startsWith('file:')).map((x) => x.slice(5));
        const files = declared.length ? declared : fromLock;
        return {
          kind: 'file',
          label: files.length > 1 ? `文件锁 ${files.length}` : '文件锁',
          files,
          detail: `文件锁：只锁这些文件 ⇒ 与写其它文件的任务可并发\n${files.join('\n')}`,
        };
      }
      if (lock === 'repo') {
        return { kind: 'repo', label: '整仓库锁', files: [], detail: '整仓库锁：未声明要写的文件 ⇒ 与任何任务互斥（单写者本义）' };
      }
      if (lock === 'none') return { kind: 'none', label: '不取锁', files: [], detail: '明确不取锁（调用方确认无竞写关系）' };
      return { kind: 'legacy', label: lock, files: declared, detail: `未知锁形态：${lock}` };
    }
    /* ZB-14（用户要求）：上下文占用由「90%」改为**绝对值**「180.9k / 200k」——
     * 百分比只说明"快满了"，绝对值才能一眼看出还剩多少 token 可用。
     * 精度取舍：k 档保留 **1 位小数**，且**截断而非四舍五入** ——
     * 用户举例的 180973 应显示 `180.9k`；若用 toFixed(1) 会四舍五入成 `181.0k`（与预期不符）。
     * 截断还有一个好处：显示值**不会超过真实值**，不会出现"显示 200.0k 但实际只用了 199.98k"这种误导。
     * 注意：这里**不复用 fmtTokens** —— 它在 <10000 时给 2 位小数（29.0k/29.1k 抖动），
     * 且同样用四舍五入；上下文用量需要稳定的一位截断精度，故独立实现。 */
    const fmtCtx = (n) => {
      if (n == null || !Number.isFinite(Number(n))) return '—';
      const v = Math.max(0, Number(n));
      if (v < 1000) return String(Math.round(v));
      if (v < 1000000) return `${(Math.floor(v / 100) / 10).toFixed(1)}k`; // 截断到 0.1k
      return `${(Math.floor(v / 10000) / 100).toFixed(2)}M`; // 截断到 0.01M
    };
    /** 上下文占用：`已用 / 上限`（如 `180.9k / 200k`）；任一缺失则显示 —。 */
    const ctxLabel = (j) => {
      if (!j || j.contextUsed == null || !j.contextWindow) return '—';
      return `${fmtCtx(j.contextUsed)} / ${fmtCtx(j.contextWindow)}`;
    };
    // Z11：长文本截断展示（详情区 prompt 最多 1200 字符）；时间本地化
    const clampText = (s, n) => {
      const str = s == null ? '' : String(s);
      return str.length > n ? `${str.slice(0, n)}…` : str;
    };
    const fmtTime = (iso) => {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return String(iso);
      }
    };
    /* 交互元素判定（模块级：拖拽守卫与 JobRow 行头点击守卫共用同一实现）。
     * Z9 教训：可点击区域内嵌按钮时，事件必须先 closest 守卫，否则子按钮点击被外层吃掉。 */
    const isInteractive = (el) => !!(el && typeof el.closest === 'function' && el.closest('button,input,select,textarea,a,[role="button"]'));

    /* apply(ctx) 捕获的客户端 ctx：createWire 用它探测远端面（模块级唯一；
     * apply 先于组件挂载执行，浅渲染等无 ctx 场景保持 null = 远端缺席 → 降级）。 */
    let MOD_CTX = null;

    /* ─────────────── 远端面就绪信号（ZB-01 ②：修「异步 $mount vs 一次性探测」竞态）───────────────
     * 事实：ctx.remote.$mount() 是**异步**的（gateway client `async $mount` → installNamespace →
     * createNamespace 在其 fiber 的 apply 里才同步装出 remote.<namespace>），而 useWire 的 useRef
     * 只在**首次渲染**建一次 wire。两者竞态 → 首次探测落空 → 面板被永久锁在 offline 降级态。
     * 正解（whale-pet 实证：真实可用的第三方插件 client.js:2217-2241）：**子 fiber**
     * ctx.inject(['remote.zcodeDispatch'], …) —— 命名空间出现即回调，既有序又不阻塞启动；
     * 顶层 inject 仍只有基础服务，绝不声明自家 remote.*（否则等于等自己 → pending → web boot 失败）。 */
    let REMOTE_SVC = null;
    const remoteWaiters = new Set();
    /** $mount 结果留痕：离线态提示据此给出可读原因（不猜）。 */
    const MOUNT_DIAG = { attempted: false, ok: null, error: null };
    function markRemoteReady(svc) {
      if (svc) REMOTE_SVC = svc;
      for (const fn of [...remoteWaiters]) {
        try { fn(); } catch { /* 单个订阅者异常不影响其他 */ }
      }
    }
    function onRemoteReady(fn) {
      remoteWaiters.add(fn);
      return () => remoteWaiters.delete(fn);
    }

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
      ['dismiss', ['id'], []],
      ['retry', ['id', 'opts'], ['opts']],
      ['tail', ['id', 'n'], ['n']],
      ['setChannel', ['next'], ['next']],
      ['setFallbackChain', ['list'], ['list']],
      ['switchGet', [], []],
      ['switchSet', ['next'], ['next']],
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

    /** 探测远端面子服务；有 snapshot() 即视为可用。
     * ZB-01：优先用子 fiber 回调拿到的实例（REMOTE_SVC，命名空间就绪的权威来源），
     * 其次才是 ctx 上的即时探测（兜底：apply 早于/晚于 mount 的两种时序都能命中）。 */
    function resolveRemote(ctx) {
      const svc = REMOTE_SVC ?? ctx?.remote?.zcodeDispatch ?? ctx?.remote?.['zcode-dispatch'];
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
        dismiss: (id) => remote.call('dismiss', id),
        retry: (id, opts) => remote.call('retry', id, opts && typeof opts === 'object' ? opts : {}),
        tail: (id, n) => remote.call('tail', id, n),
        setChannel: (next) => remote.call('setChannel', next && typeof next === 'object' ? next : {}),
        setFallbackChain: (list) => remote.call('setFallbackChain', list == null ? null : list),
        // Z12：派发总开关（switchGet 读状态；switchSet 走宿主唯一写入口）
        switchGet: () => remote.call('switchGet'),
        switchSet: (next) => remote.call('switchSet', next && typeof next === 'object' ? next : {}),
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
        async dismiss(id) {
          try {
            return await face.dismiss(id);
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
        // Z12：派发总开关（switchGet 数据对象折成 {ok:true, switch}；switchSet 透传宿主信封）
        async switchGet() {
          try {
            return { ok: true, switch: await face.switchGet() };
          } catch (e) {
            return errOf(e);
          }
        },
        async switchSet(next = {}) {
          try {
            return await face.switchSet(next);
          } catch (e) {
            return errOf(e);
          }
        },
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

    /* ─────────────── 降级 wire（ext/demo/offline；同源实现：wire.client.mjs）───────────────
     * 远端面缺席时的降级顺序（legacyWire 选择器）：
     * 1) window.__zcodeDispatchDemo === 'builtin' → 内置演示引擎（conn='demo'，排查用，默认关）；
     * 2) window.__zcodeDispatchDemo 为外部数据源对象（含 getSnapshot()）→ extWire（conn='ext'）；
     * 3) 都没有 → offlineWire（conn='offline'，Z11 诚实空态：无假行、无定时器）。 */
    function legacyWire() {
      const flag = typeof window !== 'undefined' ? window.__zcodeDispatchDemo : null;
      if (flag === 'builtin') return demoWire();
      if (flag && typeof flag === 'object' && typeof flag.getSnapshot === 'function') return extWire(flag);
      return offlineWire();
    }

    /* 外部数据源 wire（conn='ext'）：轮询注入的 window.__zcodeDispatchDemo 对象。 */
    function extWire(ext) {
      if (!ext || typeof ext.getSnapshot !== 'function') return null;
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
        dismiss: (id) => call('dismiss', id),
        tail: (id, n) => call('tail', id, n),
        // Z6 增量：外部源未提供这些方法时 call() 返回 {ok:false,error}，UI 自行降级
        channels: () => call('channels'),
        channelGet: () => call('channel', {}),
        channelSet: (c) => call('channel', c ?? {}),
        retry: (id, opts) => call('retry', { id, ...(opts ?? {}) }),
        fallbackGet: () => call('fallback', {}),
        fallbackSet: (chain) => call('fallback', { chain }),
        // Z12：外部源未提供时 call() 返回 {ok:false,error}，UI 自行降级为只读
        switchGet: () => call('switchGet', {}),
        switchSet: (next) => call('switchSet', next ?? {}),
        dispose() {
          subs.clear();
          if (timer != null) {
            clearInterval(timer);
            timer = null;
          }
        },
      };
    }

    /* 诚实空态 wire（conn='offline'，Z11）：远端与外部源都没有时不渲染任何假行——
     * 同步发一包空快照（形状与 live 快照一致），无定时器；动作一律返回可读错误。
     * 徽标「未连接」，进程区显示 emptyOffline 文案。 */
    const offlineSnapshot = () => ({
      counts: { running: 0, queued: 0, done: 0, failed: 0 },
      jobs: [],
      locks: {},
      queue: [], // 数组与 live 快照同形（LockStatus 按 .length 取队列长度；任务包示例的 queue:0 会显示 undefined）
    });
    const OFFLINE_ERR = '未连接宿主（offline）：无进程数据，动作不可用';
    function offlineWire() {
      const subs = new Set();
      const emit = () => {
        const bundle = { conn: 'offline', snapshot: offlineSnapshot(), quota: null, planQuota: null };
        for (const fn of subs) {
          try {
            fn(bundle);
          } catch { /* 单个订阅者异常不影响其他 */ }
        }
      };
      const denied = async () => ({ ok: false, error: OFFLINE_ERR });
      return {
        subscribe(cb) {
          if (typeof cb !== 'function') throw new TypeError('subscribe(cb): cb 必须是函数');
          subs.add(cb);
          emit(); // 同步一包：UI 首帧即空态，无需等轮询
          return () => subs.delete(cb);
        },
        dispatch: denied,
        kill: denied,
        dismiss: denied,
        retry: denied,
        tail: async (id) => ({ ok: true, id, lines: [] }),
        channels: async () => ({ ok: true, channels: [], warnings: [] }),
        channelGet: denied,
        channelSet: denied,
        fallbackGet: denied,
        fallbackSet: denied,
        // Z12：offline 无真值可读（浏览器也读不到宿主文件），动作拒绝 → UI 只读 + 提示走终端
        switchGet: denied,
        switchSet: denied,
        dispose() {
          subs.clear();
        },
      };
    }

    // 内置演示引擎（conn='demo'，默认关）：3 个进程起步；派发 / kill / dismiss / tail 均可交互（纯前端假数据）
    function demoWire() {
      const seed = () => {
        const s = {
          generatedAt: '', workRoot: '(demo)', maxConcurrent: 1,
          counts: {}, locks: { repo: null, memory: null }, queue: [], jobs: [],
        };
        const mk = (id, tag, state, model, body, extra) => ({
          /* ZB-16：锁名同步新模型 —— memory 已删除，演示数据也不该再出现 'repo+memory'/'both'，
           * 否则演示模式下 UI 会显示已不存在的锁（与真实语义不一致）。 */
          id, tag, state, lock: state === 'running' ? 'repo' : null,
          // Z11：带 kind 同名字段（spec.prompt），与 core/真实 spec 形状一致（UI 详情区读 spec.body ?? spec[kind]）
          spec: { kind: 'prompt', body, prompt: body, model, provider: 'plan', mode: 'edit', lock: 'repo', timeoutMin: 15, memoryBench: false, tag },
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
          running.lock = 'repo';
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
            spec: { kind, body: String(body).slice(0, 80), [kind]: String(body).slice(0, 80), model: spec.model ?? null, provider: spec.provider ?? null, mode: spec.mode ?? 'edit', lock: spec.lock ?? 'repo', timeoutMin: spec.timeoutMin ?? null, memoryBench: Boolean(spec.memoryBench), tag },
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
        /* Z11：dismiss = 从列表移除（demo 的 kill 对 paused 有效，这里主要保形状一致） */
        async dismiss(id) {
          const j = job(id);
          if (!j || !['paused', 'done', 'failed', 'killed', 'interrupted'].includes(j.state)) {
            return { ok: false, error: `dismiss 失败：job 不存在或仍在 ${j?.state ?? '?'}（demo）` };
          }
          snap.jobs = snap.jobs.filter((x) => x.id !== id);
          snap.counts = { ...snap.counts, [j.state]: Math.max(0, (snap.counts[j.state] ?? 0) - 1) };
          emit();
          return { ok: true, id };
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
                lock: j.spec.lock ?? 'repo', // ZB-18 补漏：默认由 'both' 改为 'repo'（memory 已删除）
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
        // Z12：demo 不读/写真值文件（假数据不伪装开关状态，更不许写真值）
        async switchGet() {
          return { ok: false, error: '演示模式无真值文件（demo）' };
        },
        async switchSet() {
          return { ok: false, error: '演示模式不写总开关（demo）' };
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

    /* ─────────────── wire 工厂（数据源四选一；同源：wire.client.mjs createClientWire）───────────────
     * 优先级与判据：MOD_CTX 上探测到远端面（resolveRemote 有 snapshot()）→ remoteWire
     * （conn='live'，真数据）；否则 legacyWire 选择器：__zcodeDispatchDemo='builtin' → demoWire
     * （conn='demo'，默认关）；外部源对象 → extWire（conn='ext'）；都没有 → offlineWire
     * （conn='offline'，诚实空态）。MOD_CTX 为 null（apply 未跑过，如纯组件桩浅渲染）
     * 等同远端缺席，走降级链，绝不抛错。 */
    function createWire() {
      try {
        const remote = MOD_CTX ? resolveRemote(MOD_CTX) : null;
        if (remote) return remoteWire(MOD_CTX, remote);
      } catch (e) {
        try { console.warn('[zcode-dispatch] 远端 wire 初始化失败，降级 ext/offline：', e && e.message); } catch { /* ignore */ }
      }
      try {
        /* ZB-01 诊断：走到这里 = 远端面没解析到。把这行原文（连同面板首行提示）带回即可定位。 */
        try {
          console.warn('[zcode-dispatch] 远端面未就绪 → 降级 wire。诊断=', {
            mountDiag: MOUNT_DIAG,
            childFiberService: !!REMOTE_SVC,
            hasModCtx: !!MOD_CTX,
            ctxRemoteZcodeDispatch: !!(MOD_CTX && MOD_CTX.remote && MOD_CTX.remote.zcodeDispatch),
          });
        } catch { /* ignore */ }
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
      dismiss: async () => ({ ok: false, error: 'wire 不可用' }),
      retry: async () => ({ ok: false, error: 'wire 不可用' }),
      tail: async () => [],
      channels: async () => ({ channels: [] }),
      channelGet: async () => ({}),
      channelSet: async () => ({ ok: false, error: 'wire 不可用' }),
      fallbackGet: async () => ({}),
      fallbackSet: async () => ({ ok: false, error: 'wire 不可用' }),
      switchGet: async () => ({}),
      switchSet: async () => ({ ok: false, error: 'wire 不可用' }),
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
            position: 'fixed', right: '24px', bottom: '24px', zIndex: Z_INDEX, maxWidth: '340px', pointerEvents: 'auto',
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
      /* ZB-01：远端命名空间就绪后必须重建一次 wire——否则首次渲染建成的降级 wire
       * 会被 useRef 永久沿用（$mount 异步，首帧探测必然可能落空）。 */
      const [remoteEpoch, setRemoteEpoch] = useState(0);
      useEffect(() => onRemoteReady(() => setRemoteEpoch((n) => n + 1)), []);
      const ref = useRef(null);
      const builtEpoch = useRef(-1);
      if (ref.current == null || builtEpoch.current !== remoteEpoch) {
        try { ref.current?.dispose?.(); } catch { /* 旧 wire 释放失败不阻塞重建 */ }
        ref.current = createWire() ?? DEAD_WIRE;
        builtEpoch.current = remoteEpoch;
      }
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
        dispatch: wire.dispatch, kill: wire.kill, dismiss: wire.dismiss, tail: wire.tail,
        channels: wire.channels, channelGet: wire.channelGet, channelSet: wire.channelSet,
        retry: wire.retry, fallbackGet: wire.fallbackGet, fallbackSet: wire.fallbackSet,
        switchGet: wire.switchGet, switchSet: wire.switchSet,
      };
    }

    const PAUSE_LABEL_KEY = { 'quota-exhausted': 'pQuota', 'plan-not-entitled': 'pEntitled', 'provider-signing': 'pSigning', 'config-error': 'pConfig' };
    const pauseLabel = (r) => t(PAUSE_LABEL_KEY[r] ?? 'pUnknown');
    /* ZB-02：「关闭」（= 从列表移除 + 落盘 dismissed.json）允许的状态集合，
     * 与宿主 wire.host.mjs 的 DISMISSABLE 逐一对应（paused / 各终态）。
     * 原先 UI 只在 paused 时渲染关闭按钮 → done/failed/killed/interrupted 的 job
     * 既没有终止按钮（非 active）也没有关闭按钮，列表里清不掉。 */
    const DISMISSABLE_STATES = ['paused', 'done', 'failed', 'killed', 'interrupted'];

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
    /* ZB-04：重跑（↻）。圆弧 + 箭头，几何刻意保守（半径 4、弦长 5.66 < 2r，arc 合法）。
     * 语义永远由 title/aria-label 兜底，不依赖图形被认出来。 */
    function IconRerun() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M10 6 A4 4 0 1 1 6 2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
        h('path', { d: 'M4.4 0.6 L6.4 2 L4.4 3.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
    /* ZB-04：续接（对话框 + 加号缺口），同样是保守几何（矩形 + 折线尾巴）。 */
    function IconContinue() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('rect', { x: 1.5, y: 1.5, width: 9, height: 7, rx: 1.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
        h('path', { d: 'M4 8.5 L4 11 L6.8 8.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
    }
    /* ZB-11：右下角缩放三角标（贴角实心三角，只用 currentColor + opacity，无字面色值）。 */
    function IconResizeMark() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', { d: 'M11.5 4.2 L11.5 11.5 L4.2 11.5 Z', fill: 'currentColor', opacity: '0.55' }));
    }
    /* ZB-08：固定/取消固定（图钉）。on=true 用实心填充表示"已钉住"，on=false 空心。
     * 填充值只用 currentColor / none 两个关键字，不引入字面色值。 */
    function IconPin({ on }) {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', 'aria-hidden': true },
        h('path', {
          d: 'M4.2 1.2 H7.8 L7.1 4 L8.9 5.8 V6.6 H3.1 V5.8 L4.9 4 Z',
          fill: on ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linejoin': 'round',
        }),
        h('path', { d: 'M6 6.6 V10.6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
    }

    /* Z12：派发总开关徽标（标题栏）。sw 来自快照 snapshot.switch（host 读真值文件）；
     * live=可点按钮（点击 switchSet 翻转，成功后 1s 轮询带回新快照）；
     * 非 live=只读（浏览器读不到宿主文件，诚实提示走终端 CLI），状态未知时如实显示「未知」。 */
    function SwitchBadge({ sw, live, onToggle }) {
      const [busy, setBusy] = useState(false);
      const enabled = sw ? sw.enabled !== false : null; // null=状态未知（无快照/数据源不带 switch）
      const label = enabled === null ? t('switchUnknown') : enabled ? t('switchOn') : t('switchOff');
      const dotStyle = enabled === null ? undefined : { background: enabled ? T.stDone : T.danger };
      if (!live) {
        return h('span', { className: 'zcd-conn zcd-switch', title: t('switchHintOffline') },
          h('span', { className: 'zcd-dot', style: dotStyle }), label);
      }
      const flip = () => {
        if (busy || enabled === null) return; // 状态未知时不猜方向，等下一拍快照
        setBusy(true);
        Promise.resolve(onToggle({ enabled: !enabled })).finally(() => setBusy(false));
      };
      return h('button', {
        className: 'zcd-conn zcd-switch', title: t('switchTitle'), disabled: busy,
        onPointerDown: (e) => e.stopPropagation(), onClick: flip,
      }, h('span', { className: 'zcd-dot', style: dotStyle }), label);
    }

    /* 分区（Z11 可折叠）：collapsible 时整条标题栏可点击切换（倒三角指示），折叠态存
     * localStorage['zcode-dispatch:section:<id>']。默认开闭表见 SEC_DEFAULT_OPEN。
     * Z9 教训回扣：本标题栏不挂拖拽手势、head 内也不放 button——若将来加手势/按钮，
     * 必须先 isInteractive()（closest）守卫并在按钮 onPointerDown 停冒泡，否则点击会被吃掉。 */
    function Section({ id, title, collapsible, defaultOpen, children }) {
      if (!collapsible) {
        return h('div', { className: 'zcd-sec' }, h('div', { className: 'zcd-sec-title' }, title), children);
      }
      const [open, setOpen] = useState(() => {
        const saved = loadJson(secKey(id), undefined);
        return typeof saved === 'boolean' ? saved : (defaultOpen ?? SEC_DEFAULT_OPEN[id] ?? true);
      });
      const toggle = () => setOpen((prev) => {
        const nv = !prev;
        saveJson(secKey(id), nv);
        return nv;
      });
      return h('div', { className: 'zcd-sec' },
        h('div', {
          className: 'zcd-sec-head', role: 'button', tabIndex: 0, 'aria-expanded': open,
          title, onClick: toggle,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          },
        },
          h('span', { className: 'zcd-sec-title' }, title),
          h('span', { className: 'zcd-spring' }),
          h('span', { className: 'zcd-sec-caret', 'aria-hidden': true }, h(IconChevron, { up: open })),
        ),
        open ? children : null,
      );
    }

    /* 通道分区：切换器（provider+model，不可用项置灰带原因）+ 自动降级链开关（二次确认）。 */
    function ChannelSection({ channelsInfo, channel, fallback, onSwitch, onFallbackSet, offline, offlineReason }) {
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

      return h('div', { className: 'zcd-stack' },
        warnings.length ? h('div', { className: 'zcd-feedback zcd-err' }, `${t('chanLoadFail')}: ${warnings[0]}`) : null,
        /* ZB-01 ③：离线态的说明统一由面板 body 首行渲染（此处曾重复渲染同一句，已去重）；
         * 两个下拉仍各自带 title，便于悬停即知为什么点不动。
         * ZB-14：改成**固定两行**（每行 = 标签 + 下拉），不再把 4 个元素塞进一个 flex-wrap 行 ——
         * 原先面板一变宽就重排换行、两个下拉宽度还各随内容变（用户报告「随窗口尺寸乱跑」）。
         * 现在：标签 nowrap 定自然宽、下拉 flex:1 等宽撑满 ⇒ 任意面板宽度下版式都一致。 */
        h('div', { className: 'zcd-field' },
          h('span', { className: 'zcd-field-k' }, t('provider')),
          h('select', {
            className: 'zcd-select zcd-field-v', value: channel.provider,
            onChange: (e) => switchProvider(e.target.value), 'aria-label': t('provider'),
            disabled: channels.length === 0,
            title: offline ? (offlineReason || t('chanOfflineHint')) : undefined,
          },
            channels.length === 0 ? h('option', { value: channel.provider }, channel.provider) : null,
            channels.map((c) => h('option', { key: c.id, value: c.id, disabled: !c.enabled },
              `${c.name ?? c.id}${c.enabled ? '' : `（${t('chanDisabled')}：${c.reason ?? '-'}）`}`)))),
        h('div', { className: 'zcd-field' },
          h('span', { className: 'zcd-field-k' }, t('model')),
          h('select', {
            className: 'zcd-select zcd-field-v', value: modelValue,
            onChange: (e) => switchModel(e.target.value), 'aria-label': t('model'),
            disabled: !sel || !sel.enabled,
            title: offline ? (offlineReason || t('chanOfflineHint')) : undefined,
          },
            h('option', { value: '' }, t('chanDefaultModel')),
            modelOptions.map((m) => h('option', { key: m, value: m }, m)))),
        h('div', { className: 'zcd-note', role: 'status' },
          `${t('chanNewTask')}${channel.provider}/${channel.model || t('chanDefaultModel')}`),
        h('div', { className: 'zcd-row' },
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

    function DispatchBar({ snapshot, lastJobId, feedback, busy, channel, swBlocked, onSubmit }) {
      const [kind, setKind] = useState('prompt');
      const [content, setContent] = useState('');
      const [mode, setMode] = useState('edit');
      const [timeoutMin, setTimeoutMin] = useState('15');
      const [bench, setBench] = useState(false);
      /* ZB-16（用户要求：派发流程要能明确是否 repo 锁 / 锁哪些文件）：
       *   · repoLock  —— 是否取仓库锁（取消勾选 = lock:'none'，明确不取锁）
       *   · writeText —— 仓库锁**锁哪些文件**（逗号/换行/分号分隔；留空 = 锁整个仓库）
       * memory 锁已按用户要求删除，故此处不再有它的开关。 */
      const [repoLock, setRepoLock] = useState(true);
      const [writeText, setWriteText] = useState('');

      const lastJob = (snapshot?.jobs ?? []).find((j) => j.id === lastJobId) ?? null;
      const active = lastJob && (lastJob.state === 'queued' || lastJob.state === 'running');
      const label = busy ? t('sending') : active ? (lastJob.state === 'queued' ? t('queuedBtn') : t('runningBtn')) : t('dispatch');
      const ph = kind === 'prompt' ? t('phPrompt') : kind === 'task' ? t('phTask') : t('phTarget');
      /* 文件列表解析：逗号 / 换行 / 分号都能分隔（用户可能从资源管理器复制多行路径） */
      const parseFiles = (s) => String(s ?? '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

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
        /* ZB-16：把锁意图明确传下去 —— 不勾仓库锁 ⇒ none；勾了且填了文件 ⇒ 只锁那些文件。 */
        if (!repoLock) spec.lock = 'none';
        else {
          const files = parseFiles(writeText);
          if (files.length > 0) spec.write = files;
        }
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
        /* ZB-16：**锁意图**显式化（用户要求"派发可以明确是否 repo 锁，明确 repo 锁哪些文件"）。
         * 勾选仓库锁 + 填文件 = 只锁这些文件（不同文件集可并发）；勾选但不填 = 锁整个仓库；
         * 不勾 = lock:'none'（明确不取锁）。memory 锁已删除，故无对应开关。 */
        h('div', { className: 'zcd-row' },
          h('label', { className: 'zcd-row', style: { gap: 3 } },
            h('input', { type: 'checkbox', checked: repoLock, onChange: (e) => setRepoLock(e.target.checked), 'aria-label': t('repoLockCb') }),
            h('span', { className: 'zcd-label' }, t('repoLockCb'))),
          repoLock
            ? h('input', {
              className: 'zcd-input', type: 'text', value: writeText,
              placeholder: t('writePh'), title: t('writeHint'),
              style: { flex: 1, minWidth: 120 }, 'aria-label': t('writeFiles'),
              onChange: (e) => setWriteText(e.target.value),
            })
            : h('span', { className: 'zcd-note' }, t('lockNoneHint')),
        ),
        repoLock ? h('div', { className: 'zcd-note' }, t('lockScopeHint')) : null,
        h('div', { className: 'zcd-row' },
          h('span', { className: 'zcd-label' }, t('timeout')),
          h('input', { className: 'zcd-input', type: 'number', min: 1, value: timeoutMin, onChange: (e) => setTimeoutMin(e.target.value), style: { width: 56 }, 'aria-label': t('timeout') }),
          h('label', { className: 'zcd-row', style: { gap: 3 } },
            h('input', { type: 'checkbox', checked: bench, onChange: (e) => setBench(e.target.checked) }),
            h('span', { className: 'zcd-label' }, t('bench'))),
          h('span', { className: 'zcd-spring' }),
          h('button', { className: 'zcd-btn', disabled: busy || active || swBlocked, title: swBlocked ? t('switchOffBlocked') : undefined, onClick: submit }, label),
        ),
        swBlocked ? h('div', { className: 'zcd-note', role: 'alert' }, t('switchOffBlocked')) : null,
        feedback ? h('div', { className: `zcd-feedback${feedback.kind === 'err' ? ' zcd-err' : ''}`, role: 'status' }, feedback.text) : null,
      );
    }

    /* ZB-05：tail 输出框的滚动决策（**纯函数**，便于脱离 React 独立测试）。
     *
     * 背景（用户报告）：「输出框里的文本一直闪烁，滚到最下面会自动弹回最上面内容」。
     * 两个成因：
     *   ① 轮询（refreshKey 每秒变）每次都 setTail(null) ⇒ 内容被换成「读取中…」再换回来 = 闪烁；
     *   ② 内容被替换的那一帧，浏览器把 scrollTop 归零 ⇒ 看起来"弹回最上面"。
     *
     * 本函数负责 ②：根据**用户意图**（onScroll 记下的快照）决定内容更新后 scrollTop 该是多少。
     * 关键：意图必须在**内容更新之前**记录 —— 内容一变长，gap 就变大，
     * 事后量 gap 已无法区分"用户本就在底部"与"用户停在中间"。
     *
     * @param {{intent: {top:number, atBottom:boolean}|null, scrollTop:number, scrollHeight:number, clientHeight:number}} s
     * @returns {number|null} 期望的 scrollTop；null = 不干预（保持浏览器默认）
     */
    function nextTailScroll(s) {
      const { intent, scrollHeight, clientHeight } = s;
      if (!intent) return null; // 尚无用户意图（首次渲染）⇒ 不动
      const max = Math.max(0, scrollHeight - clientHeight);
      if (intent.atBottom) return max; // 用户停在底部 ⇒ 贴底跟随新输出
      return Math.min(intent.top, max); // 否则还原到用户自己的位置（内容变短时按上限收敛）
    }

    function JobRow({ job, onKill, onDismiss, onTail, onRetry, onContinue, channels, refreshKey }) {
      const [open, setOpen] = useState(false);
      /* ZB-05：tail 取数。原实现每次轮询（refreshKey 变）都 `setTail(null)`，
       * 于是面板每秒经历「内容 → 读取中… → 内容」的闪烁；且内容被替换的那一帧，
       * 浏览器会把滚动容器 scrollTop 归零 ⇒ 用户看到「滚到底自动弹回最上面」。
       * 现改为：只在**首次取数**时显示「读取中…」，后续刷新静默替换（保内容、保滚动位）。 */
      const tailBoxRef = useRef(null); // 滚动容器（.zcd-mono）
      /* {top, atBottom}：onScroll 时记下的**用户意图**。
       * atBottom 必须在"内容更新之前"判定并留存 —— 内容一变长，gap 就变大，
       * 事后量已经无法区分"用户本就在底部"与"用户停在中间"。 */
      const tailScrollRef = useRef(null);
      const tailLoadedRef = useRef(false); // 是否已成功取过一次（决定要不要显示"读取中"）
      const [tail, setTail] = useState(undefined); // undefined=未取 null=读取中 {...}=结果
      useEffect(() => {
        if (!open) {
          tailLoadedRef.current = false;
          tailScrollRef.current = null;
          setTail(undefined);
          return undefined;
        }
        let alive = true;
        if (!tailLoadedRef.current) setTail(null); // 仅首次显示「读取中…」（轮询不清空 ⇒ 不闪烁）
        Promise.resolve(onTail(job.id, 30)).then((r) => {
          if (!alive) return;
          tailLoadedRef.current = true;
          setTail(r);
        });
        return () => {
          alive = false;
        };
      }, [open, refreshKey]); // 展开/收起与快照刷新时重取（运行中可见进度）
      /* 内容更新后校正滚动位置（标准日志查看器语义）：
       *   · 用户停在底部 → 跟随新输出继续贴底（运行中的 tail 才像"实时日志"）
       *   · 用户滚在中间/顶部 → 精确还原到原位置（不被新内容顶走）
       *   · 尚无用户意图（首次渲染）→ 不动，保持浏览器默认
       * 关键：用 onScroll 记下的 atBottom **意图**判断，而不是当场量 gap ——
       * 内容变长后 gap 必然变大，当场量会把"本在底部"误判成"用户滚在中间"。
       * 放在 useLayoutEffect：commit 后、paint 前执行，用户看不到跳动。 */
      useLayoutEffect(() => {
        const el = tailBoxRef.current;
        if (!el) return;
        const want = nextTailScroll({
          intent: tailScrollRef.current,
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        });
        if (want != null && want !== el.scrollTop) el.scrollTop = want;
      }, [tail]);
      const [handoffOpen, setHandoffOpen] = useState(false); // 换通道交接重跑的选择器
      const [hoProvider, setHoProvider] = useState('');
      const [hoModel, setHoModel] = useState('');
      const [retryFb, setRetryFb] = useState(null);
      /* ZB-04：终态行的「续接」——在同一会话里发一条 NEW 指令（dispatch + resume），
       * 与「重跑」语义不同（后者重发原提示词），故分成两个入口、两个文案。 */
      const [continueOpen, setContinueOpen] = useState(false);
      const [contText, setContText] = useState('');
      const [contFb, setContFb] = useState(null);
      const active = job.state === 'queued' || job.state === 'running';
      const paused = job.state === 'paused';
      const canDismiss = DISMISSABLE_STATES.includes(job.state);
      /* ZB-04：只有**非 paused** 的可关闭状态才给「重跑 / 续接」——paused 行已有
       * 「继续 / 换通道」（继续 == 同会话 --resume，与重跑同义），再放就是重复入口。 */
      const terminal = canDismiss && !paused;
      /* 重跑：同通道 + 有 sessionId → --resume 原提示词；无 sessionId 或无通道 → 交接重跑。
       * 与 paused 行的「继续」同义，故仅在 terminal 行提供。 */
      const doRerun = () => {
        setRetryFb(t('sending'));
        Promise.resolve(onRetry(job.id, {})).then((r) => {
          setRetryFb(r && r.ok ? `${t('fbQueued')}${r.job?.id ?? ''}` : `${t('errPrefix')}${(r && r.error) || 'unknown'}`);
        });
      };
      /* 续接：同会话 + 用户新输入的指令（dispatch + resume）。必须有 sessionId 才有意义。 */
      const doContinue = () => {
        const text = contText.trim();
        if (!text || !job.sessionId) return;
        setContFb(t('sending'));
        Promise.resolve(onContinue(job, text)).then((r) => {
          setContFb(r && r.ok ? `${t('fbQueued')}${r.job?.id ?? ''}` : `${t('errPrefix')}${(r && r.error) || 'unknown'}`);
        });
        setContText('');
      };
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
      /* Z11「关闭」：优先 kill；core 的 kill 对 paused 是空操作（子进程已退出、返回 ok 但状态
       * 停在 paused，且返回值里带最新 job），故 ok 但 job.state 仍 paused、或直接失败时，
       * 退回 dismiss（wire 层动作：把 job 从列表移除并落盘，不改 core 语义）。 */
      const doClose = async () => {
        setRetryFb(t('sending'));
        let r = null;
        try {
          r = await Promise.resolve(onKill(job.id));
        } catch { /* wire 已兜底信封，这里只防裸 reject */ }
        if (r && r.ok && (!r.job || r.job.state !== 'paused')) {
          setRetryFb(null); // kill 生效（live→killing/killed、demo→killed），快照随后刷新
          return;
        }
        try {
          const d = await Promise.resolve(onDismiss(job.id));
          setRetryFb(d && d.ok ? null : `${t('errPrefix')}${(d && d.error) || 'unknown'}`);
        } catch (e) {
          setRetryFb(`${t('errPrefix')}${(e && e.message) ?? e}`);
        }
      };
      const spec = job.spec ?? {};
      const kindField = spec.kind === 'task' ? 'task' : spec.kind === 'target' ? 'target' : 'prompt';
      const KIND_KEY = { prompt: 'kindPrompt', task: 'kindTask', target: 'kindTarget' };
      const detailBody = spec.body ?? spec[kindField]; // live=slimJob 的 body；demo=body+kind 同名字段
      const kvRow = (k, v) => (v == null || v === '' ? null : h('div', { className: 'zcd-kv' },
        h('span', { className: 'zcd-kv-k' }, k), h('span', { className: 'zcd-kv-v' }, String(v))));
      return h('div', { className: 'zcd-job' },
        /* ZB-12：行头只做「摘要」，不放任何按钮、也没有倒三角 ——
         * 整行点击即展开/收起详情（用户要求）。因为行头现在是唯一的开关，补 role/aria-expanded。 */
        h('div', {
          className: 'zcd-job-head', role: 'button', 'aria-expanded': open,
          onClick: (e) => {
            /* Z9 守卫的修正（2026-09-30 现场报告「点击没展开」）：
             * 行头自身带 role="button"（可访问性需要），若沿用原来的
             * `isInteractive(e.target)`，点行头内任意位置都会 closest 命中「行头自己」
             * ⇒ 永远被当成交互元素、永远 return、永远不切换。
             * 正确语义：命中的是**行头之外的控件**才跳过；命中行头自身（含其非交互子元素）则切换。 */
            const hit = e.target && typeof e.target.closest === 'function'
              ? e.target.closest('button,input,select,textarea,a,[role="button"]')
              : null;
            if (hit && hit !== e.currentTarget) return;
            setOpen(!open);
          },
        },
          h(StatusDot, { state: job.state }),
          h('span', { className: 'zcd-job-tag', title: job.id }, job.tag ?? shortId(job.id)),
          h('span', { className: 'zcd-badge' }, job.model ?? '—'),
          paused ? h('span', { className: 'zcd-badge s-paused', title: job.pauseDetail ?? '' }, `${t('paused')}：${pauseLabel(job.pauseReason)}`) : null,
          job.parentJobId ? h('span', { className: 'zcd-badge', title: job.parentJobId }, `${t('parentFrom')} ${shortId(job.parentJobId)}`) : null,
          (job.hopCount ?? 0) > 0 ? h('span', { className: 'zcd-badge' }, `${job.hopCount} ${t('hop')}`) : null,
          h('span', { className: 'zcd-dim' }, fmtSec(job.elapsedSec)),
          h('span', { className: 'zcd-dim', title: `${job.contextUsed ?? '—'} / ${job.contextWindow ?? '—'} tokens` }, ctxLabel(job)),
          job.exitCode != null ? h('span', { className: 'zcd-dim' }, `${t('exit')} ${job.exitCode}`) : null,
          /* ZB-18：锁徽标区分「整仓库锁」/「文件锁 N」/「不取锁」；tooltip 给出细节与文件列表。
           * 旧版本记录（含 memory）如实显示为旧形态，不伪装成新模型。 */
          (() => {
            const lk = lockKindOf(job);
            if (lk.kind === 'none') return null;
            return h('span', {
              className: `zcd-badge zcd-lock-${lk.kind}`,
              title: lk.detail || t('lockHeld'),
            }, lk.label);
          })(),
        ),
        /* 反馈行移到动作区之外：关闭按钮现在在行头，终态行没有动作区，失败反馈仍需可见。 */
        retryFb ? h('div', { className: 'zcd-note', role: 'status' }, retryFb) : null,
        /* ZB-12：全部行动作都收进这里，且**只在展开时可见** —— 行头保持纯摘要、整行点击即开关。
         * 终止(✕) 与 关闭(✕) 共用同一字形，但 active（queued/running）与 canDismiss（paused/终态）
         * 状态互斥，永不同时出现；语义由各自的 title/aria-label 区分。 */
        open && (active || terminal || canDismiss) ? h('div', { className: 'zcd-row' },
          active ? h('button', { className: 'zcd-iconbtn', title: t('kill'), 'aria-label': `${t('kill')} ${job.id}`, onClick: () => onKill(job.id) }, h(IconKill)) : null,
          /* 重跑（↻）：同会话重发原提示词。仅非 paused 的终态行（paused 行有同义的「继续」）。 */
          terminal ? h('button', { className: 'zcd-iconbtn', title: t('rerunTitle'), 'aria-label': `${t('rerun')} ${job.id}`, onClick: doRerun }, h(IconRerun)) : null,
          /* 续接：同会话发新指令。无 sessionId 时禁用（并说明原因，不静默消失）。 */
          terminal ? h('button', {
            className: 'zcd-iconbtn', title: job.sessionId ? t('continueTitle') : t('continueNoSession'),
            'aria-label': `${t('continueBtn')} ${job.id}`, disabled: !job.sessionId,
            onClick: () => setContinueOpen(!continueOpen), 'aria-expanded': continueOpen,
          }, h(IconContinue)) : null,
          /* 关闭：从列表移除（paused 也走这里；paused 的「继续/换通道」见下一行） */
          canDismiss ? h('button', { className: 'zcd-iconbtn', title: t('closeJob'), 'aria-label': `${t('closeJob')} ${job.id}`, onClick: doClose }, h(IconKill)) : null,
        ) : null,
        /* 续接输入行（点上面「续接」图标展开）——在同一会话里发一条新指令。 */
        open && terminal && continueOpen ? h('div', { className: 'zcd-row' },
          h('input', {
            className: 'zcd-input', type: 'text', value: contText, placeholder: t('continuePh'),
            style: { flex: 1, minWidth: 120 }, 'aria-label': t('continueBtn'),
            onChange: (e) => setContText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') doContinue(); },
          }),
          h('button', { className: 'zcd-btn2', onClick: doContinue, disabled: !contText.trim() }, t('continueSend')),
          contFb ? h('span', { className: 'zcd-note', role: 'status' }, contFb) : null,
        ) : null,
        /* ZB-12：paused 专属动作（继续/换通道）同样只在展开时可见，与上面的动作区同处一块。 */
        open && paused ? h('div', { className: 'zcd-row' },
          h('button', {
            className: 'zcd-btn2', onClick: doResume,
            disabled: !job.sessionId,
            title: job.sessionId ? `${t('resumeSame')}（--resume）` : t('noSession'),
          }, t('resumeSame')),
          h('button', { className: 'zcd-btn2', onClick: () => setHandoffOpen(!handoffOpen), 'aria-expanded': handoffOpen }, t('retryHandoff')),
        ) : null,
        open && paused && handoffOpen ? h('div', { className: 'zcd-row' },
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
          // Z11：派发要素详情——点行可区分「这个进程派发了什么」
          h('div', { className: 'zcd-detail' },
            kvRow(t('kind'), t(KIND_KEY[spec.kind] ?? 'kind')),
            detailBody != null && detailBody !== '' ? h('div', { className: 'zcd-mono' }, clampText(detailBody, 1200)) : null,
            kvRow(t('provider'), spec.provider ?? job.provider),
            kvRow(t('model'), spec.model ?? job.model),
            kvRow(t('mode'), spec.mode),
            kvRow(t('cwd'), spec.cwd),
            spec.timeoutMin != null ? kvRow(t('timeout'), String(spec.timeoutMin)) : null,
            kvRow(t('createdAt'), job.queuedAt ? fmtTime(job.queuedAt) : null),
            kvRow(t('sessionId'), job.sessionId),
            job.pauseReason ? kvRow(t('paused'), pauseLabel(job.pauseReason)) : null,
          ),
          h('div', { className: 'zcd-note', style: { marginTop: 6 } }, t('tail')),
          h('div', {
            className: 'zcd-mono',
            ref: tailBoxRef, // ZB-05：内容轮询刷新后据此校正滚动位置
            onScroll: (e) => {
              const el = e.currentTarget;
              tailScrollRef.current = {
                top: el.scrollTop,
                // 意图判定必须在内容更新前完成（内容一变长 gap 就失真）
                atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 4,
              };
            },
          },
            tail === null ? t('tailLoading')
              : tail === undefined ? t('tailEmpty')
                : tail && tail.ok ? (tail.lines && tail.lines.length ? tail.lines.join('\n') : t('tailEmpty'))
                  : `${t('errPrefix')}${tail && tail.error ? tail.error : 'unknown'}`)) : null,
      );
    }

    /* ─────────────── ZB-03：进程分组（用户要求「进行中 / 已完成 / 异常」分类显示）───────────────
     * 分组表是**唯一真值**（要调分组只改这张表）。状态名取自 core 的 job.state。
     * 两条纪律：
     *  1) 空分组不渲染 —— 所以分组可以取细，不会占版面；
     *  2) **未归属状态兜底**（grpOther）—— 绝不能因为「新状态没进分组表」就让 job 在列表里凭空消失。 */
    const JOB_GROUPS = [
      { key: 'grpActive', states: ['queued', 'running'] },              // 进行中（含排队）
      { key: 'grpPaused', states: ['paused'] },                        // 需处理：暂停等你决定续跑/交接
      { key: 'grpFailed', states: ['failed', 'interrupted', 'killed'] }, // 异常：非成功终态
      { key: 'grpDone', states: ['done'] },                            // 已完成
    ];

    function JobList({ snapshot, onKill, onDismiss, onTail, onRetry, onContinue, channels, refreshKey, offline }) {
      /* ZB-07：分组内展开状态（按分组 key）。会话内记忆即可 —— 刷新后回到「只看最近 N 条」，
       * 这个默认方向是安全的（永远只会少显示，不会漏掉最新）。 */
      const [expandedGroups, setExpandedGroups] = useState({});
      /* ZB-09：Tab 分页。userTab=null 表示「跟随第一个非空分组」—— 面板刚挂载时快照还没到，
       * 无法在初始化时定 tab，故用 null 表示未选择，每次渲染按当前数据推导；
       * 用户点过某个 tab 后就固定用它（即使那个 tab 为空，也如实显示空态，不偷偷跳走）。 */
      const [userTab, setUserTab] = useState(null);
      const jobs = snapshot?.jobs ?? [];
      if (jobs.length === 0) return h('div', { className: 'zcd-empty' }, offline ? t('emptyOffline') : t('noJobs'));
      const claimed = new Set();
      for (const g of JOB_GROUPS) for (const s of g.states) claimed.add(s);
      /* 分类 tab 固定 4 个（计数可为 0）—— tab 集合稳定，不会随状态变化忽隐忽现；
       * 兜底分组 grpOther 只在真的有未归属状态时才作为第 5 个 tab 出现。 */
      const tabs = JOB_GROUPS.map((g) => ({ key: g.key, items: jobs.filter((j) => g.states.includes(j.state)) }));
      const rest = jobs.filter((j) => !claimed.has(j.state));
      if (rest.length) tabs.push({ key: 'grpOther', items: rest }); // 兜底：绝不吞掉未知状态的行
      const firstNonEmpty = (tabs.find((g) => g.items.length > 0) ?? tabs[0]).key;
      const activeKey = userTab ?? firstNonEmpty;
      const active = tabs.find((g) => g.key === activeKey) ?? tabs[0];

      /* 组内**最新在上**：进程上限 1000 条，若不截断面板会变成几百行长列表。
       * 截断只隐藏「更早的」，最新的永远可见；展开按钮写明还有多少条，不静默吞行。 */
      const newestFirst = [...active.items].sort((a, b) => String(b.queuedAt ?? '').localeCompare(String(a.queuedAt ?? '')));
      const open = !!expandedGroups[active.key];
      const shown = open ? newestFirst : newestFirst.slice(0, JOB_GROUP_PREVIEW);
      const hidden = newestFirst.length - shown.length;

      return h('div', { className: 'zcd-jobs' },
        h('div', { className: 'zcd-tabs', role: 'tablist' },
          tabs.map((g) => h('button', {
            key: g.key, role: 'tab', 'aria-selected': g.key === activeKey,
            className: 'zcd-tab' + (g.key === activeKey ? ' zcd-tab-on' : ''),
            onClick: () => setUserTab(g.key),
          },
            h('span', null, t(g.key)),
            h('span', { className: 'zcd-tab-n' }, String(g.items.length))))),
        newestFirst.length === 0
          ? h('div', { className: 'zcd-empty' }, offline ? t('emptyOffline') : t('noJobs'))
          : h('div', { className: 'zcd-group-body' },
            shown.map((j) => h(JobRow, { key: j.id, job: j, onKill, onDismiss, onTail, onRetry, onContinue, channels, refreshKey })),
            hidden > 0
              ? h('button', {
                className: 'zcd-btn2', style: { alignSelf: 'flex-start' },
                onClick: () => setExpandedGroups((p) => ({ ...p, [active.key]: true })),
              }, `${t('jobMore')} ${hidden} ${t('jobMoreN')}`)
              : null,
            open && newestFirst.length > JOB_GROUP_PREVIEW
              ? h('button', {
                className: 'zcd-btn2', style: { alignSelf: 'flex-start' },
                onClick: () => setExpandedGroups((p) => ({ ...p, [active.key]: false })),
              }, t('jobCollapse'))
              : null));
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
      return h('div', { className: 'zcd-stack' },
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
      /* ZB-08：用户要求「显示被单写锁的文件和对应的进程」——
       * 文件锁表来自 core 的 listFileLocks()（细粒度）；粗粒度 repo/memory 与队列长度仍保留，
       * 因为大量任务没声明 write，走的正是粗粒度锁，不能从面板上消失。 */
      const fileLocks = (snapshot && Array.isArray(snapshot.fileLocks)) ? snapshot.fileLocks : [];
      return h('div', { className: 'zcd-locks' },
        h('div', { className: 'zcd-row' },
          /* ZB-16：repo 锁显示为「仓库锁」；memory 锁已按用户要求删除，故不再有那一格。
           * 用户要求"显示被锁的文件和对应的进程"由下面的 fileLocks 列表承担。 */
          h('span', { className: 'zcd-label' }, t('repoLock')),
          h('span', { className: 'zcd-badge' }, holderOf(snapshot && snapshot.locks && snapshot.locks.repo)),
          h('span', { className: 'zcd-label' }, t('queueLen')),
          h('span', { className: 'zcd-badge' }, String((snapshot && snapshot.queue ? snapshot.queue.length : 0))),
        ),
        fileLocks.length === 0
          ? h('div', { className: 'zcd-note' }, t('noFileLocks'))
          : h('div', { className: 'zcd-filelocks' },
            fileLocks.map((lk) => h('div', { key: `${lk.jobId}:${lk.file}`, className: 'zcd-filelock' },
              h('span', { className: 'zcd-filelock-f', title: lk.file }, clampText(lk.file.replace(/^.*[\\/]/, ''), 40)),
              h('span', { className: 'zcd-filelock-who' }, lk.tag ?? shortId(lk.jobId)),
              h('span', { className: 'zcd-dim' }, fmtSec(lk.heldSec))))),
      );
    }

    function FloatingPanel() {
      /* ZB-07/10/11：位置持久化。ZB-11 起存的是**锚定信息**（贴哪条边 + 四条边距），
       * 而不是单纯的绝对 {left, top} —— 这样窗口尺寸变化时位置可被正确推导（见 anchorOf/resolvePos）。
       * 载入时按当前视口解析一次；旧格式（只有 left/top）自动按"贴左+贴上"兼容。
       * 初始化阶段拿不到面板真实尺寸（还没渲染），用保存的宽高 / 默认值估计；
       * 挂载后 ZB-10 会用真实测量尺寸再解析一次。 */
      /* ZB-11：**锚定记录**（贴哪条边 + 四条边距）—— 必须在 pos 的 useState 之前声明：
       * 那个初始化函数会把落盘的锚定种进来（否则 TDZ：Cannot access before initialization）。 */
      const anchorRef = useRef(null);
      const [pos, setPos] = useState(() => {
        const saved = loadJson(LS.pos, null);
        if (!saved) return null;
        const savedSize = loadJson(LS.size, null) || {};
        /* ★ 关键：把落盘的**锚定记录**同时种进 anchorRef —— 渲染位置由它推导。
         * 旧格式（只有 left/top，无 ax/ay）在这里补一次 anchorOf，于是老数据也能获得
         * "贴边跟随"的新行为（否则首次升级后会一直用绝对坐标）。 */
        const view = {
          vw: (typeof window !== 'undefined' && window.innerWidth) || 0,
          vh: (typeof window !== 'undefined' && window.innerHeight) || 0,
          w: Number(savedSize.width) || WIDTH.def,
          h: Number(savedSize.height) || 320,
        };
        anchorRef.current = (saved.ax && saved.ay)
          ? saved
          : anchorOf({ left: Number(saved.left) || 0, top: Number(saved.top) || 0 }, view);
        return resolvePos(saved, view);
      });
      const [width, setWidth] = useState(() => clampWidth(loadJson(LS.size, null)?.width));
      /* ZB-06：高度初值。无保存值 → null = auto（保持旧观感）；有则钳到当前视口允许范围。 */
      const [height, setHeight] = useState(() => {
        const h = loadJson(LS.size, null)?.height;
        return h == null ? null : clampHeight(h);
      });
      const [collapsed, setCollapsed] = useState(() => !!loadJson(LS.collapsed, false));
      /* ZB-08：固定（锁定位置）。持久化 —— 固定是"我把面板安置好了"的意图，跨会话应当保持。 */
      const [pinned, setPinned] = useState(() => !!loadJson(LS.pinned, false));
      const [minimized, setMinimized] = useState(false);
      const [lastJobId, setLastJobId] = useState(null);
      const [feedback, setFeedback] = useState(null);
      const [busy, setBusy] = useState(false);
      const {
        conn, snapshot, quota, planQuota, dispatch, kill, dismiss, tail,
        channels, channelGet, channelSet, retry, fallbackGet, fallbackSet,
        switchSet,
      } = useWire();
      const rootRef = useRef(null);
      /* ZB-11：这里保存的是**锚定记录**（贴哪条边 + 四条边距），而不是解析后的坐标。
       * 渲染时才用 resolvePos 推导实际 left/top（见 rootStyle），故窗口尺寸一变，
       * 位置会随锚定边自动重算 —— 这才是"固定在右上角"应有的跨尺寸行为。
       *
       * ★ ZB-10 的错误（本轮修正）：当时把**解析后的绝对坐标**写回 pos 并落盘，
       * 窗口一缩，钳制后的坐标就固化成"新位置"（落在中间），用户意图被永久破坏；
       * 再放大也不会还原。现在渲染值不落盘，落盘的只有意图（锚定）。 */
      /* （anchorRef 已上移到 pos 的 useState 之前 —— 那里要用它种入落盘的锚定） */
      /** 读取当前视口与面板真实尺寸（拿不到时退化为 0，由各纯函数自行处理）。 */
      const viewMetrics = useCallback(() => {
        const el = rootRef.current;
        return {
          vw: (typeof window !== 'undefined' && window.innerWidth) || 0,
          vh: (typeof window !== 'undefined' && window.innerHeight) || 0,
          w: (el && el.offsetWidth) || WIDTH.def,
          h: (el && el.offsetHeight) || 320,
        };
      }, []);
      /* ZB-10/11：视口尺寸变化时**按锚定重算**（不是把坐标钳死）。
       * 用 forcePos 触发一次重渲染即可 —— 真正的坐标由渲染期的 resolvePos 推导。 */
      const [, forcePos] = useState(0);
      useEffect(() => {
        const onResize = () => forcePos((n) => n + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);
      /* 挂载后也要重算一次：初始渲染时面板还没有真实尺寸（offsetWidth=0），
       * 用估计值推导过一次；挂载后尺寸已知，需要纠正。 */
      useEffect(() => { forcePos((n) => n + 1); }, [collapsed, minimized, width, height]);
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
      /* ZB-04：续接 = 同会话 + 新指令。继承原 job 的通道/模式/锁/cwd/超时，
       * 但**提示词换成用户新输入的**（这正是与 retry 的区别：retry 重发原提示词）。
       * resume 走 dispatch 的 resume 参数 → runner 传 --resume（wire.host.mjs 的拷贝表含 'resume'）。 */
      const onContinue = useCallback((job, text) => {
        const s = job.spec ?? {};
        const spec = { kind: 'prompt', prompt: text, resume: job.sessionId };
        for (const k of ['provider', 'mode', 'lock', 'cwd']) if (s[k] != null && s[k] !== '') spec[k] = s[k];
        if (s.timeoutMin != null) spec.timeoutMin = s.timeoutMin;
        if (job.tag) spec.tag = `${job.tag}-c`;
        return dispatch(spec);
      }, [dispatch]);
      const onFallbackSet = useCallback((list) => {
        Promise.resolve(fallbackSet(list)).then((r) => {
          if (r && r.ok) setFallbackState({ enabled: !!r.enabled, chain: r.chain ?? [] });
        });
      }, [fallbackSet]);
      // Z12：派发总开关切换（成功 → 1s 轮询带回新快照、徽标自动翻转；失败 → 错误进派发区反馈行）
      const onSwitchToggle = useCallback((next) => Promise.resolve(switchSet(next)).then((r) => {
        if (!r || !r.ok) setFeedback({ kind: 'err', text: `${t('errPrefix')}${(r && r.error) || 'unknown'}` });
      }), [switchSet]);

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
      const onDismiss = useCallback((id) => Promise.resolve(dismiss(id)), [dismiss]);

      // 交互元素上按下不启动拖动（否则标题栏的 setPointerCapture 会吃掉子按钮的 click）
      // （isInteractive 已上移模块级：与 JobRow 行头点击守卫共用）
      const startDrag = useCallback((e) => {
        if (e.button !== 0) return;
        if (pinned) return; // ZB-08：已固定 → 标题栏不响应拖动（按钮仍有各自的 stopPropagation）
        if (isInteractive(e.target)) return;
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const offX = e.clientX - rect.left;
        const offY = e.clientY - rect.top;
        const target = e.currentTarget;
        const last = { left: rect.left, top: rect.top };
        /* ZB-11：拖动过程中即按"当前位置"重算锚定（贴哪条边随拖动实时变化），
         * 松手时把**锚定记录**落盘 —— 落盘的是意图（贴右上角），不是某一时刻的绝对坐标。 */
        const commitAnchor = () => {
          const a = anchorOf({ left: last.left, top: last.top }, {
            vw: (typeof window !== 'undefined' && window.innerWidth) || 0,
            vh: (typeof window !== 'undefined' && window.innerHeight) || 0,
            w: el.offsetWidth || WIDTH.def,
            h: el.offsetHeight || 320,
          });
          anchorRef.current = a;
          return a;
        };
        const move = (ev) => {
          const w = el.offsetWidth || 1;
          const ht = el.offsetHeight || 1;
          last.left = Math.min(Math.max(EDGE, ev.clientX - offX), Math.max(EDGE, window.innerWidth - w - EDGE));
          last.top = Math.min(Math.max(EDGE, ev.clientY - offY), Math.max(EDGE, window.innerHeight - ht - EDGE));
          const a = commitAnchor();
          setPos({ left: a.left, top: a.top }); // pos 状态仍用于触发重渲染
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          saveJson(LS.pos, commitAnchor()); // 落盘锚定记录（含 ax/ay 与四条边距）
        };
        try {
          target.setPointerCapture(e.pointerId);
        } catch { /* 无捕获也能拖（老内核） */ }
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }, [pinned]); // ZB-08：pinned 参与判断 ⇒ 必须进依赖，否则闭包永远读到初始值

      const startResize = useCallback((e) => {
        if (e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const el = rootRef.current;
        const startW = el ? el.offsetWidth : WIDTH.def;
        // ZB-06：起点高度取实际渲染高度（auto 时即当前内容高度），拖拽后转为固定高度
        const startH = el ? el.offsetHeight : clampHeight(0);
        /* ZB-11：手柄固定右下角 ⇒ 变宽/变高一律取正向（右移=变宽、下移=变高），手柄与光标同向。
         * 这要求面板是 left/top 锚定：若还没被拖动过（pos 为空，CSS 是 right/bottom 锚定），
         * 先把 left/top 按**当前实际几何**钉住 —— 取的就是当前 rect，视觉上零位移，
         * 但从此右边缘/下边缘才是会动的那两条边，手柄与行为一致（ZB-10 那类"抓错角"不会再出现）。 */
        if (!anchorRef.current && el) {
          const r = el.getBoundingClientRect();
          const a = anchorOf({ left: Math.round(r.left), top: Math.round(r.top) }, {
            vw: (typeof window !== 'undefined' && window.innerWidth) || 0,
            vh: (typeof window !== 'undefined' && window.innerHeight) || 0,
            w: el.offsetWidth || WIDTH.def,
            h: el.offsetHeight || 320,
          });
          anchorRef.current = a;
          setPos({ left: a.left, top: a.top });
          saveJson(LS.pos, a);
        }
        const target = e.currentTarget;
        let w = startW;
        let h = startH;
        const move = (ev) => {
          w = clampWidth(startW + (ev.clientX - startX));
          h = clampHeight(startH + (ev.clientY - startY));
          setWidth(w);
          setHeight(h);
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          // ZB-06：宽高一起落盘（同一 localStorage 键，旧值 {width} 仍可读）
          saveJson(LS.size, { width: w, height: h });
        };
        try {
          target.setPointerCapture(e.pointerId);
        } catch { /* 同上 */ }
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }, [pos]); // ZB-10：pos 决定手柄侧与变宽方向 ⇒ 必须进依赖（同 pinned 那次教训）

      // 主题令牌以 CSS 自定义属性注入，TOKENS(T) 是唯一替换点
      const cssVars = {
        '--zcd-w': `${width}px`,
        // ZB-06：仅在用户设定过高度时才注入（未设定 = 不写，CSS 回退 auto + 72vh 上限）
        /* ZB-11：收起时必须**不**注入 --zcd-h —— 否则 body 已被移除、面板却被用户设过的高度撑着，
         * 屏幕上留下一个只剩标题栏的大空盒子（用户现场报告：「内容收起了，实际面板还在」）。 */
        ...(collapsed || height == null ? {} : { '--zcd-h': `${height}px` }),
        '--zcd-bg': T.bg, '--zcd-bgBar': T.bgBar, '--zcd-sunken': T.sunken, '--zcd-hover': T.hover,
        '--zcd-accent': T.accent, '--zcd-onAccent': T.onAccent, '--zcd-border': T.border, '--zcd-shadow': T.shadow,
        '--zcd-text': T.text, '--zcd-text2': T.text2, '--zcd-text3': T.text3, '--zcd-danger': T.danger, '--zcd-mono': T.mono,
        '--zcd-st-queued': T.stQueued, '--zcd-st-running': T.stRunning, '--zcd-st-done': T.stDone,
        '--zcd-st-failed': T.stFailed, '--zcd-st-killed': T.stKilled, '--zcd-st-interrupted': T.stInterrupted,
        '--zcd-st-idle': T.stIdle,
      };
      /* ZB-11：渲染位置由**锚定记录**推导（窗口尺寸变化时自动跟随贴边）。
       * anchorRef.current 为 null ⇒ 从未定位过，走默认右下角。 */
      const metrics = viewMetrics();
      const resolved = resolvePos(anchorRef.current, metrics);
      const rootStyle = resolved
        ? { ...cssVars, left: `${Math.round(resolved.left)}px`, top: `${Math.round(resolved.top)}px` }
        : { ...cssVars, right: '24px', bottom: '24px' };

      if (minimized) {
        const running = (snapshot && snapshot.counts && snapshot.counts.running) || 0;
        const waiting = running + ((snapshot && snapshot.counts && snapshot.counts.queued) || 0);
        /* ZB-06（用户报告「最小化后只能看到一点点内容」）：胶囊原先只画
         * [状态点][数字或·]，空载时就是一个孤零零的圆点 + 中点，看不出这是什么、也点不着。
         * 现在保留「ZCode 派发台」字样 + 实时状态，并给它一个明确的 title。
         *
         * ZB-07（用户报告「缩小后的胶囊跑到左上角、最上面了，还点击不了」）：
         * 根因是胶囊**复用了面板的 pos**。面板 440×620、胶囊约 140×30，同一个 left/top
         * 必然错位；面板拖到边界时存的极端值（负数 / 超出视口）更会把胶囊整个推出屏幕 ⇒ 点不到。
         * 胶囊本就只是「回到派发台」的入口，位置不需要跟面板走 —— 固定右下角即可。 */
        const status = running > 0 ? t('pillRunning') : waiting > 0 ? t('pillQueued') : t('pillIdle');
        return h('div', {
          className: 'zcd-root zcd-min',
          style: { ...cssVars, right: '24px', bottom: '24px' }, // 不用 pos：见上
        },
          h('style', null, CSS),
          h('button', {
            className: 'zcd-pill',
            title: `${t('title')} · ${status}${waiting > 0 ? `（${waiting}）` : ''} — ${t('restore')}`,
            'aria-label': `${t('restore')}：${t('title')}`,
            onClick: () => setMinimized(false),
          },
            h(StatusDot, { state: running > 0 ? 'running' : waiting > 0 ? 'queued' : 'idle' }),
            h('span', { className: 'zcd-pill-title' }, t('title')),
            waiting > 0 ? h('span', { className: 'zcd-pill-n' }, String(waiting)) : null,
            h('span', { className: 'zcd-pill-state' }, status)));
      }

      const runningNow = ((snapshot && snapshot.counts && snapshot.counts.running) || 0) > 0;
      const connLabel = conn === 'demo' ? t('connDemo') : conn === 'ext' ? t('connExt') : conn === 'live' ? t('connLive') : conn === 'offline' ? t('connOffline') : t('connConnecting');
      /* ZB-01 ③：离线/降级态的可读原因——取自 $mount 与子 fiber 的真实留痕，不猜、不谎报。
       * 这段文字是「面板为什么未连接」的唯一权威说明：$mount 失败会带上真实错误消息。 */
      const offlineReason = (() => {
        if (conn === 'live') return '';
        if (!MOUNT_DIAG.attempted) return `${t('chanOfflineHint')}（ctx.remote.$mount 不可用）`;
        if (MOUNT_DIAG.ok === false) return `${t('chanOfflineHint')}（$mount 失败：${MOUNT_DIAG.error}）`;
        return `${t('chanOfflineHint')}（描述符已挂载，等宿主命名空间 remote.zcodeDispatch 就绪）`;
      })();
      const showOfflineNote = conn === 'offline';
      // Z12：开关状态只认 live 快照携带的 snapshot.switch（宿主读真值文件）；其他数据源如实显示「未知/只读」
      const dispatchSwitch = snapshot && snapshot.switch ? snapshot.switch : null;

      return h('div', { ref: rootRef, className: 'zcd-root', style: rootStyle, role: 'region', 'aria-label': t('title') },
        h('style', null, CSS),
        h('div', { className: 'zcd-panel' },
          h('div', { className: 'zcd-titlebar' + (pinned ? ' zcd-locked' : ''), onPointerDown: startDrag },
            h(StatusDot, { state: runningNow ? 'running' : 'idle' }),
            h('span', { className: 'zcd-title' }, t('title')),
            h(SwitchBadge, { sw: dispatchSwitch, live: conn === 'live', onToggle: onSwitchToggle }),
            h('span', { className: 'zcd-conn', title: offlineReason || connLabel, 'aria-label': connLabel }, connLabel),
            /* ZB-08：固定/解锁面板位置（持久化）。固定后标题栏不再响应拖动。 */
            h('button', {
              className: 'zcd-iconbtn', title: pinned ? t('unpin') : t('pin'),
              'aria-label': pinned ? t('unpin') : t('pin'), 'aria-pressed': pinned,
              onPointerDown: (e) => e.stopPropagation(),
              onClick: () => {
                const nv = !pinned;
                setPinned(nv);
                saveJson(LS.pinned, nv);
              },
            }, h(IconPin, { on: pinned })),
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
            /* ZB-01 ③：离线原因放在 body 首行（始终在默认折叠的各分区之外）——
             * 免得排查时还要先展开「通道」分区才看得到。 */
            showOfflineNote ? h('div', { className: 'zcd-note', role: 'status', title: offlineReason }, offlineReason) : null,
            h(Section, { id: SEC.channel, title: t('secChannel'), collapsible: true },
              /* 离线说明只在 body 首行渲染一处（去重）：这里不再重复同一句话。 */
              h(ChannelSection, { channelsInfo, channel, fallback, onSwitch, onFallbackSet, offline: conn !== 'live', offlineReason })),
            h(Section, { id: SEC.dispatch, title: t('secDispatch'), collapsible: true },
              h(DispatchBar, { snapshot, lastJobId, feedback, busy, channel, swBlocked: dispatchSwitch != null && dispatchSwitch.enabled === false, onSubmit })),
            /* ZB-12（用户要求）：用量移到**派发下面** —— 派发前先看额度/套餐余量是自然顺序。
             * 当前完整顺序：通道 → 派发 → 用量 → 进程 → 单写者/文件锁。
             * 分区 id 不变 ⇒ 各自展开状态与持久化键不受影响。 */
            h(Section, { id: SEC.quota, title: t('secQuota'), collapsible: true },
              h(QuotaCards, { quota, planQuota })),
            h(Section, { id: SEC.jobs, title: t('secJobs'), collapsible: true },
              h(JobList, { snapshot, onKill, onDismiss, onTail: tail, onRetry, onContinue, channels: channelsInfo.channels, refreshKey: (snapshot && snapshot.generatedAt) || '', offline: conn === 'offline' })),
            /* ZB-09：单写者/文件锁紧跟在进程列表之后（排查并发问题时与进程对照着看更顺）。 */
            h(Section, { id: SEC.locks, title: t('secLocks'), collapsible: true },
              h(LockStatus, { snapshot })),
          ),
        ),
        collapsed ? null : h('div', { className: 'zcd-grip', title: t('grip'), 'aria-label': t('grip'), onPointerDown: startResize }, h(IconResizeMark)),
      );
    }

    return {
      // 只依赖宿主必定提供的**基础**服务。
      // ⚠️ 绝不能把自家的 `remote.zcodeDispatch` 写进 inject：该命名空间正是 apply() 里
      // $mount 才挂上的——声明它等于"等自己"，条目会永远 pending，导致 web boot 直接失败：
      //   web boot: 1 entry did not activate
      //   @local/zcode-dispatch: pending (waiting for service: remote.zcodeDispatch)
      // 命名空间是否就绪改用子 fiber（ctx.inject）在 $mount 之后订阅。
      //
      // ⚠️ `typert` 是**必须**的（2026-09-30 现场定证，错误消息：
      //   `$mount 失败：cannot get property "typert" without inject`）：
      //   gateway 的 `$mount` 用 `const callerCtx = this.ctx` 取**调用方**的 ctx
      //   —— cordis `Service` 构造时注册 `tracker = { associate: name, property: 'ctx' }`，
      //   而 traceable 代理对 `prop === tracker.property` 直接返回调用方 ctx
      //   （refs/extracted/cordis/src/service.ts:42-58、utils.ts:165-176：
      //    `if (prop === tracker.property) return ctx`）。
      //   随后 `mountContribution(callerCtx, …)` 执行
      //   `callerCtx.typert.remotes.register(contribution)`
      //   （refs/extracted/dsh-api-gateway/lib/client.js:1662-1664）→ 缺 `typert` 即抛错。
      //   `typert` 由 @deepseek-ai/dsh-typert-registry 客户端半边提供（其自身 inject=[]，
      //   必定先于本条目就绪；gateway 自己也 inject ["typert","connection"]），故不阻塞启动。
      inject: ['slots', 'remote', 'typert'],
      apply(ctx) {
        // 整个 apply 兜底：任何异常都不许冒泡（冒泡 = 条目激活失败 = web boot 失败）。
        // 2026-09-30 曾因 inject 自声明 remote 命名空间导致启动死锁，此后按"启动绝不因插件失败"设防。
        try {
          MOD_CTX = ctx; // createWire 据此探测远端面；apply 未跑或无 remote 时走 ext/demo 降级
          // 第三方本地包不被构建期内联进 api-remotes 聚合，须在 apply 自挂 remote.zcodeDispatch
          // 子服务（同形调用见 extracted/dsh-api-remotes/lib/client.js:13505-13540）。$mount
          // 返回「命名空间就绪后可用的 disposer」，随客户端 ctx 生命周期存续；这里不持有它
          // （客户端模块表未给 apply 提供卸载通道），拒绝路径只留痕不白屏。
          try {
            const fn = ctx?.remote && ctx.remote.$mount;
            if (typeof fn === 'function') {
              MOUNT_DIAG.attempted = true;
              const mounted = fn.call(ctx.remote, REMOTE_CONTRIBUTION);
              if (mounted && typeof mounted.then === 'function') {
                mounted.then(
                  () => {
                    MOUNT_DIAG.ok = true; MOUNT_DIAG.error = null;
                    try { console.info('[zcode-dispatch] $mount 成功：remote.zcodeDispatch 已本地挂载'); } catch { /* ignore */ }
                  },
                  (e) => {
                    MOUNT_DIAG.ok = false; MOUNT_DIAG.error = (e && e.message) || String(e);
                    try { console.warn('[zcode-dispatch] $mount 失败：', MOUNT_DIAG.error); } catch { /* ignore */ }
                  },
                );
              }
            }
          } catch (e) {
            MOUNT_DIAG.attempted = true;
            MOUNT_DIAG.ok = false;
            MOUNT_DIAG.error = (e && e.message) || String(e);
          }
          // 配方步骤③：子 fiber 等 remote.zcodeDispatch 就绪（有序、且不阻塞条目激活）。
          // 命名空间缺席时该 fiber 只是 pending，不会让本条目失败——这是与顶层 inject 的关键区别。
          try {
            if (typeof ctx?.inject === 'function') {
              ctx.inject(['remote.zcodeDispatch'], (scope) => {
                try {
                  const svc = scope?.remote?.zcodeDispatch;
                  if (svc && typeof svc.snapshot === 'function') {
                    markRemoteReady(svc);
                    try { console.info('[zcode-dispatch] 子 fiber：remote.zcodeDispatch 就绪'); } catch { /* ignore */ }
                    // 依赖撤销时（命名空间退役）清掉缓存，避免拿着退役实例继续轮询。
                    if (scope && typeof scope.effect === 'function') {
                      scope.effect(() => () => { if (REMOTE_SVC === svc) REMOTE_SVC = null; }, 'zcode-dispatch.namespace');
                    }
                  }
                } catch { /* 就绪回调异常不影响条目 */ }
              });
            }
          } catch { /* 子 fiber 建立失败：仍可用 createWire 的即时探测兜底 */ }
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
