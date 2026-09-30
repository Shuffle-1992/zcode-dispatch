/**
 * 在 app.asar 中定位"推理强度选择如何持久化"的客户端代码。
 * 用法: node asar-grep.mjs <pattern1> [pattern2] ...
 * 原理: 读 asar 头部 JSON 索引 → 遍历文件树 → 只读 .js 且位于 web/client/renderer 目录的文件 → 字节级搜索。
 */
import { readFileSync } from 'node:fs';

const ASAR = 'D:\\DeepSeek\\resources\\app.asar';
const ALL = process.argv.includes('--all');
const patterns = process.argv.slice(2).filter((a) => a !== '--all');
if (patterns.length === 0) { console.error('usage: node asar-grep.mjs <pattern>...'); process.exit(1); }

const buf = readFileSync(ASAR);
const headerSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));
/* ⚠️ 数据区起始 = 16 + headerSize（**不是** 8 + headerSize）。用 8+ 会少 8 字节：
 * 内容看似可读但尾部截断（2026-10-01 实证，见 asar-cat.mjs 注释）。 */
const BASE = 16 + headerSize;

function walk(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (child.files) walk(child, p, out);
    else if (child.size !== undefined) out.push({ path: p, offset: child.offset, size: child.size });
  }
  return out;
}
const all = walk(header, [], []);
const jsFiles = ALL ? all.filter((f) => /\.(js|mjs|cjs)$/i.test(f.path)) : all.filter((f) => /\.(js|mjs)$/i.test(f.path) && /web|client|renderer|dist/i.test(f.path));
console.error(`[grep] asar 文件总数=${all.length}  客户端 JS 候选=${jsFiles.length}`);

let totalHits = 0;
for (const f of jsFiles) {
  if (f.size > 30 * 1024 * 1024) continue; // 跳过 >30MB
  const content = buf.subarray(BASE + Number(f.offset), BASE + Number(f.offset) + f.size).toString('utf8');
  for (const pat of patterns) {
    let idx = 0, count = 0;
    const samples = [];
    while ((idx = content.indexOf(pat, idx)) !== -1 && count < 40) {
      count += 1;
      if (samples.length < 3) samples.push(content.slice(Math.max(0, idx - 90), idx + 110).replace(/\s+/g, ' '));
      idx += pat.length;
    }
    if (count > 0) {
      totalHits += count;
      console.log(`\n=== ${f.path}  (${(f.size / 1024).toFixed(0)}KB)  "${pat}" ×${count}`);
      for (const s of samples) console.log(`    …${s}…`);
    }
  }
}
console.log(`\n[grep] 总命中=${totalHits}`);
