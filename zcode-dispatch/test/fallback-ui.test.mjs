/**
 * ZB-30 UI 渲染回归：自动降级开关 + 开启后的目标三下拉（**真渲染**，非源码正则）。
 *
 * 为什么需要它：`client.js` 是 cordis 客户端插件（依赖 React / 槽位），无法直接 import。
 * 源码正则（fallback-target.test.mjs 的 D 段）能钉住"写了什么"，但**测不出运行时是否抛错、
 * 关闭时是否真的不渲染**。这里用与 test/panel-style.test.mjs 同一套 DOM + React 桩真渲染一次，
 * 数据源走 ext wire（window.__zcodeDispatchDemo 对象），从而让 fallback 处于"已开启"态。
 *
 * 断言：
 *   ① 关闭态：只有开关按钮，**没有**目标三下拉
 *   ② 开启态：开关 aria-pressed=true + 指示灯用状态色；出现 3 个 select（通道/模型/思考强度）
 *   ③ 档位下拉的 option label 是中文（值仍是原始字符串）
 *   ④ 点开关 → 调用 fallbackSet(null) 关闭（wire 收到 null 而不是 ["null"]）
 */
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* ---------- DOM / React 桩（与 panel-style.test.mjs 同源，按需精简） ---------- */
const head = {
  children: [],
  appendChild(c) { c.parentNode = head; head.children.push(c); return c; },
  removeChild(c) { head.children = head.children.filter((x) => x !== c); c.parentNode = null; c.isConnected = false; return c; },
};
globalThis.document = {
  head, documentElement: { appendChild: () => {} },
  createElement: (t) => (t === 'style'
    ? { tagName: 'STYLE', attrs: {}, isConnected: true, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, textContent: '' }
    : { tagName: t.toUpperCase(), attrs: {}, setAttribute() {}, appendChild() {} }),
  getElementById: (id) => head.children.find((c) => c.attrs && c.attrs.id === id) ?? null,
  querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {},
};
const ls = new Map();
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };

/* ext wire：window.__zcodeDispatchDemo 是**对象**（有 getSnapshot）⇒ extWire（conn='ext'）。
 * 它把方法名透传到 ext[name] —— 故这里直接给 channels/channel/fallback 三个方法。 */
const fallbackCalls = [];
const CHANNELS = [
  { id: 'plan', name: '默认套餐', enabled: true, reason: null, models: ['GLM-5.3', 'GLM-5.3-Flash'], thinkingLevels: ['disabled', 'enabled'] },
  { id: 'personal', name: '个人 API', enabled: true, reason: null, models: ['deepseek-flash'], thinkingLevels: ['disabled', 'low', 'high', 'max'] },
];
const EXT = {
  getSnapshot: () => ({ generatedAt: 'x', counts: { running: 0, queued: 0 }, jobs: [], locks: {}, queue: [] }),
  getQuota: () => null,
  channels: async () => ({ ok: true, channels: CHANNELS, warnings: [] }),
  channel: async () => ({ ok: true, channel: { provider: 'plan', model: 'GLM-5.3-Flash', reasoningLevel: 'agent' } }),
  fallback: async (arg) => {
    fallbackCalls.push(arg);
    if (arg && arg.chain === null) return { ok: true, enabled: false, chain: [], targets: [], target: null };
    return {
      ok: true, enabled: true, chain: ['personal'],
      targets: [{ provider: 'personal', model: 'deepseek-flash', reasoningLevel: 'high' }],
      target: { provider: 'personal', model: 'deepseek-flash', reasoningLevel: 'high' },
    };
  },
};
let captured = null;
globalThis.window = {
  __ModuleLoader__: { load: (o) => { captured = o; } },
  __zcodeDispatchDemo: EXT,
  localStorage: globalThis.localStorage, innerHeight: 900, innerWidth: 1200,
  addEventListener: () => {}, removeEventListener: () => {},
};
await import('file:///F:/My Code/zcode-dispatch/zcode-dispatch/client.js');

const el = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() });
const cellStore = new Map();
let cur = null;
const pendingEffect = [];
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
  slots: { inject: (k, cb) => { cb(); return () => {}; }, register: (o, comp) => { regs.push({ o, comp }); return () => {}; } },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  on: () => () => {}, locale: { formatMessage: (m) => String(m?.id ?? m) },
  remote: { $mount: () => Promise.resolve() },
});

/* 渲染入口：open=true 时点一次让它展开；随后把挂起的 effect 全部跑掉（wire 订阅 → ext 同步发一包）。 */
const render = (open) => {
  let t = expand(regs[0].comp({}), 'hdr');
  if (open) {
    let chip = null;
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'button' && typeof n.props?.className === 'string' && n.props.className.includes('zcd-chip')) chip = n;
      walk(n.children);
    };
    walk(t);
    if (chip) chip.props.onClick();
  }
  t = expand(regs[0].comp({}), 'hdr');
  while (pendingEffect.length) pendingEffect.shift()();
  return t;
};
/* 找出分区里的所有 select / 开关按钮 */
const collect = (tree) => {
  const selects = []; const buttons = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'select') selects.push(n);
    if (n.type === 'button') buttons.push(n);
    walk(n.children);
  };
  walk(tree);
  return { selects, buttons };
};
/* option 的 children 在桩里是数组（el 把 children 展平后仍包一层）——统一折成字符串标签。 */
const optLabels = (sel) => (sel.children ?? [])
  .filter((c) => c && c.type === 'option')
  .map((c) => (Array.isArray(c.children) ? c.children.join('') : String(c.children ?? '')));

