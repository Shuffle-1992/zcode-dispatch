/**
 * ZB-29 回归测试：思考强度（thinking / reasoningLevel，ZCode Thought Level）。
 *
 * 语义（用户要求的「Agent决定」档）：
 *   · `thinking='agent'`（默认）= **Agent决定**：由派发方 Agent 按任务自行判断并**改传具体档位**；
 *     core 层对 'agent' **不透传** runner 参数 = 不覆盖（ZCode 按模型默认档）。
 *   · 具体档位（如 enabled / low / max）= 严格生效：runner 写入临时 provider 配置的
 *     `defaultModelSelection.options.reasoningLevel`，ZCode 会话创建即按此档运行。
 *   · 档位集合**随模型声明不同**（GLM-5 系 disabled|enabled；deepseek-v4 系 disabled|low|high|max），
 *     runner `--list-providers` 输出 `[zcode-run] reasoning-levels <model>=<a,b>`，core 解析为
 *     `channels[].thinkingLevels` 供 UI 下拉；core **不写死枚举**。
 *   · 非法档位 fail-fast（runner 校验 / ZCode 会话创建校验），不静默降级。
 *   · 仅新建会话生效；--resume 沿用原会话档位（core 对 resume 不透传）。
 *
 * 覆盖：parseProviderTable / listChannels（channelsProbeImpl）/ core 透传与字段 /
 *       wire 映射（thinking → spec.reasoningLevel）/ validateSpec / 交接沿用 / runner 注入（hermetic 干跑）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDispatcher, parseProviderTable, parseRunnerLine } from '../core/dispatch-core.mjs';
import { createActionHandler } from '../wire.host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_RUNNER = join(HERE, 'fixtures', 'fake-runner.mjs');
const RUNNER = join(HERE, '..', '..', 'collab-kit', 'zcode-run.mjs'); // test → 插件目录 → 仓库根
process.env.ZCD_FAKE_RUNNER = FAKE_RUNNER;
process.env.FAKE_SLEEP_MS = '60';

const tempDirs = [];
const newDir = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
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
async function waitTerminal(d, id, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const j = d.get(id);
    if (j && (TERMINAL.includes(j.state) || j.state === 'paused')) return j;
    await sleep(20);
  }
  throw new Error(`waitTerminal(${id}) 超时`);
}

/* ---------- A. parseProviderTable：reasoning-levels 行 → modelLevels ---------- */
test('parseProviderTable：reasoning-levels 行解析为 modelLevels（不混入 provider 行）', () => {
  const text = [
    'id                                enabled   端点/模型',
    'builtin:bigmodel-coding-plan      true      https://x | GLM-5.3, GLM-5.3-Flash',
    '[zcode-run] reasoning-levels GLM-5.3=disabled,enabled',
    '[zcode-run] reasoning-levels GLM-5.3-Flash=disabled,enabled',
  ].join('\n');
  const r = parseProviderTable(text);
  assert.equal(r.rows.length, 1, '表格行数不受 thinking 行影响');
  assert.deepEqual(r.modelLevels['GLM-5.3'], ['disabled', 'enabled']);
  assert.deepEqual(r.modelLevels['GLM-5.3-Flash'], ['disabled', 'enabled']);
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(parseProviderTable('纯垃圾文本').modelLevels, {}, '无档位行时 modelLevels 为空（不猜）');
});

test('parseRunnerLine：注入确认行 → {reasoningLevelApplied, reasoningTarget}', () => {
  const p = parseRunnerLine('[zcode-run] reasoning-level=enabled target=plan:bigmodel-coding-plan/GLM-5.3');
  assert.equal(p.reasoningLevelApplied, 'enabled');
  assert.equal(p.reasoningTarget, 'plan:bigmodel-coding-plan/GLM-5.3');
  assert.equal(parseRunnerLine('[zcode-run] 别的行'), null, '未知 [zcode-run] 行仍返回 null（parseWarnings 语义不变）');
});

/* ---------- B. listChannels：channelsProbeImpl → channels[].thinkingLevels ---------- */
test('listChannels：通道带 thinkingLevels（plan 别名继承选中 provider 的档位集）', async () => {
  const d = createDispatcher({
    runnerPath: FAKE_RUNNER,
    workRoot: newDir('zcd-think-'),
    channelsProbeImpl: async () => [
      'id'.padEnd(34) + 'enabled   端点/模型',
      'builtin:bigmodel-coding-plan'.padEnd(34) + 'true      https://x | GLM-5.3, GLM-5.3-Flash',
      '[zcode-run] reasoning-levels GLM-5.3=disabled,enabled',
      '[zcode-run] reasoning-levels GLM-5.3-Flash=disabled,enabled',
    ].join('\n'),
  });
  const r = await d.listChannels();
  const plan = r.channels.find((c) => c.id === 'plan');
  const raw = r.channels.find((c) => c.id === 'builtin:bigmodel-coding-plan');
  assert.deepEqual(raw.thinkingLevels, ['disabled', 'enabled'], 'raw 通道带档位并集');
  assert.deepEqual(plan.thinkingLevels, ['disabled', 'enabled'], 'plan 别名继承选中 provider 的档位');
  assert.equal(r.channels.find((c) => c.id === 'personal').thinkingLevels, undefined, 'personal 无探测数据 ⇒ 不猜');
});

