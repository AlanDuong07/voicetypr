import { AppPage, AppPanel, AppSectionHeading } from "@/components/layout/AppPage";
import { Button } from "@/components/ui/button";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useCyberdriverPermissions } from "@/hooks/useCyberdriverPermissions";
import { formatKeyForDisplay, normalizeShortcutKeys } from "@/lib/keyboard-normalizer";
import { isMacOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  Cable,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Power,
  Sparkles,
  TriangleAlert,
  Type,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { toast } from "sonner";

interface CyberdriverHomeTabProps {
  onSectionChange?: (section: string) => void;
}

export function CyberdriverHomeTab({ onSectionChange }: CyberdriverHomeTabProps) {
  const { status, settings, isLoading, powerOn, powerOff } = useCyberdriver();
  const { settings: appSettings } = useSettings();
  const {
    requiredPermissionsGranted,
    snapshot,
    isLoading: permissionsLoading,
  } = useCyberdriverPermissions();

  const isRunning = Boolean(status?.local_server_running || status?.tunnel_connected);
  const hasApiKey = Boolean(settings?.secret?.trim());
  const hasDictationModel = Boolean(appSettings?.current_model?.trim());
  const selectedModelLabel = appSettings?.current_model || "Not selected";
  const dictationShortcut = appSettings?.hotkey || "CommandOrControl+Shift+Space";
  const computerUseShortcut = appSettings?.computer_use_hotkey || "Option+Space";

  const nextAction = useMemo(() => {
    if (!requiredPermissionsGranted) {
      return {
        title: "Finish macOS permissions",
        description: "Microphone, Accessibility, and Screen Recording are required before Cyberdriver can start.",
        label: "Open Settings",
        section: "settings",
      };
    }
    if (!hasApiKey) {
      return {
        title: "Add your Cyberdesk API key",
        description: "Computer use mode requires a cloud connection.",
        label: "Open Settings",
        section: "settings",
      };
    }
    if (!hasDictationModel) {
      return {
        title: "Choose a speech model",
        description: "Dictation needs a local model to transcribe your voice.",
        label: "Open Models",
        section: "models",
      };
    }
    if (!isRunning) {
      return {
        title: "Turn Cyberdriver on",
        description: "Everything looks ready. Power on to start.",
        label: "Use Power Button",
        section: "home",
      };
    }
    return null;
  }, [hasApiKey, hasDictationModel, isRunning, requiredPermissionsGranted]);

  const handleToggle = async () => {
    try {
      if (isRunning) {
        await powerOff();
      } else {
        await powerOn();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to change power state.";
      console.error(message, error);
      toast.error(message);
    }
  };

  return (
    <AppPage
      title="Home"
      description="Control center for Cyberdriver runtime, voice modes, and system readiness."
    >
      <div className="space-y-6">
        {/* Power control — the ONE dominant element */}
        <AppPanel className="flex flex-col items-center gap-6 py-10 text-center">
          <Button
            type="button"
            size="icon"
            onClick={handleToggle}
            disabled={isLoading}
            className={cn(
              "h-20 w-20 rounded-full shadow-md",
              isRunning
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-foreground text-background hover:bg-foreground/90",
            )}
          >
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Power className="h-7 w-7" />
            )}
          </Button>
          <div>
            <p className="text-lg font-semibold text-foreground">
              {isRunning ? "Cyberdriver is running" : "Cyberdriver is off"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isRunning
                ? "Local API, tunnel, and hotkeys are active."
                : "Press the button to start the runtime."}
            </p>
          </div>
          {status?.last_error && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{status.last_error}</span>
            </div>
          )}
        </AppPanel>

        {/* Next action prompt */}
        {nextAction && nextAction.section !== "home" && (
          <AppPanel>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{nextAction.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{nextAction.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSectionChange?.(nextAction.section)}
              >
                {nextAction.label}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </AppPanel>
        )}

        {/* Readiness checks */}
        <AppPanel>
          <AppSectionHeading title="Readiness" />
          <div className="mt-4 divide-y divide-border">
            <ReadinessRow
              label="Permissions"
              status={
                permissionsLoading
                  ? "Checking..."
                  : requiredPermissionsGranted
                    ? "Ready"
                    : `Missing: ${formatPermissionSummary(snapshot)}`
              }
              ok={!permissionsLoading && requiredPermissionsGranted}
              action={
                !requiredPermissionsGranted && !permissionsLoading
                  ? () => onSectionChange?.("settings")
                  : undefined
              }
            />
            <ReadinessRow
              label="Computer use"
              status={hasApiKey ? "API key configured" : "No API key"}
              ok={hasApiKey}
              action={!hasApiKey ? () => onSectionChange?.("settings") : undefined}
            />
            <ReadinessRow
              label="Dictation"
              status={hasDictationModel ? selectedModelLabel : "No model selected"}
              ok={hasDictationModel}
              action={!hasDictationModel ? () => onSectionChange?.("models") : undefined}
            />
          </div>
        </AppPanel>

        {/* Voice modes and system info side by side */}
        <div className="grid gap-6 lg:grid-cols-2">
          <AppPanel>
            <AppSectionHeading title="Voice modes" />
            <div className="mt-4 space-y-3">
              <ModeRow
                icon={<Sparkles className="h-4 w-4" />}
                title="Computer Use"
                shortcut={computerUseShortcut}
                detail={hasApiKey ? "Ready" : "Needs API key"}
                ok={hasApiKey}
              />
              <ModeRow
                icon={<Type className="h-4 w-4" />}
                title="Dictation"
                shortcut={dictationShortcut}
                detail={hasDictationModel ? selectedModelLabel : "Needs model"}
                ok={hasDictationModel}
              />
            </div>
          </AppPanel>

          <AppPanel>
            <AppSectionHeading title="System" />
            <div className="mt-4 space-y-2">
              <KVRow label="Machine ID" value={status?.machine_uuid || "Loading..."} mono />
              <KVRow
                label="Local API"
                value={
                  status?.local_server_port
                    ? `127.0.0.1:${status.local_server_port}`
                    : "Not running"
                }
              />
              <KVRow
                label="Tunnel"
                value={status?.tunnel_connected ? "Connected" : "Disconnected"}
                icon={
                  status?.tunnel_connected ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Cable className="h-3.5 w-3.5 text-muted-foreground" />
                  )
                }
              />
            </div>
          </AppPanel>
        </div>
      </div>
    </AppPage>
  );
}

