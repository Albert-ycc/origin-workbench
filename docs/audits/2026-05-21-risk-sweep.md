# Origin Workbench 风险清扫问题清单

日期：2026-05-21；收尾更新：2026-05-22；CRUD 复核更新：2026-05-22

范围：后端代码逻辑、前端页面体验、桌面真实用户路径、回归测试链路。

## 角色结论

| 角色 | 结论 |
|---|---|
| 项目经理 | P0/P1 和原先标记的尾巴已全部收口；保留的问题都转成可执行脚本、测试或明确产品文案，不再停留在口头边界。 |
| 产品经理 | 用户马上能感知的断裂已修复：错误态不再伪装成空态、发送失败不丢草稿、成员可继续邀请，茶水间/项目/会议删除闭环已补，Council/Direct Chat 边界已改文案。 |
| 技术架构 | 后端 workspace 边界、room cursor 合约、salon 写入事务、CORS fallback 和 delegated completion 事件模型已补测试或回归。 |
| 前端 | rooms/councils 的错误态、草稿保留、DragStrip、tab icon、成员邀请、私聊文案和 Base UI 语义警告已完成。 |
| 后端 | ListChatSessions panic、council source chat workspace 校验、running council workspace 过滤、salon 事务和 room 分页均已完成。 |

## 统一问题表

| ID | 分类 | 严重级别 | 位置 | 问题 | 优化方向 | 状态 |
|---|---|---:|---|---|---|---|
| OW-BE-001 | 后端崩溃 | P0 | `server/internal/handler/chat.go` | `ListChatSessions` 在 workspace 为空时直接 `parseUUID`，Go 测试 panic。 | 使用统一 workspace 解析和 `parseUUIDOrBadRequest`，返回明确 400。 | 已解决 |
| OW-BE-002 | 工作区隔离 | P0 | `server/internal/handler/council_session.go` | `source_chat_session_id` 只解析 UUID，不校验是否属于当前 workspace。 | 创建 council 时用 `GetChatSessionInWorkspace` 校验。 | 已解决 |
| OW-BE-003 | 工作区隔离 | P0 | `server/pkg/db/queries/council_session.sql` | `GetRunningCouncilSessionBySourceChat` 只按 chat id 查 running council，缺 workspace 条件。 | SQL 参数增加 `workspace_id`，调用方传当前 chat session workspace。 | 已解决 |
| OW-BE-004 | Salon 启动闭环 | P1 | `server/internal/handler/council_session.go` | salon 传入已有 `source_chat_session_id` 或仅 convener 时可能不触发 kickoff。 | convener 自动纳入参与者；已有 source chat 也可作为 kickoff 载体。 | 已解决 |
| OW-BE-005 | 数据一致性 | P2 | `server/internal/handler/council_session.go` | salon 创建 chat、council、participants 不在事务内，失败可能留下半成品。 | 写入纳入同一事务，kickoff 放在 commit 后。 | 已解决 |
| OW-BE-006 | API 合约 | P2 | `server/internal/handler/room.go` | `ListRoomMessages` 暂未实现 cursor/next_cursor 合约。 | 支持 `cursor`/`before`、`limit`、`next_cursor`，返回顺序仍保持 UI 需要的旧到新。 | 已解决 |
| OW-FE-001 | 用户输入安全 | P0 | `packages/views/rooms/components/room-message-input.tsx` | 消息发送失败会清空输入且无提示。 | 失败后恢复草稿并 toast 提示。 | 已解决 |
| OW-FE-002 | 错误态 | P1 | `packages/views/rooms/components/room-message-list.tsx` | 消息加载失败会显示为空聊天。 | 增加错误态和重试。 | 已解决 |
| OW-FE-003 | 错误态 | P1 | `packages/views/rooms/rooms-page.tsx` | 房间列表加载失败会显示“还没有茶水间”。 | 增加错误态和重试。 | 已解决 |
| OW-FE-004 | 桌面产品路径 | P1 | `packages/views/councils/councils-page.tsx` | Council 页面缺少 `DragStrip`。 | 顶层补齐 `DragStrip`。 | 已解决 |
| OW-FE-005 | 可访问性 | P2 | `packages/views/councils/councils-page.tsx` | Council 列表项是可点击 `li`，键盘不可达。 | 增加 button 语义和键盘操作。 | 已解决 |
| OW-FE-006 | 桌面标签体验 | P2 | `apps/desktop/src/renderer/src/stores/tab-store.ts` | `/rooms` tab 图标退回默认 `ListTodo`。 | 增加 rooms 图标映射。 | 已解决 |
| OW-FE-007 | 视觉一致性 | P2 | `apps/desktop/src/renderer/src/globals.css`、rooms 页面 | 茶水间白底和深色 shell 割裂，文字 token 不统一。 | 改用现有 `bg-card/text-foreground/text-muted-foreground` token，并修正详情页 AppLink Button 语义。 | 已解决 |
| OW-FE-008 | 成员管理 | P1 | `packages/views/rooms/room-detail-page.tsx` | 创建后无法继续邀请成员。 | 详情页接入邀请 modal，可选择未加入的智能体并调用 `addRoomMember`。 | 已解决 |
| OW-FE-009 | 产品承诺 | P2 | `packages/views/councils/councils-page.tsx` | “发言”实际打开 Direct Chat 草稿，Council/私聊边界不清。 | 文案改为“私聊/追问”“私聊该成员”，和实际行为一致。 | 已解决 |
| OW-FE-010 | CRUD 闭环 | P1 | `packages/views/rooms/room-detail-page.tsx`、`packages/views/project-workspaces/project-workspace-page.tsx`、`packages/views/meetings/meetings-page.tsx` | 茶水间、项目工作区、会议缺少可见删除入口；茶水间缺少编辑和成员移除入口。 | 详情页补设置/删除/邀请/移除成员；项目和会议补 destructive 删除确认。 | 已解决 |
| OW-BE-007 | CRUD API | P1 | `server/cmd/server/router.go`、`server/internal/handler/{room,project_v12,meeting}.go` | 真实运行态里 DELETE 不通：茶水间仍要求先归档，项目/会议返回 405。 | 补 DELETE 路由和 handler；茶水间允许直接删除 active room；重建 `multica-backend-1` 并用真实 HTTP smoke 验证。 | 已解决 |
| OW-RT-001 | E2E 链路 | P1 | `e2e/fixtures.ts`、`playwright.config.ts` | 本地 `pnpm test:e2e` 需要显式 `E2E_DATABASE_URL` 和已运行 backend。 | 新增 `scripts/e2e-origin-smoke.sh`、`pnpm test:e2e` 和 `make e2e`，自动准备 DB、迁移、临时后端和 Playwright env。 | 已解决 |
| OW-RT-002 | 回归失败 | P1 | `server/cmd/server/router.go`、`server/internal/realtime/hub.go` | `.env` 设置 `FRONTEND_ORIGIN=http://localhost:3000` 后，后端 CORS 没有保留 electron-vite 的 `http://localhost:5173`，导致 smoke 回到登录页。 | 显式 CORS 配置仍覆盖；仅 `FRONTEND_ORIGIN` fallback 时保留默认本地 origins。 | 已解决 |
| OW-RT-003 | 文档一致性 | P2 | `Makefile`、`scripts/check.sh` | `make check` 文案写包含 Playwright E2E，脚本实际不跑。 | `make check` 明确为标准验证；新增 `make e2e` 专跑 Playwright smoke。 | 已解决 |
| OW-RT-004 | 可访问性/测试噪声 | P2 | `packages/views/workbench/workbench-page.tsx` | E2E 通过但多处 Base UI 警告：Button 使用非原生 `button` render，影响语义和表单可访问性。 | 这些 AppLink 渲染按钮设置 `nativeButton={false}`，消除错误语义警告。 | 已解决 |

