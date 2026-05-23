import { describe, expect, it } from "vitest";
import {
  keepProjectItems,
  projectCouncilCopy,
  projectCreateFlowTypes,
  projectMoreMenuGroups,
  projectPrimaryActions,
  projectResourcePanelDefault,
} from "./project-workspace-page";

describe("ProjectWorkspacePage IA", () => {
  it("keeps the top bar focused on primary project actions", () => {
    expect(projectPrimaryActions).toEqual(["成员", "会议", "更多", "资料栏"]);
  });

  it("groups low-frequency and dangerous actions under more", () => {
    expect(projectMoreMenuGroups).toEqual([
      { group: "协作类", items: ["多角色议事 / Council"] },
      { group: "维护类", items: ["整理 + 重新出发"] },
      { group: "危险类", items: ["归档", "删除"] },
    ]);
  });

  it("uses multi-role council language for the project council launcher", () => {
    expect(projectCouncilCopy).toEqual({
      dialogTitle: "发起多角色议事",
      success: "多角色议事已发起",
      participantLabel: "参与角色",
    });
    expect(Object.values(projectCouncilCopy).join(" ")).not.toContain("会议室");
    expect(Object.values(projectCouncilCopy).join(" ")).not.toContain("Council Session");
  });

  it("uses a single project create flow instead of three always-visible composers", () => {
    expect(projectCreateFlowTypes.map((item) => item.label)).toEqual([
      "Mission",
      "Idea",
      "Exploration",
    ]);
  });

  it("defaults the resource panel to memory summary", () => {
    expect(projectResourcePanelDefault).toEqual({
      title: "项目记忆摘要",
      secondaryEntrypoints: ["文件", "项目入口", "会话归档"],
    });
  });

  it("keeps only items explicitly belonging to the current project", () => {
    const items = [
      { id: "match", project_id: "project-1" },
      { id: "other", project_id: "project-2" },
      { id: "missing" },
      { id: "null", project_id: null },
    ];

    expect(keepProjectItems(items, "project-1")).toEqual([
      { id: "match", project_id: "project-1" },
    ]);
  });
});
