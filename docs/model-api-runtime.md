# Model API Runtime

Origin can register an external OpenAI-compatible Chat Completions API as a
model runtime. This gives Origin a remote model brain, but it does not by
itself provide the local agent abilities that Codex or Claude Code expose.

## Runtime Modes

| Mode | Model API provides | Origin provides | Local tools and skills |
|---|---|---|---|
| Lightweight API runtime | Chat completion responses | Agent selection, prompt assembly, task queue integration, runtime status | Not available |
| Full agent runtime | Reasoning and tool-call decisions | Tool registry, tool-call loop, permission gates, execution adapters, audit trail | Available after Origin implements those adapters |

The current implementation is the lightweight API runtime.

## Current Scope

The current API runtime:

- reads configuration from backend process environment variables;
- creates a synthetic runtime marked with `managed_by=origin_api`;
- exposes model metadata to the desktop settings page;
- sends chat-style task prompts to an OpenAI-compatible `/chat/completions`
  endpoint;
- reports failures back to the task lifecycle with explicit API errors.

It intentionally does not:

- read or write local files;
- run shell commands;
- control a browser;
- call MCP servers or desktop plugins;
- load Codex, Claude Code, or provider-native skills;
- execute model-requested tool calls.

Those abilities belong to an agent runtime, not to the model API alone.

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
```

API keys are read by the backend process. The desktop UI only shows whether a
key is configured; it does not store or display the key.

## Full Agent Runtime Roadmap

To make API-backed agents behave like local coding agents, Origin needs a
separate agent runtime layer:

1. Tool registry with schemas for filesystem, shell, browser, MCP, and skill
   execution.
2. Model tool-call loop that can submit tool definitions, execute selected
   tools, and feed tool results back to the model.
3. Permission model for read, write, network, shell, and browser actions.
4. Execution adapters that run tools locally and return structured results.
5. Audit trail that records tool calls, arguments, outputs, failures, and user
   approvals.
6. UI capability badges so users can distinguish chat-only runtimes from
   tool-enabled runtimes.

Until that layer exists, external model APIs should be described as chat-only
model backends.
