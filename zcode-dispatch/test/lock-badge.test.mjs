// ZB-18 回归测试：进程行锁徽标区分「整仓库锁 / 文件锁 / 不取锁 / 旧版记录」。
//
// 用户要求：「进程那里应该显示整仓库锁或者文件锁进行区分。」
//
// lockKindOf 是纯函数（从源码抽出来测），输入是**已持久化的 job** —— 可能来自旧版本
// （如 lock='repo+memory' 的 ZB-15 记录），故必须容错且不假装成新模型。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

/* 抽出 lockKindOf（纯函数，无外部依赖） */
const i = src.indexOf('function lockKindOf(job) {');
assert.ok(i >= 0, '未能在 client.js 里定位 lockKindOf');
const end = src.indexOf('\n    }', i);
const lockKindOf = new Function(`return (${src.slice(i, end + 6).replace(/^function lockKindOf/, 'function lockKindOf')})`)();

console.log('整仓库锁（未声明 write）');
{
  const r = lockKindOf({ lock: 'repo', spec: {} });
  ok(r.kind === 'repo', 'A1 kind=repo');
  ok(r.label === '整仓库锁', 'A2 徽标文字 = 「整仓库锁」');
  ok(/与任何任务互斥/.test(r.detail), 'A3 tooltip 说明了互斥语义');
}

console.log('\n文件锁（单文件 / 多文件）');
{
  const one = lockKindOf({ lock: 'file:f:/p/a.ts', spec: { write: ['F:/p/a.ts'] } });
  ok(one.kind === 'file', 'B1 kind=file');
  ok(one.label === '文件锁', 'B2 单文件徽标 = 「文件锁」');
  ok(one.files.length === 1 && one.files[0] === 'F:/p/a.ts', 'B3 文件列表来自 spec.write');

  const many = lockKindOf({ lock: 'file:f:/p/a.ts+file:f:/p/b.ts', spec: { write: ['F:/p/a.ts', 'F:/p/b.ts'] } });
  ok(many.kind === 'file', 'B4 kind=file');
  ok(many.label === '文件锁 2', `B5 多文件徽标带数量（实际 "${many.label}"）`);
  ok(many.files.length === 2, 'B6 文件列表完整');
  ok(/a\.ts[\s\S]*b\.ts/.test(many.detail), 'B7 tooltip 列出全部文件');
}

console.log('\n不取锁 / 未持锁');
{
  ok(lockKindOf({ lock: 'none', spec: {} }).kind === 'none', "C1 lock='none' ⇒ kind=none");
  ok(lockKindOf({ lock: null, spec: {} }).kind === 'none', 'C2 lock=null ⇒ kind=none（未持锁）');
  ok(lockKindOf({ spec: {} }).kind === 'none', 'C3 无 lock 字段 ⇒ kind=none');
  ok(lockKindOf({ lock: 'none' }).label === '不取锁', 'C4 徽标文字 = 「不取锁」');
}

console.log('\n旧版本记录（含 memory）—— 如实标注，不假装新模型');
{
  const legacy = lockKindOf({ lock: 'repo+memory', spec: { lock: 'both' } });
  ok(legacy.kind === 'legacy', "D1 lock='repo+memory' ⇒ kind=legacy");
  ok(legacy.label === 'repo+memory', 'D2 徽标显示原始值（不伪装成「整仓库锁」）');
  ok(/memory 锁已于 ZB-16 删除/.test(legacy.detail), 'D3 tooltip 说明是旧版本记录');
}
{
  const odd = lockKindOf({ lock: 'whatever' });
  ok(odd.kind === 'legacy', 'D4 未知形态也归为 legacy（不崩）');
}

console.log('\n容错（脏数据不崩）');
{
  ok(lockKindOf(null).kind === 'none', 'E1 job=null ⇒ none');
  ok(lockKindOf(undefined).kind === 'none', 'E2 job=undefined ⇒ none');
  ok(lockKindOf({ lock: 'file:x', spec: { write: 'not-array' } }).kind === 'file', 'E3 spec.write 非数组 ⇒ 回退解析 lock 字符串');
  ok(lockKindOf({ lock: 'file:x', spec: { write: [] } }).files.length === 1, 'E4 spec.write 为空 ⇒ 回退解析 lock 字符串');
}

console.log('\n接线与样式（源码断言）');
ok(/const lk = lockKindOf\(job\);/.test(src), 'F1 进程行调用 lockKindOf');
ok(/className: `zcd-badge zcd-lock-\$\{lk\.kind\}`/.test(src), 'F2 徽标带锁类型 class（便于着色区分）');
ok(/if \(lk\.kind === 'none'\) return null;/.test(src), 'F3 无锁时不渲染徽标');
ok(/\.zcd-badge\.zcd-lock-repo\{/.test(src), 'F4 有整仓库锁样式');
ok(/\.zcd-badge\.zcd-lock-file\{/.test(src), 'F5 有文件锁样式');
ok(/\.zcd-badge\.zcd-lock-legacy\{/.test(src), 'F6 有旧版记录样式（危险色提示）');
ok(!/hasLockBadge/.test(src), 'F7 无死代码（hasLockBadge 已移除）');
{
  // 不再直接渲染原始 job.lock 字符串
  ok(!/title: t\('lockHeld'\) \}, String\(job\.lock\)/.test(src), 'F8 不再直接渲染原始 job.lock');
}

console.log('\nslimJob 默认值修正（ZB-16 漏改）');
{
  const wire = readFileSync('F:\\My Code\\dsh-plugins\\zcode-dispatch\\wire.host.mjs', 'utf8');
  ok(/lock: spec\?\.lock \?\? 'repo'/.test(wire), "G1 slimJob 的 lock 默认值已由 'both' 改为 'repo'");
  ok(!/lock: spec\?\.lock \?\? 'both'/.test(wire), "G2 旧的 'both' 默认值已清除");
}

console.log(`\n===== ZB-18：${pass} PASS / 0 FAIL =====`);