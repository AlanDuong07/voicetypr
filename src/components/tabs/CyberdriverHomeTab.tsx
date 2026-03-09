import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { Loader2, Power, Radio, Type } from "lucide-react";
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
    <div className="h-full flex items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-semibold">Cyberdriver</h1>
          <p className="text-sm text-muted-foreground">
            Speak a task to your computer use agent, or use dictation mode to paste text directly.
          </p>
        </div>

        <Card className="p-8">
          <div className="flex flex-col items-center gap-6">
            <Button
              type="button"
              size="icon"
              onClick={handleToggle}
              disabled={isLoading}
              className={`h-28 w-28 rounded-full ${isRunning ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary/90"}`}
            >
              {isLoading ? <Loader2 className="h-10 w-10 animate-spin" /> : <Power className="h-10 w-10" />}
            </Button>

            <div className="text-center space-y-1">
              <p className="text-lg font-medium">{isRunning ? "Cyberdriver is on" : "Cyberdriver is off"}</p>
              <p className="text-sm text-muted-foreground">
                {status?.tunnel_connected
                  ? "Connected to Cyberdesk cloud"
                  : "Press power to start the local API and connect the reverse tunnel"}
              </p>
            </div>

            <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Radio className="h-4 w-4" />
                  Computer Use Mode
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shortcut: <span className="font-mono">{appSettings?.computer_use_hotkey || "Option+Space"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  API key: {settings?.secret ? "Configured" : "Missing"}
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Type className="h-4 w-4" />
                  Dictation Mode
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shortcut: <span className="font-mono">{appSettings?.hotkey || "CommandOrControl+Shift+Space"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Model: {appSettings?.current_model || "Not selected"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Machine ID</p>
            <p className="mt-2 break-all font-mono text-xs">{status?.machine_uuid || "Loading..."}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Local API</p>
            <p className="mt-2 text-sm font-medium">
              {status?.local_server_port ? `127.0.0.1:${status.local_server_port}` : "Not running"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase text-muted-foreground">Tunnel</p>
            <p className="mt-2 text-sm font-medium">
              {status?.tunnel_connected ? "Connected" : status?.last_error || "Disconnected"}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
