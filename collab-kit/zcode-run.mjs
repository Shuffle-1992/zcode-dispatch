/**
 * ZCode 无头派发器（DSH → ZCode 子代理通道；协议见 collab/PROTOCOL.md §5 通道 T7）。
 *
 * 用途：把一条自足任务包交给 ZCode Agent CLI 无头执行，产物与证据落盘，退出码透传，
 *      供 DSH（或任何调度方）在后台作业里等待并在完成后独立验收。
 *
 * 默认走 **ZCode 套餐额度**（provider=plan，取账号里已启用的 Coding Plan 端点+密钥），
 * 而不是个人自建 API Key；需要个人 Key 时显式 `--provider personal`。
 *
 * 用法：
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --task collab/tasks/R35-01-task.md --tag R35-01 --mode yolo
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --prompt "只回答 OK" --tag smoke
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --target "<可校验目标>" --tag R35-02 --mode edit
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --resume sess_xxx --prompt "继续下一批" --tag R35-03
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --list-providers                      # 看套餐/供应商可用性
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --prompt ... --model GLM-5.3-Flash    # 套餐内指定模型
 *   node "<dsh-plugins>/collab-kit/zcode-run.mjs" --project <项目根> --prompt ... --provider personal --model deepseek-v4-pro
 *
 * 参数：
 *   --task <file>        任务包文件（内容内联进 prompt，避免 CLI 找不到路径）
 *   --prompt <text>      直接给指令（与 --task 二选一；同时给出时 --task 优先）
 *   --target <text>      目标模式（ZCode 自续跑直到目标达成；与 --prompt/--task 互斥，CLI 限制）
 *   --resume <sess_id>   续接既有会话（保留上下文）
 *   --mode <mode>        build | edit | plan | yolo（默认 edit；无人值守建议显式指定）
 *   --cwd <path>         工作目录（默认项目根）
 *   --project <dir>      项目根（含 collab/ 的目录；默认 env ZCODE_PROJECT_DIR，再默认 cwd）
 *   --provider <p>       plan（默认，走套餐额度）| personal（个人 API Key）| <v2/config.json 里的 provider 键>
 *   --model <id>         指定模型（套餐默认 GLM-5.3；personal 模式默认个人配置里的模型）
 *   --personal-config <path>  指定个人 provider 配置（仅 --provider personal 时生效）
 *   --list-providers     列出账号内 provider/套餐可用性与模型，然后退出
 *   --attach <file>      附加文件（可重复）
 *   --tag <name>         日志/结果文件标签（默认时间戳）
 *   --timeout-min <n>    超时分钟（默认 45）
 *   --no-ledger          不写 <project>/collab/logs/zcode-runs.jsonl 用量台账
 *   --memory-bench       配合 --prompt：开启自动 Memory 提取并等待完成后再退出（需 Memory 已开启）
 *   --no-cred-fallback   关闭凭据回退（默认开启：config.json 的 Key 验活失败时回退加密凭据库）
 *
 * 产物：
 *   <project>/collab/logs/zcode-run-{tag}-{ts}.out.log      stdout（含 CLI 的 JSON 结果）
 *   <project>/collab/logs/zcode-run-{tag}-{ts}.err.log      stderr（诊断）
 *   <project>/collab/logs/zcode-run-{tag}-{ts}.result.json  解析后的 JSON 结果（sessionId/response/usage/projection）
 *   <project>/collab/logs/zcode-runs.jsonl                  每次 run 一行台账（套餐/模型/用量/上下文/耗时/退出码）
 *
 * 退出码：CLI 退出码；超时 124；参数/环境错误 1。
 * 凭证：套餐与个人 Key 都只从 ~/.zcode 读取 → 写入系统临时配置副本 → 跑完即删；
 *      脚本不打印密钥、不进日志、不入库（仓库内无任何密钥副本）。
 *
 * 凭据双保险（2026-10-01 真机事故修复，与 dsh-connect-zcode 同源）：
 *   ZCode 在 OAuth 重新登录后，把新 Key **只写进加密凭据库** `~/.zcode/v2/credentials.json`，
 *   **不回写 config.json** ⇒ config.json 里留着失效旧 Key ⇒ 派发必 401（连 CLI 自己也挂）。
 *   故：先用 config.json 的 Key **验活**；失败则从凭据库解出候选**逐把验活**，取第一把通过的。
 *   ⚠️ 验活必须校验**响应体**：网关对失效 Key 也返回 HTTP 200（body `{"code":1000,...}`）。
 *   ⚠️ 实现用 `node:https` 而非 `fetch`：实测本 runner 场景下 `fetch`（undici）后
 *      `process.exit()` 会在 Windows 触发 libuv 断言崩溃（退出码 -1073740791）。
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir, platform, userInfo } from 'node:os';
import { createDecipheriv, createHash } from 'node:crypto';
import { request as httpsRequest } from 'node:https';

/**
 * 项目根（`<root>/collab/` 所在的目录）——本工具**不再假定自己是某个项目的子目录**。
 *
 * 解析顺序（前四项与 inject-inbox.js 的既有约定一致）：
 *   1. `--project <dir>`（显式，最高优先）
 *   2. env `ZCODE_PROJECT_DIR`
 *   3. **从绝对路径的 `--task` 反推**：向上找最近的含 `collab/` 的祖先目录
 *      —— 这条是为「派发台」准备的：它按契约传**绝对** `--task` 但**不传** `--project`，
 *      且其子进程 cwd 未必是宿主项目（见 dsh-plugins/zcode-dispatch dispatch-core.mjs）。
 *   4. 当前工作目录（通用工具的合理默认：你在哪个项目里跑，就用哪个项目）
 *
 * 为什么不再是 `<脚本>/../..`：本脚本已迁至 `dsh-plugins/collab-kit/`（DSH 工具仓库），
 * 与宿主项目（如 keysion dac vue）不再有目录关系；写死推导会指向错误位置。
 */
