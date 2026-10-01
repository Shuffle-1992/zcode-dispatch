/**
 * Start Plan 直连探针（只读 config.json，不改任何配置；绝不打印凭据）。
 * 目的：判断 `builtin:bigmodel-start-plan` 的凭据能否直连其端点。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY = 'builtin:bigmodel-start-plan';
const cfg = JSON.parse(readFileSync(join(homedir(), '.zcode', 'v2', 'config.json'), 'utf8'));
const entry = cfg?.provider?.[KEY];
if (!entry) { console.error(`未找到 ${KEY}`); process.exit(1); }

const token = entry?.options?.apiKey;
const baseURL = entry?.options?.baseURL;
const kind = typeof token !== 'string' ? '(无)' : token.startsWith('ey') ? 'JWT' : /^[0-9a-f]{32}\./.test(token) ? 'apiKey' : 'other';
console.log('=== 目标 ===');
console.log(`  provider   : ${KEY}`);
console.log(`  enabled    : ${entry.enabled}   reason=${entry.systemDisabledReason ?? '-'}`);
console.log(`  baseURL    : ${baseURL}`);
console.log(`  凭据形态   : ${kind}（长度 ${typeof token === 'string' ? token.length : 0}，不打印值）`);
console.log(`  模型表     : ${Object.keys(entry.models ?? {}).join(', ')}`);

const base = String(baseURL ?? '').replace(/\/+$/, '');
if (!base || typeof token !== 'string') { console.error('缺少 baseURL/token，无法探测'); process.exit(1); }

async function probe(label, path, init) {
  const url = `${base}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let summary = text.slice(0, 300).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(text);
      summary = `code=${j.code ?? '-'} success=${j.success ?? '-'} msg=${j.msg ?? j.error?.message ?? '-'} data=${Array.isArray(j.data) ? j.data.length : '-'} type=${j.type ?? j.error?.type ?? '-'}`;
    } catch { /* 保留原文摘要 */ }
    console.log(`\n[${label}] HTTP ${res.status}  (${Date.now() - started}ms)`);
    console.log(`  ${summary}`);
    return { status: res.status, text };
  } catch (e) {
    console.log(`\n[${label}] 请求失败: ${String(e?.message ?? e).slice(0, 120)}`);
    return { status: 0, text: '' };
  }
}

const headers = { 'x-api-key': token, 'anthropic-version': '2023-06-01' };

console.log('\n=== 探测（GET /v1/models）===');
await probe('GET models', '/v1/models', { method: 'GET', headers });

console.log('\n=== 探测（POST /v1/messages，max_tokens=8，最小配额消耗）===');
await probe('POST messages', '/v1/messages', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'GLM-5.3-Flash', max_tokens: 8, messages: [{ role: 'user', content: 'OK' }] }),
});
