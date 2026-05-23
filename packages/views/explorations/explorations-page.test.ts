import { describe, expect, it, vi } from "vitest";
import {
  branchEditFields,
  closeExplorationAfterMutation,
  explorationDangerConfirmations,
  explorationHomeSections,
  explorationPrimarySurfaces,
  shouldLoadExplorationDetail,
} from "./explorations-page";

describe("ExplorationsPage IA", () => {
  it("keeps the page focused on list and the comparison table", () => {
    expect(explorationHomeSections.map((section) => section.title)).toEqual([
      "探索列表",
      "当前探索对比表",
    ]);
    expect(explorationPrimarySurfaces).toEqual(["探索列表", "7 字段横向对比"]);
  });

  it("keeps all seven branch fields available in the edit drawer", () => {
    expect(branchEditFields.map((field) => field.label)).toEqual([
      "方案核心",
      "设计逻辑",
      "关键决策",
      "成本估算",
      "风险点",
      "适用条件",
      "不适用条件",
    ]);
  });

  it("does not load exploration detail before the user selects one", () => {
    expect(shouldLoadExplorationDetail(null)).toBe(false);
    expect(shouldLoadExplorationDetail("exploration-1")).toBe(true);
  });

  it("clears the selected exploration after archive or delete", () => {
    const setSelectedId = vi.fn();

    closeExplorationAfterMutation({ setSelectedId });

    expect(setSelectedId).toHaveBeenCalledWith(null);
  });

  it("uses AlertDialog confirmations for dangerous actions", () => {
    expect(explorationDangerConfirmations).toEqual({
      explorationDelete: "alert-dialog",
      branchDelete: "alert-dialog",
    });
  });
});
