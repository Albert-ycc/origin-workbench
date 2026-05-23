import { describe, expect, it } from "vitest";
import { productNav, systemNav } from "./app-sidebar";

describe("AppSidebar IA", () => {
  it("keeps the Origin product navigation focused on the primary work path", () => {
    expect(productNav.map((item) => item.label)).toEqual([
      "原点工作台",
      "项目工作区",
      "智能体",
      "茶水间",
      "能力池",
      "技能",
      "设置",
    ]);
  });

  it("keeps secondary capabilities out of the top-level product nav", () => {
    const labels = productNav.map((item) => item.label);
    expect(labels).not.toContain("想法池");
    expect(labels).not.toContain("会议室");
    expect(labels).not.toContain("任务中枢");
    expect(labels).not.toContain("分叉探索");
    expect(labels).not.toContain("会议 Copilot");
    expect(systemNav.map((item) => item.label)).not.toContain("记忆 / 技能");
    expect(labels).not.toContain("记忆 / 技能");
  });
});
