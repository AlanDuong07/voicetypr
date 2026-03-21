import { CyberdriverPermissionChecklist } from "@/components/cyberdriver/CyberdriverPermissionChecklist";
import { CyberdriverHotkeyPicker, HotkeyList } from "@/components/cyberdriver/CyberdriverHotkeyPicker";
import { AppPage, AppPanel, AppSectionHeading } from "@/components/layout/AppPage";
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
import { isMacOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  RefreshCw,
} from "lucide-react";
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
    requiredPermissionsGranted,
  } = useCyberdriverPermissions();
  const [draft, setDraft] = useState<CyberdriverSettings>(defaultCyberdriverSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [dictationHotkey, setDictationHotkey] = useState("");
  const [computerUseHotkey, setComputerUseHotkey] = useState("");
  const [quietOtherMedia, setQuietOtherMedia] = useState(true);
  const [preferBuiltInMicWhenBluetoothOutput, setPreferBuiltInMicWhenBluetoothOutput] =
    useState(true);
  const [computerUseTypingModeEnabled, setComputerUseTypingModeEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  useEffect(() => {
    setDictationHotkey(appSettings?.hotkey || "CommandOrControl+Shift+Space");
    setComputerUseHotkey(appSettings?.computer_use_hotkey || "Option+Space");
    setQuietOtherMedia(appSettings?.pause_media_during_recording ?? true);
    setPreferBuiltInMicWhenBluetoothOutput(
      appSettings?.prefer_built_in_mic_when_bluetooth_output ?? true,
    );
    setComputerUseTypingModeEnabled(appSettings?.computer_use_typing_mode_enabled ?? true);
  }, [
    appSettings?.computer_use_hotkey,
    appSettings?.hotkey,
    appSettings?.pause_media_during_recording,
    appSettings?.prefer_built_in_mic_when_bluetooth_output,
    appSettings?.computer_use_typing_mode_enabled,
  ]);

  const canSave = useMemo(
    () =>
      draft.secret.trim().length > 0 &&
      dictationHotkey.trim().length > 0 &&
      computerUseHotkey.trim().length > 0,
    [computerUseHotkey, dictationHotkey, draft.secret],
  );

  const setField = <K extends keyof CyberdriverSettings>(key: K, value: CyberdriverSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!canSave) {
      toast.error("API key and both hotkeys are required.");
      return;
    }
    try {
      setIsSaving(true);
      await invoke("set_global_shortcut", { shortcut: dictationHotkey });
      await updateSettings({
        hotkey: dictationHotkey,
        computer_use_hotkey: computerUseHotkey,
        recording_mode: "toggle",
        use_different_ptt_key: false,
        pause_media_during_recording: quietOtherMedia,
        prefer_built_in_mic_when_bluetooth_output: preferBuiltInMicWhenBluetoothOutput,
        computer_use_typing_mode_enabled: computerUseTypingModeEnabled,
        onboarding_completed: true,
      });
      await saveSettings(draft, Boolean(status?.local_server_running || status?.tunnel_connected));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save settings.";
      console.error(message, error);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppPage
      title="Settings"
      description="Voice modes, cloud connection, permissions, and advanced configuration."
      actions={
        <Button onClick={handleSave} disabled={isSaving || !canSave} size="sm">
          {isSaving ? "Saving..." : "Save"}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Hotkeys */}
        <AppPanel>
          <AppSectionHeading
            title="Voice mode hotkeys"
            description="Keyboard shortcuts that trigger each mode."
          />
          <div className="mt-4">
            <HotkeyList>
              <CyberdriverHotkeyPicker
                icon="dictation"
                label="Dictation"
                value={dictationHotkey}
                onChange={setDictationHotkey}
                dialogDescription="This shortcut activates Dictation Mode."
                recommendedShortcuts={DICTATION_RECOMMENDED_HOTKEYS}
              />
              <CyberdriverHotkeyPicker
                icon="computer-use"
                label="Computer Use"
                value={computerUseHotkey}
                onChange={setComputerUseHotkey}
                dialogDescription="This shortcut activates Computer Use Mode."
                recommendedShortcuts={COMPUTER_USE_RECOMMENDED_HOTKEYS}
              />
            </HotkeyList>
          </div>
        </AppPanel>

        {/* Connection */}
        <AppPanel>
          <AppSectionHeading
            title="Cloud connection"
            description="Cyberdesk API credentials and host."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <LabeledField label="API Key">
              <Input
                value={draft.secret}
                onChange={(e) => setField("secret", e.target.value)}
                placeholder="sk-..."
                type="password"
              />
            </LabeledField>
            <LabeledField label="Host">
              <Input
                value={draft.host}
                onChange={(e) => setField("host", e.target.value)}
              />
            </LabeledField>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatusRow label="Runtime" value={isRunning(status) ? "On" : "Off"} />
            <StatusRow label="Machine ID" value={status?.machine_uuid || "..."} mono />
            <StatusRow label="Permissions" value={requiredPermissionsGranted ? "Ready" : "Needs review"} />
          </div>
        </AppPanel>

        {/* Permissions */}
        <AppPanel>
          <AppSectionHeading
            title="Permissions"
            description="Required macOS permissions for voice, shortcuts, screenshots, and automation."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refresh(true)}
                disabled={isRefreshing || permissionsLoading || requesting !== null}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                Refresh
              </Button>
            }
          />
          <div className="mt-4">
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
          </div>
        </AppPanel>

        {/* Advanced */}
        <AppPanel className="p-0">
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-accent"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">Advanced settings</p>
                  <p className="text-xs text-muted-foreground">
                    Ports, keepalive, recovery, and debugging.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    advancedOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-6 border-t border-border px-6 py-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Network</h3>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <LabeledField label="Port">
                        <Input
                          value={String(draft.port)}
                          onChange={(e) => setField("port", Number(e.target.value) || 443)}
                          inputMode="numeric"
                        />
                      </LabeledField>
                      <LabeledField label="Local Target Port">
                        <Input
                          value={String(draft.target_port)}
                          onChange={(e) => setField("target_port", Number(e.target.value) || 3000)}
                          inputMode="numeric"
                        />
                      </LabeledField>
                      <LabeledField label="Keepalive For">
                        <Input
                          value={draft.register_as_keepalive_for || ""}
                          onChange={(e) => setField("register_as_keepalive_for", e.target.value || null)}
                          placeholder="Machine ID"
                        />
                      </LabeledField>
                      <LabeledField label="Driver Path (Windows)">
                        <Input
                          value={draft.driver_path || ""}
                          onChange={(e) => setField("driver_path", e.target.value || null)}
                          placeholder="Optional"
                        />
                      </LabeledField>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-foreground">Behavior</h3>
                    <div className="mt-3 space-y-1">
                      <ToggleRow
                        label="Mute Other Media While Recording"
                        description="Mute other playing media while the mic is active, then restore the previous volume afterward."
                        checked={quietOtherMedia}
                        onChange={setQuietOtherMedia}
                      />
                      {isMacOS ? (
                        <ToggleRow
                          label="Prefer Mac Microphone With Bluetooth Headphones"
                          description="When Bluetooth headphones are the active output device, use your Mac's built-in microphone by default to avoid low-quality headset mode. Turn this off if you want the system default input instead."
                          checked={preferBuiltInMicWhenBluetoothOutput}
                          onChange={setPreferBuiltInMicWhenBluetoothOutput}
                        />
                      ) : null}
                      <ToggleRow
                        label="Typing Mode For Computer Use"
                        description="Let the computer-use hotkey open a subtle task composer. Start typing to switch from voice capture to a typed task, then press Enter or the hotkey again to submit."
                        checked={computerUseTypingModeEnabled}
                        onChange={setComputerUseTypingModeEnabled}
                      />
                      <ToggleRow label="Keepalive" checked={draft.keepalive_enabled} onChange={(v) => setField("keepalive_enabled", v)} />
                      <ToggleRow label="Black Screen Recovery" checked={draft.black_screen_recovery} onChange={(v) => setField("black_screen_recovery", v)} />
                      <ToggleRow label="Debug Logging" checked={draft.debug} onChange={(v) => setField("debug", v)} />
                      <ToggleRow label="Experimental Space Key" checked={draft.experimental_space} onChange={(v) => setField("experimental_space", v)} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <LabeledField label="Keepalive Threshold (min)">
                    <Input
                      value={String(draft.keepalive_threshold_minutes)}
                      onChange={(e) => setField("keepalive_threshold_minutes", Number(e.target.value) || 3)}
                      inputMode="decimal"
                    />
                  </LabeledField>
                  <LabeledField label="Black Screen Interval (s)">
                    <Input
                      value={String(draft.black_screen_check_interval)}
                      onChange={(e) => setField("black_screen_check_interval", Number(e.target.value) || 30)}
                      inputMode="decimal"
                    />
                  </LabeledField>
                  <LabeledField label="Keepalive Click X">
                    <Input
                      value={draft.keepalive_click_x ?? ""}
                      onChange={(e) => setField("keepalive_click_x", e.target.value ? Number(e.target.value) : null)}
                      inputMode="numeric"
                    />
                  </LabeledField>
                  <LabeledField label="Keepalive Click Y">
                    <Input
                      value={draft.keepalive_click_y ?? ""}
                      onChange={(e) => setField("keepalive_click_y", e.target.value ? Number(e.target.value) : null)}
                      inputMode="numeric"
                    />
                  </LabeledField>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </AppPanel>
      </div>
    </AppPage>
  );
}

function isRunning(status: ReturnType<typeof useCyberdriver>["status"]) {
  return Boolean(status?.local_server_running || status?.tunnel_connected);
}

function LabeledField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-accent">
      <div className="pr-4">
        <div className="text-sm text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StatusRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm text-foreground", mono && "break-all font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}
