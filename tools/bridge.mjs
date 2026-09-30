#!/usr/bin/env node
/**
 * DSH ↔ ZCode 客户端「桥」工具（零依赖）。
 * 用法：
 *   node tools/bridge.mjs submit <任务包.md> [--name <名字>]   # 投放任务到 inbox
 *   node tools/bridge.mjs status                               # inbox / outbox 概览
 *   node tools/bridge.mjs poll [超时秒=600] [轮询秒=5]          # 等 outbox 出现新交付
 *   node tools/bridge.mjs next                                 # 打印客户端将要取走的那个任务文件名
 * 说明：任务包由客户端「自动化（定时任务）」里的固定指令消费（见 bridge/README.md）。
 */
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const BRIDGE = join(ROOT, 'bridge');
const INBOX = join(BRIDGE, 'inbox');
const OUTBOX = join(BRIDGE, 'outbox');
const ARCHIVE = join(BRIDGE, 'archive');
for (const d of [INBOX, OUTBOX, ARCHIVE]) mkdirSync(d, { recursive: true });

const isTask = (f) => f.endsWith('.md') && !f.startsWith('.') && !f.startsWith('README');
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter(isTask).sort() : []);

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'submit') {
  const src = rest.find((a) => !a.startsWith('--'));
  if (!src) {
    console.error('用法: node tools/bridge.mjs submit <任务包.md> [--name <名字>]');
    process.exit(1);
  }
  const abs = resolve(src);
  if (!existsSync(abs)) {
    console.error(`任务包不存在: ${abs}`);
    process.exit(1);
  }
  const nameIdx = rest.indexOf('--name');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = (nameIdx >= 0 ? rest[nameIdx + 1] : null) ?? basename(abs);
  const dest = join(INBOX, name);
  copyFileSync(abs, dest);
  console.log(`[bridge] 已投递: ${dest}`);
  console.log(`[bridge] inbox 现有 ${list(INBOX).length} 条；客户端将先取: ${list(INBOX)[0]}`);
  console.log(`[bridge] 提示：客户端自动化按周期触发（见 bridge/README.md），也可在客户端点「立即运行」催一次。`);
} else if (cmd === 'status') {
  console.log(`[bridge] inbox(${list(INBOX).length}): ${list(INBOX).join(', ') || '空'}`);
  console.log(`[bridge] outbox(${list(OUTBOX).length}): ${list(OUTBOX).join(', ') || '空'}`);
  console.log(`[bridge] archive(${list(ARCHIVE).length}): ${list(ARCHIVE).slice(-3).join(', ') || '空'}`);
  console.log(`[bridge] 客户端将先取: ${list(INBOX)[0] ?? '(无)'}`);
} else if (cmd === 'next') {
  console.log(list(INBOX)[0] ?? '(inbox 为空)');
} else if (cmd === 'poll') {
  const timeoutSec = Number(rest[0] ?? 600);
  const intervalSec = Number(rest[1] ?? 5);
  const base = new Set(list(OUTBOX));
  const t0 = Date.now();
  console.log(`[bridge] watch ${OUTBOX}（基线 ${base.size} 条，超时 ${timeoutSec}s，轮询 ${intervalSec}s）`);
  const tick = () => {
    const news = list(OUTBOX).filter((f) => !base.has(f));
    if (news.length) {
      console.log(`[bridge] 新交付: ${news.join(', ')}`);
      for (const f of news) {
        const p = join(OUTBOX, f);
        console.log(`[bridge] ${f}: ${statSync(p).size} bytes, mtime=${statSync(p).mtime.toISOString()}`);
        console.log(readFileSync(p, 'utf8').slice(0, 800));
      }
      process.exit(0);
    }
    if ((Date.now() - t0) / 1000 > timeoutSec) {
      console.log('[bridge] 超时退出（无新交付）');
      process.exit(2);
    }
    setTimeout(tick, intervalSec * 1000);
  };
  tick();
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
}
