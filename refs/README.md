# refs/ —— 证据与参考资料（来源说明）

本目录里的材料分两类，**只有第一类入库**。

## 一、入库：我们自己写的分析（可入库）

| 文件 | 内容 |
|---|---|
| `dsh-slots.md` | DSH 客户端槽位证据（Z4）：`shell.overlay` 存在性与形态、官方先例、注册选项与 props 合成 |
| `dsh-theme-tokens.md` | 主题令牌证据（Z4）：`--dsw-alias-*` 全集、原 19 个引用里 16 个不存在的替换映射 |

## 二、不入库：DSH 自带材料（第三方，已 gitignore）

以下都是从本机 DSH 安装包里**只读提取**的官方材料，用于插件开发时的形态对照。它们随 DSH 出货，**不复制进本仓库**：

| 目录/文件 | 来源（asar 内路径） | 再生成方式 |
|---|---|---|
| `SKILL.md`、`references/`、`templates/` | `dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/` | `node ../tools/asar-extract.mjs "D:\DeepSeek\resources\app.asar" "dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development" refs` |
| `dsh-typert/{protocol,loader,registry,plugin-manager}` | `dsh/node_modules/@deepseek-ai/dsh-typert-*`、`dsh-plugin-manager` | 同上，前缀换成对应包路径 |
| `dsh-plugin-manager/` | `dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager` | 同上 |
| `extracted/` | 槽位/主题证据涉及的客户端包（slots/theme/layout/conversation/renderer/cordis） | 见 `tasks/Z4-delivery.md` §证据 |
| `dsh-host-cli/`、`dsh-pm-ui/` | DSH CLI 的 plugin 子命令实现、插件页客户端包 | 同上 |

> 提取器：`../tools/asar-extract.mjs`（自实现的最小 asar 读取；用法 `<asar> <path-prefix> <outDir>`，`LIST_ONLY=1` 仅列清单）。
> 恢复这些材料只需要本机有 DSH 安装（`D:\DeepSeek\resources\app.asar`），不需要网络。
