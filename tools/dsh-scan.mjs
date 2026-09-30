// dsh-scan.mjs —— 在 asar 归档数据区做原始字符串扫描（不做全量解包）。
// 思路：解析 header 拿到「字节区间 → 文件路径」映射；8MB 分块流式读数据区，
// 用 Buffer.indexOf 找针（支持多针、UTF-8 与 UTF-16LE 双编码）；命中后按区间映射
// 反查来源文件与文件内偏移，再直接从归档 fd 上按需读取命中上下文（±ctx 字节）。
// 这样扫描 121MB 归档也只占常量内存，且每条命中都能给出「文件 + 偏移 + 上下文」证据。
//
// 用法：
//   node dsh-scan.mjs <asar> <needle> [needle2 ...] [--ctx N] [--max M] [--enc utf8|utf16|both] [--path substring]
//     --ctx N      命中点前后各打印 N 字节上下文（默认 72）
//     --max M      每根针最多报告 M 次命中（默认 40；0 = 不限量）
//     --enc ...    编码（默认 both：utf8 与 utf16le 都扫）
//     --path s     只报告路径包含 s 的命中（如 @deepseek-ai）
// 输出行格式：
//   [u8|u16] <needle> @ <文件路径> +<文件内偏移> : <上下文片段（不可见字节转 ·，按 latin1 展示）>
// 例子：
//   node dsh-scan.mjs "D:\DeepSeek\resources\app.asar" "shell.overlay" "composer.dock" --ctx 96
import { open } from 'node:fs/promises';

// ── 参数解析 ──
const args = process.argv.slice(2);
const needles = [];
const opts = { ctx: 72, max: 40, enc: 'both', path: '' };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--ctx') opts.ctx = Number(args[++i]);
  else if (a === '--max') opts.max = Number(args[++i]);
  else if (a === '--enc') opts.enc = args[++i];
  else if (a === '--path') opts.path = args[++i];
  else needles.push(a);
}
if (!needles.length || !args[0]) {
  console.error('用法: node dsh-scan.mjs <asar> <needle> [needle2 ...] [--ctx N] [--max M] [--enc utf8|utf16|both] [--path substring]');
  process.exit(2);
}

// ── header 解析（与 asar-extract.mjs 同一套路，已对该归档实证）──
const fh = await open(args[0], 'r');
const head = Buffer.alloc(16);
await fh.read(head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerSize);
await fh.read(headerBuf, 0, headerSize, 16);
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
const baseOffset = 16 + headerSize;
const fileSize = (await fh.stat()).size;

// ── 拉平目录树 → 按数据区偏移排序的文件表（unpacked 文件的内容不在归档里）──
const files = [];
const walk = (node, path) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = `${path}/${name}`;
    if (entry.files) walk(entry, p);
    else files.push({ path: p.replace(/^\//, ''), size: entry.size, off: Number(entry.offset), unpacked: !!entry.unpacked });
  }
};
walk(header, '');
files.sort((a, b) => a.off - b.off);

// 二分：命中绝对偏移 → 来源文件。注意 header 里的 off 是相对数据区基址（baseOffset）的，
// 所以先换成数据区内偏移 p = abs - baseOffset 再查（最后一处 off <= p 且 p < off+size）。
const fileAt = (abs) => {
  const p = abs - baseOffset;
  if (p < 0) return null;
  let lo = 0, hi = files.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (files[mid].off <= p) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (ans < 0) return null;
  const f = files[ans];
  if (f.unpacked) return { ...f, rel: -1 }; // 内容在归档外的 unpacked 文件
  return p < f.off + f.size ? { ...f, rel: p - f.off } : null;
};

// 上下文：直接从 fd 按需读一段（命中数有限，随机读开销可忽略）
const showBytes = (buf) => buf.toString('latin1').replace(/[^\x20-\x7e]/g, '·');
const readCtx = async (abs, len) => {
  const start = Math.max(0, abs);
  const end = Math.min(fileSize, abs + len);
  if (end <= start) return Buffer.alloc(0);
  const buf = Buffer.alloc(end - start);
  await fh.read(buf, 0, buf.length, start);
  return buf;
};

// ── 分块扫描 ──
const CHUNK = 8 * 1024 * 1024;
const pins = [];
for (const n of needles) {
  const u8 = Buffer.from(n, 'utf8');
  const u16 = Buffer.from(n, 'utf16le');
  if (opts.enc === 'utf8' || opts.enc === 'both') pins.push({ needle: n, buf: u8, tag: 'u8' });
  if (opts.enc === 'utf16' || opts.enc === 'both') pins.push({ needle: n, buf: u16.length ? u16 : u8, tag: 'u16' });
}
// 块间重叠必须按最长针算（多针时短针作重叠基准会漏掉长针的跨界命中）
const maxPinLen = Math.max(...pins.map((p) => p.buf.length));
const counts = Object.fromEntries(needles.map((n) => [n, 0]));
let totalHits = 0;

for (let pos = baseOffset; pos < fileSize; pos += CHUNK) {
  const len = Math.min(CHUNK + maxPinLen - 1, fileSize - pos); // 块间重叠 = 最长针 - 1，防跨界漏检
  const buf = Buffer.alloc(len);
  await fh.read(buf, 0, len, pos);
  for (const pin of pins) {
    if (opts.max > 0 && counts[pin.needle] >= opts.max) continue;
    let i = 0;
    for (;;) {
      const hit = buf.indexOf(pin.buf, i);
      if (hit < 0) break;
      i = hit + 1;
      const abs = pos + hit;
      const f = fileAt(abs);
      if (f && opts.path && !f.path.includes(opts.path)) continue;
      counts[pin.needle] += 1;
      totalHits += 1;
      const where = !f ? '(头部/未映射)'
        : f.rel < 0 ? `${f.path} (unpacked，内容不在归档内)`
          : `${f.path} +${f.rel}`;
      const ctx = await readCtx(abs - opts.ctx, pin.buf.length + opts.ctx * 2);
      console.log(`[${pin.tag}] "${pin.needle}" @ ${where}\n    ${showBytes(ctx)}`);
      if (opts.max > 0 && counts[pin.needle] >= opts.max) break;
    }
  }
}
await fh.close();
console.log(`\n扫描完成：${totalHits} 次命中；` + needles.map((n) => `"${n}"=${counts[n]}`).join('， '));
