// ZB-16 回归测试（UI 层）：派发区锁控件 + 中文锁名 + 分区改名 + memory 锁删除。
//
// 用户要求：
//   ① repo/memory 改中文名显示，memory 改为「Zcode 记忆锁」；
//   ② 派发可明确是否 repo 锁、明确 repo 锁哪些文件；
//   ③ 删除 memory 相关；
//   ⑤ 分区名改为「文件锁 / 记忆锁」（ZB-17 起改为「仓库文件锁」）。
//
// client.js 无法直接 import（依赖 React / 槽位），故对源码做断言；
// 纯逻辑（文件列表解析）抽出来单测。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\zcode-dispatch\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

console.log('① 分区名与中文锁名');
ok(/secLocks: '仓库文件锁'/.test(src), "A1 分区名 = 「仓库文件锁」（ZB-17 用户要求；原为「文件锁 / 记忆锁」）");
ok(/repoLock: '仓库锁'/.test(src), "A2 repo 锁显示为「仓库锁」");
ok(/lockHeld: '持有仓库锁'/.test(src), 'A3 lockHeld 文案同步中文化');
ok(!/memoryLock: 'memory 锁'/.test(src), 'A4 旧的「memory 锁」英文名已移除');
ok(/noFileLocks: '（当前没有文件锁：任务未声明 write，走仓库整锁）'/.test(src),
  'A5 空态文案改为「仓库整锁」（不再提 repo/memory 粗粒度锁）');

console.log('\n③ memory 锁已删除（用户要求 ③）');
{
  // 面板不再渲染 memory 那一格
  const iLock = src.indexOf('function LockStatus');
  const seg = src.slice(iLock, src.indexOf('\n    }', iLock));
  ok(!/memoryLock/.test(seg), 'B1 LockStatus 不再渲染 memory 锁那一格');
  ok(/t\('repoLock'\)/.test(seg) && /t\('queueLen'\)/.test(seg), 'B2 仍显示仓库锁与队列长度');
}
ok(!/lock: 'both'/.test(src), "B3 派发侧不再产生 lock:'both'");
ok(!/lock: 'memory'/.test(src), "B4 派发侧不再产生 lock:'memory'");

console.log('\n② 派发区锁控件（是否 repo 锁 + 锁哪些文件）');
ok(/const \[repoLock, setRepoLock\] = useState\(true\)/.test(src), 'C1 有「仓库文件锁」开关状态（默认开）');
ok(/const \[writeText, setWriteText\] = useState\(''\)/.test(src), 'C2 有「要写的文件」输入状态');
ok(/if \(!repoLock\) spec\.lock = 'none'/.test(src), "C3 不勾 ⇒ 明确传 lock:'none'（不是静默不传）");
ok(/const files = parseFiles\(writeText\);[\s\S]{0,80}if \(files\.length > 0\) spec\.write = files;/.test(src),
  'C4 填了文件 ⇒ 传 write（只锁这些文件）');
ok(/const parseFiles = \(s\) => String\(s \?\? ''\)\.split\(\/\[\\n,;\]\+\//.test(src),
  'C5 文件列表支持逗号/换行/分号分隔（便于粘贴多行路径）');
ok(/repoLockCb: '仓库文件锁'/.test(src), 'C6 复选框文案 = 「仓库文件锁」');
ok(/writePh:/.test(src) && /留空=锁整个仓库/.test(src), 'C7 输入框 placeholder 说明了「留空=锁整个仓库」');
ok(/lockNoneHint:/.test(src) && /lockScopeHint:/.test(src), 'C8 有"不取锁"与"作用域"两条提示');

console.log('\n文件列表解析（纯逻辑，从源码抽 parseFiles）');
{
  /* 用"从 const parseFiles 起到行尾"截取，不假设行尾是 \n（本仓库是 CRLF，上一版正则因此假失败）。 */
  const i = src.indexOf('const parseFiles');
  assert.ok(i >= 0, '未能定位 parseFiles');
  const lineEnd = src.indexOf('\n', i);
  const expr = src.slice(i, lineEnd).replace(/^const parseFiles = /, '').replace(/;\s*$/, '');
  /* 注意：`new Function('return (expr)')` 求值得到**箭头函数本身**，还要再调用一次。
   * 上一版写成 new Function('s', 'return (expr)') 后直接当函数用 ⇒ 断言拿到 [Function]。 */
  const parseFiles = new Function(`return (${expr})`)();
  assert.deepEqual(parseFiles('a.ts'), ['a.ts'], 'D1 单个');
  assert.deepEqual(parseFiles('a.ts,b.ts'), ['a.ts', 'b.ts'], 'D2 逗号');
  assert.deepEqual(parseFiles('a.ts\nb.ts'), ['a.ts', 'b.ts'], 'D3 换行');
  assert.deepEqual(parseFiles('a.ts;b.ts'), ['a.ts', 'b.ts'], 'D4 分号');
  assert.deepEqual(parseFiles('  a.ts  ,  b.ts  '), ['a.ts', 'b.ts'], 'D5 去空白');
  assert.deepEqual(parseFiles('a.ts,,b.ts'), ['a.ts', 'b.ts'], 'D6 跳过空项');
  assert.deepEqual(parseFiles(''), [], 'D7 空串 ⇒ 空数组（调用方据此不传 write）');
  assert.deepEqual(parseFiles(null), [], 'D8 null ⇒ 空数组');
  pass += 1;
  console.log('  ✓ D1-D8 parseFiles 八种输入全部正确');
}

console.log('\nlocale 中英对称');
{
  const zh = JSON.parse(readFileSync('F:\\My Code\\zcode-dispatch\\zcode-dispatch\\locale\\zh.json', 'utf8'));
  const en = JSON.parse(readFileSync('F:\\My Code\\zcode-dispatch\\zcode-dispatch\\locale\\en.json', 'utf8'));
  const zu = zh.ui ?? zh, eu = en.ui ?? en;
  ok(Object.keys(zu).length === Object.keys(eu).length, `E1 中英 key 数一致（${Object.keys(zu).length}）`);
  for (const k of ['repoLockCb', 'writePh', 'writeHint', 'writeFiles', 'lockNoneHint', 'lockScopeHint']) {
    ok(zu[k] !== undefined && eu[k] !== undefined, `E2 locale 含 ${k}`);
  }
  ok(zu.secLocks === '仓库文件锁', 'E3 locale 的分区名同步为「仓库文件锁」');
}

console.log(`\n===== ZB-16(UI)：${pass} PASS / 0 FAIL =====`);