import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type {
  CyberdriverPermissionName,
  CyberdriverPermissionSnapshot,
  CyberdriverPermissionState,
} from "@/lib/cyberdriverPermissions";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Loader2,
  Mic,
  Monitor,
  RefreshCw,
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
  isRefreshing,
  requesting,
  screenCaptureNeedsRelaunch,
  onRefresh,
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
    footnote?: string;
  }> = [
    {
      name: "microphone",
      icon: <Mic className="h-5 w-5" />,
      title: "Microphone",
      description:
        "Required for dictation and computer-use voice capture.",
      state: snapshot?.microphone ?? "unknown",
    },
    {
      name: "accessibility",
      icon: <Shield className="h-5 w-5" />,
      title: "Accessibility",
      description:
        "Required for global shortcuts plus keyboard and mouse control.",
      state: snapshot?.accessibility ?? "unknown",
    },
    {
      name: "screenCapture",
      icon: <Monitor className="h-5 w-5" />,
      title: "Screen Recording",
      description: "Required for screenshots and visual computer control.",
      state: snapshot?.screenCapture ?? "unknown",
      footnote: screenCaptureNeedsRelaunch
        ? "Grant, then relaunch once."
        : undefined,
    },
    {
      name: "automation",
      icon: <WandSparkles className="h-5 w-5" />,
      title: "Automation",
      description: "Optional for dictation auto-paste.",
      state: snapshot?.automation ?? "unknown",
      footnote: "If off, dictation stays in the clipboard.",
    },
  ];

  if (isLoading && !snapshot) {
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking current macOS permission state...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {screenCaptureNeedsRelaunch ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
          <p>
            Screen Recording was granted. Relaunch once to enable screenshots in
            this app session.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRelaunch()}
            disabled={requesting !== null}
            className="h-8 shrink-0 rounded-lg border-amber-300 bg-white px-3 text-[13px] text-amber-900 hover:bg-amber-100"
          >
            Relaunch Cyberdriver
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          Required: Microphone, Accessibility, Screen Recording. Optional:
          Automation for auto-paste.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading || isRefreshing || requesting !== null}
          onClick={() => void onRefresh()}
          className="h-8 shrink-0 rounded-lg px-3 text-[13px]"
        >
          {isRefreshing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Refreshing
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {permissions.map((permission) => {
          const granted = permission.state === "granted";
          const busy = requesting === permission.name;
          const statusLabel = getStatusLabel(
            permission.name,
            permission.state,
            screenCaptureNeedsRelaunch
          );
          const action = getAction(
            permission.name,
            permission.state,
            screenCaptureNeedsRelaunch
          );

          return (
            <Card
              key={permission.name}
              className="min-h-[182px] rounded-2xl border border-border/70 p-4 shadow-none"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex items-center gap-2 font-medium text-[15px]">
                      <span className="text-foreground">{permission.icon}</span>
                      <span>{titleCase(permission.title)}</span>
                    </div>
                    <p className="max-w-[26ch] text-sm leading-6 text-muted-foreground">
                      {permission.description}
                    </p>
                  </div>

                  {granted ? (
                    <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-500" />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || isLoading}
                      onClick={() => {
                        if (action.kind === "open_settings") {
                          void onOpenSettings(permission.name);
                          return;
                        }

                        if (action.kind === "relaunch") {
                          void onRelaunch();
                          return;
                        }

                        void onRequestPermission(permission.name);
                      }}
                      className="h-8 shrink-0 rounded-lg px-3 text-[13px] whitespace-nowrap"
                    >
                      {busy ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Working
                        </>
                      ) : (
                        action.label
                      )}
                    </Button>
                  )}
                </div>

                <div className="mt-auto space-y-2 pt-4">
                  <Badge className={statusChipClass(granted, permission.state, screenCaptureNeedsRelaunch && permission.name === "screenCapture")}>
                    {statusLabel}
                  </Badge>
                  {permission.footnote ? (
                    <p className="max-w-[28ch] text-xs leading-5 text-muted-foreground">
                      {permission.footnote}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function titleCase(text: string) {
  return text;
}

function getAction(
  permission: CyberdriverPermissionName,
  state: CyberdriverPermissionState,
  screenCaptureNeedsRelaunch: boolean
) {
  if (permission === "screenCapture" && screenCaptureNeedsRelaunch) {
    return {
      kind: "relaunch" as const,
      label: "Relaunch",
    };
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

  return {
    kind: "request" as const,
    label: "Grant",
  };
}

function getStatusLabel(
  permission: CyberdriverPermissionName,
  state: CyberdriverPermissionState,
  screenCaptureNeedsRelaunch: boolean
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
      return "Needs action";
    default:
      return permission === "automation" ? "Optional" : "Unknown";
  }
}

function statusChipClass(
  granted: boolean,
  state: CyberdriverPermissionState,
  emphasized: boolean
) {
  return cn(
    "rounded-full border-0 px-2.5 py-1 text-[12px] font-medium",
    granted
      ? "bg-emerald-100 text-emerald-700"
      : emphasized
        ? "bg-amber-100 text-amber-700"
        : state === "not_determined"
          ? "bg-sky-100 text-sky-700"
          : state === "denied"
            ? "bg-rose-100 text-rose-700"
            : "bg-muted text-muted-foreground"
  );
}
