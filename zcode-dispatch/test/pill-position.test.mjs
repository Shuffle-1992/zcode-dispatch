// ZB-07 回归测试：最小化胶囊的定位与面板位置的视口钳制。
// 用户报告：「缩小后的胶囊跑到左上角，最上面了，还点击不了。」
// 根因：胶囊复用了面板的 pos（尺寸差异巨大 ⇒ 错位；面板拖到边界存的极端值 ⇒ 推出视口）。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 抽 clampPos 求值（纯函数，不依赖 React / DOM）。
 * 注意：new Function 生成的是 (p, view, EDGE) 三参函数，必须包一层把 EDGE 绑上 ——
 * 否则函数内 EDGE 是 undefined，Math.max(undefined, n) = NaN，断言会以假乱真地失败。 */
const m = /function clampPos\(p, view\) \{([\s\S]*?)\n    \}/.exec(src);
assert.ok(m, '未能在 client.js 里定位 clampPos');
const EDGE = 8;
const clampPosRaw = new Function('p', 'view', 'EDGE', m[1]);
const clampPos = (p, view) => clampPosRaw(p, view, EDGE);

console.log('clampPos 视口钳制');
const view = { vw: 1440, vh: 900, w: 440, h: 620 };
ok(clampPos(null, view) === null, 'A1 从未存过位置 → null（调用方走默认右下角）');
ok(clampPos({ left: 100, top: 100 }, view).left === 100, 'A2 合法位置原样保留');
{
  const r = clampPos({ left: -50, top: -50 }, view);
  ok(r.left === EDGE && r.top === EDGE, 'A3 负数位置 → 拉回 EDGE（不再跑到屏幕外）');
}
{
  const r = clampPos({ left: 3000, top: 2000 }, view);
  ok(r.left === 1440 - 440 - EDGE && r.top === 900 - 620 - EDGE, 'A4 超出右下 → 钳到「视口 - 面板 - EDGE」');
}
{
  const r = clampPos({ left: 100, top: 100 }, { vw: 300, vh: 200, w: 440, h: 620 });
  ok(r.left === EDGE && r.top === EDGE, 'A5 面板比视口还大 → 退化为 EDGE（左上角可见，不出负数）');
}
ok(clampPos({ left: NaN, top: 5 }, view) === null, 'A6 非有限值 → null（不拿脏值去定位）');
ok(clampPos({ left: '100', top: '200' }, view).left === 100, 'A7 字符串数字可被接受');
ok(clampPos({ left: 10, top: 10 }, { vw: 0, vh: 0, w: 440, h: 620 }).left === 10, 'A8 拿不到视口尺寸时不猜，原样返回');

console.log('\n胶囊定位（源码断言）');
const i = src.indexOf('if (minimized) {');
assert.ok(i > 0, '未找到最小化分支');
const seg = src.slice(i, src.indexOf('\n      }', i) + 8);
ok(!/style:\s*rootStyle/.test(seg), 'S1 胶囊**不再**复用面板的 rootStyle（错位根因）');
ok(/right:\s*'24px'/.test(seg) && /bottom:\s*'24px'/.test(seg), 'S2 胶囊固定右下角（24px）');
/* 去掉块注释与行注释后再断言（上一版只去块注释，被行尾 `// 不用 pos` 误判） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/\bpos\b/.test(stripComments(seg)), 'S3 胶囊分支内不引用 pos（注释除外）');
ok(/className:\s*'zcd-root zcd-min'/.test(seg), 'S4 胶囊根节点仍带 zcd-min');
ok(/pointer-events:auto/.test(src.match(/\.zcd-pill\{[^}]*\}/)?.[0] || ''), 'S5 .zcd-pill 仍是 pointer-events:auto（可点）');
ok(/\.zcd-root\{[^}]*pointer-events:none/.test(src), 'S6 .zcd-root 仍是 none（浮层空白不挡应用）');

console.log('\n面板位置载入钳制');
ok(/useState\(\(\) => \{[\s\S]{0,400}clampPos\(saved,/.test(src), 'S7 FloatingPanel 载入 pos 时经过 clampPos');

console.log(`\n===== ZB-07：${pass} PASS / 0 FAIL =====`);