function inferProjectFromTask(taskArg) {
  if (typeof taskArg !== 'string' || taskArg.trim() === '') return undefined;
  const abs = isAbsolute(taskArg) ? resolve(taskArg) : resolve(process.cwd(), taskArg);
  let dir = dirname(abs);
  // 向上最多 8 层找含 collab/ 的目录（正常 <root>/collab/tasks/x.md 只需 1~2 层）
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'collab'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveProjectRoot(cliValue) {
  if (typeof cliValue === 'string' && cliValue.trim() !== '') return resolve(cliValue.trim());
  const fromEnv = process.env.ZCODE_PROJECT_DIR;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv.trim());
  const fromTask = inferProjectFromTask(readArgValue('--task'));
  if (fromTask !== undefined) return fromTask;
  return resolve(process.cwd());
}
const PROJECT = resolveProjectRoot(readProjectArg());
const LOGS = process.env.ZCODE_LOG_DIR ? resolve(process.env.ZCODE_LOG_DIR) : join(PROJECT, 'collab', 'logs');
const HOME_ZCODE = join(homedir(), '.zcode');
const APP_CONFIG = join(HOME_ZCODE, 'v2', 'config.json');
const CRED_STORE = join(HOME_ZCODE, 'v2', 'credentials.json');

/** 先扫一遍 argv 取某个 `--flag <value>`（早于正式参数解析，因为路径常量要先算出来）。 */
function readArgValue(flag) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] ? a[i + 1] : undefined;
}
function readProjectArg() {
  return readArgValue('--project');
}

/* ---------- CLI 与环境（本机实测：两个 provider 配置必须同时给出） ---------- */
const CLI = process.env.ZCODE_CLI || 'F:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs';
const BUILTIN =
  process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ||
  'F:\\Program Files\\ZCode\\resources\\config\\provider\\zcode-builtin.json';
const PERSONAL_DEFAULT =
  process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE || join(HOME_ZCODE, 'v2', 'provider_config.json');

/* ---------- 参数解析 ---------- */
const argv = process.argv.slice(2);
const opt = { attach: [], mode: 'edit', timeoutMin: 45, ledger: true, provider: 'plan' };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--task') opt.task = next();
  else if (a === '--prompt' || a === '-p') opt.prompt = next();
  else if (a === '--target') opt.target = next();
  else if (a === '--resume') opt.resume = next();
  else if (a === '--mode') opt.mode = next();
  else if (a === '--project') opt.project = next(); // 项目根（已在顶部预扫描用于路径常量，这里仅为吞掉参数）
  else if (a === '--cwd') opt.cwd = next();
  else if (a === '--tag') opt.tag = next();
  else if (a === '--model') opt.model = next();
  else if (a === '--provider') opt.provider = next();
  else if (a === '--personal-config') opt.personalConfig = next();
  else if (a === '--timeout-min') opt.timeoutMin = Number(next());
  else if (a === '--attach') opt.attach.push(next());
  else if (a === '--no-ledger') opt.ledger = false;
  else if (a === '--memory-bench') opt.memoryBench = true;
  else if (a === '--no-cred-fallback') opt.credFallback = false;
  else if (a === '--list-providers') opt.listProviders = true;
  else if (a === '--help' || a === '-h') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    process.exit(0);
  } else {
    console.error(`[zcode-run] 未知参数: ${a}`);
    process.exit(1);
  }
}

/* ---------- 读取桌面端账号配置里的 provider（套餐密钥/端点/模型元数据都在这里） ---------- */
const readAppConfig = () => {
  if (!existsSync(APP_CONFIG)) return null;
  try {
    return JSON.parse(readFileSync(APP_CONFIG, 'utf8'));
  } catch {
    return null;
  }
};

const appCfg = readAppConfig();
const appProviders = appCfg?.provider ?? {};

const isPlanKey = (k) => /coding-plan|start-plan/.test(k);
const planCandidates = () => Object.entries(appProviders).filter(([k]) => isPlanKey(k));

