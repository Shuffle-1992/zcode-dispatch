// ZB-24 回归测试：会话标题行入口（用户要求「与子智能体同一行显示 ZCode 派发台，点击弹出面板」）。
//
// 三件事必须锁死，否则这个入口会悄悄退化：
//   ① 注册到**正确的槽位**（活体 Inspect 实证：conversation.session.header.actions，
//      与 subagent-catalog(-30)/agent-team(-20)/agent-preset(-10)/job-list(20) 同一行），
//      且 order=10（排在「创造模式」之后、DSH 自带「后台任务」之前）；
//   ② 点击**切共享 store**的 minimized（面板本体不变、单实例），且入口的 aria-expanded 随之翻转；
//   ③ ★ 入口**不建 wire**（否则每开一个会话就多一条 1s 轮询 —— 这是本轮的解耦点，
//      退化成"入口自带轮询"不会有任何报错，只会静默多一倍请求，所以必须有断言守着）。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = stripComments(src);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* ---------------- A. 静结构（不需要渲染） ---------------- */
console.log('A. 槽位与注册契约');
ok(/const HEADER_SLOT = 'conversation\.session\.header\.actions';/.test(code),
  "A1 HEADER_SLOT = 'conversation.session.header.actions'（活体 Inspect 实证的槽位名）");
