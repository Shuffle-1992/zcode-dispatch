---
round: Z12
seq: "01"
from: dsh
to: zcode
type: task
status: open
created: 2026-09-30T14:45:00+08:00
---

# Z12 任务包：插件侧接入「ZCode 派发总开关」+ 让其他会话可查可控

> 用户原话：「加一个开关吧，可以控制是否使用 Zcode 子代理派发任务。并且如何让其他会话能知道这个功能，并知道开关状态？」
> **契约已由 DSH 定好并落地（宿主仓库侧）**，本单只做**插件侧**接入 + 展示 + 工具面。

## 一、既有契约（已在跑，勿另起炉灶）

| 项 | 值 |
|---|---|
| 真值文件 | `<HOST_REPO>\collab\zcode-dispatch.switch.json` → `{enabled, updatedAt, updatedBy, note, contract}` |
| 语义 | `enabled:false` = 拒绝对 ZCode 的任何派发；**文件缺失/损坏 = 开启**（不误锁） |
| 已生效的入口 | ①`scripts/collab/zcode-run.mjs`（关闭时 exit 3，不启动进程）②`F:\My Code\dsh-plugins\tools\bridge.mjs`（关闭时 exit 3，拒绝投放） |
| 查询/切换 CLI | `node <宿主项目>\scripts\collab\zcode-switch.mjs status|on|off [--by …] [--note "…"]`（status 退出码 0=开、2=关） |
| 文档 | `宿主项目\collab\PROTOCOL.md` §7（契约全文）+ `AGENTS.md` §九（各会话开工即读） |

## 二、本单要做的四件

### 1. 宿主读取开关（带缓存）
- 新增 plugin config 字段 **`switchPath`**（string，默认 = 上面的真值文件绝对路径；写进 `cordis.patch.yml` 的 config 与 `index.js` 的 Config schema，**保留既有 5 个字段不变**）。
- `wire.host.mjs`（或 index.js，二选一但只一处）实现 `readSwitch()`：读文件 → `{enabled, updatedAt, updatedBy, note, source}`；**mtime 缓存**（同 mtime 不重复读盘）；**永不抛**（异常 → `enabled:true` + `source:'default(读取失败)'`）。

### 2. dispatch 动作强制校验 + 暴露状态
- `createActionHandler` 的 `dispatch` 分支：开关关闭 → 直接返回 `{ ok:false, error:'ZCode 派发总开关已关闭（collab/zcode-dispatch.switch.json）', switch }`，**不创建 job、不 spawn**。
- `snapshot()` 增加 `switch` 字段（同上结构），供 UI 与工具读。
- 新增动作 **`switch`**：`{ action:'switch', enabled:true|false, by?, note? }` → 原子写文件（临时文件 + rename，字段与 CLI 完全一致），返回 `{ok:true, switch}`；写失败返回 `{ok:false,error}`。**写文件的代码只允许这一处**（UI 与工具共用）。

### 3. 面板开关（UI）
- 标题栏加一个开关/徽标：**「派发：开 / 关」**（新 locale key：`switchOn` / `switchOff` / `switchTitle` / `switchHintOffline`）。
  - 远端可用（`conn==='live'`）→ 点击调用 `wire.switchSet(enabled)`，成功后刷新快照；
  - 远端不可用 → 显示为**只读**状态 + tooltip/副标题提示：**「未连接宿主：请在终端执行 zcode-switch.mjs 切换」**（诚实，不谎报可控）；
- `wire.client.mjs` 增加 `switchSet`（与既有 `channelSet` 同形：信封 `{ok,value}` 归一化）；
- 关闭态时，派发按钮禁用并显示原因（`switchOffBlocked`）。

### 4. 其他会话怎么知道（工具面）
- agent 工具的**描述**里写清能力并带上当前状态，例如：
  `把任务派发给 ZCode 子代理（当前：已开启/已关闭）。action=status 查状态；action=switch 切换 enabled=true|false；action=dispatch 派发（关闭时会被拒绝）。`
  （描述可在注册时按 `readSwitch()` 生成一次；状态以 `action:status` 的实时返回为准。）
- 工具 schema 的 `action` 枚举加入 `status`（如尚未有）与 `switch`，并加 `enabled` 布尔参数说明。
- README 增加一节「派发总开关」：真值文件、CLI、三入口、UI 行为、未连接时的降级说明。

## 三、硬约束

- ❌ **不许破坏启动路径**：客户端 `inject` 保持 `['slots','remote']`（绝不出现自家 `remote.*`）；`apply` 的 try/catch 不许拆；宿主注册失败仍要降级不抛。
- ❌ 不改 `core/*` 语义（开关校验属 wire/动作层）；❌ 不改 宿主仓库任何文件（本单只动 `F:\My Code\dsh-plugins\zcode-dispatch\**`，README/pitfalls 可写）。
- ❌ 不安装、不写 `$DSH_HOME`、不 npm 依赖、不 git。
- ✅ 文案走 locale（zh/en 同步）；主题令牌纪律不变；每步落盘；不通读大文件。
- ✅ 开关读写**只能有一处实现**（避免文件格式漂移）。

## 四、自检（贴原始输出）

1. `node --check index.js client.js wire.host.mjs wire.client.mjs`
2. `Z2_ALLOW_PROFILE_WRITE=1 node "F:\My Code\dsh-plugins\tools\verify-plugin.mjs"` → **20/20**
3. `cd zcode-dispatch && node test/core.test.mjs`、`node test/channel-retry.test.mjs` 不回归
4. **新增本地冒烟（跑完即删）**：用 `%TEMP%` 里的临时开关文件（**别动真值文件**）验证：
   - 关闭 → `handleAction('dispatch', …)` 返回 `{ok:false}` 且**未创建 job**（job 数不变、无 spawn 调用）；
   - 开启 → dispatch 正常进入 queued/running；
   - `handleAction('switch', {enabled:false})` 写文件后，重新读取得到 `enabled:false`，且字段与 CLI 写出的格式一致（键名/顺序）；
   - `snapshot().switch` 与文件一致；文件损坏/缺失 → 视为开启且不抛；
   - `wire.client` 的 `switchSet` 在远端缺席时不抛（走降级）。
5. 明确写一句：面板开关的真实点击需用户刷新页面确认。

## 五、交付

`tasks/Z12-delivery.md`：改动清单（逐条对着上面四件）/ 复现命令 + 原始输出 / 未确定项。回复同样简短四段。
