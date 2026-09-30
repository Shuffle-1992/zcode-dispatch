# ZCode 派发台插件 —— 创造模式交接单

> 本文件给**创造模式（creator preset）会话**用。标准模式的 DSH 会话没有 `plugin_manager` / `cordis_inspect_*`，也没有插件开发技能，因此**只能写出代码、不能安装验证**。
> 生成时间：2026-09-30 05:16（+08）；**06:00 更新**：Z1/Z2 已验收通过，Z3（套餐额度）在跑。作者：标准模式会话（DSH）。

## 零、当前进度（06:00）

| 单 | 内容 | 状态 |
|---|---|---|
| Z1 | 派发核心（dispatcher/quota/CLI/test） | ✅ **passed**（自测 11/11、DSH 反向探针 7/7、真实套餐派发 7.6s） |
| Z2 | 插件包（manifest/patch/Host/UI/wire/locale/icon/README） | ✅ **passed**（DSH 探针 18/18、实现方自验 75/75） |
| Z3 | 套餐额度接入（app-server RPC） | ✅ **passed**：RPC 层打通（16/16+11/11 测试、真调用 exit 0、零进程泄露）；**"剩余额度"经三类证据判定为 CLI 面不可得**（方法表全枚举 / `-32601` / `usage/stats` 语义=本地已用）。插件显示本地 5h 与引擎本周用量 |
| Z4 | 槽位/主题令牌定证（扫 DSH 客户端包） | ✅ **passed**：`shell.overlay` **存在且为官方浮层标准位**（list 型 / `scope:"root"` / 注册须带 `id`；DSH 独立扫描 3 命中）；`client.js` 原 19 令牌 **16 个不存在已全换**，复检 0 缺失 |
| Z5 | 安装前收尾（文案/额度并入/清产物/时效提示） | ✅ **passed**：五项全绿；`quota --json` = 既有 7 字段 + `local` + `planQuota`；`files` 不含运行期数据 |
| — | 安装 + 槽位接线 + 页面验证 | ⛔ **只能由创造模式会话完成**（本文件第二节） |

### 安装前你应该知道的最终状态（07:18 更新）

- 测试基线：`core 11/11`、`quota-rpc 16/16`、`z4-token-check 0 缺失`、`z2-verify 75/75`、DSH 独立探针 `18/18`。
- 唯一未接：**planQuota 真实数据进 UI**（`wire.host.mjs` 的 push 目前只有 `{snapshot, quota}`）→ 接线时决定是否加（建议低频刷新，每次起停引擎 ≈1.8s）。


### 接线时顺手做（Z3/Z4 的 P3）

- 额度卡片文案区分：**"本地用量"**（台账 5h 滚动 / 引擎本周）vs **"套餐剩余：未接入（以 ZCode 客户端为准）"**；不要把引擎本地用量写成"套餐已用"。
- `zcode-dispatch/test/z2-verify.output.txt`（输出物）建议移入 `.data/` 或删除。
- 槽位名已由静态证据确认（客户端 `0.2.0-rc.2` 代），但**建议仍用 `Slots.listSubTree` 现场复核一次**；注册 `id` 已改为 `zcode-dispatch.console`。
- 浮层 `order:20` 与官方 5 个浮层占位的观感共存待页面确认。




## 一、现状（标准模式已完成的部分）

| 项 | 路径 | 状态 |
|---|---|---|
| 插件包（cordis bundle） | `F:\My Code\dsh-plugins\zcode-dispatch\` | Z1 核心（dispatcher/quota/CLI/test）✅；Z2 插件半边（host/client/manifest/locale）见 `tasks/Z2-01-task.md` |
| 派发器（被插件调用） | `<HOST_REPO>\scripts\collab\zcode-run.mjs` | ✅ 已实测：套餐通道默认、`--model`、台账、`--memory-bench` |
| 插件开发参考资料（从 app.asar 抽出的官方技能） | `F:\My Code\dsh-plugins\refs\` | ✅ SKILL.md + 6 篇 references + 2 套 templates |
| 任务包 | `F:\My Code\dsh-plugins\tasks\Z1-01-task.md`、`Z2-01-task.md` | ✅ |

## 二、创造模式会话要做的事（按序）

1. **看现场**
   - `plugin_manager` → `list_bundles` / `list_plugins`（确认当前 profile `desktop` 已装了什么）
   - 读 `F:\My Code\dsh-plugins\refs\SKILL.md` 与 `references/ui-plugin.md`（技能本身在创造模式里也有，直接 `skill` 调用即可）

2. **接线（本单唯一真正的空白）**
   - `cordis_inspect_query` → `Slots` / `Slots.listSubTree`：确认悬浮窗槽位。**首选 `shell.overlay`**，找不到就用 `conversation.composer.dock` 或其它已分配空间的槽位；把结果写进 `client.js` 顶部的 `SLOT` 常量（只改这一行 + 该槽位的 props 用法）
   - `cordis_inspect_query` → `Service` / `Event`：找**客户端可调用的 Host 入口**（例如 session command + `ctx.remote.commands.execute()`）。把 `wire.host.mjs` / `wire.client.mjs` 里的 TODO 注释块替换为真实实现
   - `cordis_inspect_query` → `Theme`：核对 `client.js` 里 `TOKENS` 常量用的 `--dsw-alias-*` 令牌名是否真实存在

3. **安装**
   - `plugin_manager` → `install_bundle`，`target` = `F:\My Code\dsh-plugins\zcode-dispatch`（绝对路径）
   - **读返回的 `application` 与 `warnings`**（不是看日志）：`applied` 才算生效；`restart-required` / `failed` / `overridden` 要分别处置
   - 若报 pending build scripts，**先问用户**再传 `approvedBuilds`

4. **验证**
   - `cordis_inspect_query` → 确认新行已挂（`Config.listConfigs` / 插槽注册）
   - 页面上应出现右下角悬浮窗（可拖动/折叠/最小化），四个分区：派发栏 / 进程列表 / 用量卡片 / 单写者状态
   - 用 agent 工具 `zcode_dispatch` 跑 `action: list`，与 UI 显示应一致（`references/user-actions.md` 的双调用方一致性）
   - 派发一条真任务验证端到端：`action: dispatch`，`kind: prompt`，`model: GLM-5.3-Flash`，内容 `只回答 OK` → UI 应出现 running→done，用量卡片 5h 窗口计数 +1
   - 浅色/深色主题各看一眼；控制台不得有 `slot entry crashed`
   - 跑完恢复动过的任何设置/状态

5. **回收**
   - 把发现的槽位/服务名回写进 `README.md` 的「接线结论」小节，便于下次升级

## 三、注意事项

- 插件包**不要**手改 `$DSH_HOME`（`C:\Users\Administrator\.dsh`）下的 profile 文件；一律用 `plugin_manager`。
- 替换已安装包需要重启才加载新 JS（新装 bundle 可走 HMR）。
- 免费窗口：ZCode 的 `GLM-5.3-Flash` 在 2026-09-30 09:00（+08）前免费不限量 —— 需要 ZCode 干活时用 `--model GLM-5.3-Flash`。
- 已知未接入项：**套餐剩余额度**（5h/1w 剩余百分比与重置时间）。客户端走 `https://zcode.z.ai/api/v1/coding-plan/reset/status`，需要客户端签名头（裸 Key/Token 试过均 401）。可选实现路径：① ZCode app-server 的 `usage/stats` RPC（`zcode.cjs app-server --stdio`）；② 复刻客户端鉴权头。当前插件显示的是**本地台账聚合**的 5h/周用量（真实、可核对，但不是"剩余额度"）。
