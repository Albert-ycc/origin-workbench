import { useCallback, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, Loader2 } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; latestVersion: string }
  | { status: "error"; message: string };

export function UpdatesSettingsTab() {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const currentVersion = window.desktopAPI.appInfo.version;

  const handleCheck = useCallback(async () => {
    setState({ status: "checking" });
    const result = await window.updater.checkForUpdates();
    if (!result.ok) {
      setState({ status: "error", message: result.error });
      return;
    }
    setState(
      result.available
        ? { status: "available", latestVersion: result.latestVersion }
        : { status: "up-to-date" },
    );
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold">更新</h2>
      <p className="text-sm text-muted-foreground mt-1">
        桌面应用会在启动后和每小时自动检查新版本。
      </p>

      <div className="mt-6 divide-y">
        <div className="flex items-center justify-between gap-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">当前版本</p>
            <p className="text-sm text-muted-foreground mt-0.5 font-mono">
              v{currentVersion}
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">检查更新</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              立即检查一次，不必等待下一次自动轮询。有可用更新时会在角落提示。
            </p>
            {state.status === "up-to-date" && (
              <p className="text-sm text-muted-foreground mt-2 inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-success" />
                当前已是最新版本。
              </p>
            )}
            {state.status === "available" && (
              <p className="text-sm text-muted-foreground mt-2 inline-flex items-center gap-1.5">
                <ArrowDownToLine className="size-3.5 text-primary" />
                v{state.latestVersion} 可用，请查看角落里的下载提示。
              </p>
            )}
            {state.status === "error" && (
              <p className="text-sm text-destructive mt-2 inline-flex items-center gap-1.5">
                <AlertCircle className="size-3.5" />
                {state.message}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheck}
              disabled={state.status === "checking"}
            >
              {state.status === "checking" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  正在检查…
                </>
              ) : (
                "立即检查"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
