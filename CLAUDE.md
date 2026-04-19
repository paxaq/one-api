# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

One API is a unified gateway / OpenRouter-style proxy that aggregates many upstream LLM providers (OpenAI, Anthropic, Azure, Vertex, DeepSeek, Replicate, AWS Bedrock, etc.) behind three interchangeable request formats: **Chat Completion**, **Response API**, and **Claude Messages**. Any client format must be transparently convertible to any upstream native format — even when a client posts to the "wrong" endpoint, middleware auto-detects and re-routes. New adaptors must support all three formats.

## Common Commands

Backend (Go 1.25):
- `go vet ./...` — required after changes
- `go test -race ./...` — required after changes
- Run a single test: `go test -race -run TestName ./path/to/pkg`
- Lint: `make lint` (runs goimports, gofmt, go vet, golangci-lint, govulncheck)
- Build binary: `go build -o one-api`
- Run: `./one-api` (loads `.env` automatically; default admin `root` / `123456`)

Frontend (use **yarn**, not npm — npm causes `yarn.lock` conflicts):
- `make dev` / `make dev-modern` — Modern dev server (port 3001)
- `make dev-air` (3002), `make dev-berry` (3003)
- `make build-frontend-modern` — required after frontend changes; output embedded into the Go binary via `//go:embed web/build/*`
- `make build-all-templates` — build Modern + Berry + Air

Templates: Modern, Berry, Air (the legacy "default" theme is auto-redirected to Modern). **Prioritize Modern**; the others are kept for compatibility only.

## Architecture

### Request flow
`main.go` boots gin, session store, DB (`model.InitDB` + separate `InitLogDB`), Redis, options/channel caches, MCP auto-sync, optional Prometheus/OpenTelemetry, then `router.SetRouter(server, buildFS)` which mounts:
- `router/api.go` — admin/user REST (`/api/...`)
- `router/dashboard.go` — usage/dashboard
- `router/relay.go` — the OpenAI-compatible `/v1/*`, `/v2/rerank`, Zhipu `/api/paas/v4/layout_parsing`
- `router/web.go` — serves the embedded frontend (`web/build/*`)

Relay middleware chain (in order): graceful in-flight tracking → panic recover → `TokenAuth` → `BindAsyncTaskChannel` → `Distribute` (picks channel by group/model) → global + per-channel rate limits. **Format auto-detect** and **Claude Code prefix rewrites** (`/v1/v1/messages`, `/openai/v1/messages`, etc.) run earlier, before auth, so misrouted requests redispatch through the correct path with full middleware.

`controller.Relay` is the entrypoint for chat/responses/messages/embeddings/images/videos/audio/moderations/rerank. It loads channel meta, picks the adaptor, and runs the convert → DoRequest → DoResponse pipeline; retry policy lives in `controller/relay_retry_test.go` + `should_retry_test.go`.

### Adaptor model
`relay/adaptor/interface.go` defines the core `Adaptor` interface every provider implements (`Init`, `GetRequestURL`, `SetupRequestHeader`, `ConvertRequest`, `ConvertImageRequest`, `ConvertClaudeRequest`, `DoRequest`, `DoResponse`, `GetModelList`, `GetChannelName`, plus pricing methods). Each provider lives in `relay/adaptor/<name>/` (openai, anthropic, gemini, vertexai, aws, bedrock variants, deepseek, etc.). Optional capability interfaces: `OCRAdaptor`, `RerankAdaptor`, `ToolingDefaultsProvider`. `DefaultPricingMethods` provides fallback ratio/completion/tooling implementations.

Pricing is per-adaptor via `GetDefaultModelPricing`/`GetModelRatio`/`GetCompletionRatio`. `ModelConfig` carries token ratios (incl. cached input, 5m/1h cache write), tiered pricing (`ModelRatioTier`), per-modality configs (`VideoPricingConfig`, `AudioPricingConfig`, `ImagePricingConfig`, `EmbeddingPricingConfig`), and built-in tool pricing (`ChannelToolConfig` / `ToolPricingConfig`). `relay.InitializeGlobalPricing()` (called from `main.go`) builds the global pricing manager from all adaptors.

Other `relay/` subpackages: `apitype`, `channeltype`, `relaymode`, `meta` (per-request meta), `model` (request/response DTOs), `pricing`, `quota`, `billing`, `streaming`, `tooling`, `mcp`, `client`, `format`, `controller` (relay-specific helpers).

### Persistence
- `model/` — GORM models. The repo uses **`gorm.io/gorm` only**; do **not** use `gorm.io/gorm/clause` or `Preload`. Prefer raw SQL for reads; use ORM mainly for writes/updates. Use `Scan` only when result shape differs from the table.
- Logs use a separate DB connection (`model.InitLogDB`) so log volume doesn't pressure the primary DB.
- Background workers: option/channel cache sync, batch quota updater (`config.BatchUpdateEnabled` — must flush via `model.StopBatchUpdater` before drain), trace + async-task retention cleaners, automatic channel testing.
- Graceful shutdown order matters: stop accepting → `srv.Shutdown` → flush batch updater → `graceful.Drain` (billing/refund tasks) → OTel shutdown → `CloseDB`.

### Frontend i18n
All UI strings must be in `web/modern/src/i18n/locales/`. Don't hardcode user-facing text.

## Conventions (from AGENTS.md — follow these strictly)

- **English only** for code, comments, logs, UI, chat output.
- **Errors:** wrap with `github.com/Laisky/errors/v2` (`errors.Wrap`, `Wrapf`, `WithStack`) — never return bare errors. Each error is processed **exactly once**: returned **or** logged, never both. Never swallow.
- **Logging:** structured Zap. In request paths use `gmw.GetLogger(c)` (from `github.com/Laisky/gin-middlewares/v7`) — call **once per function** and store locally. Use `zap.Error(err)`, not `fmt.Sprintf`. Don't log secrets.
- **Context:** thread `context.Context` through call chains.
- **Comments:** every function/interface needs a comment starting with its name describing purpose, params, return values.
- **File length:** ≤800 lines (Go files prefer ≤600). Split by responsibility.
- **Tests:** use `github.com/stretchr/testify/require`. Add/update unit tests for new features and fixes; no one-off scripts.
- **Time:** UTC everywhere. Date-range queries must include the entire final day (end **just before 00:00 of the next day**).
- **Security:** constant-time compare for tokens/signatures; password hashing ≥10,000 iterations (OWASP); validate/sanitize all untrusted input.
- **Frontend CSS:** no `!important`, no inline styles in HTML/JSX. When debugging in the browser console, log **strings only** (not objects).
- **Concurrent edits:** multiple agents may be editing — preserve others' changes; only halt on irreconcilable conflicts.

## Sensitive files

- `.github/instructions/laisky.instructions.md` — local debugging info. Treat as sensitive; never leak its contents.
