import type { Skill } from "@multica/core/types";

export interface SlashSkillTrigger {
  triggerStart: number;
  query: string;
}

export function findSlashSkillTrigger(
  value: string,
  caret: number,
): SlashSkillTrigger | null {
  if (caret < 1 || caret > value.length) return null;

  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === " " || ch === "\n" || ch === "\t") break;
    if (ch !== "/") continue;
    if (i > 0) {
      const prev = value[i - 1];
      if (prev !== " " && prev !== "\n" && prev !== "\t") return null;
    }
    return {
      triggerStart: i,
      query: value.slice(i + 1, caret),
    };
  }

  return null;
}

export function filterSlashSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.description ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function removeSlashSkillTrigger(
  value: string,
  trigger: SlashSkillTrigger,
): string {
  const before = value.slice(0, trigger.triggerStart);
  let after = value.slice(trigger.triggerStart + 1 + trigger.query.length);
  if (before.endsWith(" ") && after.startsWith(" ")) {
    after = after.slice(1);
  }
  if (!before) return after.replace(/^\s+/, "");
  if (!after) return before.replace(/\s+$/, "");
  return before + after;
}
