import { CyberdriverPermissionChecklist } from "@/components/cyberdriver/CyberdriverPermissionChecklist";
import { CyberdriverHotkeyPicker, HotkeyList } from "@/components/cyberdriver/CyberdriverHotkeyPicker";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCyberdriver, type CyberdriverSettings, defaultCyberdriverSettings } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useCyberdriverPermissions } from "@/hooks/useCyberdriverPermissions";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

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

export function CyberdriverSettingsTab() {
  const { settings, saveSettings, status } = useCyberdriver();
  const { settings: appSettings, updateSettings } = useSettings();
  const {
    snapshot,
    isLoading: permissionsLoading,
    isRefreshing,
    requesting,
    screenCaptureNeedsRelaunch,
    refresh,
    openSettings,
    relaunchApp,
    requestPermission,
  } = useCyberdriverPermissions();
  const [draft, setDraft] = useState<CyberdriverSettings>(defaultCyberdriverSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [dictationHotkey, setDictationHotkey] = useState("");
  const [computerUseHotkey, setComputerUseHotkey] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (settings) {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    setDictationHotkey(appSettings?.hotkey || "CommandOrControl+Shift+Space");
    setComputerUseHotkey(appSettings?.computer_use_hotkey || "Option+Space");
  }, [appSettings?.computer_use_hotkey, appSettings?.hotkey]);

  const canSave = useMemo(
    () =>
      draft.secret.trim().length > 0 &&
      dictationHotkey.trim().length > 0 &&
      computerUseHotkey.trim().length > 0,
    [computerUseHotkey, dictationHotkey, draft.secret]
  );

  const setField = <K extends keyof CyberdriverSettings>(key: K, value: CyberdriverSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!canSave) {
      toast.error("Cyberdesk API key and both voice mode hotkeys are required.");
      return;
    }

    try {
      setIsSaving(true);
      await invoke("set_global_shortcut", { shortcut: dictationHotkey });
      await updateSettings({
        hotkey: dictationHotkey,
        computer_use_hotkey: computerUseHotkey,
        onboarding_completed: true,
      });
      await saveSettings(draft, Boolean(status?.local_server_running || status?.tunnel_connected));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save Cyberdriver settings.";
      console.error(message, error);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save changes to restart the Cyberdriver runtime cleanly with your new configuration.
          </p>
        </div>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <h2 className="text-lg font-medium">Voice Modes</h2>
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
          <p className="text-xs text-muted-foreground">
            Dictation still uses your local speech model. Computer use mode will send the spoken task to Cyberdesk cloud.
          </p>
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <h2 className="text-lg font-medium">Cyberdesk Connection</h2>
          <p className="text-sm text-muted-foreground">
            Keep your API key and host handy. Runtime and recovery controls live in Advanced Cyberdriver Settings.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <LabeledField label="API Key">
              <Input
                value={draft.secret}
                onChange={(event) => setField("secret", event.target.value)}
                placeholder="sk-..."
                type="password"
              />
            </LabeledField>
            <LabeledField label="Host">
              <Input value={draft.host} onChange={(event) => setField("host", event.target.value)} />
            </LabeledField>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background text-foreground">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Advanced Cyberdriver Settings
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Ports, keepalive, recovery, debugging, and Windows driver options.
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    advancedOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-5">
              <div className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Network
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <LabeledField label="Port">
                      <Input
                        value={String(draft.port)}
                        onChange={(event) => setField("port", Number(event.target.value) || 443)}
                        inputMode="numeric"
                      />
                    </LabeledField>
                    <LabeledField label="Local Target Port">
                      <Input
                        value={String(draft.target_port)}
                        onChange={(event) => setField("target_port", Number(event.target.value) || 3000)}
                        inputMode="numeric"
                      />
                    </LabeledField>
                    <LabeledField label="Register As Keepalive For">
                      <Input
                        value={draft.register_as_keepalive_for || ""}
                        onChange={(event) => setField("register_as_keepalive_for", event.target.value || null)}
                        placeholder="Main machine ID"
                      />
                    </LabeledField>
                    <LabeledField label="Amyuni Driver Path (Windows)">
                      <Input
                        value={draft.driver_path || ""}
                        onChange={(event) => setField("driver_path", event.target.value || null)}
                        placeholder="Optional driver bundle path"
                      />
                    </LabeledField>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Runtime
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ToggleField
                      label="Keepalive"
                      checked={draft.keepalive_enabled}
                      onCheckedChange={(checked) => setField("keepalive_enabled", checked)}
                    />
                    <ToggleField
                      label="Black Screen Recovery"
                      checked={draft.black_screen_recovery}
                      onCheckedChange={(checked) => setField("black_screen_recovery", checked)}
                    />
                    <ToggleField
                      label="Debug Logging"
                      checked={draft.debug}
                      onCheckedChange={(checked) => setField("debug", checked)}
                    />
                    <ToggleField
                      label="Experimental Space Key"
                      checked={draft.experimental_space}
                      onCheckedChange={(checked) => setField("experimental_space", checked)}
                    />
                    <LabeledField label="Keepalive Threshold (minutes)">
                      <Input
                        value={String(draft.keepalive_threshold_minutes)}
                        onChange={(event) => setField("keepalive_threshold_minutes", Number(event.target.value) || 3)}
                        inputMode="decimal"
                      />
                    </LabeledField>
                    <LabeledField label="Black Screen Interval (seconds)">
                      <Input
                        value={String(draft.black_screen_check_interval)}
                        onChange={(event) => setField("black_screen_check_interval", Number(event.target.value) || 30)}
                        inputMode="decimal"
                      />
                    </LabeledField>
                    <LabeledField label="Keepalive Click X">
                      <Input
                        value={draft.keepalive_click_x ?? ""}
                        onChange={(event) => setField("keepalive_click_x", event.target.value ? Number(event.target.value) : null)}
                        inputMode="numeric"
                      />
                    </LabeledField>
                    <LabeledField label="Keepalive Click Y">
                      <Input
                        value={draft.keepalive_click_y ?? ""}
                        onChange={(event) => setField("keepalive_click_y", event.target.value ? Number(event.target.value) : null)}
                        inputMode="numeric"
                      />
                    </LabeledField>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <div>
            <h2 className="text-lg font-medium">Permissions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Required for voice, shortcuts, and screenshots. Auto-paste is optional.
            </p>
          </div>
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
        </section>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving || !canSave}>
            {isSaving ? "Saving..." : "Save and Restart Cyberdriver"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
