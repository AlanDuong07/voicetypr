import { Button } from "@/components/ui/button";
import type {
  CyberdriverPermissionName,
  CyberdriverPermissionSnapshot,
  CyberdriverPermissionState,
} from "@/lib/cyberdriverPermissions";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Mic,
  Monitor,
  Shield,
  WandSparkles,
} from "lucide-react";
import type { ReactNode } from "react";

interface CyberdriverPermissionChecklistProps {
  snapshot: CyberdriverPermissionSnapshot | null;
  isLoading: boolean;
  isRefreshing: boolean;
  requesting: CyberdriverPermissionName | null;
  screenCaptureNeedsRelaunch: boolean;
  onRefresh: () => Promise<void>;
  onOpenSettings: (permission: CyberdriverPermissionName) => Promise<void>;
  onRelaunch: () => Promise<void>;
  onRequestPermission: (permission: CyberdriverPermissionName) => Promise<void>;
}

export function CyberdriverPermissionChecklist({
  snapshot,
  isLoading,
  requesting,
  screenCaptureNeedsRelaunch,
  onOpenSettings,
  onRelaunch,
  onRequestPermission,
}: CyberdriverPermissionChecklistProps) {
  const permissions: Array<{
    name: CyberdriverPermissionName;
    icon: ReactNode;
    title: string;
    description: string;
    state: CyberdriverPermissionState;
    optional?: boolean;
  }> = [
    {
      name: "microphone",
      icon: <Mic className="h-4 w-4" />,
      title: "Microphone",
      description: "Voice capture for dictation and computer use.",
      state: snapshot?.microphone ?? "unknown",
    },
    {
      name: "accessibility",
      icon: <Shield className="h-4 w-4" />,
      title: "Accessibility",
      description: "Global shortcuts, keyboard, and mouse control.",
      state: snapshot?.accessibility ?? "unknown",
    },
    {
      name: "screenCapture",
      icon: <Monitor className="h-4 w-4" />,
      title: "Screen Recording",
      description: "Screenshots for visual computer control.",
      state: snapshot?.screenCapture ?? "unknown",
    },
    {
      name: "automation",
      icon: <WandSparkles className="h-4 w-4" />,
      title: "Automation",
      description: "Auto-paste dictation text. If off, text stays in clipboard.",
      state: snapshot?.automation ?? "unknown",
      optional: true,
    },
  ];

  if (isLoading && !snapshot) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking permissions...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {screenCaptureNeedsRelaunch && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-amber-900 dark:text-amber-200">
            Screen Recording granted. Relaunch to activate.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRelaunch()}
            disabled={requesting !== null}
          >
            Relaunch
          </Button>
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border">
        {permissions.map((perm) => {
          const granted = perm.state === "granted";
          const busy = requesting === perm.name;
          const action = getAction(perm.name, perm.state, screenCaptureNeedsRelaunch);

          return (
            <div key={perm.name} className="flex items-center gap-4 px-4 py-3">
              {/* Status indicator */}
              <div className="shrink-0">
                {granted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Circle className="h-4 w-4 text-border" />
                )}
              </div>

              {/* Icon + text */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="shrink-0 text-muted-foreground">{perm.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{perm.title}</p>
                    {perm.optional && (
                      <span className="text-xs text-muted-foreground">Optional</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{perm.description}</p>
                </div>
              </div>

              {/* Status text + action */}
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={cn(
                    "text-xs font-medium",
                    granted
                      ? "text-emerald-600 dark:text-emerald-400"
                      : perm.state === "denied"
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground",
                  )}
                >
                  {getStatusLabel(perm.name, perm.state, screenCaptureNeedsRelaunch)}
                </span>
                {!granted && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || isLoading}
                    onClick={() => {
                      if (action.kind === "open_settings") {
                        void onOpenSettings(perm.name);
                      } else if (action.kind === "relaunch") {
                        void onRelaunch();
                      } else {
                        void onRequestPermission(perm.name);
                      }
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      action.label
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getAction(
  permission: CyberdriverPermissionName,
  state: CyberdriverPermissionState,
  screenCaptureNeedsRelaunch: boolean,
) {
  if (permission === "screenCapture" && screenCaptureNeedsRelaunch) {
    return { kind: "relaunch" as const, label: "Relaunch" };
  }
  if (permission === "automation") {
    return {
      kind: state === "denied" ? ("open_settings" as const) : ("request" as const),
      label: state === "denied" ? "Open Settings" : "Test Auto-Paste",
    };
  }
  if (permission === "microphone") {
    return {
      kind: state === "denied" ? ("open_settings" as const) : ("request" as const),
      label: state === "denied" ? "Open Settings" : "Grant",
    };
  }
  return { kind: "request" as const, label: "Grant" };
}

function getStatusLabel(
  permission: CyberdriverPermissionName,
  state: CyberdriverPermissionState,
  screenCaptureNeedsRelaunch: boolean,
) {
  if (permission === "screenCapture" && screenCaptureNeedsRelaunch && state !== "granted") {
    return "Pending relaunch";
  }
  switch (state) {
    case "granted":
      return "Granted";
    case "not_determined":
      return "Not requested";
    case "denied":
      return "Denied";
    default:
      return permission === "automation" ? "Not tested" : "Unknown";
  }
}
