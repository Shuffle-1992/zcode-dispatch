// ZB-21 回归测试：面板「重影 + 透明 + 塌到左上角」的根治。
//
// 用户报告：「面板会发生重影的问题。变成透明在左上角。」
//
// ★ 根因：样式此前是**作为 React 元素**渲染进组件树（`h('style', null, CSS)`）。
// 面板每秒轮询重渲染，一旦 React 重建该 <style> 节点，浏览器会**先移除再插入**样式表 ——
// 那一瞬间：
//   ① .zcd-root 失去 position:fixed ⇒ 面板**塌到左上角**（退回静态布局）
//   ② .zcd-panel 失去 background ⇒ **透明**（看到底下 DSH）
//   ③ 样式重新插入时 .zcd-panel 的 animation:zcd-in 从头播放，而
//      `@keyframes zcd-in{from{opacity:0}}` **没有 to** ⇒ 反复重启期间长期半透明 ⇒ **重影**
//
// 修法：A. 样式只注入一次到 document.head（脱离 React 重渲染路径）；
//       B. 给 zcd-in 补显式 `to{opacity:1;transform:none}`。
//
// 本测试用 DOM 桩统计 head 的插入/移除次数，**核心断言是"重渲染不再触碰 head"**。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 剥离注释后再做源码断言 —— 本轮注释里**引用**了旧代码 `h('style', null, CSS)` 作根因说明，
 * 不剥注释会把"解释"误判成"残留"（第一版正是这样假失败）。 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释（含 JSDoc）
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避开 http:// 这类）
const code = stripComments(src);

console.log('A. 样式已移出组件树（根治前提）');
ok(!/h\('style', null, CSS\)/.test(code), "A1 组件树里不再渲染 h('style', null, CSS)（注释引用不算）");
ok((code.match(/h\('style'/g) || []).length === 0, "A2 生效代码里无 h('style' 出现");
ok(/document\.createElement\('style'\)/.test(code), "A3 改为 document.createElement('style')");
ok(/\(document\.head \|\| document\.documentElement\)\.appendChild\(s\)/.test(code),
  'A4 注入到 document.head（脱离 React 协调）');

console.log('\nB. 幂等与生命周期');
ok(/function ensureStyle\(\)/.test(src), 'B1 有 ensureStyle()');
ok(/if \(styleEl && styleEl\.isConnected\) return;/.test(src), 'B2 已注入则直接返回（幂等，不重复插入）');
ok(/const existing = document\.getElementById\(STYLE_ID\)/.test(src),
  'B3 先按 id 查找已存在的样式（跨组件实例复用，不产生第二份）');
ok(/function detachStyle\(\)/.test(src), 'B4 有 detachStyle()（保持"卸载即清理"语义）');
ok(/ensureStyle\(\);[\s\S]{0,80}return \(\) => detachStyle\(\);/.test(src),
  'B5 useEffect 挂载时注入、卸载时移除');
ok(/\}, \[\]\);/.test(src), 'B6 该 effect 依赖为空数组（只在挂载/卸载跑，轮询重渲染不触发）');

