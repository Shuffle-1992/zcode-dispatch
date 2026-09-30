// ZB-10 → ZB-11 回归测试：视口尺寸变化时面板位置的处理。
//
// 演进说明（重要，避免误读）：
//   · ZB-10 的实现是「按真实尺寸**重新钳制**」——把钳制后的绝对坐标写回并落盘。
//   · ZB-11 发现那正是用户报告的反效果（缩窗后坐标被固化到中间，放大不还原），
//     故**改为锚定语义**：只落盘"贴哪条边 + 边距"，位置由当前视口推导。
//     即 ZB-10 的 reclampPos **已被移除**，其要保证的行为（视口变化后仍可见、不跑丢）
//     由 anchorOf/resolvePos 以更强的方式保证。
//
// 本文件保留 ZB-10 的**核心不变量**断言（视口变化后绝不跑到视口外、绝不出现负数），
// 并确认旧实现已退役（防止有人把"钳死坐标"再写回来）。
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SRC = 'F:\\My Code\\dsh-plugins\\zcode-dispatch\\client.js';
const src = readFileSync(SRC, 'utf8');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass += 1; console.log(`  ✓ ${m}`); };

const EDGE = 8;
const fnOf = (n) => {
  const m = new RegExp(`function ${n}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n    \\}`).exec(src);
  assert.ok(m, `未能在 client.js 里定位 ${n}`);
  return m;
};
const mAnchor = fnOf('anchorOf');
const mClamp = fnOf('clampPos');
const mResolve = fnOf('resolvePos');
const { anchorOf, resolvePos, clampPos } = new Function('EDGE', `
  ${mAnchor[0]}
  ${mClamp[0]}
  ${mResolve[0]}
  return { anchorOf, resolvePos, clampPos };
`)(EDGE);

console.log('核心不变量：任何视口下都可见（ZB-10 的初衷，ZB-11 用锚定继续保证）');
{
  const anchors = [
    anchorOf({ left: 24, top: 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 }),                       // 左上
    anchorOf({ left: 1456, top: 24 }, { vw: 1920, vh: 1080, w: 440, h: 720 }),                     // 右上
    anchorOf({ left: 24, top: 336 }, { vw: 1920, vh: 1080, w: 440, h: 720 }),                      // 左下
    anchorOf({ left: 1456, top: 336 }, { vw: 1920, vh: 1080, w: 440, h: 720 }),                    // 右下
  ];
  const viewports = [
    { vw: 1920, vh: 1080 }, { vw: 1280, vh: 900 }, { vw: 1024, vh: 768 }, { vw: 800, vh: 600 }, { vw: 400, vh: 300 },
  ];
  let allVisible = true;
  let negative = false;
  for (const a of anchors) {
    for (const vp of viewports) {
      const r = resolvePos(a, { ...vp, w: 440, h: 720 });
      if (!r) { allVisible = false; continue; }
      // 左上角必须落在视口内且非负（"可见、可点"的最低要求）
      if (r.left < 0 || r.top < 0 || r.left >= vp.vw || r.top >= vp.vh) allVisible = false;
      if (r.left < 0 || r.top < 0) negative = true;
    }
  }
  ok(allVisible, 'D1 4 种贴边 × 5 种视口（含比面板还小的）⇒ 左上角始终在视口内可见');
  ok(!negative, 'D2 任何组合下都不出现负数坐标');
}
{
  // 面板比视口大：退化为 EDGE，不出负数
  const r = resolvePos({ ax: 'right', ay: 'bottom', rx: 0, by: 0 }, { vw: 300, vh: 200, w: 440, h: 720 });
  ok(r.left === EDGE && r.top === EDGE, 'D3 面板比视口大 ⇒ 退化为 EDGE（左上角可见）');
}

console.log('\n旧实现已退役（防止"钳死坐标"被写回）');
ok(!/const reclampPos = useCallback/.test(src),
  'E1 ZB-10 的 reclampPos 已移除（它会把钳制后的绝对坐标固化进 pos）');
ok(!/setPos\(\(prev\) => \{[\s\S]{0,240}clampPos\(prev/.test(src),
  'E2 不存在"把 clampPos 结果写回 pos"的写法');
ok(/const resolved = resolvePos\(anchorRef\.current, metrics\)/.test(src),
  'E3 位置改由锚定推导（ZB-11）');
ok(/window\.addEventListener\('resize'/.test(src) && /forcePos/.test(src),
  'E4 仍监听 resize（ZB-10 的诉求保留：视口变化要响应），但改为触发重算而非重钳');

console.log('\nclampPos 仍是安全网（未被删除）');
ok(typeof clampPos === 'function' && clampPos(null, { vw: 100, vh: 100 }) === null,
  'F1 clampPos 仍可用且对 null 返回 null');
ok(clampPos({ left: -50, top: -50 }, { vw: 1000, vh: 600, w: 440, h: 320 }).left === EDGE,
  'F2 clampPos 仍把负数拉回 EDGE');

console.log(`\n===== ZB-10/11：${pass} PASS / 0 FAIL =====`);