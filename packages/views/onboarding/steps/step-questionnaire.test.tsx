import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionnaireAnswers } from "@multica/core/onboarding";
import { StepQuestionnaire } from "./step-questionnaire";

const EMPTY_ANSWERS: QuestionnaireAnswers = {
  team_size: null,
  team_size_other: null,
  role: null,
  role_other: null,
  use_case: null,
  use_case_other: null,
};

function renderStep(initial: Partial<QuestionnaireAnswers> = {}) {
  const onSubmit = vi.fn();
  render(
    <StepQuestionnaire
      initial={{ ...EMPTY_ANSWERS, ...initial }}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

/**
 * The 继续 button is the product of a strict "all three answered"
 * gate — no Skip path. These tests lock down that policy so a future
 * refactor can't silently loosen it:
 *   - Disabled by default (zero answers)
 *   - Stays disabled with 1 or 2 answers
 *   - Enabled only when all three have concrete selections
 *   - Stays disabled when any "其他" selection has empty text
 *   - Clicking while disabled never calls onSubmit
 *   - Switching away from 其他 clears that question's *_其他 field
 */
describe("StepQuestionnaire", () => {
  it("继续 is disabled when no questions are answered", () => {
    renderStep();
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeDisabled();
  });

  it("继续 stays disabled with only one question answered", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole("radio", { name: /只有我/i }));
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeDisabled();
  });

  it("继续 stays disabled with only two questions answered", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole("radio", { name: /只有我/i }));
    await user.click(
      screen.getByRole("radio", { name: /软件开发者/i }),
    );
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeDisabled();
  });

  it("继续 enables when all three questions are answered", async () => {
    const user = userEvent.setup();
    renderStep();
    await user.click(screen.getByRole("radio", { name: /只有我/i }));
    await user.click(
      screen.getByRole("radio", { name: /软件开发者/i }),
    );
    await user.click(
      screen.getByRole("radio", { name: /编写并交付代码/i }),
    );
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeEnabled();
  });

  it("继续 stays disabled when 其他 is picked but its text is empty", async () => {
    const user = userEvent.setup();
    renderStep({
      team_size: "solo",
      role: "developer",
      // Q3 will be set to 其他 in-test — no text typed yet.
    });
    const q3其他 = screen.getAllByRole("radio", { name: /^其他$/i })[2]!;
    await user.click(q3其他);
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeDisabled();
  });

  it("继续 re-enables once 其他 text is filled in", async () => {
    const user = userEvent.setup();
    renderStep({ team_size: "solo", role: "developer" });
    const q3其他 = screen.getAllByRole("radio", { name: /^其他$/i })[2]!;
    await user.click(q3其他);
    const input = screen.getByPlaceholderText(/自动整理我的周报/i);
    await user.type(input, "Teach me the system");
    expect(
      screen.getByRole("button", { name: /继续/i }),
    ).toBeEnabled();
  });

  it("clears 其他 text when the user switches to a concrete option", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep({
      role: "developer",
      use_case: "coding",
    });

    // Pick Q1 其他 → type → switch to 只有我 → submit.
    // Submitted payload must have team_size_other = null.
    const q1其他 = screen.getAllByRole("radio", { name: /^其他$/i })[0]!;
    await user.click(q1其他);
    await user.type(
      screen.getByPlaceholderText(/我帮忙运营的小社群/i),
      "large enterprise",
    );
    await user.click(screen.getByRole("radio", { name: /只有我/i }));
    await user.click(screen.getByRole("button", { name: /继续/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        team_size: "solo",
        team_size_other: null,
      }),
    );
  });

  it("does not call onSubmit when 继续 is disabled", async () => {
    // Belt-and-suspenders against a future refactor that replaces
    // <Button disabled> with a custom element that doesn't honor
    // the native disabled semantics — the handler's own
    // can继续 short-circuit catches it either way.
    const user = userEvent.setup();
    const { onSubmit } = renderStep();
    await user.click(screen.getByRole("button", { name: /继续/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("respects the initial prop (used for resume-after-back)", () => {
    renderStep({ team_size: "team", role: "developer" });
    expect(
      screen.getByRole("radio", { name: /我的团队/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("radio", { name: /软件开发者/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("submits the full answer set including all three questions", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderStep();

    await user.click(screen.getByRole("radio", { name: /只有我/i }));
    await user.click(
      screen.getByRole("radio", { name: /软件开发者/i }),
    );
    await user.click(
      screen.getByRole("radio", { name: /编写并交付代码/i }),
    );
    await user.click(screen.getByRole("button", { name: /继续/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      team_size: "solo",
      team_size_other: null,
      role: "developer",
      role_other: null,
      use_case: "coding",
      use_case_other: null,
    });
  });
});