const listProviders = () => {
  if (!appCfg) {
    console.error(`[zcode-run] 读不到 ${APP_CONFIG}`);
    process.exit(1);
  }
  console.log('id'.padEnd(34) + 'enabled  端点/模型');
  for (const [id, p] of Object.entries(appProviders)) {
    const models = p?.models ? Object.keys(p.models).join(', ') : '-';
    const reason = p?.systemDisabledReason ? ` (${p.systemDisabledReason})` : '';
    console.log(
      `${id.padEnd(34)}${String(!!p?.enabled).padEnd(10)}${p?.options?.baseURL ?? '-'} | ${models}${reason}`,
    );
  }
  console.log('\n提示：默认 --provider plan 会选第一个启用的 *coding-plan，其次 *start-plan。');
};

if (opt.listProviders) {
  listProviders();
  process.exit(0);
}

const problems = [];
if (!existsSync(CLI)) problems.push(`找不到 ZCode CLI: ${CLI}（可用 ZCODE_CLI 覆盖）`);
if (!existsSync(BUILTIN)) problems.push(`找不到内置 provider 配置: ${BUILTIN}`);
const personalPath = opt.personalConfig ? resolve(opt.personalConfig) : PERSONAL_DEFAULT;
if (opt.provider === 'personal' && !existsSync(personalPath)) {
  problems.push(`找不到个人 provider 配置: ${personalPath}`);
}
if (opt.target && (opt.prompt || opt.task)) {
  problems.push('--target 与 --prompt/--task 互斥（CLI 限制），请二选一');
}
if (!opt.target && !opt.prompt && !opt.task) problems.push('必须给出 --task / --prompt / --target 之一');
if (problems.length) {
  for (const p of problems) console.error(`[zcode-run] ${p}`);
  process.exit(1);
}

/* ---------- 凭据双保险：config.json 验活失败 → 回退加密凭据库 ----------
 * 与 dsh-connect-zcode 的 credential-store.js / credential.js 同源逻辑（本项目内联实现，
 * 避免跨仓库依赖）。设计约束与参考实现一致：
 *   · **必须验活才切换**（不验活就切可能选到同样失效的 key，比不切更糟）
 *   · **零明文日志**（只打指纹 head=xxxxxxxx*** tail=***xxxx）
 *   · **零落盘**（明文只在内存；本文件已有的临时 provider 副本机制不变）
 *   · **绝不抛**（解密失败/文件缺失/网络异常一律降级，保持既有行为）
 *   · 用 `node:https` 而非 fetch —— 实测 fetch 后 process.exit 在 Windows 会崩（见文件头注释）
 */

/** 加密值前缀与算法常量（与 zcode.cjs 一致，从 dsh-connect-zcode 移植）。 */
const ENC_PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;
const SECRET_ENV = 'ZCODE_CREDENTIAL_SECRET';
/** zhipu 平台 API Key 形态（32 hex id + "." + 16 secret；实测长度恒为 49）。 */
const API_KEY_RE = /^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/;

/** 解出解密 secret（env 优先，否则 ZCode 的 fallback 串——与 zcode.cjs 同式）。 */
function resolveCredSecret() {
  const fromEnv = process.env[SECRET_ENV]?.trim();
  if (fromEnv) return fromEnv;
  let user = 'unknown';
  try {
    user = userInfo().username;
  } catch {
    /* 取不到用户名就用 unknown（与 zcode.cjs 同式） */
  }
  return `zcode-credential-fallback:${platform()}:${homedir()}:${user}`;
}

/** 解密单个 enc:v1 值。失败返回 null（绝不抛、绝不打印值）。 */
function decryptCredentialValue(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return null;
    const parts = value.slice(ENC_PREFIX.length).split('.');
    if (parts.length !== 3) return null;
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN || data.length === 0) return null;
    const key = createHash('sha256').update(resolveCredSecret()).digest();
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 脱敏指纹（仅供日志/诊断，绝不还原 key）。 */
function keyFingerprint(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length < 12) return '(invalid)';
  return `head=${apiKey.slice(0, 8)}*** tail=***${apiKey.slice(-4)}`;
}

/**
 * 从加密凭据库读出全部 coding-plan api-key 候选。
 * 键形如 `account-provider:coding-plan:account:<planId>:account:<accountId>:api-key`（7 段、两个 account:）。
 * 解密后须匹配 API Key 形态；返回按 id 字典序（稳定顺序，便于逐把验活）。
 * @param {(msg: string) => void} [diag]
 * @returns {Array<{ id: string, apiKey: string }>} 失败 = 空数组
 */
