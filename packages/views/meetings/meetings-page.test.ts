import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import {
  meetingDangerActions,
  meetingDangerConfirmations,
  meetingBackupSurfaces,
  meetingNavigationCopy,
  meetingPrimaryActions,
  meetingPrimarySurfaces,
  meetingSecondaryActions,
  SourceImportPanel,
} from "./meetings-page";

describe("MeetingsPage IA", () => {
  it("keeps the meeting detail focused on live process surfaces", () => {
    expect(meetingPrimarySurfaces).toEqual(["实时转写流", "关键洞察 / 旁听提示"]);
    expect(meetingBackupSurfaces).toEqual(["本地录音备份"]);
  });

  it("uses meeting as the navigation concept and keeps Copilot as capability copy", () => {
    expect(meetingNavigationCopy).toEqual({
      routeTitle: "会议",
      globalTitle: "会议工作台",
      projectTitle: "项目会议",
      capabilitySubtitle: "会议 Copilot 能力用于录音转写、Agent 旁听分析和会后沉淀",
    });
  });

  it("keeps only start and stop as primary meeting detail actions", () => {
    expect(meetingPrimaryActions).toEqual(["开始", "结束"]);
  });

  it("moves secondary meeting actions out of the detail first screen", () => {
    expect(meetingSecondaryActions).toEqual(["会议设置", "导入转写", "纪要生成 / 查看"]);
    expect(meetingDangerActions).toEqual(["归档", "删除"]);
  });

  it("uses AlertDialog for destructive meeting actions", () => {
    expect(meetingDangerConfirmations).toEqual({
      meetingDelete: "alert-dialog",
    });
  });

  it("keeps imported transcript text in a bounded scrollable editor", () => {
    render(
      createElement(SourceImportPanel, {
        text: Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 行转写`).join("\n"),
        onTextChange: () => {},
        onUploadClick: () => {},
        onSave: () => {},
        disabled: false,
      }),
    );

    const editor = screen.getByPlaceholderText("粘贴会议文件转写内容，保存后按段落写入本场会议");
    expect(editor).toHaveClass("[field-sizing:fixed]");
    expect(editor).toHaveClass("h-40");
    expect(editor).toHaveClass("max-h-40");
    expect(editor).toHaveClass("overflow-y-auto");
  });
});
