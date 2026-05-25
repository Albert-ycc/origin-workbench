# 大模型 API 设置体验优化调研

日期：2026-05-24
范围：Origin 桌面端 `设置 -> 大模型 API`
状态：产品调研 / 已进入实现验收

## 1. Intake

### Goal

把外接大模型 API 的配置体验从“环境变量命令生成器”升级成“连接一个模型服务”的直观流程。用户应该知道先选哪类服务、填哪些信息、怎么验证、配置成功后在哪里使用。

### 用户与场景

- 用户：本机 Origin Workbench 用户，想接入 OpenAI 官方 API、OpenRouter/中转站、cc-switch/OpenAI 兼容入口。
- 场景：用户第一次进入设置页，希望把 API Key、Base URL、模型 ID 填进去，然后马上确认连接是否可用。
- 当前阻塞：首屏信息密度过高，用户需要先理解 `OPENAI_*` / `ORIGIN_MODEL_*` 环境变量、Mac App 命令、daemon 启动方式、工具边界和模型列表，才知道下一步做什么。

### Evidence

- 用户反馈：当前界面“显得比较复杂”“把所有信息疯狂堆在一个页面上”“很懵，不知道从何下手”。
- 截图证据：首屏同时展示 3 个模式卡、4 个以上输入项、状态按钮、配置说明和滚动区域中的后续模块。
- 代码证据：
  - 当前页在 `apps/desktop/src/renderer/src/components/model-api-settings-tab.tsx` 中实现。
  - 表单只存在前端 state，并生成 `launchctl setenv ...` / `export ...` 命令；页面文案明确写着“输入不会保存到页面里”。
  - 后端当前从环境变量读取配置，`server/internal/runtimeconfig/api_runtime.go` 只返回脱敏 metadata。
  - 现有 UI 组件已支持 `Dialog`、`Tooltip`、`Accordion`、`Tabs`，可以承接说明弹窗与二级折叠信息。

### Scope

In scope：

- 重新定义大模型 API 设置页的信息架构。
- 明确 P0/P1/P2 的产品切片和验收标准。
- 明确哪些信息留在主流程，哪些放到问号弹窗、折叠区域或二级页面。
- 为后续实现提供前后端边界和测试策略。

Out of scope：

- 不扩大 API runtime 能力范围，例如写文件、Shell、浏览器、MCP。
- 不把外接 API runtime 宣称为完整 Codex / Claude Code 本地 runtime。
- 不在普通 workspace settings 或前端可回读状态里明文持久化 API Key。

### Success Metric

- 新用户在首屏 30 秒内能判断自己应该选择哪类接入方式。
- 用户无需阅读环境变量说明，就能完成主路径：选择服务 -> 填 Key/Base URL/模型 -> 验证 -> 保存/启用 -> 去智能体选择。
- 高级信息不消失，但默认收起或放在帮助弹窗/详情页。
- 配置错误时给出可执行修复方向，而不是只显示“未配置/待刷新”。

### Risk

- Secret 风险：API Key 不能进入普通数据库、日志、截图或前端可回读状态。
- 兼容风险：现有环境变量接入不能被破坏，仍需保留给高级用户和自动化场景。
- 认知风险：如果只把文字移到弹窗，但仍要求用户复制命令，体验改善有限。
- 运行时边界风险：外接 API 目前只有只读文件工具，必须避免用户误以为它等价于完整本地 Agent。

## 2. 竞品与同类流程启发

### Cline

Cline 的 OpenAI Compatible 配置把主流程收敛为几个字段：Provider、Base URL、API Key、Model，并提供 Verify 来确认连接。官方文档也把错误排查按 Invalid API Key、Model Not Found、Connection Errors 分类。这对 Origin 的启发是：主流程应围绕“填字段 + 验证连接”，而不是围绕环境变量命令。

参考：https://docs.cline.bot/provider-config/openai-compatible

Cline 对 OpenAI 直连还区分 API Key 路径和 OpenAI Codex OAuth 路径，并把 Base URL 放成可选项。对 Origin 的启发是：OpenAI 官方直连可以比中转站更简化，默认 Base URL 不应抢占用户注意力。

参考：https://docs.cline.bot/provider-config/openai

### Continue

