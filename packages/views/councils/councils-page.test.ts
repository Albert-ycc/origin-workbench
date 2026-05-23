import { describe, expect, it, vi } from "vitest";
import {
  closeCouncilAfterMutation,
  councilDangerActions,
  councilDangerConfirmations,
  councilProductCopy,
} from "./councils-page";

describe("CouncilsPage IA", () => {
  it("uses multi-role council language instead of meeting-room language", () => {
    expect(councilProductCopy).toEqual({
      title: "多角色议事",
      detailTitle: "议事详情",
      createAction: "发起议事",
      listTitle: "议事列表",
      emptyTitle: "还没有多角色议事",
    });
    expect(Object.values(councilProductCopy).join(" ")).not.toContain("会议室");
    expect(Object.values(councilProductCopy).join(" ")).not.toContain("新建会议");
  });

  it("keeps council dangerous actions low-weight and confirmed", () => {
    expect(councilDangerActions).toEqual(["归档", "删除"]);
    expect(councilDangerConfirmations).toEqual({
      councilDelete: "alert-dialog",
    });
  });

  it("clears selected council after archive or delete", () => {
    const setSelectedId = vi.fn();

    closeCouncilAfterMutation({ setSelectedId });

    expect(setSelectedId).toHaveBeenCalledWith(null);
  });
});
