import { describe, expect, it } from "vitest";
import type { Skill } from "@multica/core/types";
import {
  findSlashSkillTrigger,
  filterSlashSkills,
  removeSlashSkillTrigger,
} from "./skill-slash";

const skills = [
  skill("skill-1", "frontend-design", "Build polished frontend UI"),
  skill("skill-2", "test-driven-development", "Write failing tests first"),
  skill("skill-3", "lark-doc", "Operate Feishu documents"),
];

describe("skill slash helpers", () => {
  it("opens only for slash commands at a word boundary", () => {
    expect(findSlashSkillTrigger("/", 1)).toEqual({ triggerStart: 0, query: "" });
    expect(findSlashSkillTrigger("请用 /front", 9)).toEqual({
      triggerStart: 3,
      query: "front",
    });
    expect(findSlashSkillTrigger("https://example.com/a", 21)).toBeNull();
  });

  it("filters by skill name and description", () => {
    expect(filterSlashSkills(skills, "test").map((s) => s.name)).toEqual([
      "test-driven-development",
    ]);
    expect(filterSlashSkills(skills, "feishu").map((s) => s.name)).toEqual([
      "lark-doc",
    ]);
  });

  it("removes the slash query after a skill is selected", () => {
    expect(removeSlashSkillTrigger("请用 /front 做首屏", { triggerStart: 3, query: "front" })).toBe(
      "请用 做首屏",
    );
    expect(removeSlashSkillTrigger("/test", { triggerStart: 0, query: "test" })).toBe("");
  });
});

function skill(id: string, name: string, description: string): Skill {
  return {
    id,
    name,
    description,
    workspace_id: "workspace-1",
    content: "",
    config: {},
    files: [],
    created_by: null,
    created_at: "2026-05-06T00:00:00Z",
    updated_at: "2026-05-06T00:00:00Z",
  };
}
