import { describe, expect, it } from "vitest";
import {
  buildProviderPayload,
  maskApiKeyForDisplay,
  modelApiSettingsLayoutClasses,
  PROVIDER_PRESETS,
  type ProviderForm,
} from "./model-api-settings-tab";

function form(overrides: Partial<ProviderForm> = {}): ProviderForm {
  return {
    preset: "deepseek",
    name: "",
    apiKey: "",
    baseUrl: "",
    modelName: "",
    modelNames: "",
    runtimeName: "",
    toolRoots: "",
    ...overrides,
  };
}

describe("buildProviderPayload", () => {
  it("builds a DeepSeek preset payload and falls back model_names to model_name", () => {
    expect(
      buildProviderPayload(
        form({
          preset: "deepseek",
          name: "本地模型",
          apiKey: "sk-test",
          baseUrl: "https://api.deepseek.com/v1",
          modelName: "deepseek-chat",
        }),
      ),
    ).toMatchObject({
      preset: "deepseek",
      name: "本地模型",
      enabled: true,
      api_key: "sk-test",
      base_url: "https://api.deepseek.com/v1",
      model_name: "deepseek-chat",
      model_names: "deepseek-chat",
    });
  });

  it("omits empty optional fields and only adds tool_roots when provided", () => {
    const withoutTools = buildProviderPayload(
      form({ apiKey: "sk-test", modelName: "gpt-4.1-mini", toolRoots: "" }),
    );
    expect(withoutTools.tool_roots).toBeUndefined();
    expect(withoutTools.name).toBeUndefined();

    expect(
      buildProviderPayload(
        form({ apiKey: "sk-test", modelName: "gpt-4.1-mini", toolRoots: "/a,/b" }),
      ),
    ).toMatchObject({ tool_roots: "/a,/b" });
  });

  it("preserves the enabled flag when editing a disabled provider", () => {
    expect(
      buildProviderPayload(form({ apiKey: "sk-test", modelName: "deepseek-chat" }), false),
    ).toMatchObject({ enabled: false });
  });
});

describe("maskApiKeyForDisplay", () => {
  it("masks long keys while keeping first 4 and last 4 characters", () => {
    expect(maskApiKeyForDisplay("sk-super-secret-key")).toBe("sk-s********-key");
  });

  it("fully masks short keys and returns empty for empty input", () => {
    expect(maskApiKeyForDisplay("short")).toBe("********");
    expect(maskApiKeyForDisplay("")).toBe("");
    expect(maskApiKeyForDisplay("   ")).toBe("");
  });
});

describe("PROVIDER_PRESETS", () => {
  it("ships DeepSeek defaults for one-click setup", () => {
    const deepseek = PROVIDER_PRESETS.find((p) => p.id === "deepseek");
    expect(deepseek).toMatchObject({
      defaultBaseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      defaultRuntimeName: "DeepSeek API",
    });
  });
});

describe("modelApiSettingsLayoutClasses", () => {
  it("keeps container-safe layout classes for the dense desktop surface", () => {
    const shellGrid = modelApiSettingsLayoutClasses.shellGrid.split(/\s+/);
    const providerGrid = modelApiSettingsLayoutClasses.providerGrid.split(/\s+/);

    expect(shellGrid).toContain("2xl:grid-cols-[minmax(0,1fr)_340px]");
    expect(shellGrid).not.toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
    expect(providerGrid).toContain(
      "[grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),1fr))]",
    );
    expect(modelApiSettingsLayoutClasses.codeBadge).toContain("break-all");
  });
});