/* 分区默认「通道」是收起的（SEC_DEFAULT_OPEN.channel=false）——本测试要渲染通道分区，
 * 故先把它置为展开（Section 的初值读 localStorage['zcode-dispatch:section:channel']）。 */
ls.set('zcode-dispatch:section:channel', 'true');

/* ---------- ① 首帧（ext 的 fallback 返回 enabled=true，但 effect 跑完才进 state） ---------- */
let tree = render(true);
let { selects, buttons } = collect(tree);
const toggleOf = (b) => b.find((x) => typeof x.props?.className === 'string' && x.props.className.includes('zcd-toggle'));

/* 首帧 effect 尚未跑 → fallback 初值 {enabled:false} ⇒ 只有开关、没有目标下拉。
 * （这一步同时证明"关闭时不显示"。） */
ok(selects.length === 3, `关闭态只有「通道」分区的 3 个下拉（实际 ${selects.length}）`);
ok(!!toggleOf(buttons), '① 关闭态已渲染降级开关按钮');
ok(toggleOf(buttons).props['aria-pressed'] === false, '① 关闭态 aria-pressed=false');
const dotOf = (btn) => (btn.children ?? []).find((c) => c && typeof c.props?.className === 'string' && c.props.className.includes('zcd-dot'));
ok(!!dotOf(toggleOf(buttons)), '① 开关带指示灯（.zcd-dot）');
ok(String(dotOf(toggleOf(buttons)).props.style.background).includes('state-error'), '① 关闭态指示灯用错误/危险状态色令牌（非字面色值）');

/* ---------- ② effect 跑完（fallbackGet 返回 enabled=true）→ 重渲染 ---------- */
await new Promise((r) => setTimeout(r, 30));
tree = render(false);
({ selects, buttons } = collect(tree));
const toggle = toggleOf(buttons);
ok(!!toggle && toggle.props['aria-pressed'] === true, '② 开启态 aria-pressed=true');
ok(String(dotOf(toggle).props.style.background).includes('state-success'), '② 开启态指示灯用成功状态色令牌');
ok(selects.length === 6, `② 开启后出现目标三下拉（通道/模型/思考强度 ⇒ 共 6 个，实际 ${selects.length}）`);
const labels = selects.flatMap(optLabels);
ok(labels.includes('关闭思考') && labels.includes('开启思考'), '③ 档位 option 中文标签（disabled→关闭思考 / enabled→开启思考）');
ok(labels.includes('高强度') && labels.includes('最高强度'), '③ deepseek 通道的四档中文（高强度/最高强度）');
ok(selects.some((s) => (s.children ?? []).some((c) => c && c.type === 'option' && c.props.value === 'high')),
  '③ option value 仍是原始档位字符串（high）—— 中文只在 label');
ok(labels.includes('（沿用原任务模型）') && labels.includes('（沿用原任务思考强度）'),
  '★ 模型/档位首项是「沿用原任务」（不是 Agent决定）');
/* 作用域必须只取**降级目标**的三个下拉（后 3 个）：上面「通道」分区的档位下拉首项本来就该是
 * 「Agent决定」（那是给派发 Agent 的规定，ZB-29d）。 */
const fbSelects = selects.slice(3);
const fbLabels = fbSelects.flatMap(optLabels);
ok(fbLabels.length > 0 && !fbLabels.some((l) => l.includes('Agent决定')),
  '★ 降级目标下拉里不出现「Agent决定」（自动降级时没有 Agent 在决定）');

/* ---------- ④ 点开关 → 关闭（wire 收到 null） ---------- */
const before = fallbackCalls.length;
toggle.props.onClick();
await new Promise((r) => setTimeout(r, 20));
ok(fallbackCalls.length === before + 1, '④ 点击开关触发一次 fallback 写入');
ok(fallbackCalls[fallbackCalls.length - 1].chain === null, '★ 关闭时 wire 收到 chain:null（不是 ["null"] 的旧缺陷）');
tree = render(false);
({ selects } = collect(tree));
ok(selects.length === 3, `④ 关闭后目标下拉消失（回到 3 个，实际 ${selects.length}）`);

/* ---------- ⑤ demo 数据源同样走新形状（它是 `window.__zcodeDispatchDemo='builtin'` 时的路径） ----------
 * 单独跑一遍：把 flag 换成 'builtin' 会走 demoWire，其 fallbackGet/Set 用的是内联 normTargets/fallbackShape。
 * 这里直接对源码做形态断言即可（真渲染两条路径已在 ①–④ 覆盖 ext；demo 的语义由 core 测试 A/C 覆盖）。 */
ok(/async fallbackGet\(\) \{\s*return \{ ok: true, \.\.\.fallbackShape\(demoTargets\) \};\s*\}/.test(src),
  '⑤ demo 数据源的 fallbackGet 用同一 fallbackShape（新形状）');
ok(/async fallbackSet\(target\) \{\s*demoTargets = normTargets\(target\);/.test(src),
  '⑤ demo 数据源的 fallbackSet 用同一 normTargets（对象/数组/null 三形状一致）');
ok(/let demoTargets = \[\];/.test(src) && !/let demoChain/.test(src), '⑤ 旧的 demoChain 已彻底替换（不留死变量）');

console.log(`\n===== ZB-30 UI 渲染：${pass} PASS / 0 FAIL =====`);
process.exit(0);