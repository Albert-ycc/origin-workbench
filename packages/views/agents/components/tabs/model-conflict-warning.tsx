"use client";

import { AlertTriangle } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@multica/ui/components/ui/alert";

export function hasModelCliOverride(args: string[] | undefined): boolean {
  const tokens = args ?? [];
  return tokens.some(
    (arg, index) =>
      arg === "--model" ||
      arg === "-m" ||
      arg.startsWith("--model=") ||
      (tokens[index - 1] === "--model" || tokens[index - 1] === "-m"),
  );
}

export function ModelConflictWarning({
  className,
}: {
  className?: string;
}) {
  return (
    <Alert className={className}>
      <AlertTriangle className="size-4 text-warning" />
      <AlertTitle className="text-sm">模型配置可能被自定义参数覆盖</AlertTitle>
      <AlertDescription className="text-xs">
        这个智能体的自定义参数里包含 <code>--model</code> 或 <code>-m</code>。
        实际启动时 CLI 参数可能优先于页面里的模型选择。建议只在“模型”页设置模型，
        把参数里的模型 flag 删除。
      </AlertDescription>
    </Alert>
  );
}