function readStoredApiKeys(diag = () => {}) {
  try {
    if (!existsSync(CRED_STORE)) {
      diag(`凭据库不存在：${CRED_STORE}`);
      return [];
    }
    const raw = JSON.parse(readFileSync(CRED_STORE, 'utf8'));
    if (raw === null || typeof raw !== 'object') return [];
    const out = [];
    let matched = 0;
    let decrypted = 0;
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith('account-provider:coding-plan:') || !k.endsWith(':api-key')) continue;
      matched += 1;
      const plain = decryptCredentialValue(v);
      if (typeof plain !== 'string' || !API_KEY_RE.test(plain)) continue;
      decrypted += 1;
      const segs = k.split(':');
      const planId = segs.length >= 4 && segs[2] === 'account' ? segs[3] : 'unknown';
      out.push({ id: planId, apiKey: plain });
    }
    /* 计数诊断（参考实现踩过的坑）：区分"库里没 key"与"形态变了被滤光"，
     * 否则回退失败时毫无线索。 */
    diag(`凭据库条目 ${Object.keys(raw).length} 条，其中 coding-plan api-key ${matched} 条，形态校验通过 ${decrypted} 条`);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } catch (e) {
    diag(`凭据库读取失败：${e?.message ?? e}`);
    return [];
  }
}

/** 用 node:https 发 GET 并解析 JSON（不用 fetch：见文件头 libuv 崩溃说明）。 */
function httpsGetJson(urlStr, headers, timeoutMs = 8000) {
  return new Promise((resolvePromise) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolvePromise(v);
      }
    };
    try {
      const u = new URL(urlStr);
      const req = httpsRequest(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          method: 'GET',
          headers,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => finish({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', () => finish(null));
        },
      );
      req.setTimeout(timeoutMs, () => {
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        finish(null);
      });
      req.on('error', () => finish(null));
      req.end();
    } catch {
      finish(null);
    }
  });
}

/**
 * 验活一把 Key。**必须校验响应体**：bigmodel 网关对失效 Key 的 `GET /v1/models`
 * 也返回 HTTP 200，body 却是 `{"code":1000,"msg":"身份验证失败。","success":false}`。
 * 三者同时满足才算通过：ok → success!==false → code===200 → data 非空。
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function validateApiKey(apiKey, baseURL, timeoutMs = 8000) {
  if (typeof apiKey !== 'string' || !apiKey) return { ok: false, reason: 'key 为空' };
  const base = String(baseURL ?? '').replace(/\/+$/, '');
  if (!base) return { ok: false, reason: 'baseURL 为空' };
  const res = await httpsGetJson(`${base}/v1/models`, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, timeoutMs);
  if (!res) return { ok: false, reason: '网络异常/超时' };
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  let body;
  try {
    body = JSON.parse(res.text);
  } catch {
    return { ok: false, reason: '响应非 JSON' };
  }
  if (body === null || typeof body !== 'object') return { ok: false, reason: '响应非对象' };
  if (body.success === false) return { ok: false, reason: `body: code=${body.code ?? '?'} ${body.msg ?? '认证失败'}` };
  if (body.code !== undefined && body.code !== 200) return { ok: false, reason: `body: code=${body.code}` };
  if (!Array.isArray(body.data) || body.data.length === 0) return { ok: false, reason: 'data 为空' };
  return { ok: true, reason: `${body.data.length} 个模型` };
}

/**
 * 解析可用凭据：config.json 的 Key 优先；**验活失败**才回退到加密凭据库
 * （逐把验活，取第一把通过的）。任何失败都保持 config.json 原值（不引入新失败面）。
 * @param {string} configKey  config.json 里的 apiKey
 * @param {string} baseURL
 * @param {{ enabled?: boolean, onDiagnostic?: (m: string) => void }} [io]
 * @returns {Promise<{ apiKey: string, source: 'config'|'store', fingerprint: string }>}
 */
async function resolvePlanApiKey(configKey, baseURL, io = {}) {
  const diag = typeof io.onDiagnostic === 'function' ? io.onDiagnostic : () => {};
  const fallback = { apiKey: configKey, source: 'config', fingerprint: keyFingerprint(configKey) };
  if (io.enabled === false) return fallback; // --no-cred-fallback

  const base = await validateApiKey(configKey, baseURL);
  if (base.ok) return fallback; // config.json 有效 ⇒ 不动（绝大多数情况）

  diag(`config.json 的 Key 验活失败（${base.reason}）⇒ 尝试回退到加密凭据库`);
  const candidates = readStoredApiKeys(diag);
  if (candidates.length === 0) {
    diag('凭据库无可用候选 ⇒ 沿用 config.json 原值（派发仍会 401，请跑 sync-key-to-config.mjs）');
    return fallback;
  }
  for (const cand of candidates) {
    const r = await validateApiKey(cand.apiKey, baseURL);
    if (r.ok) {
      diag(`✅ 回退成功：account=${cand.id} ${keyFingerprint(cand.apiKey)}（${r.reason}）`);
      return { apiKey: cand.apiKey, source: 'store', fingerprint: keyFingerprint(cand.apiKey) };
    }
    diag(`   候选 ${cand.id} ${keyFingerprint(cand.apiKey)} → ❌ ${r.reason}`);
  }
  diag(`凭据库 ${candidates.length} 个候选均验活失败 ⇒ 沿用 config.json 原值`);
  return fallback;
}

