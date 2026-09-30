/**
 * 等待 inbox 出现新消息（跨 Agent 互唤醒的等待命令，协议见 collab/PROTOCOL.md 通道 T1）。
 *
 * 用法：node scripts/collab/wait-inbox.mjs <inbox目录> [超时秒=1800] [轮询秒=5]
 * 行为：记录启动时的文件基线，出现新 .md 消息即打印并退出 0；超时退出 2；参数错退出 1。
 * 注意：本命令运行期间不要并跑其他重负载门禁；由协议使用方负责重新挂起下一轮等待。
 */
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , dirArg, timeoutArg = '1800', intervalArg = '5'] = process.argv;
if (!dirArg) {
  console.error('usage: node scripts/collab/wait-inbox.mjs <dir> [timeoutSec] [intervalSec]');
  process.exit(1);
}
const dir = resolve(dirArg);
if (!existsSync(dir)) {
  console.error(`[wait-inbox] 目录不存在: ${dir}`);
  process.exit(1);
}

const timeoutMs = Number(timeoutArg) * 1000;
const intervalMs = Number(intervalArg) * 1000;
const isMsg = (f) => f.endsWith('.md') && !f.startsWith('.') && !f.startsWith('README');

const baseline = new Set(readdirSync(dir).filter(isMsg));
const started = Date.now();
console.log(`[wait-inbox] watch ${dir}（基线 ${baseline.size} 条，超时 ${timeoutArg}s，轮询 ${intervalArg}s）`);

const tick = () => {
  let news = [];
  try {
    news = readdirSync(dir).filter(isMsg).filter((f) => !baseline.has(f));
  } catch (err) {
    console.error(`[wait-inbox] 读取失败: ${err.message}`);
  }
  if (news.length) {
    console.log(`[wait-inbox] 发现新消息: ${news.join(', ')}`);
    process.exit(0);
  }
  if (Date.now() - started > timeoutMs) {
    console.log('[wait-inbox] 超时退出');
    process.exit(2);
  }
  setTimeout(tick, intervalMs);
};
tick();