function ReadinessRow({
  label,
  status,
  ok,
  action,
}: {
  label: string;
  status: string;
  ok: boolean;
  action?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex h-2 w-2 rounded-full",
            ok ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
      </div>
      {action && (
        <Button variant="ghost" size="sm" onClick={action}>
          Fix
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function ModeRow({
  icon,
  title,
  shortcut,
  detail,
  ok,
}: {
  icon: ReactNode;
  title: string;
  shortcut: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-foreground">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className={cn("text-xs", ok ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
            {detail}
          </p>
        </div>
      </div>
      <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {formatShortcutLabel(shortcut)}
      </kbd>
    </div>
  );
}

function KVRow({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        {icon}
        <p className={cn("text-sm text-foreground", mono && "break-all font-mono text-xs")}>
          {value}
        </p>
      </div>
    </div>
  );
}

function formatShortcutLabel(shortcut: string) {
  return normalizeShortcutKeys(shortcut)
    .split("+")
    .filter(Boolean)
    .map((token) => formatKeyForDisplay(token, isMacOS))
    .join(" ");
}

function formatPermissionSummary(
  snapshot: ReturnType<typeof useCyberdriverPermissions>["snapshot"],
) {
  if (!snapshot) return "required permissions";
  const missing: string[] = [];
  if (snapshot.microphone !== "granted") missing.push("Microphone");
  if (snapshot.accessibility !== "granted") missing.push("Accessibility");
  if (snapshot.screenCapture !== "granted") missing.push("Screen Recording");
  return missing.length > 0 ? missing.join(", ") : "required permissions";
}