Continue 把模型分成 chat、edit、apply、autocomplete、embed、rerank 等角色，并把 API Key 作为 User Secret 管理；自托管/OpenAI-compatible 场景则通过 provider、model、baseUrl、apiKey 表达。对 Origin 的启发是：模型配置不只是一个模型 ID，后续可以沉淀成“模型能力/用途”的二级信息，但不应压在首次接入首屏。

参考：https://docs.continue.dev/customize/models
参考：https://docs.continue.dev/guides/how-to-self-host-a-model

### OpenRouter

OpenRouter 强调统一 API、单一 base URL、模型 slug 和模型目录。对 Origin 的启发是：中转站/聚合网关用户最需要的是“base URL 是否正确、模型 ID 是否存在、当前 key 是否能调用这个模型”的即时验证。

参考：https://openrouter.ai/docs/quickstart

## 3. 当前体验问题拆解

### P0 问题：主路径不够像“连接服务”

当前页面把用户引导到复制命令，而不是让用户在页面内完成连接。对非工程化用户而言，“API Key 只能生成命令、不保存、还要重启 App”会让操作目标变得不确定。

### P0 问题：首屏信息层级混乱

首屏同时出现：

- 三种接入方式说明。
- API Key、Base URL、模型 ID、模型列表、能力来源名称、允许读取目录。
- “现在做到哪一步”的状态卡。
- “刷新状态”。

这些信息都重要，但不应该同级展示。首屏只应保留完成任务所需的最小路径。

### P1 问题：说明内容没有按用户问题组织

用户真正会问的是：

- 我应该选哪个入口？
- Base URL 是什么，什么时候要 `/v1`？
- 模型 ID 从哪里找？
- 配置成功后在哪里用？
- 外接 API 能不能读写文件、跑命令？

当前页面则按实现概念组织：变量族、命令片段、metadata、工具列表。

### P1 问题：状态反馈不够可行动

“未配置 / 待刷新 / 已就绪”不足以指导修复。错误态应该区分：

- Key 缺失。
- Base URL 不通。
- 模型不存在。
- 连接成功但未重启/后端未读取到。
- 已配置但没有可选模型。

### P2 问题：高级能力边界占用主流程

只读工具、变量优先级、终端 daemon 启动片段属于高级/排障信息，不应在首屏与主流程竞争注意力。

## 4. 产品方向

建议把页面改成“三层结构”：

### 第一层：主配置流程

目标：像连接一个账号或模型服务。

建议首屏结构：

1. 顶部状态条：未连接 / 已连接 / 需要处理，并显示最后一次检测结果。
2. Provider 选择：OpenAI 官方、OpenRouter/中转站、cc-switch/本机兼容环境、自定义 OpenAI Compatible。
3. 必填字段：API Key、Base URL、模型 ID。
4. 主按钮：测试连接。
5. 测试通过后：保存并启用。
6. 成功后 CTA：去智能体选择这个能力来源。

默认隐藏或弱化：

- 模型列表。
- 能力来源名称。
- 允许读取目录。
- 环境变量族。
- 终端/daemon 命令。
- 工具列表。

### 第二层：上下文帮助

用问号按钮或小型弹窗解决解释性内容：

- Provider 旁：不知道选哪个？
- Base URL 旁：什么时候需要 `/v1`？
- 模型 ID 旁：去哪里找模型 ID？
- API Key 旁：Key 会存在哪里？
- 允许读取目录旁：外接模型能访问哪些本机文件？

原则：弹窗回答一个具体问题，不写长教程。

### 第三层：高级设置 / 诊断页

放入二级页面或折叠区：

- 环境变量命令生成器。
- Mac App / 终端 daemon 两种启动方式。
- 当前识别到的 runtime metadata。
- 只读工具能力边界。
- 变量优先级：`ORIGIN_MODEL_*` 优先于 `OPENAI_*`。
- 连接诊断日志与错误详情。

入口文案建议为：“高级设置与命令行配置”或“诊断与环境变量”。

## 5. Prioritized Product Plan

### P0-1：重构为“连接模型服务”主流程

Score：Impact 5 + Frequency 5 + Blocking 5 + Confidence 5 - Effort 3 = 17

用户价值：用户不用理解环境变量，也能知道下一步该填什么、点什么。

Acceptance Criteria：

