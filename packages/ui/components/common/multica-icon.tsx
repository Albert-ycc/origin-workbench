import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";

interface MulticaIconProps extends React.ComponentProps<"span"> {
  /**
   * If true, play a one-time entrance spin animation.
   */
  animate?: boolean;
  /**
   * If true, disable hover spin animation.
   */
  noSpin?: boolean;
  /**
   * If true, show a border around the icon.
   */
  bordered?: boolean;
  /**
   * Size of the bordered icon: "sm" (default), "md", "lg"
   */
  size?: "sm" | "md" | "lg";
}

const borderedSizes = {
  sm: { wrapper: "p-1.5", icon: "size-3.5" },
  md: { wrapper: "p-2", icon: "size-4" },
  lg: { wrapper: "p-2.5", icon: "size-5" },
};

// Origin Workbench logo — Cartesian origin (0,0): a filled center
// point with a horizontal + vertical axis crossing through it. Adopts
// currentColor so light/dark themes flow through. (Component name
// stays `MulticaIcon` because rename has 5+ import sites; the visual
// identity is what matters here.)
function OriginGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block size-full", className)}
      aria-hidden="true"
    >
      <line
        x1="2"
        y1="48"
        x2="94"
        y2="48"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="square"
      />
      <line
        x1="48"
        y1="2"
        x2="48"
        y2="94"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="square"
      />
      <circle cx="48" cy="48" r="14" fill="currentColor" />
    </svg>
  );
}

export function MulticaIcon({
  className,
  animate = false,
  noSpin = false,
  bordered = false,
  size = "sm",
  ...props
}: MulticaIconProps) {
  const [entranceDone, setEntranceDone] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setEntranceDone(true), 600);
    return () => clearTimeout(timer);
  }, [animate]);

  if (bordered) {
    const sizeConfig = borderedSizes[size];
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center border border-border rounded-md",
          sizeConfig.wrapper,
          className,
        )}
        aria-hidden="true"
        {...props}
      >
        <span
          className={cn(
            "block",
            sizeConfig.icon,
            !entranceDone && "animate-entrance-spin",
            entranceDone && !noSpin && "hover:animate-spin",
          )}
        >
          <OriginGlyph />
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-block size-[1em]",
        !entranceDone && "animate-entrance-spin",
        entranceDone && !noSpin && "hover:animate-spin",
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      <OriginGlyph />
    </span>
  );
}
