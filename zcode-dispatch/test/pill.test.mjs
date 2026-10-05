// ZB-06 回归测试：最小化胶囊必须保留「ZCode 派发台」字样（用户要求），
// 且不得再出现旧的"孤立中点"占位写法。
// client.js 无法直接 import（依赖 React / 槽位），故对源码做断言 + 对纯逻辑做抽取校验。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 取出最小化分支的源码片段（从最小化判定到该分支结束）。
 * ZB-24：最小化状态由局部 useState 迁到模块级共享 store（会话头入口要读同一事实），
 * 判定串随之变为 `if (ui.minimized)`。这里两种写法都认 —— 本测试要守的是
 * 「胶囊渲染了什么」，不是「状态存在哪」，否则状态来源一改就假红。 */
const mi = src.indexOf('if (ui.minimized) {');
const i = mi >= 0 ? mi : src.indexOf('if (minimized) {');
assert.ok(i > 0, '未找到最小化分支');
const seg = src.slice(i, src.indexOf('\n      }', i) + 8);

console.log('胶囊渲染（最小化分支）');
ok(/t\('title'\)/.test(seg), 'S1 胶囊渲染 t(\'title\') ⇒ 保留「ZCode 派发台」字样');
ok(/zcd-pill-title/.test(seg), 'S2 标题有独立样式节点（可加粗、不换行）');
ok(/pillRunning|pillQueued|pillIdle/.test(seg), 'S3 胶囊显示运行中/排队中/空闲状态');
ok(/zcd-pill-n/.test(seg), 'S4 有任务数徽标（waiting>0 时才出现）');
ok(/'aria-label':/.test(seg), 'S5 有 aria-label（可访问性）');
ok(!/'·'/.test(seg), 'S6 不再使用孤立的「·」占位（用户报告"只能看到一点点内容"的根因）');

console.log('\n样式与文案');
ok(/\.zcd-pill-title\{/.test(src), 'S7 定义了 .zcd-pill-title 样式');
ok(/\.zcd-pill-n\{/.test(src), 'S8 定义了 .zcd-pill-n 样式');
ok(/\.zcd-pill-state\{/.test(src), 'S9 定义了 .zcd-pill-state 样式');
for (const k of ['pillRunning', 'pillQueued', 'pillIdle']) {
  const n = (src.match(new RegExp(`${k}:`, 'g')) || []).length;
  ok(n >= 2, `S10 ${k} 在中英内嵌 STRINGS 各出现一次（实际 ${n} 处）`);
}

console.log('\nlocale 对称');
const zh = JSON.parse(readFileSync('F:\\My Code\\zcode-dispatch\\zcode-dispatch\\locale\\zh.json', 'utf8'));
const en = JSON.parse(readFileSync('F:\\My Code\\zcode-dispatch\\zcode-dispatch\\locale\\en.json', 'utf8'));
const zu = zh.ui ?? zh, eu = en.ui ?? en;
ok(Object.keys(zu).length === Object.keys(eu).length, `S11 中英 key 数一致（${Object.keys(zu).length}）`);
for (const k of ['pillRunning', 'pillQueued', 'pillIdle']) ok(zu[k] && eu[k], `S12 locale 含 ${k}`);

console.log(`\n===== ZB-06：${pass} PASS / 0 FAIL =====`);