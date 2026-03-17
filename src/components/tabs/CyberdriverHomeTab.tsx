import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { formatKeyForDisplay, normalizeShortcutKeys } from "@/lib/keyboard-normalizer";
import { isMacOS } from "@/lib/platform";
import {
  Cable,
  CheckCircle2,
  Loader2,
  Power,
  Sparkles,
  Type,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

export function CyberdriverHomeTab() {
  const { status, settings, isLoading, powerOn, powerOff } = useCyberdriver();
  const { settings: appSettings } = useSettings();

  const isRunning = Boolean(status?.local_server_running || status?.tunnel_connected);

  const handleToggle = async () => {
    try {
      if (isRunning) {
        await powerOff();
      } else {
        await powerOn();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to change Cyberdriver power state.";
      console.error(message, error);
      toast.error(message);
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="space-y-6">
          <div className="space-y-3">
            <Badge
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                isRunning
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isRunning ? "Online" : "Offline"}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Cyberdriver
              </h1>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center rounded-2xl border border-border/70 bg-muted/15 p-6 text-center">
            <Button
              type="button"
              size="icon"
              onClick={handleToggle}
              disabled={isLoading}
              className={`h-20 w-20 rounded-full ${
                isRunning
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : "bg-primary hover:bg-primary/90"
              }`}
            >
              {isLoading ? (
                <Loader2 className="h-7 w-7 animate-spin" />
              ) : (
                <Power className="h-7 w-7" />
              )}
            </Button>

            <div className="mt-5 space-y-1">
              <p className="text-2xl font-semibold tracking-tight text-foreground">
                {isRunning ? "Cyberdriver is on" : "Cyberdriver is off"}
              </p>
              <p className="text-sm text-muted-foreground">
                {status?.tunnel_connected
                  ? "Connected to Cyberdesk cloud"
                  : "Start the local API and reverse tunnel"}
              </p>
            </div>

            {status?.last_error && !status?.tunnel_connected ? (
              <p className="mt-3 max-w-[22rem] text-xs leading-5 text-muted-foreground">
                {status.last_error}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Two voice modes for desktop control and fast dictation.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <ModeCard
                icon={<Sparkles className="h-4 w-4" />}
                title="Computer Use"
                shortcut={appSettings?.computer_use_hotkey || "Option+Space"}
                detail={`API key: ${settings?.secret ? "Configured" : "Missing"}`}
              />
              <ModeCard
                icon={<Type className="h-4 w-4" />}
                title="Dictation"
                shortcut={appSettings?.hotkey || "CommandOrControl+Shift+Space"}
                detail={`Model: ${appSettings?.current_model || "Not selected"}`}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label="Machine ID"
            value={status?.machine_uuid || "Loading..."}
            mono
          />
          <StatCard
            label="Local API"
            value={
              status?.local_server_port
                ? `127.0.0.1:${status.local_server_port}`
                : "Not running"
            }
          />
          <StatCard
            label="Tunnel"
            value={status?.tunnel_connected ? "Connected" : "Disconnected"}
            statusIcon={
              status?.tunnel_connected ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Cable className="h-4 w-4 text-muted-foreground" />
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  shortcut,
  detail,
}: {
  icon: ReactNode;
  title: string;
  shortcut: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Shortcut:{" "}
        <span className="font-medium text-foreground">
          {formatShortcutLabel(shortcut)}
        </span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  mono = false,
  statusIcon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  statusIcon?: ReactNode;
}) {
  return (
    <Card className="rounded-2xl border-border/70 p-4 shadow-none">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {statusIcon}
      </div>
      <p
        className={`mt-3 text-sm text-foreground ${
          mono ? "break-all font-mono text-[13px]" : "font-medium"
        }`}
      >
        {value}
      </p>
    </Card>
  );
}

function formatShortcutLabel(shortcut: string) {
  return normalizeShortcutKeys(shortcut)
    .split("+")
    .filter(Boolean)
    .map((token) => formatKeyForDisplay(token, isMacOS))
    .join("+");
}
