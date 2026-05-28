# AI 圆桌 P0 交付报告

日期：2026-05-27（提交完成 2026-05-28）
分支：`feature/ai-roundtable-p0`（基于 `origin-open-source-ready`）
范围：把 Council/会议室升级为 Mission 前置决策引擎的最小闭环

## 一句话总结

把 WIP 阶段塞在 `council_session.summary` 文本里用 `[AI_ROUNDTABLE_P0]` 标记字符串解析的「圆桌模板」改造为结构化 `strategy` JSONB 字段，补齐角色观点卡持久化、分歧矩阵、6 段总结模板、`mission.source_council_id` 反向指针，以及完整 round-trip 单测。

## 改了什么

### 数据库（migration 092 / 093）

- **092 `council_session_strategy`**：给 `council_session` 加 `strategy JSONB NOT NULL DEFAULT '{}'::jsonb`，并对 `(strategy->>'roundtable_type')` 建条件索引。结构约定见 migration up 文件 docstring（应用层契约，DB 只保证有效 JSONB）。
- **093 `mission_source_council`**：给 `mission` 加 `source_council_id UUID REFERENCES council_session(id) ON DELETE SET NULL` + 条件索引。Council 被删时 Mission 不级联删（Mission 是耐久产物）。

### 后端（Go handler / sqlc）

- `server/pkg/db/queries/council_session.sql`：`CreateCouncilSession` / `UpdateCouncilSession` 接 `strategy`，缺省落 `'{}'::jsonb`，update 是「整对象替换」语义。
- `server/pkg/db/queries/mission.sql`：`CreateMission` 接 `source_council_id`。
- `server/internal/handler/council_session.go`：
  - Response / Request struct 新增 `Strategy json.RawMessage`。
  - 新增 `normalizeStrategy()`：保证发给前端的 strategy 永远是合法 object（不会出现 `null` 或空 bytes，省掉前端三种 defensively guard）。
  - 新增 `validateStrategyJSON()`：禁止 strategy 顶层非 object，避免前端误传数组/标量；schema 内部仍然保持 forward-compatible（不在后端定义 strict Go struct）。
- `server/internal/handler/mission.go`：
  - `CreateMissionRequest` / `MissionResponse` 加 `source_council_id`。
  - Create 时校验 source council 属于同 workspace（跨 workspace 隔离防御）。

### 前端（core types / views）

- `packages/core/types/council-session.ts`：新增 `CouncilStrategy` / `CouncilRolePerspective` / `CouncilDisagreement` / `CouncilConclusionStructured` 等 11 个相关类型；`CouncilSession` 加 `strategy: CouncilStrategy` + `project_id?`（前 type 后 backend 已就绪）。
- `packages/core/types/mission.ts`：`Mission` / `CreateMissionRequest` 加 `source_council_id`。
- `packages/core/types/index.ts`：barrel 导出新增类型。
- `packages/views/councils/councils-page.tsx`：
  - `buildRoundtableStrategy()` 取代「往 summary 塞 sentinel 字符串」方案，返回结构化 strategy 对象。
  - `buildRoundtableSummary()` 保留（向后兼容 + 列表速览用）。
  - `isRoundtableSession()` / `roundtableTemplateForSession()` 改为优先读 strategy，老 council fallback 到 summary 标记。
  - `RoundtableSummaryBox` 改为从 strategy 渲染。
  - **新增 `RoundtablePerspectivesPanel`**：每个 active participant 一张观点卡，已记录显示 position/evidence/self_rebuttal/risk/suggestion，未记录显示「记录」按钮。
  - **新增 `PerspectiveEditorDialog`**：inline 编辑一个 perspective。
  - **新增 `DisagreementMatrix`**：从 `strategy.disagreements` 渲染分歧 + 各方立场和成立条件。
  - **新增 6 段总结模板**（CONCLUSION_SECTIONS：结论/分歧/风险/假设/行动项/记忆候选）：散会时 roundtable 模式呈现 6 个 textarea，提交时同时写 `conclusion`（markdown）和 `strategy.conclusion_structured`（结构化对象，便于程序消费）。
  - `buildRoundtableMissionDraft()` 现在用 `strategy.expected_output` 而非 parse summary 文本，并自动带上 `source_council_id: session.id`。

