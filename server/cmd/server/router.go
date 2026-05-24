package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/multica-ai/multica/server/internal/analytics"
	"github.com/multica-ai/multica/server/internal/auth"
	"github.com/multica-ai/multica/server/internal/daemonws"
	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	obsmetrics "github.com/multica-ai/multica/server/internal/metrics"
	"github.com/multica-ai/multica/server/internal/middleware"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/storage"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

var defaultOrigins = []string{
	"http://localhost:3000", // Next.js dev
	"http://localhost:5173", // electron-vite dev
	"http://localhost:5174", // electron-vite dev (fallback port)
	"file://",               // packaged desktop app
}

func allowedOrigins() []string {
	if raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS")); raw != "" {
		return splitOrigins(raw)
	}
	frontendOrigin := strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN"))
	if frontendOrigin == "" {
		return defaultOrigins
	}

	origins := append([]string{}, defaultOrigins...)
	for _, origin := range splitOrigins(frontendOrigin) {
		seen := false
		for _, existing := range origins {
			if existing == origin {
				seen = true
				break
			}
		}
		if !seen {
			origins = append(origins, origin)
		}
	}
	return origins
}

func splitOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	if len(origins) == 0 {
		return defaultOrigins
	}
	return origins
}

// NewRouter creates the fully-configured Chi router with all middleware and routes.
// rdb is optional: when non-nil the runtime local-skill request stores are
// swapped for Redis-backed implementations so multiple API nodes share the
// same pending queue (required for multi-node prod). This should be a request
// path Redis client, not the realtime relay's blocking read client. A nil rdb
// keeps the default in-memory stores which are fine for single-node dev and
// tests.
func NewRouter(pool *pgxpool.Pool, hub *realtime.Hub, bus *events.Bus, analyticsClient analytics.Client, rdb *redis.Client) chi.Router {
	return NewRouterWithOptions(pool, hub, bus, analyticsClient, rdb, RouterOptions{})
}

type RouterOptions struct {
	HTTPMetrics  *obsmetrics.HTTPMetrics
	DaemonHub    *daemonws.Hub
	DaemonWakeup service.TaskWakeupNotifier
}