/* ---------- C/D. core 透传 + 字段 + wire 映射 + validateSpec ---------- */
test('★ core：具体档位 → runner 参数 --reasoning-level；agent/未指定 → 不透传', async () => {
  const workRoot = newDir('zcd-think-');
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot, maxConcurrent: 1 });
  /* 每次派发独立 argv 目录（文件名带 fake runner 子进程 pid，同目录多文件会有字典序歧义）。 */
  const readArgvOf = (argvDir) => {
    const files = readdirSync(argvDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, `该目录应恰有一份 argv（实际 ${files.length}）`);
    return JSON.parse(readFileSync(join(argvDir, files[0]), 'utf8'));
  };

  const argvDir1 = newDir('zcd-argv1-');
  process.env.FAKE_ARGV_FILE = join(argvDir1, 'argv');
  const j1 = d.dispatch({ kind: 'prompt', prompt: 'x', tag: 't1', reasoningLevel: 'enabled' });
  const done1 = await waitTerminal(d, j1.id);
  const argv1 = readArgvOf(argvDir1);
  const i1 = argv1.indexOf('--reasoning-level');
  assert.ok(i1 >= 0, '具体档位应透传 --reasoning-level');
  assert.equal(argv1[i1 + 1], 'enabled');
  assert.equal(done1.reasoningLevel, 'enabled', 'job 记录请求档位');
  assert.equal(done1.reasoningLevelApplied, 'enabled', '假 runner 回显 ⇒ Applied 确认位');
  assert.equal(done1.reasoningTarget, 'fake-plan/fake-model');

  const argvDir2 = newDir('zcd-argv2-');
  process.env.FAKE_ARGV_FILE = join(argvDir2, 'argv');
  const j2 = d.dispatch({ kind: 'prompt', prompt: 'y', tag: 't2', reasoningLevel: 'agent' });
  const done2 = await waitTerminal(d, j2.id);
  const argv2 = readArgvOf(argvDir2);
  assert.ok(!argv2.includes('--reasoning-level'), "★ 'agent'（Agent决定）不透传 = 不覆盖");
  assert.equal(done2.reasoningLevel, 'agent');
  assert.equal(done2.reasoningLevelApplied, undefined, '未注入 ⇒ 无 Applied 确认');
  delete process.env.FAKE_ARGV_FILE;

  const j3 = d.dispatch({ kind: 'prompt', prompt: 'z', tag: 't3' });
  const done3 = await waitTerminal(d, j3.id);
  assert.equal(done3.reasoningLevel, null, '未指定 ⇒ job.reasoningLevel=null');
  assert.throws(() => d.dispatch({ kind: 'prompt', prompt: 'x', reasoningLevel: '  ' }), TypeError, '空白档位拒绝');
  assert.throws(() => d.dispatch({ kind: 'prompt', prompt: 'x', reasoningLevel: 3 }), TypeError, '非字符串拒绝');
});

test('wire：dispatch 的 thinking 参数 → spec.reasoningLevel（工具层映射）', async () => {
  const workRoot = newDir('zcd-think-');
  const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot, maxConcurrent: 1 });
  const handle = createActionHandler(d, {});
  const r = await handle('dispatch', { kind: 'prompt', prompt: 'x', thinking: 'enabled' });
  assert.equal(r.ok, true);
  assert.equal(r.job.spec.reasoningLevel, 'enabled', '工具参数 thinking 落到 spec.reasoningLevel');
  const r2 = await handle('dispatch', { kind: 'prompt', prompt: 'y' });
  assert.equal(r2.job.spec.reasoningLevel, null, '不传 = 未指定（等价 agent 语义）');
  await Promise.all([r.job.id, r2.job.id].map((id) => waitTerminal(d, id)));
});

