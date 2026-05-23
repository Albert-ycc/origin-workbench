<div align="center">

<img src="apps/desktop/build/icon.png" alt="Origin Workbench" width="120" />

# Origin Workbench

### 单用户本地 AI Agent 工作台

**一个人 · 一台机 · 一个工作区 · 多个 Agent。**
我希望在自己笔记本上长着的那台「个人笔记本 + 多 Agent 控制面板」。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Powered by Multica](https://img.shields.io/badge/Powered%20by-Multica-7c3aed.svg)](https://github.com/multica-ai/multica)
[![Desktop · macOS](https://img.shields.io/badge/Desktop-macOS%20arm64-000.svg)](#打包桌面端正式版)
[![Mobile · Preview](https://img.shields.io/badge/Mobile-LAN%20PWA%20preview-0f766e.svg)](#origin-mobile-预览)
[![Status · Active fork](https://img.shields.io/badge/Status-个人活跃维护-orange.svg)](#项目状态)

[上游](https://github.com/multica-ai/multica) · [License](LICENSE) · [Notice](NOTICE) · [贡献指南](CONTRIBUTING.md) · [更新日志](https://github.com/Albert-ycc/origin-workbench/releases)

[English](README.md) | **简体中文**

</div>

---

> Fork 自 [multica-ai/multica](https://github.com/multica-ai/multica)。**Powered by Multica** · Apache 2.0（包含上游附加条款——详见 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)）。Multica 原版 README 保留在 [`README.upstream.md`](README.upstream.md)。

---

## Origin 是什么？

Origin 把 Multica 从「面向人 + Agent 团队的多租户 SaaS」改造成 **个人本地 Agent 工作台**。一个使用者、一台电脑、一个工作区、多个 Agent。桌面端仍是主要支持入口，v1.1 新增手机端预览，用来在同一局域网里快速捕捉想法和轻量查看工作台。

如果说 Multica 是「把 AI Agent 当队友的 Linear」，那 Origin 就是「我希望在自己笔记本上长着的那台个人笔记本 + 多 Agent 控制面板」：

- 我用自然语言描述想做什么 → captain Agent 帮我拆解。
- 我把还没成形的念头丢进 **想法池** → 它先在那儿养着，养成熟了一键升级成 Mission。
- 当一个决定需要多视角时，我开一场 **Council Session**——临时拉几个对的 Agent 进同一间屋子，按「安静 / 简洁 / 活跃」三档发言节奏轮流过审。
- 我的身份卡和沟通偏好放在 **User Profile** 里，作为每个 Agent system prompt 的最近一层注入（Phase 7 把这条线和 API runtime 端到端打通）。

整个系统跑在 `localhost`。没有 Origin Cloud、没有团队邀请、没有邮箱验证——填个名字、挑个头像就进来。

## 大模型 API runtime

Origin 可以对接 OpenAI 兼容的大模型 API、中转站，或 cc-switch / Codex 写入的
OpenAI 兼容环境变量，用来给聊天型 Agent 提供模型回复。
现在 API runtime 已补上 Origin 自己的工具循环和只读本地文件工具
（`list_directory`、`read_text_file`、`search_text`），API Agent 可以读取和搜索允许目录里的项目上下文。
它仍不会自动继承 Codex / Claude Code 的写文件、Shell、浏览器、MCP、skills 执行等能力。

能力说明、环境变量和后续完整 Agent 模式路线图见
[`docs/model-api-runtime.md`](docs/model-api-runtime.md)。

## 跟上游 Multica 的差别

| 维度 | 上游 Multica | Origin Fork |
|---|---|---|
| 部署模式 | 多租户 SaaS / 自托管 | 单用户、单工作区、纯本地 |
| 登录方式 | 邮箱 + 验证码（或 Google OAuth） | 名字 + 头像（`/auth/local-signin`） |
| 工作区 | 用户可创建可切换 | 硬编码 `Fairy`，没有重命名 UI |
| Web 前端 | `apps/web/`（Next.js） | **已删。** 桌面端是主入口；`apps/mobile/` 是本地手机伴随预览。 |
| 成员 / 邀请 / Labs / Repos | 设置页签 | **已删**——跟单用户模型冲突。 |
| 自动更新 | 拉官方 Multica releases | **已删**——会把 fork 覆盖掉。 |
| 想法池 / Council Session / User Profile | — | Origin 本地工作流对象。 |
| Inbox / 团队协作 mailbox | 团队协作消息面 | 从产品路径移除；附件和捕捉内容回到纯本地用户模型。 |
| 头像 | DiceBear 远程 URL 生成 | 内置 50 张原点风格离线头像池。 |

完整的修改清单见 [`NOTICE`](NOTICE)。

## 项目状态

这是一个活跃的个人 fork——接口可能随时变。如果你想要稳定、有人维护的产品，请用上游 Multica。

产品路线图和 PM 视角的设计笔记保留在 fork 私有目录（`docs-private/`，已 gitignore）。值得对外分享的架构决策记录在 [`NOTICE`](NOTICE)。

## 快速上手

桌面端是主要支持入口。

```bash
# 1. 装依赖
pnpm install

# 2. 用 Docker Compose 起后端（Postgres + Go server）
docker compose -p multica -f docker-compose.selfhost.yml \
  -f docker-compose.selfhost.build.yml up -d --build backend

# 3. 跑桌面端 dev 模式（electron-vite HMR）
pnpm dev:desktop
```

App 启动后会停在本地登录页——挑个头像、填个名字就进来。本地登录不需要邮箱、不需要验证码。

## Origin Mobile 预览

`apps/mobile/` 是 v1.1 新增的手机端预览壳。它现在可以作为局域网 PWA 运行，也预留了通过 Capacitor 直装 iPhone 的路径。当前范围刻意保持轻量：连接 Mac 上的 Origin 后端、读取本地工作区、查看 Mission 和 Agent、捕捉想法，并把短语音作为本地 Origin 附件上传。它不是 Origin Cloud 客户端，也不会把团队、邀请、多用户 SaaS 流程带回来。

```bash
pnpm --filter @multica/mobile dev
pnpm --filter @multica/mobile build
```

手机端具体启动方式见 [`apps/mobile/README.md`](apps/mobile/README.md)。

## 打包桌面端正式版

```bash
pnpm --filter @multica/desktop run package -- --mac --arm64 --dir \
  -c.mac.notarize=false -c.mac.identity=null
```

打好的 `.app` 在 `apps/desktop/dist-local/mac-arm64/` 里。

本机安装更新时，要同时更新 `docker compose -p multica` 下现有
`multica-backend-1` 后端容器，并替换 `/Users/albert/Applications/Origin.app`。
安装目录只保留当前 `Origin.app` 和一个 `Origin.app.rollback-*` 回滚版本。

## 许可与署名

本 fork 用与上游 Multica 完全一致的 **改良版 Apache License 2.0** 分发。完整条款见 [`LICENSE`](LICENSE)，包括上游附加条款 §1a（未经书面许可不得做 SaaS / 商业嵌入）和 §1b（保留 `apps/web/` 中的 LOGO / 版权声明）。Origin fork 通过删除 `apps/web/` 来满足 §1b。

正式的修改清单和上游署名见 [`NOTICE`](NOTICE)。

「Multica」名称、商标、logo 资产，以及 multica.ai 服务，归 Multica, Inc. 所有，不属于本 fork。

## 上游

- 源码：https://github.com/multica-ai/multica
- License：https://github.com/multica-ai/multica/blob/main/LICENSE