func NewRouterWithOptions(pool *pgxpool.Pool, hub *realtime.Hub, bus *events.Bus, analyticsClient analytics.Client, rdb *redis.Client, opts RouterOptions) chi.Router {
	queries := db.New(pool)
	emailSvc := service.NewEmailService()
	daemonHub := opts.DaemonHub
	if daemonHub == nil {
		daemonHub = daemonws.NewHub()
	}

	// Initialize storage with S3 as primary, fallback to local
	var store storage.Storage
	s3 := storage.NewS3StorageFromEnv()
	if s3 != nil {
		store = s3
	} else {
		local := storage.NewLocalStorageFromEnv()
		if local != nil {
			store = local
		}
	}

	cfSigner := auth.NewCloudFrontSignerFromEnv()

	signupConfig := handler.Config{
		AllowSignup:         os.Getenv("ALLOW_SIGNUP") != "false",
		AllowedEmails:       splitAndTrim(os.Getenv("ALLOWED_EMAILS")),
		AllowedEmailDomains: splitAndTrim(os.Getenv("ALLOWED_EMAIL_DOMAINS")),
	}
	h := handler.New(queries, pool, hub, bus, emailSvc, store, cfSigner, analyticsClient, signupConfig, daemonHub)
	if pool != nil {
		go func() {
			jobs, err := h.RecoverStaleMeetingASRJobs(context.Background(), time.Now().Add(-time.Minute))
			if err != nil {
				slog.Warn("meeting ASR stale job recovery failed", "error", err)
				return
			}
			if len(jobs) > 0 {
				slog.Info("meeting ASR stale jobs recovered", "count", len(jobs))
			}
		}()
	}
	if opts.DaemonWakeup != nil {
		h.TaskService.Wakeup = opts.DaemonWakeup
	}
	if rdb != nil {
		h.LocalSkillListStore = handler.NewRedisLocalSkillListStore(rdb)
		h.LocalSkillImportStore = handler.NewRedisLocalSkillImportStore(rdb)
	}
	// Auth caches: PAT cache is shared between the regular Auth middleware,
	// the DaemonAuth fallback (mul_) path, and the revoke handler
	// (invalidate). DaemonTokenCache backs the DaemonAuth mdt_ path. Both
	// constructors return nil when rdb is nil — every consumer handles that
	// as "no cache, always hit DB".
	patCache := auth.NewPATCache(rdb)
	daemonTokenCache := auth.NewDaemonTokenCache(rdb)
	h.PATCache = patCache
	h.DaemonTokenCache = daemonTokenCache

	// Empty-claim cache: lets the daemon poll path skip a Postgres
	// scan when a recent check confirmed the runtime had no queued
	// task. Returns nil when rdb is nil — TaskService treats that
	// as "no cache, always hit DB" (existing behavior).
	h.TaskService.EmptyClaim = service.NewEmptyClaimCache(rdb)

	// Wire WS heartbeat after stores are finalized so the WS path uses the
	// same (possibly Redis-backed) stores as the HTTP path.
	daemonHub.SetHeartbeatHandler(h.HandleDaemonWSHeartbeat)
	health := newServerHealth(pool)

	r := chi.NewRouter()

	// Global middleware
	r.Use(chimw.RequestID)
	r.Use(middleware.ClientMetadata)
	r.Use(middleware.RequestLogger)
	if opts.HTTPMetrics != nil {
		r.Use(opts.HTTPMetrics.Middleware)
	}
	r.Use(chimw.Recoverer)
	r.Use(middleware.ContentSecurityPolicy)
	origins := allowedOrigins()

	// Share allowed origins with WebSocket origin checker.
	realtime.SetAllowedOrigins(origins)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Workspace-ID", "X-Workspace-Slug", "X-Request-ID", "X-Agent-ID", "X-Task-ID", "X-CSRF-Token", "X-Client-Platform", "X-Client-Version", "X-Client-OS"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health / readiness checks
	r.Get("/health", health.liveHandler)
	r.Get("/readyz", health.readyHandler)
	r.Get("/healthz", health.readyHandler)

	// Realtime subsystem metrics — connection counts, slow-client evictions,
	// and per-event-type send QPS counters. Exposed as JSON so it can be
	// scraped by ops or surfaced in the admin UI without adding a Prometheus
	// dependency. See MUL-1138 (Phase 0).
	//
	// Access is restricted (MUL-1342): when REALTIME_METRICS_TOKEN is set,
	// callers must present it via Authorization: Bearer <token>. When the
	// env var is unset the handler only serves loopback callers so local
	// dev keeps working without exposing the metrics on a public listener.
	r.Get("/health/realtime", realtimeMetricsHandler(os.Getenv("REALTIME_METRICS_TOKEN")))

	// WebSocket
	mc := &membershipChecker{queries: queries}
	pr := &patResolver{queries: queries, cache: patCache}
	slugResolver := realtime.SlugResolver(func(ctx context.Context, slug string) (string, error) {
		ws, err := queries.GetWorkspaceBySlug(ctx, slug)
		if err != nil {
			return "", err
		}
		return util.UUIDToString(ws.ID), nil
	})
	r.Get("/ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.HandleWebSocket(hub, mc, pr, slugResolver, w, r)
	})

	// Local file serving (when using local storage)
	if local, ok := store.(*storage.LocalStorage); ok {
		r.Get("/uploads/*", func(w http.ResponseWriter, r *http.Request) {
			file := strings.TrimPrefix(r.URL.Path, "/uploads/")
			local.ServeFile(w, r, file)
		})
	}

	// Auth (public)
	r.Post("/auth/send-code", h.SendCode)
	r.Post("/auth/verify-code", h.VerifyCode)
	r.Post("/auth/local-signin", h.LocalSignIn)
	r.Post("/auth/google", h.GoogleLogin)
	r.Post("/auth/logout", h.Logout)

	// Public API
	r.Get("/api/config", h.GetConfig)

	// Daemon API routes (require daemon token or valid user token)
	r.Route("/api/daemon", func(r chi.Router) {
		r.Use(middleware.DaemonAuth(queries, patCache, daemonTokenCache))

		r.Post("/register", h.DaemonRegister)
		r.Post("/deregister", h.DaemonDeregister)
		r.Post("/heartbeat", h.DaemonHeartbeat)
		r.Get("/ws", h.DaemonWebSocket)
		r.Get("/workspaces/{workspaceId}/repos", h.GetDaemonWorkspaceRepos)

		r.Post("/runtimes/{runtimeId}/tasks/claim", h.ClaimTaskByRuntime)
		r.Get("/runtimes/{runtimeId}/tasks/pending", h.ListPendingTasksByRuntime)
		r.Post("/runtimes/{runtimeId}/update/{updateId}/result", h.ReportUpdateResult)
		r.Post("/runtimes/{runtimeId}/models/{requestId}/result", h.ReportModelListResult)
		r.Post("/runtimes/{runtimeId}/local-skills/{requestId}/result", h.ReportLocalSkillListResult)
		r.Post("/runtimes/{runtimeId}/local-skills/import/{requestId}/result", h.ReportLocalSkillImportResult)

		r.Get("/tasks/{taskId}/status", h.GetTaskStatus)
		r.Post("/tasks/{taskId}/start", h.StartTask)
		r.Post("/tasks/{taskId}/progress", h.ReportTaskProgress)
		r.Post("/tasks/{taskId}/complete", h.CompleteTask)
		r.Post("/tasks/{taskId}/fail", h.FailTask)
		r.Post("/tasks/{taskId}/usage", h.ReportTaskUsage)
		r.Post("/tasks/{taskId}/messages", h.ReportTaskMessages)
		r.Get("/tasks/{taskId}/messages", h.ListTaskMessages)

		r.Get("/issues/{issueId}/gc-check", h.GetIssueGCCheck)

		r.Post("/runtimes/{runtimeId}/recover-orphans", h.RecoverOrphanedTasks)
		r.Post("/tasks/{taskId}/session", h.PinTaskSession)
	})

	// Protected API routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(queries, patCache))
		r.Use(middleware.RefreshCloudFrontCookies(cfSigner))

		// --- User-scoped routes (no workspace context required) ---
		r.Get("/api/me", h.GetMe)
		r.Patch("/api/me", h.UpdateMe)
		r.Patch("/api/me/onboarding", h.PatchOnboarding)
		r.Post("/api/me/onboarding/complete", h.CompleteOnboarding)
		r.Post("/api/me/onboarding/cloud-waitlist", h.JoinCloudWaitlist)
		r.Post("/api/me/starter-content/import", h.ImportStarterContent)
		r.Post("/api/me/starter-content/dismiss", h.DismissStarterContent)
		r.Post("/api/cli-token", h.IssueCliToken)
		r.Post("/api/upload-file", h.UploadFile)
		r.Post("/api/feedback", h.CreateFeedback)

		r.Route("/api/workspaces", func(r chi.Router) {
			r.Get("/", h.ListWorkspaces)
			r.Post("/", h.CreateWorkspace)
			r.Route("/{id}", func(r chi.Router) {
				// Member-level access
				r.Group(func(r chi.Router) {
					r.Use(middleware.RequireWorkspaceMemberFromURL(queries, "id"))
					r.Get("/", h.GetWorkspace)
					r.Get("/members", h.ListMembersWithUser)
					r.Post("/leave", h.LeaveWorkspace)
					r.Get("/invitations", h.ListWorkspaceInvitations)
				})
				// Admin-level access
				r.Group(func(r chi.Router) {
					r.Use(middleware.RequireWorkspaceRoleFromURL(queries, "id", "owner", "admin"))
					r.Put("/", h.UpdateWorkspace)
					r.Patch("/", h.UpdateWorkspace)
					r.Post("/members", h.CreateInvitation)
					r.Route("/members/{memberId}", func(r chi.Router) {
						r.Patch("/", h.UpdateMember)
						r.Delete("/", h.DeleteMember)
					})
					r.Delete("/invitations/{invitationId}", h.RevokeInvitation)
				})
				// Owner-only access
				r.With(middleware.RequireWorkspaceRoleFromURL(queries, "id", "owner")).Delete("/", h.DeleteWorkspace)
			})
		})

		// User-scoped invitation routes (no workspace context required)
		r.Get("/api/invitations", h.ListMyInvitations)
		r.Get("/api/invitations/{id}", h.GetMyInvitation)
		r.Post("/api/invitations/{id}/accept", h.AcceptInvitation)
		r.Post("/api/invitations/{id}/decline", h.DeclineInvitation)

		r.Route("/api/tokens", func(r chi.Router) {
			r.Get("/", h.ListPersonalAccessTokens)
			r.Post("/", h.CreatePersonalAccessToken)
			r.Delete("/{id}", h.RevokePersonalAccessToken)
		})

		// --- Workspace-scoped routes (all require workspace membership) ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireWorkspaceMember(queries))

			// Assignee frequency
			r.Get("/api/assignee-frequency", h.GetAssigneeFrequency)

			// Issues
			r.Route("/api/issues", func(r chi.Router) {
				r.Get("/search", h.SearchIssues)
				r.Get("/child-progress", h.ChildIssueProgress)
				r.Get("/by-team-message/{messageId}", h.ListIssuesByTeamMessage)
				r.Get("/by-team-message/{messageId}/cards", h.ListDelegationTaskCardsByTeamMessage)
				r.Get("/", h.ListIssues)
				r.Post("/", h.CreateIssue)
				r.Post("/quick-create", h.QuickCreateIssue)
				r.Post("/batch-update", h.BatchUpdateIssues)
				r.Post("/batch-delete", h.BatchDeleteIssues)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetIssue)
					r.Put("/", h.UpdateIssue)
					r.Delete("/", h.DeleteIssue)
					r.Post("/comments", h.CreateComment)
					r.Get("/comments", h.ListComments)
					r.Get("/timeline", h.ListTimeline)
					r.Get("/subscribers", h.ListIssueSubscribers)
					r.Post("/subscribe", h.SubscribeToIssue)
					r.Post("/unsubscribe", h.UnsubscribeFromIssue)
					r.Get("/active-task", h.GetActiveTaskForIssue)
					r.Post("/tasks/{taskId}/cancel", h.CancelTask)
					r.Post("/rerun", h.RerunIssue)
					r.Get("/task-runs", h.ListTasksByIssue)
					r.Get("/usage", h.GetIssueUsage)
					r.Post("/reactions", h.AddIssueReaction)
					r.Delete("/reactions", h.RemoveIssueReaction)
					r.Get("/attachments", h.ListAttachments)
					r.Get("/children", h.ListChildIssues)
					r.Get("/labels", h.ListLabelsForIssue)
					r.Post("/labels", h.AttachLabel)
					r.Delete("/labels/{labelId}", h.DetachLabel)
				})
			})

			// Task messages (user-facing, not daemon auth)
			r.Get("/api/tasks/{taskId}/messages", h.ListTaskMessagesByUser)

			// Labels
			r.Route("/api/labels", func(r chi.Router) {
				r.Get("/", h.ListLabels)
				r.Post("/", h.CreateLabel)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetLabel)
					r.Put("/", h.UpdateLabel)
					r.Delete("/", h.DeleteLabel)
				})
			})

			// Projects
			r.Route("/api/projects", func(r chi.Router) {
				r.Get("/search", h.SearchProjects)
				r.Get("/", h.ListProjects)
				r.Post("/", h.CreateProject)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetProject)
					r.Put("/", h.UpdateProject)
					r.Delete("/", h.DeleteProject)
					r.Get("/resources", h.ListProjectResources)
					r.Post("/resources", h.CreateProjectResource)
					r.Delete("/resources/{resourceId}", h.DeleteProjectResource)
				})
			})

			// Autopilots
			r.Route("/api/autopilots", func(r chi.Router) {
				r.Get("/", h.ListAutopilots)
				r.Post("/", h.CreateAutopilot)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetAutopilot)
					r.Patch("/", h.UpdateAutopilot)
					r.Delete("/", h.DeleteAutopilot)
					r.Post("/trigger", h.TriggerAutopilot)
					r.Get("/runs", h.ListAutopilotRuns)
					r.Post("/triggers", h.CreateAutopilotTrigger)
					r.Route("/triggers/{triggerId}", func(r chi.Router) {
						r.Patch("/", h.UpdateAutopilotTrigger)
						r.Delete("/", h.DeleteAutopilotTrigger)
					})
				})
			})

			// Missions (Origin product-level work objects)
			r.Route("/api/missions", func(r chi.Router) {
				r.Get("/", h.ListMissions)
				r.Post("/", h.CreateMission)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetMission)
					r.Patch("/", h.UpdateMission)
					r.Post("/archive", h.ArchiveMission)
				})
			})

			// User Profile (Origin §14.10): single-row per (workspace, user)
			r.Route("/api/user-profile", func(r chi.Router) {
				r.Get("/", h.GetUserProfile)
				r.Put("/", h.UpsertUserProfile)
			})

			// Council Sessions (Origin on-demand multi-agent rooms)
			r.Route("/api/council-sessions", func(r chi.Router) {
				r.Get("/", h.ListCouncilSessions)
				r.Post("/", h.CreateCouncilSession)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetCouncilSession)
					r.Patch("/", h.UpdateCouncilSession)
					r.Delete("/", h.DeleteCouncilSession)
					r.Post("/adjourn", h.AdjournCouncilSession)
					r.Post("/archive", h.ArchiveCouncilSession)
					r.Post("/participants", h.AddCouncilSessionParticipant)
					r.Delete("/participants/{agentId}", h.RemoveCouncilSessionParticipant)
				})
			})

			// Rooms (客厅模块 v1.0.14 — 陪伴型多 agent 群聊空间)
			r.Route("/api/rooms", func(r chi.Router) {
				r.Get("/", h.ListRooms)
				r.Post("/", h.CreateRoom)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetRoom)
					r.Patch("/", h.UpdateRoom)
					r.Put("/", h.UpdateRoom)
					r.Post("/archive", h.ArchiveRoom)
					r.Delete("/", h.DeleteRoom)
					r.Get("/messages", h.ListRoomMessages)
					r.Post("/messages", h.SendRoomMessage)
					r.Get("/members", h.ListRoomMembers)
					r.Post("/members", h.AddRoomMember)
					r.Delete("/members/{memberId}", h.RemoveRoomMember)
					r.Route("/agents/{agentId}/persona", func(r chi.Router) {
						r.Get("/", h.GetRoomAgentPersona)
						r.Patch("/", h.UpsertRoomAgentPersona)
						r.Put("/", h.UpsertRoomAgentPersona)
					})
					r.Route("/members/{agentId}/persona", func(r chi.Router) {
						r.Get("/", h.GetRoomAgentPersona)
						r.Patch("/", h.UpsertRoomAgentPersona)
						r.Put("/", h.UpsertRoomAgentPersona)
					})
				})
			})

			// Ideas (Origin idea pool — lightweight pre-Mission incubation layer)
			r.Route("/api/ideas", func(r chi.Router) {
				r.Get("/", h.ListIdeas)
				r.Post("/", h.CreateIdea)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetIdea)
					r.Patch("/", h.UpdateIdea)
					r.Delete("/", h.DeleteIdea)
					r.Post("/archive", h.ArchiveIdea)
					r.Post("/promote", h.PromoteIdea)
					r.Get("/notes", h.ListIdeaNotes)
					r.Post("/notes", h.CreateIdeaNote)
					r.Delete("/notes/{noteId}", h.DeleteIdeaNote)
				})
			})

			// Explorations (Origin §14.7 — Branching Exploration with the
			// 7-field comparison contract)
			r.Route("/api/explorations", func(r chi.Router) {
				r.Get("/", h.ListExplorations)
				r.Post("/", h.CreateExploration)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetExploration)
					r.Patch("/", h.UpdateExploration)
					r.Delete("/", h.DeleteExploration)
					r.Post("/archive", h.ArchiveExploration)
					r.Post("/branches", h.CreateExplorationBranch)
					r.Patch("/branches/{branchId}", h.UpdateExplorationBranch)
					r.Delete("/branches/{branchId}", h.DeleteExplorationBranch)
				})
			})

			// ToolBindings (Origin §14.9 — attach external tools to a
			// Mission / Agent / Idea / Council)
			r.Route("/api/tool-bindings", func(r chi.Router) {
				r.Get("/", h.ListToolBindings)
				r.Post("/", h.CreateToolBinding)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetToolBinding)
					r.Patch("/", h.UpdateToolBinding)
					r.Delete("/", h.DeleteToolBinding)
				})
			})

			// Project workspaces (Origin §17 — v1.2). Mounted under /api/v12/
			// to avoid colliding with the legacy v1.0 /api/projects (issue
			// classification path). Frontend uses these endpoints; v1.0 path
			// kept for backwards compat only.
			r.Route("/api/v12/projects", func(r chi.Router) {
				r.Get("/", h.ListProjectsV12)
				r.Post("/", h.CreateProjectV12)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetProjectV12)
					r.Patch("/", h.UpdateProjectV12)
					r.Delete("/", h.DeleteProjectV12)
					r.Post("/archive", h.ArchiveProjectV12)
					r.Post("/memory-doc/append", h.AppendProjectMemoryDoc)
					r.Post("/memory/pin", h.PinChatMessageToProjectMemory)
					r.Get("/memories", h.ListAgentProjectMemoriesByProject)
					r.Get("/main-chat", h.GetProjectMainChat)
					r.Get("/main-chat/messages", h.ListProjectMainChatMessages)
					r.Post("/main-chat/messages", h.PostProjectMainChatMessage)
					r.Get("/history", h.GetProjectHistory)
					r.Post("/compact/preview", h.PreviewProjectCompaction)
					r.Post("/compact/preview-jobs", h.StartProjectCompactionPreviewJob)
					r.Get("/compact/preview-jobs/{taskId}", h.GetProjectCompactionPreviewJob)
					r.Post("/compact/confirm", h.ConfirmProjectCompaction)
					r.Get("/archived-sessions", h.ListProjectArchivedSessions)
				})
			})
			r.Get("/api/v12/teams/{teamId}/projects", h.ListProjectsByTeamV12)

			// Meeting copilot (Origin §18 — meeting audio, realtime transcript,
			// evidence cards, and workspace-scoped realtime events).
			r.Route("/api/v13/meetings", func(r chi.Router) {
				r.Get("/", h.ListMeetingSessions)
				r.Post("/", h.CreateMeetingSession)
				r.Get("/asr/status", h.GetMeetingASRStatus)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetMeetingSession)
					r.Patch("/", h.UpdateMeetingSession)
					r.Delete("/", h.DeleteMeetingSession)
					r.Post("/start", h.StartMeetingSession)
					r.Post("/stop", h.StopMeetingSession)
					r.Post("/archive", h.ArchiveMeetingSession)
					r.Get("/summary", h.GetMeetingSummary)
					r.Post("/summary", h.GenerateMeetingSummary)
					r.Get("/audio-assets", h.ListMeetingAudioAssets)
					r.Post("/audio-assets", h.UploadMeetingAudioAsset)
					r.Delete("/audio-assets/{assetId}", h.DeleteMeetingAudioAsset)
					r.Post("/audio-assets/{assetId}/asr-jobs", h.CreateMeetingASRJob)
					r.Get("/asr-jobs", h.ListMeetingASRJobs)
					r.Post("/asr-jobs/{jobId}/retry", h.RetryMeetingASRJob)
					r.Get("/transcript-segments", h.ListMeetingTranscriptSegments)
					r.Post("/transcript-segments", h.CreateMeetingTranscriptSegment)
					r.Patch("/transcript-segments/{segmentId}", h.UpdateMeetingTranscriptSegment)
					r.Delete("/transcript-segments/{segmentId}", h.DeleteMeetingTranscriptSegment)
					r.Post("/transcript-segments/{segmentId}/split", h.SplitMeetingTranscriptSegment)
					r.Post("/transcript-segments/{segmentId}/merge", h.MergeMeetingTranscriptSegments)
					r.Get("/insights", h.ListMeetingInsightCards)
					r.Patch("/insights/{insightId}", h.UpdateMeetingInsightStatus)
				})
			})

			// Pins
			r.Route("/api/pins", func(r chi.Router) {
				r.Get("/", h.ListPins)
				r.Post("/", h.CreatePin)
				r.Put("/reorder", h.ReorderPins)
				r.Delete("/{itemType}/{itemId}", h.DeletePin)
			})

			// Attachments
			r.Get("/api/attachments/{id}", h.GetAttachmentByID)
			r.Delete("/api/attachments/{id}", h.DeleteAttachment)

			// Comments
			r.Route("/api/comments/{commentId}", func(r chi.Router) {
				r.Put("/", h.UpdateComment)
				r.Delete("/", h.DeleteComment)
				r.Post("/reactions", h.AddReaction)
				r.Delete("/reactions", h.RemoveReaction)
			})

			// Agents
			r.Route("/api/agents", func(r chi.Router) {
				r.Get("/", h.ListAgents)
				r.Post("/", h.CreateAgent)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetAgent)
					r.Put("/", h.UpdateAgent)
					r.Post("/archive", h.ArchiveAgent)
					r.Post("/restore", h.RestoreAgent)
					r.Post("/cancel-tasks", h.CancelAgentTasks)
					r.Get("/tasks", h.ListAgentTasks)
					r.Get("/skills", h.ListAgentSkills)
					r.Put("/skills", h.SetAgentSkills)
					r.Get("/memories", h.ListAgentMemories)
					r.Post("/memories", h.CreateAgentMemory)
					r.Post("/memories/{memoryId}/confirm", h.ConfirmAgentMemory)
					r.Post("/memories/{memoryId}/reject", h.RejectAgentMemory)
					r.Get("/skill-candidates", h.ListAgentSkillCandidates)
					r.Post("/skill-candidates", h.CreateAgentSkillCandidate)
					r.Post("/skill-candidates/{candidateId}/confirm", h.ConfirmAgentSkillCandidate)
					r.Post("/skill-candidates/{candidateId}/reject", h.RejectAgentSkillCandidate)
					r.Get("/events", h.ListAgentEvents)
				})
			})

			// Teams (Phase 2: agent group + group chat)
			r.Route("/api/teams", func(r chi.Router) {
				r.Get("/", h.ListTeams)
				r.Post("/", h.CreateTeam)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetTeam)
					r.Patch("/", h.UpdateTeam)
					r.Delete("/", h.DeleteTeam)
					r.Post("/archive", h.ArchiveTeam)
					r.Post("/restore", h.RestoreTeam)
					r.Post("/members", h.AddTeamMember)
					r.Delete("/members/{memberId}", h.RemoveTeamMember)
					r.Get("/messages", h.ListTeamMessages)
					r.Post("/messages", h.PostTeamMessage)
				})
			})

			// Skills
			r.Route("/api/skills", func(r chi.Router) {
				r.Get("/", h.ListSkills)
				r.Post("/", h.CreateSkill)
				r.Post("/import", h.ImportSkill)
				r.Route("/{id}", func(r chi.Router) {
					r.Get("/", h.GetSkill)
					r.Put("/", h.UpdateSkill)
					r.Delete("/", h.DeleteSkill)
					r.Get("/files", h.ListSkillFiles)
					r.Put("/files", h.UpsertSkillFile)
					r.Delete("/files/{fileId}", h.DeleteSkillFile)
				})
			})

			// Usage
			r.Route("/api/usage", func(r chi.Router) {
				r.Get("/daily", h.GetWorkspaceUsageByDay)
				r.Get("/summary", h.GetWorkspaceUsageSummary)
			})

			// Runtimes
			r.Route("/api/runtimes", func(r chi.Router) {
				r.Get("/", h.ListAgentRuntimes)
				r.Route("/{runtimeId}", func(r chi.Router) {
					r.Get("/usage", h.GetRuntimeUsage)
					r.Get("/usage/by-agent", h.GetRuntimeUsageByAgent)
					r.Get("/usage/by-hour", h.GetRuntimeUsageByHour)
					r.Get("/activity", h.GetRuntimeTaskActivity)
					r.Post("/update", h.InitiateUpdate)
					r.Get("/update/{updateId}", h.GetUpdate)
					r.Post("/models", h.InitiateListModels)
					r.Get("/models/{requestId}", h.GetModelListRequest)
					r.Post("/local-skills", h.InitiateListLocalSkills)
					r.Get("/local-skills/{requestId}", h.GetLocalSkillListRequest)
					r.Post("/local-skills/import", h.InitiateImportLocalSkill)
					r.Get("/local-skills/import/{requestId}", h.GetLocalSkillImportRequest)
					r.Delete("/", h.DeleteAgentRuntime)
				})
			})

			// Tasks (user-facing, with ownership check)
			r.Post("/api/tasks/{taskId}/cancel", h.CancelTaskByUser)

			// Workspace-wide agent task snapshot for presence derivation:
			// every active task + each agent's most recent terminal task.
			r.Get("/api/agent-task-snapshot", h.ListWorkspaceAgentTaskSnapshot)

			// Workspace-wide daily agent activity (last 365d, anchored on
			// completed_at). Backs the Agents-list sparkline (trailing 7d
			// slice) AND the agent detail year heatmap.
			r.Get("/api/agent-activity-365d", h.GetWorkspaceAgentActivity365d)

			// Workspace-wide 30-day run counts per agent for the Agents-list RUNS column.
			r.Get("/api/agent-run-counts", h.GetWorkspaceAgentRunCounts)

			r.Route("/api/chat/sessions", func(r chi.Router) {
				r.Post("/", h.CreateChatSession)
				r.Get("/", h.ListChatSessions)
				r.Route("/{sessionId}", func(r chi.Router) {
					r.Get("/", h.GetChatSession)
					r.Delete("/", h.ArchiveChatSession)
					r.Post("/messages", h.SendChatMessage)
					r.Get("/messages", h.ListChatMessages)
					r.Get("/pending-task", h.GetPendingChatTask)
					r.Post("/read", h.MarkChatSessionRead)
				})
			})
			r.Get("/api/chat/pending-tasks", h.ListPendingChatTasks)

			// Inbox
			r.Route("/api/inbox", func(r chi.Router) {
				r.Get("/", h.ListInbox)
				r.Get("/unread-count", h.CountUnreadInbox)
				r.Post("/mark-all-read", h.MarkAllInboxRead)
				r.Post("/archive-all", h.ArchiveAllInbox)
				r.Post("/archive-all-read", h.ArchiveAllReadInbox)
				r.Post("/archive-completed", h.ArchiveCompletedInbox)
				r.Post("/{id}/read", h.MarkInboxRead)
				r.Post("/{id}/archive", h.ArchiveInboxItem)
			})

			// Notification preferences
			r.Route("/api/notification-preferences", func(r chi.Router) {
				r.Get("/", h.GetNotificationPreferences)
				r.Put("/", h.UpdateNotificationPreferences)
			})
		})
	})

	return r
}