test('retry 交接重跑：沿用原任务的思考强度档位', async () => {
  const workRoot = newDir('zcd-think-');
  process.env.FAKE_PAUSE_TEXT = 'Error: quota_exceeded for this window';
  process.env.FAKE_EXIT_CODE = '1';
  process.env.FAKE_DONE_BEFORE_PAUSE = '1';
  try {
    const d = createDispatcher({ runnerPath: FAKE_RUNNER, workRoot, maxConcurrent: 1 });
    const j = d.dispatch({ kind: 'prompt', prompt: 'x', tag: 'think-h', reasoningLevel: 'enabled' });
    const paused = await waitTerminal(d, j.id);
    assert.equal(paused.state, 'paused');
    const nj = d.retry(j.id, { provider: 'personal' }); // 换通道 ⇒ 交接重跑（新会话）
    assert.equal(nj.spec.reasoningLevel, 'enabled', '交接 spec 沿用原档位（新会话 ⇒ 档位生效）');
    await waitTerminal(d, nj.id);
  } finally {
    delete process.env.FAKE_PAUSE_TEXT;
    delete process.env.FAKE_EXIT_CODE;
    delete process.env.FAKE_DONE_BEFORE_PAUSE;
  }
});

/* ---------- E. runner 注入 hermetic 干跑（假 CLI 零网络；断言临时 provider 配置内容） ---------- */
test('★ runner：--reasoning-level 写入临时 provider 配置的 defaultModelSelection（hermetic 干跑）', () => {
  const proj = newDir('zcd-rl-proj-');
  const builtin = join(proj, 'builtin.json');
  const personal = join(proj, 'personal.json');
  const dummy = join(proj, 'dummy-cli.cjs');
  const argvOut = join(proj, 'argv.json');
  mkdirSync(join(proj, 'collab'), { recursive: true });
  /* 内置声明：test-model 支持 disabled|enabled */
  writeFileSync(builtin, JSON.stringify({
    schemaVersion: 1,
    config: { modelConfigRules: { modelRules: [{ modelMatch: '.*test-model.*', config: { optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' } } } }] } },
  }));
  /* 个人 provider：prov-x / test-model */
  writeFileSync(personal, JSON.stringify({
    schemaVersion: 1,
    config: {
      providerConfigRules: { providerRules: [{ providerId: 'prov-x', providerName: 'X', config: { group: 'standard-personal', access: { type: 'api-key', apiKey: 'k' }, api: { type: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:9' }, personalModelIds: ['test-model'], modelOrder: ['test-model'] } }] },
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
    },
  }));
  /* 假 CLI：把临时 provider 配置里的 defaultModelSelection 落盘（临时目录随后被 runner 删除，必须趁运行时拷出） */
  writeFileSync(dummy, 'const fs=require("fs");try{const c=JSON.parse(fs.readFileSync(process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE,"utf8"));fs.writeFileSync(process.env.ARGV_OUT,JSON.stringify(c.config.defaultModelSelection??null));}catch(e){fs.writeFileSync(process.env.ARGV_OUT,"ERR:"+e.message);}');

  const env = {
    ...process.env,
    ZCODE_CLI: dummy,
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtin,
    ARGV_OUT: argvOut,
    FAKE_ARGV_FILE: '', // 与本测试无关
  };
  delete env.FAKE_ARGV_FILE;
  const run = (extra) => spawnSync(process.execPath, [RUNNER, '--project', proj, '--prompt', 'x', '--provider', 'personal', '--personal-config', personal, '--model', 'test-model', '--no-ledger', ...extra], { env, encoding: 'utf8', timeout: 60000 });

  const r1 = run(['--reasoning-level', 'enabled']);
  assert.equal(r1.status, 0, `干跑应成功（stderr: ${r1.stderr}）`);
  const sel = JSON.parse(readFileSync(argvOut, 'utf8'));
  assert.deepEqual(sel, { providerId: 'prov-x', modelId: 'test-model', options: { reasoningLevel: 'enabled' } },
    '★ defaultModelSelection 注入临时 provider 配置（headless 会话初始档位）');

  const r2 = run([]);
  assert.equal(r2.status, 0);
  assert.equal(readFileSync(argvOut, 'utf8'), 'null', '未指定档位 ⇒ 不写 defaultModelSelection（行为不变）');

  const r3 = run(['--reasoning-level', 'high']);
  assert.equal(r3.status, 1, '非法档位 fail-fast');
  assert.match(r3.stderr, /disabled\|enabled/, '报错列出可用档位');

  const r4 = run(['--resume', 'sess_x', '--reasoning-level', 'enabled']);
  assert.equal(r4.status, 0, `resume 场景不注入也不报错（stderr: ${r4.stderr}）`);
  assert.match(r4.stderr, /--resume/, '并如实警告沿用原会话档位');
  assert.equal(readFileSync(argvOut, 'utf8'), 'null', 'resume ⇒ 未注入');
});
