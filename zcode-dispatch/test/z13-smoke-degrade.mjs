// Z13 冒烟·降级路径（跑完即删，无钩子=本地解析不到 @deepseek-ai/dsh-tools）：
// 断言 defineTool 缺失或 ctx.tools 不可用时，apply() 不抛、不注册、清理可跑——激活安全。
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { apply } = await import('../index.js');

const results = [];
const ok = (cond, label, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const switchFile = join(tmpdir(), `z13-smoke-switch-${process.pid}.json`);
const mkCtx = () => {
  const captured = [];
  const effects = [];
  const logs = [];
  return {
    captured, effects, logs,
    ctx: {
      effect(fn) { effects.push(fn); },
      logger: {
        info: (m) => logs.push(['info', m]),
        warn: (m) => logs.push(['warn', m]),
        error: (m) => logs.push(['error', m]),
      },
    },
  };
};

// ① ctx.tools.register 存在，但 dsh-tools 解析失败 → 不注册、不抛
{
  const { ctx, captured, effects, logs } = mkCtx();
  ctx.tools = { register(def) { captured.push(def); } };
  let threw = false;
  try { apply(ctx, { runnerPath: '', workRoot: '', switchPath: switchFile }); } catch { threw = true; }
  ok(!threw, '① defineTool 缺失：apply 不抛');
  ok(captured.length === 0, '① defineTool 缺失：不注册任何工具', `count=${captured.length}`);
  ok(logs.some(([, m]) => m.includes('@deepseek-ai/dsh-tools 不可用')), '① 打出降级 warn', logs.find(([, m]) => m.includes('未注册'))?.[1] ?? '');
  let disposeThrew = false;
  try { for (const fn of effects) fn(); } catch { disposeThrew = true; }
  ok(!disposeThrew, '① defineTool 缺失：卸载清理不抛');
}

// ② ctx 无 tools → 不注册、不抛
{
  const { ctx, captured, effects, logs } = mkCtx();
  let threw = false;
  try { apply(ctx, { runnerPath: '', workRoot: '', switchPath: switchFile }); } catch { threw = true; }
  ok(!threw, '② ctx 无 tools：apply 不抛');
  ok(captured.length === 0, '② ctx 无 tools：不注册任何工具');
  ok(logs.some(([, m]) => m.includes('ctx.tools.register 不可用')), '② 打出降级 warn');
  let disposeThrew = false;
  try { for (const fn of effects) fn(); } catch { disposeThrew = true; }
  ok(!disposeThrew, '② ctx 无 tools：卸载清理不抛');
}

// ③ ctx.tools.register 非函数 → 不注册、不抛
{
  const { ctx, effects, logs } = mkCtx();
  ctx.tools = { register: 42 };
  let threw = false;
  try { apply(ctx, { runnerPath: '', workRoot: '', switchPath: switchFile }); } catch { threw = true; }
  ok(!threw, '③ register 非函数：apply 不抛');
  ok(logs.some(([, m]) => m.includes('ctx.tools.register 不可用')), '③ 打出降级 warn');
  try { for (const fn of effects) fn(); } catch { ok(false, '③ 卸载清理不抛'); }
  ok(true, '③ 卸载清理不抛');
}

const failed = results.filter((r) => !r).length;
console.log(`\n[z13 冒烟·降级] ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
