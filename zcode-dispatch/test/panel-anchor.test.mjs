// ZB-11 回归测试：浮动位置改为**锚定语义**（贴边跟随，而非绝对坐标被钳死）。
//
// 用户报告：「DSH 全屏时把派发台固定在右上角 → 缩到默认大小 → 派发台被挤到中间对话上面 →
// 再全屏，它仍留在中间；正确应恢复到右上角，不遮挡中间的对话内容。」
//
// ★ 根因正是 ZB-10 的「钳制」：位置只存绝对 {left, top}，窗口缩小时钳制把坐标**改写**进 pos
// 并落盘（落到中间），放大时只保证"不越界"、不会还原 ⇒ 用户意图被永久破坏。
// 正解：存锚定（贴哪条边 + 四条边距），位置由「边距 + 当前视口」推导。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

const EDGE = 8;
const fnOf = (name) => {
  const m = new RegExp(`function ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n    \\}`).exec(src);
  assert.ok(m, `未能在 client.js 里定位 ${name}`);
  return m;
};
const mClamp = fnOf('clampPos');
const mAnchor = fnOf('anchorOf');
const mResolve = fnOf('resolvePos');
const clampPos = (p, v) => new Function('p', 'view', 'EDGE', mClamp[2])(p, v, EDGE);
/* anchorOf / resolvePos 内部会调用彼此与 clampPos —— 用闭包把三者一起求值，避免依赖全局 */
const build = new Function('EDGE', `
  ${mAnchor[0]}
  ${mClamp[0]}
  ${mResolve[0]}
  return { anchorOf, resolvePos, clampPos };
`);
const { anchorOf, resolvePos } = build(EDGE);

console.log('anchorOf：判定贴哪条边（用户场景：右上角）');
{
  const view = { vw: 1920, vh: 1080, w: 440, h: 720 };
  const a = anchorOf({ left: 1920 - 440 - 24, top: 24 }, view); // 右上角
  ok(a.ax === 'right', 'A1 右上角 ⇒ 贴右（ax=right）');
  ok(a.ay === 'top', 'A2 右上角 ⇒ 贴上（ay=top）');
  ok(a.rx === 24, `A3 右边距记录正确（rx=${a.rx}）`);
  ok(a.ty === 24, `A4 上边距记录正确（ty=${a.ty}）`);
}
{
  const a = anchorOf({ left: 24, top: 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 });
  ok(a.ax === 'left' && a.ay === 'top', 'A5 左上角 ⇒ 贴左+贴上');
}
{
  const a = anchorOf({ left: 24, top: 1080 - 720 - 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 });
  ok(a.ax === 'left' && a.ay === 'bottom', 'A6 左下角 ⇒ 贴左+贴下');
}

console.log('\nresolvePos：本报告的核心场景（缩窗再放大）');
{
  const atFull = anchorOf({ left: 1920 - 440 - 24, top: 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 });
  // 缩到 1280×720：贴右 ⇒ 应贴着右边收（距右仍 24），而不是被钳到中间
  const small = resolvePos(atFull, { vw: 1280, vh: 720, w: 440, h: 720 });
  ok(Math.abs((1280 - small.left - 440) - 24) <= 1, `B1 缩窗后仍贴右（距右≈24，实际 ${1280 - small.left - 440}）`);
  ok(small.left > 1280 / 2, 'B2 缩窗后位于右半边（未被挤到中间/左侧）');
  // 再全屏：应回到右上角原处
  const back = resolvePos(atFull, { vw: 1920, vh: 1080, w: 440, h: 720 });
  ok(back.left === 1920 - 440 - 24 && back.top === 24, 'B3 再全屏 ⇒ **精确回到右上角**（这是用户要求的行为）');
}

console.log('\nresolvePos：其它贴边组合');
{
  const topLeft = anchorOf({ left: 24, top: 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 });
  /* 视口必须**放得下面板**（dh 足够）才谈得上"位置不变"：
   * 上一版用了 1280×720，而面板高正好 720 ⇒ 任何 top>0 都会让底边越界，
   * clampPos 按设计退化为 EDGE=8 —— 那是测试期望不合物理，不是 bug。 */
  const r = resolvePos(topLeft, { vw: 1280, vh: 900, w: 440, h: 720 });
  ok(r.left === 24 && r.top === 24, 'B4 贴左上 ⇒ 缩窗后仍在左上角（left/top 不变，视口放得下面板）');
}
{
  const bottomRight = anchorOf({ left: 1920 - 440 - 24, top: 1080 - 720 - 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 });
  const r = resolvePos(bottomRight, { vw: 1280, vh: 900, w: 440, h: 720 });
  ok(Math.abs((1280 - r.left - 440) - 24) <= 1, 'B5 贴右下 ⇒ 缩窗后仍贴右');
  ok(Math.abs((900 - r.top - 720) - 24) <= 1, 'B6 贴右下 ⇒ 缩窗后仍贴下');
}

console.log('\n向后兼容与安全网');
{
  // 旧格式（只有 left/top，无 ax/ay）⇒ resolvePos 按"贴左+贴上"处理，与旧行为一致
  const legacy = { left: 300, top: 200 };
  const r = resolvePos(legacy, { vw: 1920, vh: 1080, w: 440, h: 720 });
  ok(r.left === 300 && r.top === 200, 'C1 旧格式（无 ax/ay）按 left/top 原样使用（向后兼容）');
  ok(resolvePos(null, { vw: 1920, vh: 1080 }) === null, 'C2 无记录 ⇒ null（走默认右下角）');
}
{
  // 安全网：锚定推导出的位置若越界（面板比视口大），仍被 clampPos 钳住
  const a = { ax: 'right', ay: 'bottom', rx: 0, by: 0, lx: 0, ty: 0, left: 0, top: 0 };
  const r = resolvePos(a, { vw: 300, vh: 200, w: 440, h: 720 });
  ok(r.left === EDGE && r.top === EDGE, 'C3 面板比视口大 ⇒ 退化为 EDGE（左上角可见，不出负数）');
}

console.log('\n接线（源码断言）');
ok(/const anchorRef = useRef\(null\);[\s\S]{0,200}const \[pos, setPos\] = useState/.test(src),
  'S1 anchorRef 声明在 pos 的 useState **之前**（否则 TDZ：Cannot access before initialization）');
ok(/const resolved = resolvePos\(anchorRef\.current, metrics\)/.test(src),
  'S2 渲染位置由 resolvePos(锚定, 当前视口) 推导（不落盘解析值）');
ok(/saveJson\(LS\.pos, commitAnchor\(\)\)/.test(src), 'S3 拖拽落盘的是**锚定记录**（commitAnchor）');
ok(/anchorOf\(\{ left: last\.left, top: last\.top \}/.test(src), 'S4 拖动时按当前位置实时重算锚定');
ok(/window\.addEventListener\('resize'/.test(src), 'S5 监听 resize ⇒ 窗口变化时重算位置');
ok(!/setPos\(\(prev\) => \{[\s\S]{0,200}clampPos/.test(src),
  'S6 **不再**把钳制后的绝对坐标写回 pos（ZB-10 的错误做法已移除）');
ok(/\$\{Math\.round\(resolved\.left\)\}px/.test(src), 'S7 rootStyle 使用推导结果');

console.log(`\n===== ZB-11：${pass} PASS / 0 FAIL =====`);