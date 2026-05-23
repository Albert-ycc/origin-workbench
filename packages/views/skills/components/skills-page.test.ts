import { describe, expect, it } from "vitest";
import {
  skillDetailEntryLabel,
  skillListSecondaryActions,
  skillPageSubtitle,
  skillPrimarySurface,
} from "./skills-page";
import { skillRowDetailActionLabel } from "./skill-columns";

describe("SkillsPage IA", () => {
  it("keeps the skills page focused on list scanning", () => {
    expect(skillPrimarySurface).toEqual({
      title: "技能",
      primaryCta: "新建技能",
      controls: ["搜索", "筛选"],
    });
  });

  it("keeps explanatory copy to a short subtitle", () => {
    expect(skillPageSubtitle.length).toBeLessThanOrEqual(36);
    expect(skillPageSubtitle).toBe("工作区技能列表，可分配给智能体使用。");
  });

  it("keeps low-frequency skill work in secondary surfaces", () => {
    expect(skillListSecondaryActions).toEqual(["创建", "导入", "详情编辑", "删除确认"]);
  });

  it("makes row detail entry explicit", () => {
    expect(skillDetailEntryLabel).toBe("打开技能详情");
    expect(skillRowDetailActionLabel).toBe("打开技能详情");
  });
});
