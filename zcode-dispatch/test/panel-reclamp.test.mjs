// ZB-10 回归测试：面板位置在视口变化 / 挂载后按真实尺寸重新钳制。
// 用户报告：「派发台面板固定了，重开 DSH 时窗口显示有变化，导致固定位置变动」。
//
// 缺口有二：
//   ① 载入时钳制用的是**猜的**高度（savedSize.height || 320），与真实渲染高度不符；
//   ② **视口尺寸变化时完全没有重钳** ⇒ 重开 DSH 后窗口变小，面板留在视口外。
// 修复：挂载后用 offsetWidth/Height（真实值）重钳一次 + 监听 resize 持续重钳。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 抽 clampPos 求值（纯函数）。注意 new Function 生成的是 (p, view, EDGE) 三参函数，
 * 必须包一层把 EDGE 绑上，否则函数内 EDGE 为 undefined ⇒ Math.max(undefined,n)=NaN。 */
const m = /function clampPos\(p, view\) \{([\s\S]*?)\n    \}/.exec(src);
assert.ok(m, '未能在 client.js 里定位 clampPos');
const EDGE = 8;
const clampPosRaw = new Function('p', 'view', 'EDGE', m[1]);
const clampPos = (p, view) => clampPosRaw(p, view, EDGE);

console.log('clampPos 语义（重钳的依据）');
ok(clampPos(null, { vw: 1000, vh: 600, w: 440, h: 620 }) === null, 'B1 未存过位置 → null（走默认右下角）');
{
  // 模拟本报告的核心场景：存的是旧视口下的位置，新视口更小
  const r = clampPos({ left: 1200, top: 700 }, { vw: 1000, vh: 600, w: 440, h: 620 });
  ok(r.left === 1000 - 440 - 8, `B2 越界 left 被钳到视口内（1200 → ${r.left}）`);
  ok(r.top === EDGE, `B3 面板高于视口 ⇒ top 退化为 EDGE=${EDGE}（保证左上角可见，不出负数）`);
}
{
  const r = clampPos({ left: 352, top: 8 }, { vw: 800, vh: 500, w: 440, h: 620 });
  ok(r.left === 352 && r.top === 8, 'B4 已在视口内 ⇒ 不做无谓挪动（保持用户原位）');
}
{
  const r = clampPos({ left: 50, top: 50 }, { vw: 1440, vh: 900, w: 440, h: 620 });
  ok(r.left === 50 && r.top === 50, 'B5 窗口变大 ⇒ 位置不动（只钳不居中）');
}

console.log('\n接线（源码断言）');
ok(/const reclampPos = useCallback\(/.test(src), 'S1 定义了 reclampPos');
const iRe = src.indexOf('const reclampPos');
const seg = src.slice(iRe, iRe + 1400);
ok(/el\.offsetWidth/.test(seg) && /el\.offsetHeight/.test(seg),
  'S2 用 offsetWidth/offsetHeight（真实测量尺寸），而非猜的值');
ok(/window\.addEventListener\('resize'/.test(seg), 'S3 监听 resize ⇒ 视口变化时重钳');
ok(/window\.removeEventListener\('resize'/.test(seg), 'S4 卸载时移除监听（不泄漏）');
ok(/if \(!el\) return;/.test(seg), 'S5 未挂载/最小化态安全早退（最小化分支不挂 rootRef）');
ok(/clampPos\(prev, \{ vw, vh, w, h \}\)/.test(seg), 'S6 重钳复用同一个 clampPos（语义唯一）');
ok(/reclampPos\(\);\s*\/\/ 挂载后按真实尺寸钳一次/.test(src), 'S7 挂载后立即重钳一次（覆盖初始的"猜尺寸"钳制）');
ok(/\}, \[reclampPos, collapsed, minimized\]\)/.test(src),
  'S8 展开/折叠/最小化后尺寸变了也重钳');

console.log(`\n===== ZB-10：${pass} PASS / 0 FAIL =====`);