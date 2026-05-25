import { describe, expect, it } from "vitest";
import {
  buildGuidedSetupDisplaySnippets,
  buildGuidedSetupSnippets,
  getPrimaryConnectionFields,
  modelApiProviderDefaults,
  type GuidedSetupForm,
} from "./model-api-settings-tab";

function form(overrides: Partial<GuidedSetupForm> = {}): GuidedSetupForm {
  return {
    mode: "ccSwitch",
    apiKey: "",
    baseUrl: "",
    modelName: "",
    modelList: "",
    runtimeName: "",
    toolRoots: "",
    ...overrides,
  };
}

describe("buildGuidedSetupSnippets", () => {
  it("generates cc-switch commands with OpenAI-compatible environment variables", () => {
    const snippets = buildGuidedSetupSnippets(
      form({
        mode: "ccSwitch",
        apiKey: "sk-test",
        baseUrl: "http://127.0.0.1:3456/v1",
        modelName: "gpt-4.1-mini",
      }),
    );

    expect(snippets.launchctl).toContain('launchctl setenv OPENAI_API_KEY "sk-test"');
    expect(snippets.launchctl).toContain(
      'launchctl setenv OPENAI_BASE_URL "http://127.0.0.1:3456/v1"',
    );
    expect(snippets.launchctl).toContain('launchctl setenv OPENAI_MODEL "gpt-4.1-mini"');
    expect(snippets.launchctl).toContain('open -a "Origin"');
    expect(snippets.launchctl).not.toContain("ORIGIN_MODEL_API_KEY");
  });

  it("uses readable placeholders when the user has not entered values yet", () => {
    const snippets = buildGuidedSetupSnippets(form());

    expect(snippets.launchctl).toContain('launchctl setenv OPENAI_API_KEY "在这里粘贴 API Key"');
    expect(snippets.launchctl).toContain(
      'launchctl setenv OPENAI_BASE_URL "https://your-cc-switch.example/v1"',
    );
    expect(snippets.launchctl).toContain('launchctl setenv OPENAI_MODEL "模型 ID，例如 gpt-4.1-mini"');
    expect(snippets.launchctl).toContain(
      'launchctl setenv ORIGIN_MODEL_TOOL_ROOTS "$HOME/OriginWorkbenchMount"',
    );
  });

  it("generates dedicated Origin variables for relay mode", () => {
    const snippets = buildGuidedSetupSnippets(
      form({
        mode: "relay",
        apiKey: "relay-key",
        baseUrl: "https://relay.example/v1",
        modelName: "openrouter/auto",
        runtimeName: "OpenRouter",
      }),
    );

    expect(snippets.launchctl).toContain('launchctl setenv ORIGIN_MODEL_API_KEY "relay-key"');
    expect(snippets.launchctl).toContain(
      'launchctl setenv ORIGIN_MODEL_BASE_URL "https://relay.example/v1"',
    );
    expect(snippets.launchctl).toContain('launchctl setenv ORIGIN_MODEL_NAME "openrouter/auto"');
    expect(snippets.launchctl).toContain('launchctl setenv ORIGIN_MODEL_RUNTIME_NAME "OpenRouter"');
    expect(snippets.launchctl).not.toContain("OPENAI_API_KEY");
  });

  it("keeps generated commands shell-safe for common special characters", () => {
    const snippets = buildGuidedSetupSnippets(
      form({
        apiKey: 'sk-"$test`',
        baseUrl: "https://relay.example/v1",
        modelName: "gpt-4.1-mini",
      }),
    );

    expect(snippets.launchctl).toContain('launchctl setenv OPENAI_API_KEY "sk-\\"\\$test\\`"');
  });

  it("masks API keys in display snippets without changing copyable commands", () => {
    const input = form({
      apiKey: "sk-super-secret-key",
      baseUrl: "http://127.0.0.1:3456/v1",
      modelName: "gpt-4.1-mini",
    });

    const copyable = buildGuidedSetupSnippets(input);
    const display = buildGuidedSetupDisplaySnippets(input);

    expect(copyable.launchctl).toContain("sk-super-secret-key");
    expect(display.launchctl).not.toContain("sk-super-secret-key");
    expect(display.shell).not.toContain("sk-super-secret-key");
    expect(display.launchctl).toContain("sk-s********-key");
  });
});

describe("model API settings product helpers", () => {
  it("keeps the primary setup path focused on the required connection fields", () => {
    expect(getPrimaryConnectionFields("relay")).toEqual(["apiKey", "baseUrl", "modelName"]);
    expect(getPrimaryConnectionFields("official")).toEqual(["apiKey", "modelName"]);
  });

  it("uses real provider defaults without exposing environment variable details in the primary path", () => {
    expect(modelApiProviderDefaults("relay")).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      runtimeName: "OpenRouter / 中转站",
    });
    expect(modelApiProviderDefaults("ccSwitch")).toMatchObject({
      baseUrl: "https://your-cc-switch.example/v1",
      runtimeName: "cc-switch",
    });
  });
});
