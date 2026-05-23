import { describe, expect, it, vi } from "vitest";
import {
  closeIdeaDetailAfterMutation,
  ideaDeleteConfirmation,
  ideaDetailActions,
  ideaHomeSections,
  shouldLoadIdeaDetail,
} from "./ideas-page";

describe("IdeasPage IA", () => {
  it("keeps the ideas home focused on capture and incubation list", () => {
    expect(ideaHomeSections.map((section) => section.title)).toEqual([
      "快速捕捉",
      "待孵化列表",
    ]);
  });

  it("only loads detail data when a detail drawer is open for a selected idea", () => {
    expect(shouldLoadIdeaDetail(null, false)).toBe(false);
    expect(shouldLoadIdeaDetail("idea-1", false)).toBe(false);
    expect(shouldLoadIdeaDetail(null, true)).toBe(false);
    expect(shouldLoadIdeaDetail("idea-1", true)).toBe(true);
  });

  it("keeps promote as the detail primary action and destructive actions low-weight", () => {
    expect(ideaDetailActions).toEqual({
      primary: "升级 Mission",
      secondary: ["添加笔记"],
      more: ["归档", "删除"],
    });
  });

  it("uses an AlertDialog confirmation instead of window.confirm for delete", () => {
    expect(ideaDeleteConfirmation).toEqual({
      mechanism: "alert-dialog",
      title: "删除想法",
    });
  });

  it("closes the drawer and clears selection after archive/delete/promote success", () => {
    const onOpenChange = vi.fn();
    const setSelectedId = vi.fn();

    closeIdeaDetailAfterMutation({ onOpenChange, setSelectedId });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(setSelectedId).toHaveBeenCalledWith(null);
  });
});
