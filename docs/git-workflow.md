# Git 协作与发布流程

本文档定义 Origin Workbench 的代码管理约定。目标是让多个 Bug、功能和多个 Agent 可以并行推进，同时降低合并冲突、遗漏改动和误发生产的风险。

## 基本原则

- 生产代码只从稳定分支发布，不能直接在生产分支上改功能。
- 一个 Bug 或功能对应一个独立分支，避免多个任务混在同一批提交里。
- 多个 Agent 或多个进程并行工作时，必须使用独立 `git worktree` 和独立分支。
- 所有改动先合入测试集成分支验证，通过后再进入生产分支。
- 合并前先跑最快相关检查；涉及后端、接口、桌面端入口的改动需要补充真实运行验证。

## 分支职责

| 分支 | 用途 | 规则 |
|---|---|---|
| `main` | 生产环境 / 正式发布 | 只接收已验证改动；发布前打 tag 或 release |
| `develop` | 测试环境 / 集成验证 | 功能分支先合到这里；测试环境部署此分支 |
| `feature/*` | 新功能 | 从 `develop` 拉出，完成后合回 `develop` |
| `fix/*` | 普通 Bug 修复 | 从 `develop` 拉出，完成后合回 `develop` |
| `hotfix/*` | 生产紧急修复 | 从 `main` 拉出，修完后同时合回 `main` 和 `develop` |

如果当前仓库还没有 `develop`，先从当前稳定分支创建：

```bash
git switch main
git pull --ff-only
git switch -c develop
git push -u origin develop
```

## 单任务开发流程

普通功能或 Bug：

```bash
git switch develop
git pull --ff-only
git switch -c fix/example-bug
```

完成修改后：

```bash
git status --short
pnpm --filter @multica/core typecheck
git add <changed-files>
git commit -m "fix: describe the bug"
git switch develop
git pull --ff-only
git merge --no-ff fix/example-bug
```

检查命令按实际改动选择，不需要每次全量跑：

```bash
pnpm --filter @multica/desktop typecheck
pnpm --filter @multica/views typecheck
pnpm --filter @multica/core typecheck
cd server && go test ./...
```

## 多任务并行流程

同一时间开三五个任务时，不要让多个 Agent 共用同一个目录。每个任务使用独立 worktree：

```bash
git switch develop
git pull --ff-only

git worktree add ../origin-fix-login -b fix/login-timeout develop
git worktree add ../origin-feature-report -b feature/nutrition-report develop
git worktree add ../origin-fix-room -b fix/room-message-sync develop
```

每个目录只服务一个任务：

```bash
cd ../origin-fix-login
git status --short --branch
```

任务结束并合回后，清理对应 worktree：

```bash
git worktree remove ../origin-fix-login
git branch -d fix/login-timeout
```

## 测试环境到生产环境

建议测试环境始终部署 `develop`：

```bash
git switch develop
git pull --ff-only
```

测试通过后再发布生产：

```bash
git switch main
git pull --ff-only
git merge --no-ff develop
git tag vX.Y.Z
git push origin main vX.Y.Z
```

如果使用 GitHub PR：

- `feature/*` 或 `fix/*` 提 PR 到 `develop`。
- `develop` 验证通过后，再由 `develop` 提 PR 到 `main`。
- `main` 合并后创建 GitHub Release 或 tag。

## 冲突处理

合并前先确认当前任务基于最新 `develop`：

```bash
git switch fix/example-bug
git fetch origin
git rebase origin/develop
```

如果出现冲突：

1. 只解决当前任务相关文件的冲突。
2. 不顺手重构无关文件。
3. 解决后跑该任务相关的最快检查。
4. 合并前用 `git diff develop...HEAD` 确认本分支只包含当前任务改动。

## 紧急生产修复

生产事故走 `hotfix/*`：

```bash
git switch main
git pull --ff-only
git switch -c hotfix/production-issue
```

修复验证后：

```bash
git switch main
git merge --no-ff hotfix/production-issue
git tag vX.Y.Z
git push origin main vX.Y.Z

git switch develop
git pull --ff-only
git merge --no-ff hotfix/production-issue
git push origin develop
```

## Agent 协作约定

- 开始改代码前，先说明本次任务目录、分支和预计修改文件。
- 一个 Agent 不接管另一个 Agent 的 worktree。
- 如果发现目标文件已有未提交改动，先判断是否属于当前任务；不确定时暂停并说明风险。
- 合并前必须给出：改了什么、验证了什么、还有什么没验证。
- 文档、配置和脚本改动也按同样流程走分支和测试环境验证。
