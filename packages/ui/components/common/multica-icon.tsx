import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { ORIGIN_ICON_DATA_URL } from "./origin-icon-data";

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

  const innerImg = (
    <img
      src={ORIGIN_ICON_DATA_URL}
      alt="Origin"
      className={cn("block size-full select-none")}
      draggable={false}
    />
  );

  if (bordered) {
    const sizeConfig = borderedSizes[size];
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center border border-border rounded-md overflow-hidden",
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
          {innerImg}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-block size-[1em] overflow-hidden",
        !entranceDone && "animate-entrance-spin",
        entranceDone && !noSpin && "hover:animate-spin",
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      {innerImg}
    </span>
  );
}
