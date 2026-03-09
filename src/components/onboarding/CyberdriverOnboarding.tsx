import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useAccessibilityPermission } from "@/hooks/useAccessibilityPermission";
import { useMicrophonePermission } from "@/hooks/useMicrophonePermission";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { CheckCircle2, ChevronRight, Keyboard, Mic, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

interface CyberdriverOnboardingProps {
  onComplete: () => void;
}

export function CyberdriverOnboarding({ onComplete }: CyberdriverOnboardingProps) {
  const { settings, status, saveSettings } = useCyberdriver();
  const { updateSettings, settings: appSettings } = useSettings();
  const [apiKey, setApiKey] = useState(settings?.secret || "");
  const [dictationHotkey, setDictationHotkey] = useState(appSettings?.hotkey || "CommandOrControl+Shift+Space");
  const [computerUseHotkey, setComputerUseHotkey] = useState(appSettings?.computer_use_hotkey || "Option+Space");
  const [saving, setSaving] = useState(false);

  const mic = useMicrophonePermission({ checkOnMount: true });
  const accessibility = useAccessibilityPermission({ checkOnMount: true });

  const requestPermission = async (kind: "microphone" | "accessibility") => {
    if (kind === "microphone") {
      const granted = await mic.requestPermission();
      if (!granted) {
        await open("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
      }
      return;
    }

    const granted = await accessibility.requestPermission();
    if (!granted) {
      await open("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    }
  };

  const handleContinue = async () => {
    if (!apiKey.trim()) {
      toast.error("Cyberdesk API key is required.");
      return;
    }

    try {
      setSaving(true);
      await invoke("set_global_shortcut", { shortcut: dictationHotkey });
      await updateSettings({
        hotkey: dictationHotkey,
        computer_use_hotkey: computerUseHotkey,
        onboarding_completed: true,
      });
      await saveSettings(
        {
          ...(settings || {
            host: "api.cyberdesk.io",
            port: 443,
            target_port: 3000,
            keepalive_enabled: false,
            keepalive_threshold_minutes: 3,
            keepalive_click_x: null,
            keepalive_click_y: null,
            black_screen_recovery: false,
            black_screen_check_interval: 30,
            debug: true,
            register_as_keepalive_for: null,
            experimental_space: false,
            driver_path: null,
          }),
          secret: apiKey.trim(),
        },
        false
      );
      onComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to finish onboarding.";
      console.error(message, error);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
        <Card className="w-full max-w-3xl p-8">
          <div className="space-y-8">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold">Welcome to Cyberdriver</h1>
              <p className="text-sm text-muted-foreground">
                Set up your Cyberdesk API key, grant desktop permissions, and configure your two voice modes.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <PermissionCard
                icon={<Mic className="h-5 w-5" />}
                title="Microphone"
                description="Needed for both dictation and computer-use voice capture."
                granted={Boolean(mic.hasPermission)}
                onGrant={() => requestPermission("microphone")}
              />
              <PermissionCard
                icon={<Shield className="h-5 w-5" />}
                title="Accessibility"
                description="Needed for global shortcuts, keyboard, and mouse automation."
                granted={Boolean(accessibility.hasPermission)}
                onGrant={() => requestPermission("accessibility")}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Cyberdesk API Key">
                <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
              </Field>
              <Field label="Machine ID">
                <Input value={status?.machine_uuid || ""} readOnly disabled />
              </Field>
              <Field label="Dictation Hotkey">
                <Input value={dictationHotkey} onChange={(event) => setDictationHotkey(event.target.value)} />
              </Field>
              <Field label="Computer Use Hotkey">
                <Input value={computerUseHotkey} onChange={(event) => setComputerUseHotkey(event.target.value)} />
              </Field>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              Dictation mode uses the local speech model you configure in <span className="font-medium text-foreground">Models</span>.
              Computer use mode sends the spoken task to Cyberdesk cloud and shows task progress in the floating toolbar.
            </div>

            <div className="flex justify-end">
              <Button onClick={handleContinue} disabled={saving}>
                {saving ? "Saving..." : "Continue to Cyberdriver"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function PermissionCard({
  icon,
  title,
  description,
  granted,
  onGrant,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  granted: boolean;
  onGrant: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            {icon}
            <span>{title}</span>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {granted ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Button variant="outline" size="sm" onClick={onGrant}>
            Grant
          </Button>
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Keyboard className="h-4 w-4" />
        {label}
      </span>
      {children}
    </label>
  );
}