## 当前验收命令

```bash
pnpm --filter @multica/core typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/desktop typecheck
pnpm --filter @multica/views test -- rooms rooms/components/room-member-sidebar.test.tsx councils --runInBand
cd server && go test ./internal/handler ./internal/service ./cmd/server ./pkg/db/...
ENV_FILE=.env E2E_BACKEND_PORT=18081 pnpm test:e2e
```

## 本轮已验证

- `pnpm --filter @multica/views typecheck`：通过。
- `pnpm --filter @multica/core typecheck`：通过。
- `pnpm --filter @multica/desktop typecheck`：通过。
- `pnpm --filter @multica/views test -- rooms rooms/components/room-member-sidebar.test.tsx councils --runInBand`：通过，`42 files / 261 tests`。
- `cd server && go test ./internal/handler -run 'TestChatSession_ListExcludesRoomInternal|TestCreateCouncilSessionRejectsForeignSourceChat|TestCreateSalonCouncilWithConvenerOnlyCreatesParticipantAndSourceChat|TestRoom'`：通过。
- `cd server && go test ./internal/service`：通过。
- `cd server && go test ./cmd/server ./internal/realtime`：通过。
- `cd server && go test ./internal/handler ./internal/service ./cmd/server ./pkg/db/...`：通过。
- `ENV_FILE=.env E2E_BACKEND_PORT=18081 pnpm test:e2e`：通过，`5 passed`；会自动启动并清理临时后端。

## CRUD 复核验证（2026-05-22）

- `cd server && go test ./internal/handler -run 'Test(RoomMessage_DeleteRoomAllowsActiveRoom|DeleteMeetingSessionRemovesMeetingAndDependents|DeleteProjectV12RemovesProjectFromList)'`：通过。
- `pnpm --filter @multica/core test -- api/client.test.ts --runInBand`：通过，`22 files / 186 tests`。
- `pnpm --filter @multica/views test -- rooms/room-detail-page.test.tsx rooms/components/room-member-sidebar.test.tsx --runInBand`：通过，`42 files / 263 tests`。
- 真实 API smoke against `localhost:8080`：茶水间、项目工作区、会议均为 `create 201 -> delete 204 -> get 404`。
- 运行态修复要求：后端 API 变更必须重建/替换 Docker Compose 项目 `multica` 的 `multica-backend-1`；只替换 `Origin.app` 不会更新 `localhost:8080`。

## 仍需跟进

- 本表内原先标记的待解决项已全部收口。
- 后续如果要做更大范围的项目工作区信息架构重做，应作为独立产品迭代立项，不再作为本轮风险清扫遗留漏洞。