- Happy path：选择 OpenAI/OpenRouter/自定义入口，填写 API Key、Base URL、模型 ID，点击“测试连接”，成功后可以保存并显示“已连接”。
- Empty：没有配置时只显示一个清晰的连接表单，不显示命令块和工具边界。
- Loading：测试连接时按钮禁用并显示进度。
- Error：Key 错、URL 错、模型不存在分别给出不同错误文案。
- Success：显示 provider、默认模型、最后检测时间和“去智能体”入口。
- Security：API Key 不在日志、toast、状态卡、命令显示中明文暴露。
- Backward compatibility：现有环境变量读取仍可用。

Debt constraints：

- 不直接把 API Key 存进普通 workspace settings。
- 如果先不做持久保存，只能以“测试连接 + 生成命令”的中间态发布，并在页面明确标注，不可伪装成已保存。

### P0-2：把说明性内容移出主屏

Score：Impact 4 + Frequency 5 + Blocking 4 + Confidence 5 - Effort 2 = 16

用户价值：首屏更像操作台，而不是文档页。

Acceptance Criteria：

- Provider、Base URL、模型 ID、API Key、允许读取目录都有问号帮助入口。
- 点击问号打开 `Dialog` 或 `Popover`，内容可关闭、可键盘访问。
- 高级命令和变量说明默认不展开。
- 页面首屏在 1440px 宽度下只展示主配置、状态和主要 CTA。

Debt constraints：

- 不把长文塞进 tooltip；超过 2-3 行的说明用 dialog。
- 不新增第三方 UI 库，复用现有 `@multica/ui` 组件。

### P1-1：连接测试与诊断反馈

Score：Impact 5 + Frequency 4 + Blocking 4 + Confidence 4 - Effort 4 = 13

用户价值：用户能知道失败原因，而不是反复重启/刷新。

Acceptance Criteria：

- 提供“测试连接”接口或本地检测路径。
- 至少覆盖 API Key missing、401/403、404 model not found、network/base URL failure、empty models。
- 失败信息用用户可理解的中文表达，并保留可复制的技术详情。
- 不记录 API Key。

Debt constraints：

- 如果后端暂时没有 provider-specific models endpoint，不要假装模型列表自动发现；先测试 `/chat/completions` 最小请求或提供显式限制。

### P1-2：配置成功后的使用路径闭环

Score：Impact 4 + Frequency 4 + Blocking 3 + Confidence 5 - Effort 2 = 14

用户价值：配置完成后知道在哪里启用。

Acceptance Criteria：

- 已连接状态显示“去智能体选择模型”CTA。
- CTA 到智能体页后，用户能看到该 runtime，并选择模型。
- 如果没有智能体，提供“新建智能体”入口。
- 如果 runtime 是只读 API runtime，智能体页显示能力边界 badge。

Debt constraints：

- 不在设置页复制完整智能体编辑功能，只做跳转和状态说明。

### P2-1：Provider 预设与模型提示

Score：Impact 3 + Frequency 3 + Blocking 2 + Confidence 4 - Effort 2 = 10

用户价值：减少 Base URL 和模型 ID 的手输错误。

Acceptance Criteria：

- OpenAI 默认隐藏 Base URL 或显示为默认值。
- OpenRouter 默认填 `https://openrouter.ai/api/v1`。
- cc-switch 保留 `OPENAI_*` 兼容说明，但移到高级解释。
- 模型 ID 支持常用占位提示，不自动虚构可用模型。

Debt constraints：

- 不硬编码过多第三方供应商；优先做 OpenAI / OpenRouter / 自定义。

## 6. Recommended IA Sketch

主页面：

```text
大模型 API
[状态：未连接] [测试连接]

选择服务
( ) OpenAI 官方
( ) OpenRouter / 中转站
( ) cc-switch / 本机兼容环境
( ) 自定义 OpenAI Compatible

连接信息
API Key        [••••••••••] [?]
Base URL       [https://openrouter.ai/api/v1] [?]
模型 ID        [openai/gpt-4.1-mini] [?]

[测试连接] [保存并启用]

高级设置与诊断 >
```

高级页/折叠区：

```text
环境变量命令
当前识别状态
只读工具边界
变量优先级
排障详情
```

## 7. Team Split

- Product：确认主流程文案、Provider 分类、哪些说明进入问号弹窗。
- Architecture：设计安全持久化边界；明确 env fallback 与页面保存配置的优先级。
- Backend：提供连接测试/保存/读取脱敏状态接口，避免 API Key 泄漏。
- Frontend：重构设置页 IA，使用 Dialog/Popover/Accordion 分层展示。
- QA：覆盖首次配置、错误配置、env fallback、已连接状态、智能体跳转。
- Release：如改动涉及本机 app，按 Origin 发布规则区分本地已修、GitHub 已好、发布已好、本机安装包已好。