ok(/ctx\.slots\.inject\(HEADER_SLOT,/.test(code), 'A2 用 slots.inject(HEADER_SLOT, …) 等该槽位就绪（与 shell.overlay 同款写法）');
ok(/id: 'zcode-dispatch', order: 10/.test(code), "A3 注册 id='zcode-dispatch'、order=10（排在 agent-preset(-10) 与 job-list(20) 之间）");
ok(/id: 'zcode-dispatch\.console', order: 20/.test(code), 'A4 浮层那条注册保持不变（id/order 未被本次改动带偏）');

console.log('\nB. 解耦约束：入口是纯读者，不建第二条 wire');
{
  const i = code.indexOf('function HeaderEntry()');
  const body = code.slice(i, code.indexOf('\n    function FloatingPanel()', i));
  ok(i > 0 && body.length > 0, 'B1 能定位 HeaderEntry 函数体');
  ok(!/useWire\s*\(/.test(body), 'B2 ★ 入口体内不调 useWire()（否则每会话多一条 1s 轮询）');
  ok(!/createWire\s*\(/.test(body), 'B3 入口体内不创建 wire');
  ok(/usePanelUi\(\)/.test(body), 'B4 入口状态全部来自共享 store（usePanelUi）');
  ok(/panelUi\.set\(\{ minimized: active \}\)/.test(body), 'B5 点击只切共享 store 的 minimized（不复制面板）');
  const store = code.slice(code.indexOf('const panelUi = {'), code.indexOf('function usePanelUi()'));
  ok(/listeners: new Set\(\)/.test(store) && /subscribe\(l\)/.test(store), 'B6 共享 store 有订阅/退订');
  ok(/if \(!changed\) return next;/.test(store), 'B7 store 做值变化去重（面板每秒重渲染不白刷读者）');
}

console.log('\nC. 面板侧已改用同一份状态（否则会出现「入口显示已打开、面板却是胶囊」）');
ok(/const ui = usePanelUi\(\);/.test(code), 'C1 FloatingPanel 用 usePanelUi() 取代局部 minimized state');
ok(!/setMinimized\(/.test(code), 'C2 全文件不再有 setMinimized（旧局部 state 已清除）');
ok(/panelUi\.set\(\{ minimized: true \}\)/.test(code) && /panelUi\.set\(\{ minimized: false \}\)/.test(code),
  'C3 「最小化」「展开派发台」两个动作都写共享 store');
ok(/panelUi\.set\(\{ running: Number\(counts\.running\) \|\| 0, queued: Number\(counts\.queued\) \|\| 0, conn \}\)/.test(code),
  'C4 面板把 running/queued/conn 发布进 store（入口的计数来源）');

console.log('\nD. 文案双份同源（locale 与内嵌 STRINGS）');
for (const f of ['locale/zh.json', 'locale/en.json']) {
  const j = JSON.parse(readFileSync('F:\\My Code\\zcode-dispatch\\zcode-dispatch\\' + f, 'utf8'));
  ok(typeof j.ui?.headerTip === 'string' && j.ui.headerTip.length > 0, `D1 ${f} 有 ui.headerTip`);
}
ok((code.match(/headerTip:/g) || []).length === 2, 'D2 client.js 内嵌 STRINGS 的 zh/en 双侧都有 headerTip');

/* ---------------- E. 真渲染：点击翻转 aria-expanded ---------------- */
console.log('\nE. 真渲染（React 桩）：入口形态与点击行为');
{
  const mkEl = (tag) => ({
    tagName: tag.toUpperCase(), children: [], attrs: {}, parentNode: null, isConnected: true, textContent: '',
    setAttribute: (k, v) => { mkEl.attrs = mkEl.attrs; }, appendChild: (c) => c, removeChild: (c) => c,
  });
  const head = { children: [], appendChild: (c) => { head.children.push(c); return c; }, removeChild: () => {} };
  globalThis.document = { head, documentElement: { appendChild: () => {} }, createElement: (t) => (t === 'style' ? { tagName: 'STYLE', attrs: {}, setAttribute() {}, textContent: '' } : mkEl(t)), getElementById: () => null, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} };
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  let captured = null;
  globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o; } }, localStorage: globalThis.localStorage, innerHeight: 900, innerWidth: 1200, addEventListener: () => {}, removeEventListener: () => {} };
  await import('file:///F:/My Code/zcode-dispatch/zcode-dispatch/client.js');

  const el = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() });
  const cellStore = new Map();
  let cur = null; const pendingEffect = [];
  const React = {
    createElement: el, Fragment: 'Fragment',
    Component: class { constructor(p) { this.props = p ?? {}; this.state = {}; } setState(n) { this.state = { ...this.state, ...(typeof n === 'function' ? n(this.state) : n) }; } },
    useState: (v) => { const c = cur.cells; const i = cur.idx++; if (c[i] === undefined) c[i] = typeof v === 'function' ? v() : v; return [c[i], (nv) => { c[i] = typeof nv === 'function' ? nv(c[i]) : nv; }]; },
    useEffect: (fn) => { const i = cur.idx++; if (!cur.effects.has(i)) { cur.effects.set(i, true); pendingEffect.push(fn); } },
    useLayoutEffect: (fn) => { const i = cur.idx++; if (!cur.effects.has(i)) { cur.effects.set(i, true); pendingEffect.push(fn); } },
    useRef: (v) => { const i = cur.idx++; if (!(i in cur.cells)) cur.cells[i] = { current: v }; return cur.cells[i]; },
    useCallback: (f) => f, useMemo: (f) => (typeof f === 'function' ? f() : f), useSyncExternalStore: () => undefined,
  };
  const expand = (node, path) => {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${path}.${i}`));
    const kids = (node.children ?? []).map((c, i) => expand(c, `${path}.${i}`));
    const type = node.type;
    const props = { ...node.props, children: kids.length <= 1 ? kids[0] : kids };
    if (typeof type === 'function' && type.prototype && typeof type.prototype.render === 'function') {
      const inst = new type(props); inst.props = props; return expand(inst.render(), `${path}~${type.name}`);
    }
    if (typeof type === 'function') {
      const key = `${path}~${type.name || 'anon'}`;
      if (!cellStore.has(key)) cellStore.set(key, { cells: [], deps: new Map(), effects: new Map() });
      const prev = cur; cur = cellStore.get(key); cur.idx = 0;
      let out; try { out = type(props); } finally { cur = prev; }
      return expand(out, key);
    }
    return { ...node, children: kids };
  };
  const regs = [];
  const mod = captured.factory((n) => (n === 'react' ? React : {}));
  mod.apply({
    slots: { inject: (key, cb) => { cb(); return () => {}; }, register: (opts, comp) => { regs.push({ opts, comp }); return () => {}; } },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    on: () => () => {}, locale: { formatMessage: (m) => String(m?.id ?? m) },
  });

  const header = regs.find((r) => r.opts.name === 'conversation.session.header.actions');
  ok(!!header, 'E1 apply 后确实注册了会话头槽位（真渲染路径）');
  ok(header.opts.id === 'zcode-dispatch' && header.opts.order === 10, `E2 注册选项 id/order 正确（${header.opts.id}/${header.opts.order}）`);
  ok(regs.some((r) => r.opts.name === 'shell.overlay'), 'E3 浮层注册同时存在（两条互不影响）');

  const render = () => {
    let t = expand(header.comp({}), 'hdr');
    t = expand(header.comp({}), 'hdr');
    while (pendingEffect.length) pendingEffect.shift()();
    return t;
  };
  const findButton = (node) => {
    if (node == null || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const n of node) { const r = findButton(n); if (r) return r; } return null; }
    if (node.type === 'button') return node;
    return findButton(node.children);
  };
  const texts = (node) => {
    if (node == null || node === false || node === true) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(texts).join('|');
    return texts(node.children);
  };

  let tree = render();
  const btn = findButton(tree);
  ok(!!btn, 'E4 渲染出一枚 <button>（入口胶囊）');
  ok(typeof btn.props.className === 'string' && btn.props.className.includes('zcd-head'), 'E5 className 含 zcd-head（CSS 有对应规则）');
  ok(btn.props['aria-expanded'] === true, 'E6 初始 aria-expanded=true（面板默认展开态）');
  ok(texts(btn).includes('ZCode 派发台'), `E7 胶囊上显示「ZCode 派发台」（实际文本=${texts(btn)}）`);
  ok(typeof btn.props.onClick === 'function', 'E8 有 onClick（点击弹出/收起面板）');
  ok(!findButton(tree)?.props?.children?.toString?.().includes('zcd-head-n'), 'E9 无运行中/排队任务时不渲染计数徽标');

  btn.props.onClick(); // ← 真实点击处理器（不是只看源码里有没有）
  tree = render();
  const btn2 = findButton(tree);
  ok(btn2.props['aria-expanded'] === false, 'E10 ★ 点击后 aria-expanded 翻转为 false（切的是共享 store，不是局部 state）');
  btn2.props.onClick();
  tree = render();
  ok(findButton(tree).props['aria-expanded'] === true, 'E11 再点一次翻回 true（可反复开合）');
}

console.log(`\n===== ZB-24：${pass} PASS / 0 FAIL =====`);

/* 本文件渲染了 client.js 的组件；与 panel-style.test.mjs 同理显式退出，
 * 避免任何潜在定时器（面板 1s 轮询）让事件循环不空、进程挂住。 */
process.exit(0);
