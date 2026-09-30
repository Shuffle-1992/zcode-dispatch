// Z13 保真验证（跑完即删）：让【真实】defineTool（refs/dsh-tools/lib/index.js:838，
// 提取自 DSH asar 的官方包产物）亲自编译并注册我们的 TOOL_PARAMETERS / output——
// spec 违反官方 DSL 则 defineTool 抛错 → 本插件注册降级 → 捕获数为 0 → 本脚本 FAIL。
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register('./z13-smoke-hook-real.mjs', import.meta.url);
const [{ defineTool }, { apply }] = await Promise.all([
  import('@deepseek-ai/dsh-tools'),
  import('../index.js'),
]);

const results = [];
const ok = (cond, label, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
ok(typeof defineTool === 'function', '真实现 defineTool 已加载（refs/dsh-tools/lib/index.js）');

const captured = [];
const effects = [];
const ctx = {
  tools: { register(def) { captured.push(def); } },
  effect(fn) { effects.push(fn); },
  logger: { info: () => {}, warn: (m) => console.log(`  [warn] ${m}`), error: (m) => console.log(`  [error] ${m}`) },
};
const tmp = mkdtempSync(join(tmpdir(), 'z13-real-'));
const api = apply(ctx, { runnerPath: fileURLToPath(new URL('./fixtures/fake-runner.mjs', import.meta.url)), workRoot: join(tmp, 'work'), switchPath: join(tmp, 'switch.json') });

ok(captured.length === 1, '真实 defineTool 接受本插件 spec 并注册（捕获 1 个）', `count=${captured.length}`);
const tool = captured[0] ?? {};
ok(tool.name === 'zcode_dispatch', 'captured.name === zcode_dispatch', tool.name);

// 真实编译产物断言：defineTool 存的是编译后 JSON Schema（required 收拢到顶层）
const compiled = tool.parameters;
ok(compiled && compiled.type === 'object' && Array.isArray(compiled.required) && compiled.required.join(',') === 'action', '真实编译：parameters.type=object 且 required=[action]', JSON.stringify(compiled?.required ?? null));
ok(compiled?.properties?.action?.enum?.includes('status') && compiled?.properties?.action?.enum?.includes('switch'), '真实编译：action 枚举含 status/switch', JSON.stringify(compiled?.properties?.action?.enum ?? null));
ok(Object.hasOwn(compiled?.properties?.timeoutMin ?? {}, 'type') && !Object.hasOwn(compiled?.properties?.timeoutMin ?? {}, 'exclusiveMinimum'), '真实编译：timeoutMin 无 DSL 外键残留');
ok(Object.keys(tool.output?.schema ?? {}).length === 0, '真实编译：output schema = 注解即无约束 JSON（{}）', JSON.stringify(tool.output?.schema ?? null));

// 官方校验语义经真实 execute 包装器端到端（defineTool 内部先 validateArgs 再透传）：
const run = (args) => tool.execute(args).then((r) => JSON.parse(r));
ok((await run({ action: 'status' })).ok === true, '真实 execute：{action:status} 过校验 → ok:true');
await run({ action: 'tail', n: 5 }).then(
  (r) => ok(r && typeof r.ok === 'boolean', '真实 execute：可选字段（tail 无 id）过校验进入 handler', JSON.stringify(r).slice(0, 60)),
  (e) => ok(false, '真实 execute：可选字段（tail 无 id）过校验进入 handler', String(e)),
);
for (const [label, args] of [
  ['缺必填 action', {}],
  ['枚举外 action', { action: 'nope' }],
  ['enabled 非布尔', { action: 'switch', enabled: 'yes' }],
  ['chain 非字符串数组', { action: 'fallback', chain: [1, 2] }],
]) {
  try {
    await tool.execute(args);
    ok(false, `真实 execute 拒绝：${label}`, '未抛');
  } catch (e) {
    ok(e?.name === 'ToolArgsError', `真实 execute 拒绝：${label}`, (e?.message ?? '').slice(0, 90));
  }
}
void api;
let disposeThrew = false;
try { for (const fn of effects) fn(); } catch { disposeThrew = true; }
ok(!disposeThrew, '卸载清理不抛');
rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n[z13 保真·真 defineTool] ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
