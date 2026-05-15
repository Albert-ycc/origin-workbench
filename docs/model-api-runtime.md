# Model API Runtime

Origin can register an external OpenAI-compatible Chat Completions API, relay
gateway, or cc-switch / Codex OpenAI-compatible environment as a model runtime.
The model API provides the remote model brain; Origin now adds a server-side
tool-call loop with a small set of read-only local file tools so API runtime
chat tasks can inspect project context without depending on Codex or Claude
Code.

## Runtime Modes

| Mode | Model API provides | Origin provides | Local tools and skills |
|---|---|---|---|
| API runtime with file tools | Chat completion responses and tool-call decisions | Agent selection, prompt assembly, task queue integration, runtime status, tool-call loop, read-only file tools | list_directory, read_text_file, search_text |
| Full agent runtime | Reasoning and tool-call decisions | Tool registry, permission gates, execution adapters, audit trail | Filesystem write, shell, browser, MCP, provider-native skills |

The current implementation is the API runtime with read-only file tools.

## Current Scope

The current API runtime:

- reads configuration from backend process environment variables;
- accepts either Origin-specific `ORIGIN_MODEL_*` variables or common
  OpenAI-compatible variables written by tools such as cc-switch;
- creates a synthetic runtime marked with `managed_by=origin_api`;
- exposes model metadata to the desktop settings page;
- sends chat-style task prompts to an OpenAI-compatible `/chat/completions`
  endpoint;
- sends tool definitions for `list_directory`, `read_text_file`, and
  `search_text`;
- executes model-requested read-only file tools inside configured local roots
  and feeds tool results back to the model;
- reports failures back to the task lifecycle with explicit API errors.

It intentionally does not:

- write local files;
- run shell commands;
- control a browser;
- call MCP servers or desktop plugins;
- execute Codex, Claude Code, or provider-native skills as local actions.

Those abilities still belong to a full local agent runtime. The API runtime can
read and search allowed files, but it should not be presented as equivalent to
Codex or Claude Code yet.

## Configuration

Required:

```bash
export ORIGIN_MODEL_API_KEY="sk-..."
export ORIGIN_MODEL_NAME="gpt-4.1-mini"
```

Optional:

```bash
export ORIGIN_MODEL_PROVIDER="openai"
export ORIGIN_MODEL_BASE_URL="https://api.openai.com/v1"
export ORIGIN_MODEL_NAMES="gpt-4.1-mini,gpt-4.1"
export ORIGIN_MODEL_RUNTIME_NAME="Model API"
export ORIGIN_MODEL_TOOL_ROOTS="/Users/albert/OriginWorkbenchMount"
```

Origin-specific variables take precedence. If they are not set, Origin also
accepts these OpenAI-compatible aliases:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://your-relay.example/v1"
export OPENAI_MODEL="gpt-5-codex"
export OPENAI_MODELS="gpt-5-codex,claude-sonnet-4"
```

`OPENAI_API_BASE` and `OPENAI_API_BASE_URL` are accepted as Base URL aliases.
For cc-switch, use its Codex / OpenAI-compatible app profile. Claude Code
profiles usually write `ANTHROPIC_*` variables and should not be reused here
because this runtime calls `/chat/completions`.

For relay gateways, the Base URL normally includes `/v1`. If a user pastes the
full `/v1/chat/completions` endpoint, Origin normalizes it to avoid appending
`/chat/completions` twice.

API keys are read by the backend process. The desktop UI only shows whether a
key is configured; it does not store or display the key.

`ORIGIN_MODEL_TOOL_ROOTS` is a comma-separated allowlist. Relative tool paths are
resolved under the first root. Absolute tool paths are allowed only when they
stay inside one of the configured roots. If unset, the backend working directory
is used as the only tool root.

## Full Agent Runtime Roadmap

To make API-backed agents behave like local coding agents, Origin needs a
broader agent runtime layer:

1. Permission model for write, network, shell, browser, and MCP actions.
2. Execution adapters for file writes, shell, browser control, MCP, and desktop
   plugins.
3. Skill execution adapter that can safely map Codex / Claude Code style skills
   into Origin-owned tools.
4. Audit trail that records tool calls, arguments, outputs, failures, and user
   approvals.
5. UI capability badges that distinguish read-only API runtimes from full local
   agent runtimes.
