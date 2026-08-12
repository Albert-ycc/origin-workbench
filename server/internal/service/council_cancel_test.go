package service

import (
	"encoding/json"
	"testing"

	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// relayCancelTestService 只测 relay 中止句柄机制，不依赖 DB。Bus 保持 nil，
// 注册时传空 workspaceID 使 CancelCouncilSession 跳过事件发布。
func relayCancelTestService() *TaskService {
	return &TaskService{}
}

func TestRegisterCouncilSessionReturnsHandleCtx(t *testing.T) {
	s := relayCancelTestService()
	key := broadcastRelayKey("council", "c-1")

	ctx := s.RegisterCouncilSession("council", "c-1", "chat-1", "")
	if ctx == nil {
		t.Fatal("RegisterCouncilSession returned nil ctx")
	}
	if h := relayHandleFromCtx(ctx); h == nil {
		t.Fatal("ctx does not carry councilRelayHandle")
	}
	// 刚注册的链应处于活跃状态
	if s.councilRelayCanceled(key, relayHandleFromCtx(ctx).generation) {
		t.Fatal("fresh chain should be active")
	}
	councilCancels.Delete(key)
}

func TestReRegisterReplacesOldChain(t *testing.T) {
	s := relayCancelTestService()
	key := broadcastRelayKey("council", "c-1")

	oldCtx := s.RegisterCouncilSession("council", "c-1", "chat-1", "")
	oldGen := relayHandleFromCtx(oldCtx).generation

	// 重复 @全体：新链覆盖旧句柄
	newCtx := s.RegisterCouncilSession("council", "c-1", "chat-1", "")
	newGen := relayHandleFromCtx(newCtx).generation
	if oldGen == newGen {
		t.Fatal("re-registration should allocate a new generation")
	}

	// 旧链推进前应感知自己被取代而停止
	if !s.councilRelayCanceled(key, oldGen) {
		t.Fatal("old chain should stop after re-registration")
	}
	// 新链保持活跃
	if s.councilRelayCanceled(key, newGen) {
		t.Fatal("new chain should stay active")
	}
	councilCancels.Delete(key)
}

func TestCancelCouncilRelayStopsChain(t *testing.T) {
	s := relayCancelTestService()
	key := broadcastRelayKey("team", "team-1")

	ctx := s.RegisterCouncilSession("team", "team-1", "chat-1", "")
	gen := relayHandleFromCtx(ctx).generation

	s.CancelCouncilRelay("team", "team-1")
	if !s.councilRelayCanceled(key, gen) {
		t.Fatal("chain should be canceled after CancelCouncilRelay")
	}
	// 幂等：对已删除的 key 再取消不 panic
	s.CancelCouncilRelay("team", "team-1")
}

func TestCouncilRelayCanceledMissingHandleIsStopped(t *testing.T) {
	s := relayCancelTestService()
	// 从未注册 / 已 deregister 的 key 一律视为中止
	if !s.councilRelayCanceled(broadcastRelayKey("council", "never-registered"), 1) {
		t.Fatal("missing handle should be treated as canceled")
	}
}

func TestDeregisterEndsChain(t *testing.T) {
	s := relayCancelTestService()
	key := broadcastRelayKey("council", "c-2")

	ctx := s.RegisterCouncilSession("council", "c-2", "chat-2", "")
	gen := relayHandleFromCtx(ctx).generation
	s.deregisterCouncilSession(key)

	if !s.councilRelayCanceled(key, gen) {
		t.Fatal("deregistered chain should stop")
	}
}

func TestCancelCouncilRelayForTaskFromContext(t *testing.T) {
	s := relayCancelTestService()
	key := broadcastRelayKey("council", "c-3")

	ctx := s.RegisterCouncilSession("council", "c-3", "chat-3", "")
	gen := relayHandleFromCtx(ctx).generation

	// 构造 relay 链上一环的 task（Context 是 CouncilBroadcastContext）
	raw, err := json.Marshal(CouncilBroadcastContext{
		Type:             CouncilBroadcastContextType,
		CouncilSessionID: "c-3",
		SourceKind:       CouncilBroadcastSourceCouncil,
	})
	if err != nil {
		t.Fatalf("marshal context: %v", err)
	}
	s.CancelCouncilRelayForTask(db.AgentTaskQueue{Context: raw})

	if !s.councilRelayCanceled(key, gen) {
		t.Fatal("CancelCouncilRelayForTask should cancel the owning chain")
	}
	councilCancels.Delete(key)
}

func TestCancelCouncilRelayForTaskIgnoresNonBroadcast(t *testing.T) {
	s := relayCancelTestService()

	// 普通聊天任务（无 Context）不应取消任何链，也不 panic
	s.CancelCouncilRelayForTask(db.AgentTaskQueue{})
	// 非 broadcast 类型的 Context 同样不生效
	raw, _ := json.Marshal(map[string]string{"type": "quick_create"})
	s.CancelCouncilRelayForTask(db.AgentTaskQueue{Context: raw})
}
