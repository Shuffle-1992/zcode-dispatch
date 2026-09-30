// ZB-09 回归测试：面板分区渲染顺序（用量与单写者已互换位置）。
//
// 用户要求：「将单写者面板和用量面板互换位置」。
// client.js 是 cordis 客户端插件（依赖 React / 槽位），无法直接 import，
// 故对源码做**顺序断言** —— 足以钉住"谁排在谁前面"，防止后续编辑无意改回。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 取出面板 body 里各分区渲染语句的出现位置（按文件顺序 = 渲染顺序） */
const order = [];
for (const m of src.matchAll(/h\(Section, \{ id: SEC\.(\w+)/g)) {
  order.push({ key: m[1], at: m.index });
}
const keys = order.map((o) => o.key);

console.log('分区顺序（源码出现顺序 = 渲染顺序）');
console.log(`  实际 = ${keys.join(' → ')}`);

ok(keys.length === 5, `应有 5 个分区，实际 ${keys.length}`);
ok(keys.includes('channel') && keys.includes('dispatch') && keys.includes('jobs'), 'S1 通道/派发/进程三个分区都在');
ok(keys.includes('locks') && keys.includes('quota'), 'S2 单写者与用量两个分区都在');

const iLocks = keys.indexOf('locks');
const iQuota = keys.indexOf('quota');
const iJobs = keys.indexOf('jobs');

ok(iLocks < iQuota, 'S3 单写者排在用量**之前**（本次互换的目标）');
ok(iLocks === iJobs + 1, 'S4 单写者**紧跟**进程列表之后');
ok(iQuota === keys.length - 1, 'S5 用量移到最末');
ok(iLocks === iJobs + 1 && iQuota === iLocks + 1, 'S6 两分区相邻且顺序为 进程 → 单写者 → 用量');

console.log('\n折叠状态按 id 独立（换位不应串状态）');
ok(/SEC_DEFAULT_OPEN/.test(src), 'S7 默认开闭表仍按 id 定义');
ok(/secKey\(id\)/.test(src) || /section:\$\{id\}/.test(src) || /'zcode-dispatch:section:/.test(src),
  'S8 折叠状态持久化键仍按分区 id（与渲染顺序无关）');

console.log(`\n===== ZB-09：${pass} PASS / 0 FAIL =====`);