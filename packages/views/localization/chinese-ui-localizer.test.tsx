import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChineseUiLocalizer } from "./chinese-ui-localizer";

describe("ChineseUiLocalizer", () => {
  it("translates common dynamic UI text and attributes", async () => {
    render(
      <div>
        <ChineseUiLocalizer />
        <button type="button" aria-label="Row actions" title="View transcript">
          No matches
        </button>
        <input placeholder="Search skills…" />
        <input aria-label="Back to method chooser" title="Only the runtime owner and workspace admins can delete this runtime" />
        <p>Updated 3 issues</p>
        <p>Cancelled 2 tasks</p>
        <p>Showing 5 of 10</p>
        <p>This issue does not exist or has been deleted in this workspace.</p>
        <p>Any workspace member can delete issues.</p>
        <p>No pending invitations</p>
        <p>Opening Multica</p>
        <p>Schedule recurring tasks for your AI agents. Pick a template or start from scratch.</p>
        <p>Connect a remote machine</p>
        <p>When this runtime spent</p>
        <p>Join the cloud runtime waitlist</p>
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "行操作" })).toHaveAttribute(
        "title",
        "查看执行记录",
      );
      expect(screen.getByPlaceholderText("搜索技能…")).toBeInTheDocument();
      expect(screen.getByText("已更新 3 个任务")).toBeInTheDocument();
      expect(screen.getByText("已取消 2 个任务")).toBeInTheDocument();
      expect(screen.getByText("正在显示 5 / 10")).toBeInTheDocument();
      expect(screen.getByText("这个任务不存在，或已从当前工作区删除。")).toBeInTheDocument();
      expect(screen.getByText("任何工作区成员都可以删除任务。")).toBeInTheDocument();
      expect(screen.getByText("暂无待处理邀请")).toBeInTheDocument();
      expect(screen.getByText("正在打开 Multica")).toBeInTheDocument();
      expect(screen.getByText("为 AI 智能体设置周期性任务。选择模板，或从空白开始。")).toBeInTheDocument();
      expect(screen.getByText("连接远程机器")).toBeInTheDocument();
      expect(screen.getByText("此运行环境的消耗")).toBeInTheDocument();
      expect(screen.getByText("加入云端运行环境候补名单")).toBeInTheDocument();
      expect(screen.getByLabelText("返回选择方式")).toHaveAttribute(
        "title",
        "只有运行环境所有者和工作区管理员可以删除这个运行环境",
      );
    });
  });
});
