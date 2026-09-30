// Z13 冒烟·defineTool 忠实桩：只复刻 refs/dsh-tools/lib/index.js:838 真实现里
// 冒烟断言依赖的可观察行为——parameters 走官方 spec（必填/枚举校验）、execute
// 先校验再透传、output 原样携带。不做完整 schema 编译（真实编译在宿主内发生）。

class ToolArgsError extends Error {
  constructor(violations) {
    super(`invalid arguments: ${violations.join('; ')}`);
    this.name = 'ToolArgsError';
    this.violations = violations;
  }
}

const TYPES = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
};

// parameterSchemaSpecToJsonSchema + validateArgs 的最小语义：必填在场、类型匹配、枚举命中。
export function validateArgs(spec, args) {
  const violations = [];
  for (const [key, node] of Object.entries(spec ?? {})) {
    const has = args != null && typeof args === 'object' && args[key] !== undefined;
    if (node.required && !has) violations.push(`missing required property "${key}"`);
    if (!has) continue;
    const check = TYPES[node.type];
    if (check && !check(args[key])) violations.push(`"${key}" must be ${node.type}`);
    else if (Array.isArray(node.enum) && !node.enum.includes(args[key])) violations.push(`"${key}" must be one of ${JSON.stringify(node.enum)}`);
  }
  return violations;
}

export function defineTool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: options.output,
    async execute(args, exec) {
      const violations = validateArgs(options.parameters, args);
      if (violations.length > 0) throw new ToolArgsError(violations);
      return options.execute(args, exec);
    },
  };
}
