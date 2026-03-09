import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCyberdriver, type CyberdriverSettings, defaultCyberdriverSettings } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

export function CyberdriverSettingsTab() {
  const { settings, saveSettings, status } = useCyberdriver();
  const { settings: appSettings, updateSettings } = useSettings();
  const [draft, setDraft] = useState<CyberdriverSettings>(defaultCyberdriverSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [dictationHotkey, setDictationHotkey] = useState("");
  const [computerUseHotkey, setComputerUseHotkey] = useState("");

  useEffect(() => {
    if (settings) {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    setDictationHotkey(appSettings?.hotkey || "CommandOrControl+Shift+Space");
    setComputerUseHotkey(appSettings?.computer_use_hotkey || "Option+Space");
  }, [appSettings?.computer_use_hotkey, appSettings?.hotkey]);

  const canSave = useMemo(() => draft.secret.trim().length > 0 && dictationHotkey.trim().length > 0, [dictationHotkey, draft.secret]);

  const setField = <K extends keyof CyberdriverSettings>(key: K, value: CyberdriverSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    if (!canSave) {
      toast.error("Cyberdesk API key and dictation hotkey are required.");
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
          <h2 className="text-lg font-medium">Cyberdesk Connection</h2>
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
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <h2 className="text-lg font-medium">Automation Runtime</h2>
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
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 p-5">
          <h2 className="text-lg font-medium">Voice Modes</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <LabeledField label="Dictation Hotkey">
              <Input value={dictationHotkey} onChange={(event) => setDictationHotkey(event.target.value)} />
            </LabeledField>
            <LabeledField label="Computer Use Hotkey">
              <Input value={computerUseHotkey} onChange={(event) => setComputerUseHotkey(event.target.value)} />
            </LabeledField>
          </div>
          <p className="text-xs text-muted-foreground">
            Dictation still uses your local speech model. Computer use mode will send the spoken task to Cyberdesk cloud.
          </p>
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
