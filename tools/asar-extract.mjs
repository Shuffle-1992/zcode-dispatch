// asar-extract.mjs —— 从 Electron asar 归档按路径前缀提取文件（零依赖，自实现最小读取）。
// 来源：DSH 标准模式会话写的 C:\Users\Administrator\AppData\Local\Temp\asar-extract.mjs，
// 此处复制固化（临时目录随时可能被清理），逻辑与原版一致，仅补充注释。已对
// D:\DeepSeek\resources\app.asar（~121MB）实证可用（Z1 用它抽出了 refs/ 下的官方技能文档）。
//
// asar 格式（本工具只依赖这几条）：
//   [16 字节头][header JSON][文件数据区]
//   头内偏移 12 处的 uint32LE = header JSON 的字节长度；JSON 从偏移 16 开始；
//   数据区基址 = 16 + headerSize（本归档无对齐填充，实测成立）。
//   header JSON 是一棵目录树，叶子节点带 { size, offset }，offset 是相对数据区基址的偏移。
//
// 用法：
//   node asar-extract.mjs <asar> <path-prefix> <outDir>      提取路径前缀匹配的文件到 outDir
//   LIST_ONLY=1 node asar-extract.mjs <asar> <path-prefix>   只列清单（大小 + 路径），不写盘
// 例子：
//   LIST_ONLY=1 node asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai" NUL
//   node asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-client-ui-theme" "F:\...\refs\extracted\theme"
import { open, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const archive = process.argv[2];
const prefix = process.argv[3];
const outDir = process.argv[4];

// 1) 读 16 字节头，取 header JSON 长度，再读 JSON 并解析出目录树
const fh = await open(archive, 'r');
const head = Buffer.alloc(16);
await fh.read(head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerSize);
await fh.read(headerBuf, 0, headerSize, 16);
const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
const baseOffset = 16 + headerSize; // 文件数据区基址

// 2) 深度优先把树拉平成 { path, size, offset } 列表（offset 相对数据区基址）
const files = [];
const walk = (node, path) => {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = `${path}/${name}`;
    if (entry.files) walk(entry, p);
    else files.push({ path: p.replace(/^\//, ''), size: entry.size, offset: Number(entry.offset) });
  }
};
walk(header, '');

const targets = files.filter((f) => f.path.startsWith(prefix));
console.log(`匹配 ${targets.length} 个文件（总 ${files.length}）`);
// 3) 只列模式：打印后直接退出，不写任何盘
if (process.env.LIST_ONLY === '1') {
  for (const t of targets) console.log(`  ${String(t.size).padStart(8)}  ${t.path}`);
  await fh.close();
  process.exit(0);
}
// 4) 提取模式：逐文件按 offset+size 从数据区读出，写到 outDir 下（去掉前缀的相对路径）
for (const t of targets) {
  const buf = Buffer.alloc(t.size);
  if (t.size > 0) await fh.read(buf, 0, t.size, baseOffset + t.offset);
  const dest = join(outDir, t.path.slice(prefix.length).replace(/^\/+/, '') || t.path.split('/').pop());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  ${t.size.toString().padStart(8)}  ${t.path}`);
}
await fh.close();
console.log(`已提取到 ${outDir}`);
