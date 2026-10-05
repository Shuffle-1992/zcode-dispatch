// ZB-27 回归测试：会话标题行入口 = **一枚与同排入口同形态的文字按钮 + 挂在其下的悬浮弹窗**。
//
// 用户连续两次的要求（2026-10-05）：
//   ① 「把派发台改成与子智能体一样的位置，在那一行显示 ZCode 派发台，点击弹出面板」
//   ② 「不协调，字体大小样式都与其他的一致…弹窗参考子智能体的，悬浮在旁边的…取消右下角最小化的药丸」
//
// 因此本测试锁四件事：
//   A. 槽位/注册契约（同排、order=10）且**不再**注册到 shell.overlay（浮窗与药丸已取消）；
//   B. 入口样式取自系统同排入口（job-list）：无边框、12px、label-tertiary、min-height 28；
//   C. 点击开合 + 点外部/Esc 关闭；弹窗用系统菜单令牌（--dsw-specific-menu / elevation-prominent）；
//   D. 入口自身**不建 wire**（wire 由弹窗里的 PanelBody 持），避免每个会话多一条 1s 轮询。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const code = stripComments(src);

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

console.log('A. 槽位与注册契约');
ok(/const HEADER_SLOT = 'conversation\.session\.header\.actions';/.test(code), 'A1 HEADER_SLOT 指向会话标题行槽位');
ok(/id: 'zcode-dispatch', order: 10/.test(code), 'A2 注册 id=zcode-dispatch、order=10（在 agent-preset(-10) 与 job-list(20) 之间）');
ok(!/ctx\.slots\.inject\(SLOT,/.test(code), '★ A3 不再注册 shell.overlay（右下角浮窗已取消，避免两份 UI）');
ok(!/zcode-dispatch\.console/.test(code), '★ A4 旧浮层 cell id（zcode-dispatch.console）已移除');

console.log('\nB. 入口样式与同排一致（取自 dsh-client-ui-jobs 的 job-list 触发样式）');
{
  const chip = code.match(/'\.[^']*zcd-chip\{[^]*?\}',/);
  ok(!!chip, 'B1 有 .zcd-chip 规则');
  const css = chip[0];
  ok(/border:0/.test(css), 'B2 无边框（同排入口是纯文字按钮，不是药丸）');
  ok(/background:0 0/.test(css), 'B3 无底色');
  ok(/font-size:12px/.test(css), 'B4 字号 12px（与同排一致）');
  ok(/line-height:18px/.test(css), 'B5 行高 18px');
  ok(/min-height:28px/.test(css), 'B6 min-height 28px');
  ok(/gap:3px/.test(css), 'B7 图标/文字间距 3px');
  ok(/T\.text3/.test(css), 'B8 常态色用 label-tertiary（T.text3）');
  ok(/\.zcd-chip:hover/.test(code) && /T\.text2/.test(code.match(/\.zcd-chip:hover[^\n]*/)[0]), 'B9 hover 变 label-secondary（T.text2）');
  ok(/zcd-chip-chevron/.test(code), 'B10 带展开指示箭头（与同排入口一致）');
}

console.log('\nC. 弹窗：系统菜单样式 + 开合交互');
{
  const menu = code.match(/'\.[^']*zcd-menu\{[^]*?\}',/);
  ok(!!menu, 'C1 有 .zcd-menu 规则');
  const css = menu[0];
  ok(/--dsw-specific-menu/.test(css), 'C2 背景用系统菜单令牌 --dsw-specific-menu');
  ok(/--dsw-elevation-prominent/.test(css), 'C3 阴影用 --dsw-elevation-prominent');
  ok(/--dsw-radius-lg/.test(css), 'C4 圆角用 --dsw-radius-lg');
  ok(/position:absolute/.test(css) && /top:calc\(100% \+ 5px\)/.test(css), 'C5 绝对定位挂在入口下方（top: calc(100% + 5px)，与 job-list 同款）');
  ok(/max-height:min\(/.test(css) && /overflow:auto/.test(css), 'C6 限高 + 内部滚动（不高出视口）');
  ok(/\.zcd-menu,\.zcd-menu \*\{box-sizing:border-box;\}/.test(code), 'C7 ★ box-sizing 作用域改到 .zcd-menu（ZB-17 的输入框撑破回归不能复发）');
  ok(/addEventListener\('pointerdown'/.test(code), 'C8 点外部关闭');
  ok(/Escape/.test(code), 'C9 Esc 关闭');
  ok(/aria-expanded/.test(code) && /aria-haspopup/.test(code), 'C10 无障碍属性：aria-expanded / aria-haspopup');
}

console.log('\nD. 解耦：入口不建 wire；浮窗时代的状态与交互不再残留');
{
  const i = code.indexOf('function HeaderEntry()');
  const body = code.slice(i, code.indexOf('function PanelBody()', i));
  ok(i > 0 && body.length > 0, 'D1 定位 HeaderEntry 函数体');
  ok(!/useWire\s*\(/.test(body), '★ D2 入口体内不调 useWire（wire 由弹窗里的 PanelBody 持有）');
  ok(!/panelUi/.test(src), '★ D3 ZB-24 的模块级共享 store 已移除（入口只是开合开关）');
  ok(!/setMinimized|ui\.minimized/.test(code), '★ D4 最小化状态/药丸相关代码已清除');
  ok(!/zcd-pill|zcd-min|className: 'zcd-root'|zcd-titlebar|zcd-grip/.test(code), '★ D5 药丸/浮窗类名与标记已清除');
}

/* ---------------- E. 真渲染：点开 → 弹窗出现；再点 → 收起 ---------------- */
console.log('\nE. 真渲染（React 桩）：开合与弹窗内容');
{
  const head = { children: [], appendChild(c) { head.children.push(c); return c; }, removeChild() {} };
  globalThis.document = {
    head, documentElement: { appendChild: () => {} },
    createElement: (t) => (t === 'style' ? { tagName: 'STYLE', attrs: {}, setAttribute() {}, textContent: '' } : { tagName: t.toUpperCase(), attrs: {}, setAttribute() {}, appendChild() {} }),
    getElementById: () => null, querySelector: () => null,
    addEventListener: () => {}, removeEventListener: () => {},
  };
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
    slots: { inject: (k, cb) => { cb(); return () => {}; }, register: (o, comp) => { regs.push({ o, comp }); return () => {}; } },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    on: () => () => {}, locale: { formatMessage: (m) => String(m?.id ?? m) },
    remote: { $mount: () => Promise.resolve() },
  });
  ok(regs.length === 1 && regs[0].o.name === 'conversation.session.header.actions', `E1 只注册了会话头槽位一个 cell（实际 ${regs.length} 个）`);

  const render = () => {
    let t = expand(regs[0].comp({}), 'hdr');
    while (pendingEffect.length) pendingEffect.shift()();
    return t;
  };
  const findAll = (node, pred, acc = []) => {
    if (node == null || typeof node !== 'object') return acc;
    if (Array.isArray(node)) { for (const n of node) findAll(n, pred, acc); return acc; }
    if (pred(node)) acc.push(node);
    findAll(node.children, pred, acc);
    return acc;
  };
  const texts = (node) => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(texts).join('');
    return texts(node.children);
  };

  let tree = render();
  const chip = findAll(tree, (n) => n.type === 'button' && typeof n.props.className === 'string' && n.props.className.includes('zcd-chip'))[0];
  ok(!!chip, 'E2 渲染出入口按钮（.zcd-chip）');
  ok(texts(chip).includes('ZCode 派发台'), `E3 入口文字是「ZCode 派发台」（实际=${texts(chip)}）`);
  ok(chip.props['aria-expanded'] === false, 'E4 初始未展开');
  ok(findAll(tree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('zcd-menu')).length === 0, 'E5 未展开时没有弹窗（不预先建 wire）');

  chip.props.onClick();
  tree = render();
  const menus = findAll(tree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('zcd-menu'));
  ok(menus.length === 1, 'E6 ★ 点击后挂出弹窗（.zcd-menu）');
  ok(findAll(tree, (n) => n.type === 'button' && n.props.className.includes('zcd-chip'))[0].props['aria-expanded'] === true, 'E7 展开状态与 aria-expanded 一致');
  const menuText = texts(menus[0]);
  ok(menuText.includes('派发'), `E8 弹窗里是原面板内容（含分区标题，实际片段=${menuText.slice(0, 40)}）`);

  findAll(tree, (n) => n.type === 'button' && n.props.className.includes('zcd-chip'))[0].props.onClick();
  tree = render();
  ok(findAll(tree, (n) => typeof n.props?.className === 'string' && n.props.className.includes('zcd-menu')).length === 0, 'E9 再点入口收起弹窗');
}

console.log(`\n===== ZB-27：${pass} PASS / 0 FAIL =====`);
process.exit(0);