### 测试（go test）

- `server/internal/handler/council_session_strategy_test.go`（新增 3 个 round-trip 测试）：
  - `TestCreateCouncilWithStrategyRoundTrip`：create 带 strategy → response 回读 → patch 加 role_perspective → 再回读验证其他字段不丢。
  - `TestCreateCouncilRejectsNonObjectStrategy`：strategy 是数组要 400。
  - `TestCreateMissionWithSourceCouncilIDRoundTrip`：create mission 带 council id → 验证反向指针 + reject 不存在的 council id 为 400。

## 验证了什么

| 层级 | 命令 | 结果 |
|---|---|---|
| Core types | `pnpm --filter @multica/core typecheck` | ✅ pass |
| Views | `pnpm --filter @multica/views typecheck` | ✅ pass |
| Desktop | `pnpm --filter @multica/desktop typecheck` | ✅ pass（node + web）|
| Handler 单元 | `go test ./internal/handler/ -count=1 -p 1` | ✅ pass（全包 4.152s）|
| Service / Server / SQL | `go test ./internal/service ./pkg/db/... ./cmd/server` | ✅ pass |
| 容器健康 | `curl /health` | ✅ 200 |
| Migration apply | `psql -c "SELECT version FROM schema_migrations"` | ✅ 092 / 093 都在 |
| Schema 列 | `\d council_session` / `\d mission` | ✅ `strategy` JSONB + 索引 / `source_council_id` UUID FK + 索引 |
| Last-mile container rebuild | `docker compose -p multica ... up -d --force-recreate backend` | ✅ 用新 image，启动 log 干净 |

## 还没验证的（残余风险）

1. **真实带 user token 的 HTTP smoke**：handler-level integration test 已用真实 PG pool 覆盖创建/更新/校验链路，但还没用 `curl localhost:8080` 走完 auth middleware + JSON HTTP transport 的端到端打一次。需要在 desktop UI 里手动创建一场圆桌、记录观点卡、走 6 段散会、点「转 Mission」，看真实链路是否绿。
2. **多 Agent 并行产观点**：P0 只做手动填卡，自动观点卡生成（主持人 Agent + 角色 prompt）是 P1 范围，目前没接入。
3. **大对象写入压力**：`strategy` 是 JSONB，单行可能膨胀到几十 KB（多个 perspectives + disagreements + structured conclusion）；现在没限上限。如果用户长期跑多人多轮会议会有页爆裂风险，建议 P1 加 `pg_column_size(strategy) > N` 拒绝写入或拆冷数据。
4. **WIP 兼容**：`origin-open-source-ready` 上 `stash@{0}` 还保留着用户原始的 WIP 半成品（含旧版本的 councils-page.tsx + project-workspace-page.tsx 圆桌前端）；用户回去 pop 时这 2 个文件会冲突，需要选 feature 分支的版本（详见下方「合并建议」）。

## 技术债清单

