// Z13 冒烟·主路径（跑完即删）：钩子把 @deepseek-ai/dsh-tools 解析到忠实桩，
// 断言 apply() 经官方 ctx.tools.register(defineTool(...)) 恰好注册 1 个工具且形状正确。
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register('./z13-smoke-hook.mjs', import.meta.url);
const { apply, inject, name } = await import('../index.js');

const results = [];
const ok = (cond, label, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const captured = [];
const effects = [];
const logs = [];
const ctx = {
  tools: { register(def) { captured.push(def); } },
  effect(fn) { effects.push(fn); },
  logger: {
    info: (m) => logs.push(['info', m]),
    warn: (m) => logs.push(['warn', m]),
    error: (m) => logs.push(['error', m]),
  },
};
const switchFile = join(tmpdir(), `z13-smoke-switch-${process.pid}.json`); // 不存在=开启（Z12 契约），不落真值
// createActionHandler 的 dispatcher 全局门禁（wire.host.mjs:230）连 status 也要求 dispatcher 在，
// 故照 z2-verify §6 用假 runner + 临时 workRoot 建真 dispatcher（status 只读开关文件，不 spawn）。
const tmp = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), 'z13-smoke-'));
const cfg = {
  runnerPath: join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'fake-runner.mjs'),
  ledgerPath: join(tmp, 'ledger.jsonl'),
  workRoot: join(tmp, 'work'),
  switchPath: switchFile,
};

const api = apply(ctx, cfg);

ok(name === 'zcode-dispatch', 'export name === zcode-dispatch', name);
ok(Array.isArray(inject) && inject.length === 1 && inject[0] === 'tools', "export inject === ['tools']", JSON.stringify(inject));
ok(inject.every((n) => typeof n === 'string' && !n.startsWith('remote.')), 'inject 不含任何 remote.*');
ok(captured.length === 1, '恰好捕获 1 个工具', `count=${captured.length}`);
const tool = captured[0] ?? {};
ok(tool.name === 'zcode_dispatch', "captured.name === 'zcode_dispatch'", tool.name);
ok(typeof tool.execute === 'function', 'typeof captured.execute === function');
ok(typeof tool.description === 'string' && tool.description.includes('已开启'), '工具描述含注册时刻开关状态', (tool.description ?? '').split('\n')[0]);
ok(tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters), 'parameters 是官方 spec 对象（非 JSON Schema 包装）');
const action = tool.parameters?.action;
ok(action && typeof action === 'object' && action.type === 'string' && typeof action.description === 'string', 'parameters.action 带 type/description（官方 spec 形状）', JSON.stringify(action ?? null));
ok(Array.isArray(action?.enum) && action.enum.includes('status') && action.enum.includes('switch'), 'action 枚举含 status 与 switch', JSON.stringify(action?.enum ?? null));
ok(action?.required === true, 'action.required === true');
ok(tool.parameters?.enabled?.type === 'boolean' && tool.parameters?.chain?.type === 'array' && tool.parameters?.chain?.items?.type === 'string', 'enabled/chain 字段 spec 形状保持');
ok(tool.output?.schema?.type === 'json' && typeof tool.output?.render === 'function', "output = { schema:{type:'json'}, render } 最小合法形态");

let statusValue = null;
try {
  const raw = await tool.execute({ action: 'status' });
  statusValue = JSON.parse(raw);
  ok(statusValue && statusValue.ok === true && statusValue.switch && statusValue.switch.enabled === true, "execute({action:'status'}) 可 JSON 序列化且 ok:true", raw.slice(0, 120));
} catch (e) {
  ok(false, "execute({action:'status'}) 可 JSON 序列化且 ok:true", String(e));
}
try {
  await tool.execute({ action: 'nope' });
  ok(false, '非法 action 被 defineTool 校验层拒绝', '未抛错');
} catch (e) {
  ok(e?.name === 'ToolArgsError', '非法 action 被 defineTool 校验层拒绝', `${e?.name}: ${(e?.message ?? '').slice(0, 80)}`);
}
ok(typeof api.handleAction === 'function' && api.dispatcher !== null && api.wire, 'apply 返回 {dispatcher, wire, handleAction}（假 runner 就绪）');

let disposeThrew = false;
try { for (const fn of effects) fn(); } catch { disposeThrew = true; }
ok(effects.length > 0 && !disposeThrew, '卸载清理（ctx.effect 注册的 disposeAll）不抛');
rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n[z13 冒烟·主路径] ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
