/**
 * ZB-15 回归测试：默认锁由 both 收窄为 repo（最小锁）。
 *
 * 用户观察（成立）：一般派发都是 repo+memory 两把锁 ⇒ 任何两个任务都互斥，多并发无从谈起。
 * 而 memory 锁保护的是 **ZCode 自己的记忆库（~/.zcode）**，与仓库写入互不相干 ——
 * 绝大多数"改代码"的派发根本不写它，却白占一把锁。
 *
 * 宿主 PROTOCOL §5.2 对单写者的定义是「**仓库文件写权限**」，故默认只锁 repo
 * 就已守住单写者纪律的本义；memory 改为按需显式声明。
 *
 * 三档语义（本文件逐条钉住）：
 *   · write 非空        ⇒ 细粒度文件锁（最强并发）
 *   · lock === 'both'   ⇒ 显式两把锁（确实会写 ~/.zcode 时才用）
 *   · 其它（含缺省）    ⇒ **只锁 repo**（默认；单写者本义）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDispatcher } from '../core/dispatch-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_RUNNER = join(HERE, 'fixtures', 'fake-runner.mjs');
process.env.ZCD_FAKE_RUNNER = FAKE_RUNNER;

const tempDirs = [];
const newWorkRoot = () => {
  const d = mkdtempSync(join(tmpdir(), 'zcd-minlock-'));
  tempDirs.push(d);
  return d;
};
test.after(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = ['done', 'failed', 'killed', 'interrupted'];
async function waitFor(pred, what, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error(`waitFor(${what}) 超时`);
}
async function waitTerminal(d, id, timeoutMs = 20000) {
  await waitFor(() => {
    const j = d.get(id);
    return j && (TERMINAL.includes(j.state) || j.state === 'paused');
  }, `terminal:${id}`, timeoutMs);
  return d.get(id);
}

test('默认（不传 lock）只锁 repo —— 这是本次收窄的核心', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', tag: 'A' }); // 不传 lock
  await waitFor(() => d.get(a.id).state === 'running', 'A running');
  assert.equal(d.get(a.id).lock, 'repo', `默认应只锁 repo，实际 "${d.get(a.id).lock}"`);
  assert.ok(existsSync(d.lockPaths.repo), 'repo 锁文件应存在');
  assert.ok(!existsSync(d.lockPaths.memory), '**memory 锁文件不应存在**（默认不再占它）');
  await waitTerminal(d, a.id);
  assert.ok(!existsSync(d.lockPaths.repo) && !existsSync(d.lockPaths.memory), '结束后都释放');
});

test('默认锁下两个任务可并行（原先 both 会串行 —— 这是收益）', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', tag: 'A' }); // 默认
  const b = d.dispatch({ kind: 'prompt', prompt: 'b', tag: 'B' }); // 默认
  // 两者都只要 repo —— 仍互斥（单写者本义），但**不再额外争 memory**
  assert.equal(d.get(b.id).state, 'queued', 'A/B 都要 repo ⇒ 仍按单写者串行（安全底线不变）');
  await waitTerminal(d, a.id);
  await waitTerminal(d, b.id);
  assert.equal(d.get(a.id).lock, 'repo');
  assert.equal(d.get(b.id).lock, 'repo');
});

test('默认(repo) 与显式 memory 可并行 —— 收窄后多出的并发能力', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', tag: 'A' });              // 默认 → repo
  const b = d.dispatch({ kind: 'prompt', prompt: 'b', lock: 'memory', tag: 'B' }); // 显式 memory
  await waitFor(() => d.get(a.id).state === 'running' && d.get(b.id).state === 'running', 'A/B 并行');
  assert.equal(d.get(a.id).lock, 'repo');
  assert.equal(d.get(b.id).lock, 'memory');
  await Promise.all([waitTerminal(d, a.id), waitTerminal(d, b.id)]);
  assert.ok(!existsSync(d.lockPaths.repo) && !existsSync(d.lockPaths.memory), '两把锁都释放');
});

test('显式 lock=both 仍取两把锁（写 ~/.zcode 记忆时才用）', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', lock: 'both', tag: 'A' });
  await waitFor(() => d.get(a.id).state === 'running', 'A running');
  assert.equal(d.get(a.id).lock, 'repo+memory', `both 应取两把锁，实际 "${d.get(a.id).lock}"`);
  assert.ok(existsSync(d.lockPaths.repo) && existsSync(d.lockPaths.memory), '两把锁文件都在');
  await waitTerminal(d, a.id);
  assert.ok(!existsSync(d.lockPaths.repo) && !existsSync(d.lockPaths.memory), '结束后都释放');
});

test('both 与默认(repo) 互斥 —— 因为共享 repo', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', lock: 'both', tag: 'A' });
  const b = d.dispatch({ kind: 'prompt', prompt: 'b', tag: 'B' }); // 默认 repo
  assert.equal(d.get(b.id).state, 'queued', 'B 要 repo，A 持 repo ⇒ B 排队');
  await waitTerminal(d, a.id);
  await waitTerminal(d, b.id);
});

test('write 优先于 lock：声明 write 时走文件级，不占 repo/memory', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 4 });
  const a = d.dispatch({ kind: 'prompt', prompt: 'a', write: ['F:/p/x.ts'], lock: 'both', tag: 'A' });
  await waitFor(() => d.get(a.id).state === 'running', 'A running');
  assert.match(d.get(a.id).lock, /^file:/, 'write 优先 ⇒ 走文件锁而非 both');
  assert.ok(!existsSync(d.lockPaths.repo) && !existsSync(d.lockPaths.memory),
    '声明 write 时不应占用 repo/memory 粗粒度锁');
  assert.equal(d.listFileLocks().length, 1, '只持一把文件锁');
  await waitTerminal(d, a.id);
  assert.equal(d.listFileLocks().length, 0, '结束后文件锁释放');
});

test('lock 取值校验仍只接受 repo|memory|both', async () => {
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot: newWorkRoot(), maxConcurrent: 2 });
  assert.throws(() => d.dispatch({ kind: 'prompt', prompt: 'x', lock: 'none' }), TypeError);
  assert.throws(() => d.dispatch({ kind: 'prompt', prompt: 'x', lock: 'repo+memory' }), TypeError);
  /* 合法值不抛。注意必须**等它们落地**再结束测试 ——
   * 否则测试结束后 dispatcher 仍在 persist()，而 test.after 已删掉临时目录 ⇒
   * ENOENT 写 jobs.json.*.tmp（上一版正是踩了这个，被 node:test 判为
   * "generated asynchronous activity after the test ended"）。 */
  const started = [];
  for (const lk of ['repo', 'memory', 'both']) {
    const j = d.dispatch({ kind: 'prompt', prompt: 'x', lock: lk });
    assert.ok(j && j.id, `lock=${lk} 应被接受`);
    started.push(j.id);
  }
  await Promise.all(started.map((id) => waitTerminal(d, id)));
});
