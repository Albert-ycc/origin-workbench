import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ONBOARDING_STEP_ORDER } from "@multica/core/onboarding";
import { StepHeader } from "./step-header";

describe("StepHeader", () => {
  it("renders one dot per step in ONBOARDING_STEP_ORDER", () => {
    const { container } = render(<StepHeader currentStep="questionnaire" />);
    const dots = container.querySelectorAll('[aria-hidden="true"]');
    expect(dots).toHaveLength(ONBOARDING_STEP_ORDER.length);
  });

  it("shows step count text matching the current step's position", () => {
    // workspace is index 1 (0-indexed) → Step 2 of 5
    render(<StepHeader currentStep="workspace" />);
    expect(
      screen.getByText(`第 2 步，共 ${ONBOARDING_STEP_ORDER.length} 步`),
    ).toBeInTheDocument();
  });

  it("sets accessible progressbar attrs", () => {
    render(<StepHeader currentStep="agent" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "4"); // agent is index 3 → step 4
    expect(bar).toHaveAttribute("aria-valuemax", String(ONBOARDING_STEP_ORDER.length));
  });

  it("falls back to step 1 when given an unknown step", () => {
    // TS would normally prevent this, but at runtime the store enum and
    // the flow's local step could drift during a refactor — the header
    // must not crash. Assert the defensive fallback lands on step 1.
    render(<StepHeader currentStep={"bogus" as never} />);
    expect(
      screen.getByText(`第 1 步，共 ${ONBOARDING_STEP_ORDER.length} 步`),
    ).toBeInTheDocument();
  });
});