// membershipChecker implements realtime.MembershipChecker using database queries.
type membershipChecker struct {
	queries *db.Queries
}

func (mc *membershipChecker) IsMember(ctx context.Context, userID, workspaceID string) bool {
	_, err := mc.queries.GetMemberByUserAndWorkspace(ctx, db.GetMemberByUserAndWorkspaceParams{
		UserID:      parseUUID(userID),
		WorkspaceID: parseUUID(workspaceID),
	})
	return err == nil
}

// patResolver implements realtime.PATResolver using database queries.
// patCache is shared with the Auth and DaemonAuth middlewares so a token
// revoke through any path invalidates the cache for all of them. Nil
// cache is supported and degrades to direct DB lookups.
type patResolver struct {
	queries *db.Queries
	cache   *auth.PATCache
}

func (pr *patResolver) ResolveToken(ctx context.Context, token string) (string, bool) {
	hash := auth.HashToken(token)

	if userID, ok := pr.cache.Get(ctx, hash); ok {
		return userID, true
	}

	pat, err := pr.queries.GetPersonalAccessTokenByHash(ctx, hash)
	if err != nil {
		return "", false
	}

	userID := util.UUIDToString(pat.UserID)

	var expiresAt time.Time
	if pat.ExpiresAt.Valid {
		expiresAt = pat.ExpiresAt.Time
	}
	pr.cache.Set(ctx, hash, userID, auth.TTLForExpiry(time.Now(), expiresAt))

	// Cache miss = first WS auth in this TTL window. Refresh last_used_at;
	// subsequent connects within the window skip the write.
	go pr.queries.UpdatePersonalAccessTokenLastUsed(context.Background(), pat.ID)

	return userID, true
}

// parseUUID is a thin alias for util.MustParseUUID. Call sites here are all
// internal round-trips of DB-sourced UUIDs (e.g. issue.ID, e.ActorID), so an
// invalid value indicates a programming error and should panic loudly.
func parseUUID(s string) pgtype.UUID {
	return util.MustParseUUID(s)
}

func splitAndTrim(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	res := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			res = append(res, trimmed)
		}
	}
	return res
}
