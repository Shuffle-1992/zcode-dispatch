/** 从 app.asar 抽取单个文件到 stdout 或指定路径。用法: node asar-cat.mjs <asar内路径> [输出文件] */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ASAR = 'D:\\DeepSeek\\resources\\app.asar';
const [target, out] = process.argv.slice(2);
if (!target) { console.error('usage: node asar-cat.mjs <asar内路径> [输出文件]'); process.exit(1); }

const buf = readFileSync(ASAR);
const headerSize = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));
/* ⚠️ 数据区起始 = 16 + headerSize（**不是** 8 + headerSize）。
 * 用 8+headerSize 会少 8 字节：读出的内容看似正常但**尾部被截断**
 * （2026-10-01 实证：schemastery index.mjs 尾部 `export { Schema as default };` 被截成
 *  `export { Schema as def`）。判据：拿头部 integrity.hash 校验读到的字节。 */
const BASE = 16 + headerSize;

const parts = target.split('/').filter(Boolean);
let node = header;
for (const p of parts) { node = node?.files?.[p]; if (!node) { console.error(`未找到: ${target}`); process.exit(1); } }
const content = buf.subarray(BASE + Number(node.offset), BASE + Number(node.offset) + node.size);
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, content); console.log(`已抽出 ${node.size} B → ${out}`); }
else process.stdout.write(content);