## 8. Implementation Guardrails

- 保留现有 env-only 入口作为高级/兼容模式。
- API Key 只能进入后端本地配置文件，不能进入普通 workspace settings、日志、toast 或前端可回读状态。
- API Key 输入可用于测试连接，但所有显示层必须脱敏。
- 首屏不要出现 `ORIGIN_MODEL_*` / `OPENAI_*` 变量族，除非用户进入高级设置。
- 不改变 API runtime 当前能力边界：只读文件工具，不支持写文件、Shell、浏览器、MCP。

## 9. Definition Of Done For Next Slice

- 产品设计稿或代码改造中，首屏只保留主路径和必要状态。
- 说明性内容通过问号弹窗、折叠区或二级页面呈现。
- 至少有一个可验证的测试路径：测试连接成功/失败。
- 保留 env fallback，并在高级页解释。
- 自动化测试覆盖 command/snippet 兼容逻辑和关键 UI 状态。
- 手动 smoke：从空配置进入页面 -> 填写测试信息 -> 错误提示/成功状态 -> 去智能体。

## 10. 当前建议结论

下一步不建议只做“把文字搬进问号弹窗”的轻改。那会降低视觉噪音，但仍无法解决用户不知道怎么完成配置的问题。

更合理的 P0 是：把主页面改成连接表单，并把命令生成器降级为高级兼容入口。是否立即实现“保存并启用”，取决于 API Key 的安全持久化方案；如果短期无法安全保存，也应该把主流程改成“测试连接 + 复制高级命令”的临时路径，并清楚标注这是过渡方案。

## 11. 实现验收记录

日期：2026-05-24
状态：通过产品验收

### 已落地

- 主流程从“复制命令生成器”改为“选择服务 -> 填连接信息 -> 测试连接 -> 保存并启用 -> 去智能体”。
- 保存按钮升级为“测试并保存”：后端先跑 `/chat/completions` 最小请求，失败时不写配置文件。
- “测试连接”只返回诊断结果，不静默保存 API Key 或配置。
- OpenAI 官方隐藏 Base URL 到高级区；OpenRouter 默认值改为 `https://openrouter.ai/api/v1`；新增自定义 OpenAI Compatible 入口。
- API Key、Base URL、模型 ID、高级信息改为问号弹窗说明。
- 模型列表、能力来源名称、允许读取目录、环境变量命令、变量族放入高级折叠或次级状态区。
- 后端新增读取、保存、测试连接接口；连接测试覆盖 key 缺失、鉴权失败、模型不存在、Base URL/网络失败等分类。
- 保存成功后记录最近检测时间、耗时和结果；前端状态卡展示最近检测。
- 成功连接后会 best-effort 调用 `/models` 自动发现模型；服务不支持 `/models` 时不阻塞保存。
- `ORIGIN_MODEL_TOOL_ROOTS` 支持 `~`、`$HOME`、`${HOME}` 展开，保存前校验目录存在。
- API Key 保存到后端本地 JSON 配置文件，文件权限 `0600`；接口不回传完整 Key。
- 任务执行路径改为读取“环境变量优先，保存配置兜底”的统一配置源。
- 自托管 Docker 增加 `backend_config` 卷和 `ORIGIN_MODEL_CONFIG_FILE` 默认路径，避免容器重建丢配置。

### 产品验收结论

- P0-1 通过：首屏核心任务变成连接表单，并支持测试、保存、启用闭环。
- P0-2 通过：说明性内容被问号弹窗和高级折叠承接，首屏不再铺满变量和命令。
- P1-1 通过：测试连接返回可行动中文错误，并保留技术详情。
- P1-2 通过：状态卡提供“去智能体选择”的下一步入口。
- P2-1 通过：Provider 默认值和字段层级按真实接入场景收敛。
- P1 补强通过：最近检测和自动发现模型形成保存后的状态闭环。

### 验证命令

- `go test -count=1 ./internal/runtimeconfig ./internal/modelapi ./internal/handler ./internal/service`
- `pnpm --filter @multica/core test -- client.test.ts`
- `pnpm --filter @multica/core typecheck`
- `pnpm --filter @multica/desktop test -- model-api-settings-tab.test.tsx`
- `pnpm --filter @multica/desktop typecheck`
- `git diff --check`
