import { fireEvent, render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings-page";

vi.mock("./account-tab", () => ({ AccountTab: () => <div>个人资料内容</div> }));
vi.mock("./preferences-tab", () => ({ PreferencesTab: () => <div>偏好内容</div> }));
vi.mock("./appearance-tab", () => ({ AppearanceTab: () => <div>外观内容</div> }));
vi.mock("./notifications-tab", () => ({ NotificationsTab: () => <div>通知内容</div> }));
vi.mock("./tokens-tab", () => ({ TokensTab: () => <div>令牌内容</div> }));

describe("SettingsPage", () => {
  it("keeps normal tabs narrow while allowing dense desktop tabs to use a wide panel", () => {
    render(
      <SettingsPage
        extraAccountTabs={[
          {
            value: "narrow-extra",
            label: "窄面板",
            icon: Settings,
            content: <div>窄面板内容</div>,
          },
          {
            value: "wide-extra",
            label: "宽面板",
            icon: Settings,
            layout: "wide",
            content: <div>宽面板内容</div>,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "窄面板" }));
    expect(screen.getByText("窄面板内容").closest("[data-slot='tabs-content']")).toHaveClass(
      "max-w-3xl",
    );

    fireEvent.click(screen.getByRole("tab", { name: "宽面板" }));
    expect(screen.getByText("宽面板内容").closest("[data-slot='tabs-content']")).toHaveClass(
      "max-w-6xl",
    );
  });
});
