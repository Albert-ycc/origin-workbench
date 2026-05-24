import { describe, expect, it } from "vitest";
import {
  agentBadgeCardClassName,
  agentBadgeMetaLabels,
  formatAgentStartDate,
  getAgentModelLabel,
} from "./agent-card";
import {
  agentBadgeGridClassName,
  agentListLayout,
  agentPageSubtitle,
  agentPrimarySurface,
} from "./agents-page";

describe("AgentsPage IA", () => {
  it("keeps the agents page aligned with workspace list surfaces", () => {
    expect(agentPrimarySurface).toEqual({
      title: "智能体",
      primaryCta: "新建智能体",
      controls: ["搜索", "状态筛选", "排序"],
    });
    expect(agentListLayout).toBe("badge-grid");
  });

  it("does not expose legacy team ownership controls", () => {
    expect(agentPrimarySurface.controls).not.toContain("范围");
    expect(agentPrimarySurface.controls).not.toContain("我的");
    expect(agentPrimarySurface.controls).not.toContain("全部");
  });

  it("uses fixed-width badge columns that wrap to however many fit", () => {
    expect(agentBadgeGridClassName).toContain(
      "grid-cols-[repeat(auto-fill,minmax(21rem,21rem))]",
    );
    expect(agentBadgeGridClassName).toContain("justify-center");
    expect(agentBadgeGridClassName).not.toMatch(
      /(?:^|\s)(?:sm:|lg:|xl:)?grid-cols-[1-6](?:\s|$)/,
    );
  });

  it("keeps badge cards compact and focused on the required fields", () => {
    expect(agentBadgeCardClassName).toContain("w-[21rem]");
    expect(agentBadgeCardClassName).toContain("min-h-[18rem]");
    expect(agentBadgeCardClassName).not.toContain("min-h-[28rem]");
    expect(agentBadgeMetaLabels).toEqual(["入职时间", "当前模型", "运行次数"]);
    expect(formatAgentStartDate("2026-04-16T10:30:00Z")).toBe("2026-04-16");
    expect(formatAgentStartDate("not-a-date")).toBe("—");
    expect(getAgentModelLabel("claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(getAgentModelLabel("")).toBe("继承默认");
  });

  it("keeps explanatory copy short enough for the header chrome", () => {
    expect(agentPageSubtitle.length).toBeLessThanOrEqual(36);
    expect(agentPageSubtitle).toBe("配置智能体角色、运行来源和工作状态。");
  });
});
