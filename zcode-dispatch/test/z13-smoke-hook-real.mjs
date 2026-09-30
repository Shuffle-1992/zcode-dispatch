// Z13 保真验证·模块钩子（跑完即删）：'@deepseek-ai/dsh-tools' 解析到工作区提取的
// 真实现（refs/dsh-tools/lib/index.js，官方包 lib 产物）；它 import 的宿主内部包本地
// 不存在，按名生成 data URL 桩（只覆盖模块顶层求值与本次调用路径所需的最小形状）。
const REAL = new URL('../../refs/dsh-tools/lib/index.js', import.meta.url).href;

// 各宿主内部包被真实现引用的具名导出 → data URL 内的桩定义
const STUBS = {
  '@deepseek-ai/cordis': { Service: 'class Service {}' },
  '@deepseek-ai/dsh-llm': {
    HarnessError: 'class HarnessError extends Error { constructor(message, code) { super(message); this.code = code; } }',
    createUserMessage: '() => ({})',
  },
  '@deepseek-ai/dsh-scope': {
    AnonymousEntries: 'class AnonymousEntries {}',
    NamedEntries: 'class NamedEntries {}',
    ScopedLayers: 'class ScopedLayers {}',
    scopeOf: '() => undefined',
    scopeTarget: '() => undefined',
  },
  '@deepseek-ai/dsh-util-values': {
    assertNever: '(v) => { throw new Error("assertNever: " + String(v)); }',
    deepFreeze: '(o) => o',
    isJsonValue: '(v) => { try { JSON.stringify(v); return true; } catch { return false; } }',
    snapshotJsonValue: '(v) => JSON.parse(JSON.stringify(v))',
  },
  '@deepseek-ai/dsh-brand': { brandString: '(s) => s' },
  // RUN_CODE_CONTROLS 顶层求值需要 [...ESCALATION_TARGETS] 可迭代
  '@deepseek-ai/dsh-sandbox': {
    ESCALATION_TARGETS: 'new Set(["read-only"])',
    approveEscalation: '() => ({})',
    validateEscalationArgs: '() => {}',
  },
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') return { shortCircuit: true, url: REAL };
  const names = STUBS[specifier];
  if (names) {
    const body = Object.entries(names).map(([k, def]) => `export const ${k} = ${def};`).join('\n');
    return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(body)}` };
  }
  return nextResolve(specifier, context);
}