console.log('\nC. 入场动画终态明确（消除重影的直接手段）');
{
  const i = src.indexOf('@keyframes zcd-in');
  const block = src.slice(i, src.indexOf('}}', i) + 2);
  ok(/from\{opacity:0/.test(block), 'C1 from 仍是 opacity:0（保留入场淡入观感）');
  ok(/to\{opacity:1/.test(block), 'C2 **补上了 to{opacity:1}** —— 即使动画被重启，终态也明确不透明');
  ok(/transform:none/.test(block), 'C3 to 里 transform:none（复位，避免残留位移）');
}

console.log('\nD. 定位与背景的来源未被破坏');
ok(/\.zcd-root\{position:fixed/.test(src), 'D1 .zcd-root 仍是 position:fixed（否则会塌到左上角）');
ok(/\.zcd-panel\{[^}]*background:/.test(src), 'D2 .zcd-panel 仍有 background（否则透明）');
ok(/width:min\(var\(--zcd-w/.test(src), 'D3 .zcd-root 仍有宽度（否则塌成窄条）');
ok(/'--zcd-w': `\$\{width\}px`/.test(src), 'D4 --zcd-w 仍按 width 注入');

console.log('\nE. DOM 桩实测：注入一次且重渲染不再触碰 head');
{
  const headChildren = [];
  let insertCount = 0, removeCount = 0;
  const mkEl = (tag) => {
    const e = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, parentNode: null, isConnected: true,
      setAttribute: (k, v) => { e.attrs[k] = v; },
      getAttribute: (k) => e.attrs[k],
      appendChild: (c) => { c.parentNode = e; e.children.push(c); insertCount += 1; return c; },
      removeChild: (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; c.isConnected = false; removeCount += 1; return c; },
    };
    return e;
  };
  const head = mkEl('head');
  globalThis.document = {
    head, documentElement: mkEl('html'),
    createElement: (t) => mkEl(t),
    getElementById: (id) => head.children.find((c) => c.attrs.id === id) ?? null,
    querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {},
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  let captured = null;
  globalThis.window = { __ModuleLoader__: { load: (o) => { captured = o; } }, __zcodeDispatchDemo: 'builtin', localStorage: globalThis.localStorage, innerHeight: 900, innerWidth: 1200, addEventListener: () => {}, removeEventListener: () => {} };
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
  const mod = captured.factory((n) => (n === 'react' ? React : {}));
  /* ZB-24：注册数从 1 变 2（新增会话头入口）。原先「最后注册的组件胜出」的写法
   * 会静默选错组件（渲染到会话头入口 → 样式不注入 → E1 假红）。改为**按槽位名显式取**。 */
  const regs = [];
  mod.apply({
    slots: { inject: (k, cb) => { cb(); return () => {}; }, register: (o, comp) => { regs.push({ o, comp }); if (o.name === 'shell.overlay') captured.comp = comp; return () => {}; } },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    on: () => () => {}, locale: { formatMessage: (m) => String(m?.id ?? m) },
  });
  ok(regs.some((r) => r.o.name === 'shell.overlay'), 'D5 注册了 shell.overlay（本测试的被测组件来源）');
  const render = () => {
    let t = expand(captured.comp({}), 'root');
    t = expand(captured.comp({}), 'root');
    t = expand(captured.comp({}), 'root');
    while (pendingEffect.length) pendingEffect.shift()();
    return t;
  };
  let tree = render();
  ok(head.children.filter((c) => c.tagName === 'STYLE').length === 1, 'E1 挂载后 head 里恰好 1 个 <style>');
  ok(head.children[0].attrs.id === 'zcode-dispatch-style', 'E2 样式带稳定 id（幂等查找依据）');
  const css = String(head.children[0].textContent ?? '');
  ok(css.includes('.zcd-root{position:fixed'), 'E3 注入的 CSS 含 position:fixed');
  ok(/\.zcd-panel\{[^}]*background:/.test(css), 'E4 注入的 CSS 含 .zcd-panel 背景');
  {
    let n = 0;
    const f = (x) => { if (!x || typeof x !== 'object') return; if (x.type === 'style') n += 1; for (const c of x.children ?? []) f(c); };
    f(tree);
    ok(n === 0, 'E5 组件树里没有 <style> 节点');
  }
  const ins0 = insertCount, rem0 = removeCount;
  for (let i = 0; i < 10; i += 1) render();
  ok(insertCount === ins0 && removeCount === rem0,
    `E6 ★ 连续 10 次重渲染后 head 插入/移除次数不变（${ins0}→${insertCount} / ${rem0}→${removeCount}）—— 这是"透明+塌左上角"的根治`);
  ok(head.children.filter((c) => c.tagName === 'STYLE').length === 1, 'E7 重渲染后样式仍在位');
}

console.log(`\n===== ZB-21：${pass} PASS / 0 FAIL =====`);

/* ⚠️ 必须显式退出：本文件是**唯一真正 import 并渲染 client.js** 的测试，
 * 而面板有 1s 轮询定时器（REMOTE_POLL_MS=1000）⇒ 事件循环永不自然清空、进程挂住。
 * 其它测试只读源码文本，故能自然退出。
 * 放在最后：任何断言失败都会先抛错，不会走到这里（不会被这个 exit 掩盖）。 */
process.exit(0);