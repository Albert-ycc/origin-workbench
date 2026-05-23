import { describe, expect, it, vi } from "vitest";
import {
  missionCreateFields,
  missionDetailTabs,
  missionHomeSections,
  closeCreateMissionDialog,
  shouldLoadMissionDetail,
} from "./missions-page";

describe("MissionsPage IA", () => {
  it("keeps the Mission home focused on overview work", () => {
    expect(missionHomeSections.map((section) => section.title)).toEqual([
      "Mission 总览",
      "待确认队列",
      "Mission 列表",
    ]);
  });

  it("moves creation into a flow with the required fields", () => {
    expect(missionCreateFields).toEqual([
      "目标",
      "负责人",
      "协作成员",
      "风险级别",
      "执行模式",
    ]);
  });

  it("only loads detail data after a mission drawer is opened", () => {
    expect(shouldLoadMissionDetail(null, false)).toBe(false);
    expect(shouldLoadMissionDetail("mission-1", false)).toBe(false);
    expect(shouldLoadMissionDetail("mission-1", true)).toBe(true);
  });

  it("keeps low-frequency detail surfaces behind tabs", () => {
    expect(missionDetailTabs.map((tab) => tab.label)).toEqual([
      "进度",
      "群聊",
      "详情",
    ]);
    expect(missionDetailTabs.find((tab) => tab.key === "details")?.items).toEqual([
      "团队",
      "能力 / 工具绑定",
      "执行记录",
      "记忆候选",
      "风险说明",
    ]);
  });

  it("resets the create form before closing it from cancel/close actions", () => {
    const reset = vi.fn();
    const onOpenChange = vi.fn();

    closeCreateMissionDialog({ isPending: false, reset, onOpenChange });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(reset.mock.invocationCallOrder[0]!).toBeLessThan(onOpenChange.mock.invocationCallOrder[0]!);
  });

  it("does not close or reset while create submission is pending", () => {
    const reset = vi.fn();
    const onOpenChange = vi.fn();

    closeCreateMissionDialog({ isPending: true, reset, onOpenChange });

    expect(reset).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
