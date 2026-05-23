import { describe, expect, it } from "vitest";
import { workbenchNewActions, workbenchTaskSections } from "./workbench-page";

describe("Workbench IA", () => {
  it("organizes the first screen by user task buckets", () => {
    expect(workbenchTaskSections.map((item) => item.title)).toEqual([
      "今日继续",
      "待处理",
      "新建",
    ]);
    expect(workbenchTaskSections[0].items).toEqual(["项目工作区", "进行中 Mission"]);
    expect(workbenchTaskSections[1].items).toEqual(["风险确认"]);
    expect(workbenchTaskSections.flatMap((item) => item.items)).not.toContain("信箱回报");
    expect(workbenchTaskSections[2].items).toEqual(["捕捉想法", "发起会议", "多角色议事", "方案对比"]);
  });

  it("keeps new actions task-oriented instead of restating sidebar entries", () => {
    expect(workbenchNewActions.map((item) => item.title)).toEqual([
      "捕捉想法",
      "发起会议",
      "多角色议事",
      "方案对比",
    ]);
    expect(workbenchNewActions.map((item) => item.title)).not.toContain("会议 Copilot");
    expect(workbenchNewActions.map((item) => item.title)).not.toContain("Council Session");
    expect(workbenchNewActions.map((item) => item.title)).not.toContain("记忆 / 技能");
  });
});