| 项 | 原因 | 建议 |
|---|---|---|
| `councils-page.tsx` 已 1700+ 行 | 在原文件内一次性把 P0 全部能力堆进来，避免拆分组件造成 review 难度 | P1 拆出 `councils/components/roundtable-perspectives-panel.tsx` + `councils/components/conclusion-form.tsx` |
| Strategy update API 是「整对象替换」 | sqlc 接口最简单，handler 也最干净 | P1 如果观点卡冲突多，可加 `UpsertRolePerspective(session_id, agent_id, payload)` 单卡 API |
| 主持人 Agent prompt / 自动框架推荐 | P0 显式排除（用户决策：「P1：主持人 Agent」） | P1 落地，对接现有 Skill/Agent 配置 |
| `project_id` baseline 缺失补丁 | 圆桌任务依赖 `session.project_id` 转 Mission，所以前端 `CouncilSession.project_id?` 加上了；后端 baseline `CouncilSessionResponse` 仍然没输出 `project_id` 字段（那是 `origin-open-source-ready` 上 WIP project_id 任务的尾巴，不在圆桌 scope）| 跟踪：WIP 用户回到 main 分支补完 ProjectID converter 输出 |
| Test cleanup 经验沉淀 | 我的 mission 测试一开始没清理 `agent_task_queue` 行，导致 `TestClaimTask_*` 串行跑时被污染（被脏 task 抢去） | 已经在测试里加了 cleanup。后续凡是 CreateMission 的测试都应该按 chat_session_id 清 task queue |

## 合并建议

**Feature 分支已就绪**，4 个 commit 干净可 review：

```
c65219dc test(councils,missions): cover strategy + source_council_id round-trip
15032565 feat(councils): persist roundtable metadata via strategy + perspective cards + 6-section conclusion
29baaea1 feat(councils,missions): add strategy JSONB + source_council_id reverse pointer
bde336e6 chore(councils): import AI roundtable P0 frontend skeleton baseline
```

合并目标是 **`origin-open-source-ready`**（不是 `develop`，因为这个 fork 没有 develop 分支，集成分支就是 `origin-open-source-ready`）。

合并前必须解决的 WIP 衔接：

1. `origin-open-source-ready` 上仍有 `stash@{0}: wip-mixed-snapshot-2026-05-27-before-ai-roundtable-split`，包含 22 个文件改动 + 2 个未追踪文件（model-api-runtime / agent runtime / chat store 等无关 WIP + 根目录 `councils-page.tsx` 原型副本 + `prototypes/origin-ui-redesign/`）。
2. 这个 stash 里有**旧版本**的 `packages/views/councils/councils-page.tsx` 和 `packages/views/project-workspaces/project-workspace-page.tsx`，与 feature 分支的新版本会冲突。

推荐顺序：

```bash
# 1. 切回 origin-open-source-ready
git switch origin-open-source-ready

# 2. 先合并 feature/ai-roundtable-p0
git merge --no-ff feature/ai-roundtable-p0

# 3. 再 pop WIP stash
git stash pop stash@{0}
# 此时 packages/views/councils/councils-page.tsx 和
# packages/views/project-workspaces/project-workspace-page.tsx
# 会冲突 —— 选 "ours"（即合并进来的新版本）：
git checkout --ours packages/views/councils/councils-page.tsx
git checkout --ours packages/views/project-workspaces/project-workspace-page.tsx
git add packages/views/councils/councils-page.tsx packages/views/project-workspaces/project-workspace-page.tsx

# 4. 剩下 19 个 WIP 文件就是 model-api-runtime 那批，与圆桌无关，
#    它们会作为未提交改动留在工作区，由用户决定下一步如何处理。
```

合并后建议在 desktop UI 上跑一次完整 P0 流程：
- 项目工作区 → 召开圆桌 → 选「评审圆桌」 → 加 2 个 agent → 创建
- 在 council 详情页给每个 agent 记录一张观点卡
- 散会时填 6 段 → 看 conclusion 区域结构化渲染
- 点「转 Mission」 → 验证 mission detail 里能看到 source_council_id

## 不在本轮范围

- 主持人 Agent prompt 协议（P1）
- 自动框架推荐 / 角色组推荐（P1）
- 「会议」一级入口合并（会议 Copilot + 会议室 + AI 圆桌）（P2，需要先拍 IA 决策，见 [INTERACTION_AUDIT_2026-05-23](../../docs-private/INTERACTION_AUDIT_2026-05-23.md)）
- 删除根目录孤儿 `councils-page.tsx` 和 `prototypes/origin-ui-redesign/`（5/24 UI 重设计原型，归属另一项独立工作）
