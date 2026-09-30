// Z13 冒烟·模块钩子：把 '@deepseek-ai/dsh-tools' 解析到本地忠实桩（真实包本地不解析，
// 宿主才解析；桩只复刻冒烟断言所需的可观察契约，见 z13-smoke-stub.mjs）。
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { shortCircuit: true, url: new URL('./z13-smoke-stub.mjs', import.meta.url).href };
  }
  return nextResolve(specifier, context);
}
