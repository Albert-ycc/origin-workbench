import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { Markdown } from "../markdown";

describe("@multica/ui basic components", () => {
  it("renders button content and disabled state", () => {
    render(<Button disabled>Run</Button>);

    const button = screen.getByRole("button", { name: "Run" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("data-slot", "button");
  });

  it("renders dialog title and description when open", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>Review the change before continuing.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("heading", { name: "Confirm action" })).toBeInTheDocument();
    expect(screen.getByText("Review the change before continuing.")).toBeInTheDocument();
  });

  it("renders textarea placeholder and value", () => {
    render(<Textarea aria-label="Notes" placeholder="Write notes" defaultValue="Draft" />);

    const textarea = screen.getByRole("textbox", { name: "Notes" });
    expect(textarea).toHaveValue("Draft");
    expect(textarea).toHaveAttribute("placeholder", "Write notes");
  });

  it("renders sanitized markdown links and inline emphasis", () => {
    render(<Markdown>{"A **bold** [link](https://example.com)"}</Markdown>);

    expect(screen.getByText("bold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });
});
