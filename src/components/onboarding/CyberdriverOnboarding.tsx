import { CyberdriverHotkeyPicker, HotkeyList } from "@/components/cyberdriver/CyberdriverHotkeyPicker";
import { CyberdriverPermissionChecklist } from "@/components/cyberdriver/CyberdriverPermissionChecklist";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useCyberdriverPermissions } from "@/hooks/useCyberdriverPermissions";
import { getMissingRequiredPermissions } from "@/lib/cyberdriverPermissions";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Keyboard } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

interface CyberdriverOnboardingProps {
  onComplete: () => void;
}

const ONBOARDING_DRAFT_STORAGE_KEY = "cyberdriver_onboarding_draft";
const DICTATION_RECOMMENDED_HOTKEYS = [
  "CommandOrControl+Shift+Space",
  "Control+Alt+D",
  "Shift+F5",
  "Alt+D",
];
const COMPUTER_USE_RECOMMENDED_HOTKEYS = [
  "Alt+Space",
  "Control+Alt+P",
  "Shift+F6",
  "Alt+P",
];

export function CyberdriverOnboarding({ onComplete }: CyberdriverOnboardingProps) {
  const { settings, status, saveSettings } = useCyberdriver();
  const { updateSettings, settings: appSettings } = useSettings();
  const {
    snapshot,
    isLoading: permissionsLoading,
    isRefreshing,
    requesting,
    screenCaptureNeedsRelaunch,
    requiredPermissionsGranted,
    refresh,
    openSettings,
    relaunchApp,
    requestPermission,
  } = useCyberdriverPermissions();
  const [apiKey, setApiKey] = useState(() => {
    const draft = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (draft) {
      try {
        return JSON.parse(draft).apiKey || settings?.secret || "";
      } catch {
        // ignore malformed draft
      }
    }
    return settings?.secret || "";
  });
  const [dictationHotkey, setDictationHotkey] = useState(() => {
    const draft = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (draft) {
      try {
        return (
          JSON.parse(draft).dictationHotkey ||
          appSettings?.hotkey ||
          "CommandOrControl+Shift+Space"
        );
      } catch {
        // ignore malformed draft
      }
    }
    return appSettings?.hotkey || "CommandOrControl+Shift+Space";
  });
  const [computerUseHotkey, setComputerUseHotkey] = useState(() => {
    const draft = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (draft) {
      try {
        return (
          JSON.parse(draft).computerUseHotkey ||
          appSettings?.computer_use_hotkey ||
          "Option+Space"
        );
      } catch {
        // ignore malformed draft
      }
    }
    return appSettings?.computer_use_hotkey || "Option+Space";
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(
      ONBOARDING_DRAFT_STORAGE_KEY,
      JSON.stringify({
        apiKey,
        dictationHotkey,
        computerUseHotkey,
      })
    );
  }, [apiKey, computerUseHotkey, dictationHotkey]);

  const missingRequiredPermissions = useMemo(() => {
    return snapshot ? getMissingRequiredPermissions(snapshot) : [];
  }, [snapshot]);

  const handleContinue = async () => {
    if (!apiKey.trim()) {
      toast.error("Cyberdesk API key is required.");
      return;
    }

    if (!dictationHotkey.trim() || !computerUseHotkey.trim()) {
      toast.error("Choose both voice mode hotkeys before continuing.");
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

      if (!requiredPermissionsGranted && missingRequiredPermissions.length > 0) {
        toast.info(
          `You can finish ${missingRequiredPermissions.join(", ")} later in Settings. Cyberdriver will stay off until those permissions are granted.`
        );
      }

      window.localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
      onComplete();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to finish onboarding.";
      console.error(message, error);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center">
        <Card className="w-full max-w-4xl p-8">
          <div className="space-y-8">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold">Welcome to Cyberdriver</h1>
              <p className="text-sm text-muted-foreground">
                Save your Cyberdesk API key, choose your two voice hotkeys, and
                grant the desktop permissions Cyberdriver needs on macOS.
              </p>
            </div>

            {snapshot && !requiredPermissionsGranted ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                Remaining required permissions:{" "}
                <span className="font-medium">
                  {missingRequiredPermissions.join(", ")}
                </span>
                . You can keep going now, but Cyberdriver will not power on
                until those are green.
              </div>
            ) : null}

            {snapshot && requiredPermissionsGranted ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                Required macOS permissions are ready. Automation is optional and
                only affects dictation auto-paste.
              </div>
            ) : null}

            <CyberdriverPermissionChecklist
              snapshot={snapshot}
              isLoading={permissionsLoading}
              isRefreshing={isRefreshing}
              requesting={requesting}
              screenCaptureNeedsRelaunch={screenCaptureNeedsRelaunch}
              onRefresh={async () => refresh(true)}
            onOpenSettings={openSettings}
            onRelaunch={relaunchApp}
              onRequestPermission={requestPermission}
            />

            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-medium">Voice Modes</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick one shortcut for dictation and one for sending spoken tasks to Cyberdesk cloud.
                </p>
              </div>
              <HotkeyList>
                <CyberdriverHotkeyPicker
                  icon="dictation"
                  label="Dictation Hotkey"
                  value={dictationHotkey}
                  onChange={setDictationHotkey}
                  dialogDescription="This shortcut will activate Dictation Mode."
                  recommendedShortcuts={DICTATION_RECOMMENDED_HOTKEYS}
                />
                <CyberdriverHotkeyPicker
                  icon="computer-use"
                  label="Computer Use Hotkey"
                  value={computerUseHotkey}
                  onChange={setComputerUseHotkey}
                  dialogDescription="This shortcut will activate Computer Use Mode."
                  recommendedShortcuts={COMPUTER_USE_RECOMMENDED_HOTKEYS}
                />
              </HotkeyList>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Cyberdesk API Key">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-..."
                />
              </Field>
              <Field label="Machine ID">
                <Input value={status?.machine_uuid || ""} readOnly disabled />
              </Field>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              Dictation mode uses the local speech model you configure in{" "}
              <span className="font-medium text-foreground">Models</span>.
              Computer use mode sends the spoken task to Cyberdesk cloud and
              shows task progress in the floating toolbar.
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleContinue}
                disabled={
                  saving ||
                  permissionsLoading ||
                  !apiKey.trim() ||
                  !dictationHotkey.trim() ||
                  !computerUseHotkey.trim()
                }
              >
                {saving
                  ? "Saving..."
                  : requiredPermissionsGranted
                    ? "Continue to Cyberdriver"
                    : "Continue and Finish Permissions Later"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
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