/* ---------- 解析本次使用的 provider 与模型 ---------- */
let providerId = null; // 用于展示；null 表示直接用个人配置
let providerRule = null; // 若需注入套餐 provider，这里是 providerRules 条目
let providerModels = []; // [{ id, contextWindow, maxOutput }]
let providerLabel = 'personal';

if (opt.provider !== 'personal') {
  if (!appCfg) {
    console.error(`[zcode-run] --provider ${opt.provider} 需要读取 ${APP_CONFIG}（桌面端账号配置）`);
    process.exit(1);
  }
  let key = opt.provider;
  if (key === 'plan') {
    const ranked = planCandidates().sort(([a, pa], [b, pb]) => {
      const score = (k, p) => (p?.enabled ? 2 : 0) + (/coding-plan/.test(k) ? 1 : 0);
      return score(b, pb) - score(a, pa);
    });
    const pick = ranked.find(([, p]) => p?.enabled);
    if (!pick) {
      console.error('[zcode-run] 账号内没有已启用的套餐 provider（--list-providers 查看原因）');
      process.exit(1);
    }
    key = pick[0];
  }
  const entry = appProviders[key];
  if (!entry) {
    console.error(`[zcode-run] provider 不存在: ${key}（可用 --list-providers 查看）`);
    process.exit(1);
  }
  if (!entry.enabled) {
    console.error(
      `[zcode-run] provider ${key} 未启用（${entry.systemDisabledReason ?? '未知原因'}），拒绝派发以免静默改用其他通道`,
    );
    process.exit(1);
  }
  if (!entry?.options?.apiKey || !entry?.options?.baseURL) {
    console.error(`[zcode-run] provider ${key} 缺少 apiKey/baseURL`);
    process.exit(1);
  }
  /* 凭据双保险：先验活 config.json 的 Key，失败则回退加密凭据库（逐把验活取第一把通过的）。
   * 诊断只打指纹（head=xxxxxxxx*** tail=***xxxx），绝不打印 Key 原文。 */
  const cred = await resolvePlanApiKey(entry.options.apiKey, entry.options.baseURL, {
    enabled: opt.credFallback !== false,
    onDiagnostic: (m) => console.log(`[zcode-run] [cred] ${m}`),
  });
  if (cred.source === 'store') {
    console.log(`[zcode-run] [cred] 本次使用凭据库中的 Key（${cred.fingerprint}）；config.json 里的旧 Key 已失效`);
  }
  providerId = key;
  providerLabel = entry.name ?? key;
  providerModels = Object.entries(entry.models ?? {}).map(([id, m]) => ({
    id,
    contextWindow: m?.limit?.context,
    maxOutput: m?.limit?.output,
  }));
  if (opt.model && providerModels.length && !providerModels.some((m) => m.id === opt.model)) {
    console.warn(
      `[zcode-run] 警告：${opt.model} 不在 ${key} 的模型表（${providerModels.map((m) => m.id).join(', ')}）中，仍按指定值请求`,
    );
  }
  const modelIds = opt.model ? [opt.model] : providerModels.map((m) => m.id);
  providerRule = {
    providerId: `plan:${key.replace(/^builtin:/, '')}`,
    providerName: `${entry.name ?? key}（ZCode 套餐）`,
    config: {
      group: 'standard-personal',
      access: { type: 'api-key', apiKey: cred.apiKey }, // ★ 用验活后的 Key（可能来自凭据库回退）；只在内存→临时文件，跑完即删
      api: { type: entry.kind === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions', baseUrl: entry.options.baseURL },
      personalModelIds: modelIds,
      modelOrder: modelIds,
    },
  };
}

/* ---------- 组 prompt ---------- */
let prompt = opt.prompt ?? '';
let taskPath = '';
if (opt.task) {
  taskPath = isAbsolute(opt.task) ? opt.task : resolve(PROJECT, opt.task);
  if (!existsSync(taskPath)) {
    console.error(`[zcode-run] 任务包不存在: ${taskPath}`);
    process.exit(1);
  }
  const body = readFileSync(taskPath, 'utf8');
  prompt =
    `请严格按下面的任务包执行（任务包文件：${taskPath}）。\n` +
    '你是本项目唯一的业务代码写入方；任务包里的「禁止」与「交付物」是硬约束。\n' +
    '完成后必须把交付文档写到任务包指定的路径，并在最终回复里给出：交付清单 / 可复跑命令 / 原始输出 / 未决问题。\n\n' +
    '===== 任务包开始 =====\n' +
    body +
    '\n===== 任务包结束 =====';
}

const cwd = resolve(PROJECT, opt.cwd ?? '.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tag = opt.tag || stamp;
mkdirSync(LOGS, { recursive: true });
const base = join(LOGS, `zcode-run-${tag}-${stamp}`);
const outLog = `${base}.out.log`;
const errLog = `${base}.err.log`;
const resultFile = `${base}.result.json`;

/* ---------- 生成临时个人 provider 配置（套餐注入 / --model 改写；原配置不动，副本跑完即删） ---------- */
let modelPath = personalPath;
let tempDir = '';
const needTempConfig = !!providerRule || !!opt.model;
if (needTempConfig) {
  try {
    let cfg;
    if (providerRule) {
      cfg = {
        schemaVersion: 1,
        config: {
          providerConfigRules: { providerRules: [providerRule] },
          modelConfigRules: {
            providerModelRules: (opt.model ? [opt.model] : providerModels.map((m) => m.id)).map((id) => {
              const meta = providerModels.find((m) => m.id === id);
              return {
                modelId: id,
                providerId: providerRule.providerId,
                config: {
                  enabled: true,
                  ...(meta?.contextWindow ? { properties: { contextWindow: meta.contextWindow } } : {}),
                  ...(meta?.maxOutput ? { optionSpecs: { maxOutputTokens: { max: meta.maxOutput } } } : {}),
                },
              };
            }),
            manualProviderModelRules: [],
          },
        },
      };
    } else {
      const src = JSON.parse(readFileSync(personalPath, 'utf8'));
      let hits = 0;
      const rewrite = (o) => {
        if (Array.isArray(o)) return o.map(rewrite);
        if (o && typeof o === 'object') {
          const out = {};
          for (const [k, v] of Object.entries(o)) {
            if (k === 'modelId' && typeof v === 'string') { out[k] = opt.model; hits += 1; }
            else if ((k === 'personalModelIds' || k === 'modelOrder') && Array.isArray(v)) { out[k] = v.map(() => opt.model); hits += 1; }
            else out[k] = rewrite(v);
          }
          return out;
        }
        return o;
      };
      cfg = rewrite(src);
      if (!hits) {
        console.error('[zcode-run] --model 未命中任何 modelId/personalModelIds/modelOrder 字段，拒绝继续（防静默用错模型）');
        process.exit(1);
      }
    }
    tempDir = join(tmpdir(), `zcode-cfg-${process.pid}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    modelPath = join(tempDir, 'provider_config.json');
    writeFileSync(modelPath, JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error(`[zcode-run] 临时 provider 配置生成失败: ${err.message}`);
    process.exit(1);
  }
}

/* ---------- 套餐额度撞顶识别（T20 实证，2026-10-01） ----------
 * Coding Plan 有 5 小时滚动窗口上限。撞顶时 CLI 以 exit 1 结束，stderr 携带：
 *   statusCode: 429 / 'anthropic-ratelimit-unified-status': 'rejected'
 *   { code: '1308', message: '[1308][已达到 5 小时的使用上限。您的限额将在 <时间> 重置。]' }
 *   retry-after: '<秒>'
 * 识别它是为了把「额度耗尽」与「任务真失败」分开 —— 前者不该重试，也不该怪任务包。 */
function detectRateLimit(text) {
  if (!text) return null;
  const hit =
    /\b429\b/.test(text) ||
    /anthropic-ratelimit-unified-status['"]?\s*:\s*['"]rejected/i.test(text) ||
    /reatt?e?[_-]?limit|rate_limit_error/i.test(text) ||
    /已达到\s*5\s*小时的使用上限/.test(text);
  if (!hit) return null;
  const codeMatch = text.match(/code['"]?\s*:\s*['"]?(\d{4})/);
  const retryMatch = text.match(/retry-after['"]?\s*:\s*['"]?(\d+)/i);
  const resetMatch = text.match(/限额将在\s*([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})\s*重置/);
  return {
    code: codeMatch ? codeMatch[1] : null,
    retryAfterSec: retryMatch ? Number(retryMatch[1]) : null,
    resetAt: resetMatch ? resetMatch[1] : null,
  };
}

/* ---------- ZCode 派发总开关（跨会话真值来源；契约见 collab/PROTOCOL.md） ----------
 * 任何会话（DSH / ZCode / 桥）派发前都必须过这一关：文件里 enabled:false 即拒绝。
 * 真值来源是磁盘文件而非内存开关 —— 跨进程只能靠文件。
 * 路径优先取 env `ZCODE_SWITCH_FILE`（跨项目统一开关），否则 <project>/collab/ 下的默认位置。 */
const SWITCH_FILE =
  process.env.ZCODE_SWITCH_FILE && process.env.ZCODE_SWITCH_FILE.trim() !== ''
    ? resolve(process.env.ZCODE_SWITCH_FILE.trim())
    : join(PROJECT, 'collab', 'zcode-dispatch.switch.json');
function readDispatchSwitch() {
  try {
    if (!existsSync(SWITCH_FILE)) return { enabled: true, source: 'default(无文件=开启)' };
    const raw = JSON.parse(readFileSync(SWITCH_FILE, 'utf8'));
    return { enabled: raw.enabled !== false, updatedAt: raw.updatedAt, updatedBy: raw.updatedBy, note: raw.note };
  } catch (e) {
    return { enabled: true, source: `default(读取失败: ${e.message})` };
  }
}
{
  const sw = readDispatchSwitch();
  if (!sw.enabled) {
    console.error('[zcode-run] ⛔ ZCode 派发总开关为「关闭」，拒绝派发（未启动任何进程、未消耗任何额度）。');
    console.error(`[zcode-run] 开关文件: ${SWITCH_FILE}`);
    if (sw.updatedBy || sw.updatedAt) console.error(`[zcode-run] 最后修改: ${sw.updatedBy ?? '?'} @ ${sw.updatedAt ?? '?'}`);
    if (sw.note) console.error(`[zcode-run] 备注: ${sw.note}`);
    console.error('[zcode-run] 需要恢复派发时: node scripts/collab/zcode-switch.mjs on');
    process.exit(3); // 3 = 因总开关关闭而拒绝（与参数错误 1、超时 124 区分）
  }
}

/* ---------- 执行 ---------- */
const args = ['-p', prompt];
if (opt.target) {
  args.length = 0;
  args.push('--target', opt.target);
}
if (opt.resume) args.push('--resume', opt.resume);
if (opt.memoryBench) {
  if (opt.target || !opt.prompt) {
    console.error('[zcode-run] --memory-bench 仅适用于 --prompt（CLI 限制：需配合 --prompt 使用）');
    process.exit(1);
  }
  args.push('--memory-bench');
}
for (const f of opt.attach) args.push('--attach', isAbsolute(f) ? f : resolve(PROJECT, f));
args.push('--cwd', cwd, '--mode', opt.mode, '--json', '--no-color');

const env = {
  ...process.env,
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: BUILTIN,
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: modelPath,
};

console.log(`[zcode-run] tag=${tag} mode=${opt.mode} cwd=${cwd}`);
console.log(
  `[zcode-run] provider=${providerId ?? 'personal'}${opt.model ? ` model=${opt.model}` : providerModels.length ? ` models=${providerModels.map((m) => m.id).join('/')}` : ''}` +
    `${providerLabel !== 'personal' && providerId ? ` (${providerLabel})` : ''}`,
);
if (taskPath) console.log(`[zcode-run] task=${taskPath}`);
console.log(`[zcode-run] cli=${CLI}`);
if (opt.resume) console.log(`[zcode-run] resume=${opt.resume}`);

const startedAt = new Date();
const started = Date.now();
const r = spawnSync(process.execPath, [CLI, ...args], {
  cwd,
  env,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: Math.max(1, opt.timeoutMin) * 60 * 1000,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
const stdout = r.stdout ?? '';
const stderr = r.stderr ?? '';
writeFileSync(outLog, stdout);
writeFileSync(errLog, stderr);
if (tempDir) {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* 临时配置清理失败不掩盖结果 */ }
}

/* ---------- 解析结果（stdout 里最后一个顶层 JSON 对象） ---------- */
let result = null;
const trimmed = stdout.trim();
if (trimmed) {
  const start = trimmed.lastIndexOf('\n{');
  for (const candidate of [start >= 0 ? trimmed.slice(start + 1) : trimmed, trimmed]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        result = parsed;
        break;
      }
    } catch {
      /* 继续尝试 */
    }
  }
}
if (result) writeFileSync(resultFile, JSON.stringify(result, null, 2));

/* ---------- 从 CLI 日志按 traceId 反查实际 provider/model/端点（结果 JSON 不含这些字段） ---------- */
const actual = (() => {
  const fallback = { provider: providerId ?? 'personal', model: opt.model ?? null, baseURL: null };
  if (!result?.traceId) return fallback;
  const localDay = (d) => {
    const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return x.toISOString().slice(0, 10);
  };
  const days = new Set([localDay(startedAt), localDay(new Date())]);
  for (const day of days) {
    const logFile = join(HOME_ZCODE, 'cli', 'log', `zcode-${day}.jsonl`);
    if (!existsSync(logFile)) continue;
    try {
      const text = readFileSync(logFile, 'utf8');
      const idx = text.indexOf(`"traceId":"${result.traceId}"`);
      if (idx < 0) continue;
      const seg = text.slice(idx, idx + 40000);
      return {
        provider: /"providerId":"([^"]+)"/.exec(seg)?.[1] ?? fallback.provider,
        model: /"modelId":"([^"]+)"/.exec(seg)?.[1] ?? fallback.model,
        baseURL: /"baseURL":"([^"]+)"/.exec(seg)?.[1] ?? null,
      };
    } catch { /* 日志读取失败不影响主流程 */ }
  }
  return fallback;
})();

const code = timedOut ? 124 : (r.status ?? 1);
const usage = result?.usage ?? {};
const projection = result?.projection ?? {};
const ctxPct =
  projection.contextUsed && projection.contextWindow
    ? ` (${((projection.contextUsed / projection.contextWindow) * 100).toFixed(1)}% of ${projection.contextWindow})`
    : '';

console.log(
  `[zcode-run] done exit=${code}${timedOut ? ' (超时)' : ''} elapsed=${elapsed}s` +
    (r.signal ? ` signal=${r.signal}` : '') +
    (result?.sessionId ? ` session=${result.sessionId}` : '') +
    (actual.provider ? ` provider=${actual.provider}` : '') +
    (actual.model ? ` model=${actual.model}` : '') +
    (result?.response ? ` responseChars=${String(result.response).length}` : ''),
);
/* 静默死亡诊断（Z6-01 实证：CLI 无任何输出即 exit 1，事后无法归因）：
   无 stdout/stderr 且非 0 退出 → 明确标注，并给出可查线索（进程信号、CLI 侧日志、内存） */
if (!stdout.trim() && !stderr.trim() && code !== 0) {
  console.error(
    `[zcode-run] 诊断：CLI 静默退出（stdout/stderr 均为空，exit=${code}${r.signal ? `, signal=${r.signal}` : ''}）。` +
      '常见原因：上下文/内存打满、进程被外部终止、启动期崩溃。' +
      '可查：~/.zcode/cli/log/zcode-<date>.jsonl 尾部事件（turn.failed / shutdown.completed）与 Windows 事件日志。',
  );
}
if (actual.baseURL) console.log(`[zcode-run] endpoint=${actual.baseURL}`);
/* 套餐额度撞顶诊断（T20 实证，2026-10-01）：
   Coding Plan 有 5 小时滚动窗口上限，撞顶时 CLI 以 exit 1 结束，stderr 里带
   HTTP 429 + `[1308] 已达到 5 小时的使用上限` + `retry-after: <秒>`。
   若不识别，调用方无法区分「任务真失败」与「额度耗尽」，会误判为代码问题并盲目重试。 */
const rateLimit = detectRateLimit(stderr);
if (rateLimit) {
  const waitHint = rateLimit.retryAfterSec
    ? `约 ${Math.ceil(rateLimit.retryAfterSec / 60)} 分钟后（retry-after=${rateLimit.retryAfterSec}s）`
    : '窗口重置后';
  const resetHint = rateLimit.resetAt ? `（${rateLimit.resetAt} 重置）` : '';
  console.error(
    `[zcode-run] 诊断：套餐额度撞顶（HTTP 429${rateLimit.code ? ` code=${rateLimit.code}` : ''}）——` +
      `Coding Plan 5 小时滚动窗口已满，${waitHint}${resetHint}可重试。` +
      '这**不是**任务包或代码问题；请勿立即重试（会继续消耗并失败）。' +
      `原始信息见 ${errLog}`,
  );
}
if (result?.usage) {
  console.log(
    `[zcode-run] usage requests=${usage.modelRequestCount ?? '-'} in=${usage.inputTokens ?? '-'} out=${usage.outputTokens ?? '-'} cacheRead=${usage.cacheReadTokens ?? '-'}`,
  );
}
if (projection.contextUsed) {
  console.log(`[zcode-run] context used=${projection.contextUsed}${ctxPct} turnCount=${projection.turnCount ?? '-'}`);
}
console.log(`[zcode-run] out=${outLog}`);
console.log(`[zcode-run] err=${errLog}`);
if (result) console.log(`[zcode-run] result=${resultFile}`);
if (timedOut) console.error(`[zcode-run] 超时（${opt.timeoutMin}min）已终止；stderr 尾部见 ${errLog}`);

/* ---------- 用量台账（每次 run 一行，便于统计与排期） ---------- */
if (opt.ledger) {
  try {
    appendFileSync(
      join(LOGS, 'zcode-runs.jsonl'),
      JSON.stringify({
        at: startedAt.toISOString(),
        tag,
        task: taskPath ? taskPath.replace(`${PROJECT}\\`, '').replace(/\\/g, '/') : null,
        mode: opt.mode,
        kind: opt.target ? 'target' : opt.resume ? 'resume' : 'prompt',
        billing: providerId ? 'zcode-plan' : 'personal-api-key',
        provider: actual.provider,
        endpoint: actual.baseURL,
        model: actual.model,
        sessionId: result?.sessionId ?? null,
        traceId: result?.traceId ?? null,
        exit: code,
        timedOut,
        signal: r.signal ?? null,
        silentExit: !stdout.trim() && !stderr.trim() && code !== 0,
        rateLimited: rateLimit ? true : null,
        retryAfterSec: rateLimit?.retryAfterSec ?? null,
        elapsedSec: Number(elapsed),
        requests: usage.modelRequestCount ?? null,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cacheReadTokens: usage.cacheReadTokens ?? null,
        contextUsed: projection.contextUsed ?? null,
        contextWindow: projection.contextWindow ?? null,
        responseChars: result?.response ? String(result.response).length : null,
      }) + '\n',
    );
  } catch { /* 台账写入失败不影响主流程 */ }
}

process.exit(code);
