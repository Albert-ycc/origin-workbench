package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// fakeRoomPersonaQuerier 实现 roomAgentPersonaQuerier，注入预设行/错误。
type fakeRoomPersonaQuerier struct {
	row db.RoomAgentPersona
	err error
}

func (f *fakeRoomPersonaQuerier) GetRoomAgentPersona(ctx context.Context, arg db.GetRoomAgentPersonaParams) (db.RoomAgentPersona, error) {
	return f.row, f.err
}

const (
	roomUUID    = "11111111-1111-1111-1111-111111111111"
	agentUUID   = "22222222-2222-2222-2222-222222222222"
	councilUUID = "33333333-3333-3333-3333-333333333333"
)

func TestRoomPersonaOverrideRoomScenario(t *testing.T) {
	// room 场景：sessionID 即 room.ID，fake 返回带 override 的行。
	q := &fakeRoomPersonaQuerier{
		row: db.RoomAgentPersona{
			PersonaOverride: []byte(`{"nickname":"小红","tone":"俏皮"}`),
		},
	}
	got := roomPersonaOverride(context.Background(), q, roomUUID, agentUUID)
	if got == nil {
		t.Fatal("room scenario should return a non-nil override map")
	}
	if got["nickname"] != "小红" || got["tone"] != "俏皮" {
		t.Fatalf("override map = %v, want {nickname:小红 tone:俏皮}", got)
	}
}

func TestRoomPersonaOverrideCouncilTeamNoRowsIsNil(t *testing.T) {
	// council/team 场景：sessionID 是 council/team UUID 而非 room_id，
	// 查询返回 ErrNoRows → nil。
	q := &fakeRoomPersonaQuerier{err: pgx.ErrNoRows}
	if got := roomPersonaOverride(context.Background(), q, councilUUID, agentUUID); got != nil {
		t.Fatalf("council/team scenario should be nil, got %v", got)
	}
}

func TestRoomPersonaOverrideEmptyOverrideIsNil(t *testing.T) {
	q := &fakeRoomPersonaQuerier{row: db.RoomAgentPersona{PersonaOverride: []byte(`{}`)}}
	if got := roomPersonaOverride(context.Background(), q, roomUUID, agentUUID); got != nil {
		t.Fatalf("empty override should be nil, got %v", got)
	}
	q = &fakeRoomPersonaQuerier{row: db.RoomAgentPersona{}}
	if got := roomPersonaOverride(context.Background(), q, roomUUID, agentUUID); got != nil {
		t.Fatalf("nil override bytes should be nil, got %v", got)
	}
}

func TestRoomPersonaOverrideInvalidJSONIsNil(t *testing.T) {
	q := &fakeRoomPersonaQuerier{row: db.RoomAgentPersona{PersonaOverride: []byte("not json")}}
	if got := roomPersonaOverride(context.Background(), q, roomUUID, agentUUID); got != nil {
		t.Fatalf("invalid JSON override should be nil, got %v", got)
	}
}

func TestRoomPersonaOverrideInvalidUUIDIsNil(t *testing.T) {
	q := &fakeRoomPersonaQuerier{row: db.RoomAgentPersona{PersonaOverride: []byte(`{"x":"y"}`)}}
	if got := roomPersonaOverride(context.Background(), q, "not-a-uuid", agentUUID); got != nil {
		t.Fatalf("invalid room UUID should be nil, got %v", got)
	}
	if got := roomPersonaOverride(context.Background(), q, roomUUID, "not-a-uuid"); got != nil {
		t.Fatalf("invalid agent UUID should be nil, got %v", got)
	}
}

func TestRoomPersonaOverrideEmptyIDsIsNil(t *testing.T) {
	if got := roomPersonaOverride(context.Background(), &fakeRoomPersonaQuerier{}, "", agentUUID); got != nil {
		t.Fatalf("empty sessionID should be nil, got %v", got)
	}
	if got := roomPersonaOverride(context.Background(), &fakeRoomPersonaQuerier{}, roomUUID, ""); got != nil {
		t.Fatalf("empty agentID should be nil, got %v", got)
	}
}

func TestRoomPersonaOverrideQueryErrorIsNil(t *testing.T) {
	// 非 NoRows 错误：记 warn 但返回 nil，不阻塞 relay 链。
	q := &fakeRoomPersonaQuerier{err: errors.New("db down")}
	if got := roomPersonaOverride(context.Background(), q, roomUUID, agentUUID); got != nil {
		t.Fatalf("query error should be nil, got %v", got)
	}
}
