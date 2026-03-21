import { CyberdriverHotkeyPicker, HotkeyList } from "@/components/cyberdriver/CyberdriverHotkeyPicker";
import { CyberdriverPermissionChecklist } from "@/components/cyberdriver/CyberdriverPermissionChecklist";
import { AppChip, AppPanel } from "@/components/layout/AppPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useModelManagementContext } from "@/contexts/ModelManagementContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useCyberdriverPermissions } from "@/hooks/useCyberdriverPermissions";
import { getMissingRequiredPermissions } from "@/lib/cyberdriverPermissions";
import { cn } from "@/lib/utils";
import { isLocalModel, OnboardingStepId } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  Keyboard,
  Mic,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

interface CyberdriverOnboardingProps {
  onComplete: (destination?: string) => void;
}

const ONBOARDING_DRAFT_STORAGE_KEY = "cyberdriver_onboarding_draft";
const CURRENT_ONBOARDING_VERSION = 2;
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
const STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "permissions",
  "hotkeys",
  "cyberdesk",
  "dictation",
  "finish",
];
const STEP_CONTENT = [
  {
    id: "welcome" as const,
    label: "Welcome",
    kicker: "Start here",
    title: "Set up Cyberdriver in a few focused steps.",
    description:
      "We’ll get permissions, hotkeys, and Cyberdesk access ready first. Dictation model setup can follow without blocking computer use.",
  },
  {
    id: "permissions" as const,
    label: "Permissions",
    kicker: "Mac access",
    title: "Grant the desktop capabilities Cyberdriver needs.",
    description:
      "Microphone, Accessibility, and Screen Recording power the core experience. Automation is optional for dictation auto-paste.",
  },
  {
    id: "hotkeys" as const,
    label: "Voice modes",
    kicker: "Shortcuts",
    title: "Choose one shortcut for each voice workflow.",
    description:
      "Keep dictation and computer use easy to remember. Your current hotkey picker and side-specific modifier support stay intact.",
  },
  {
    id: "cyberdesk" as const,
    label: "Cyberdesk",
    kicker: "Cloud link",
    title: "Connect this machine to Cyberdesk.",
    description:
      "Your API key powers computer use mode. The machine ID below is what Cyberdesk cloud will target for tasks.",
  },
  {
    id: "dictation" as const,
    label: "Dictation",
    kicker: "Speech path",
    title: "Check whether local dictation is ready yet.",
    description:
      "Computer use can work as soon as Cyberdesk is connected. Dictation becomes fully ready once you’ve picked a local speech model.",
  },
  {
    id: "finish" as const,
    label: "Finish",
    kicker: "Ready",
    title: "You’re ready to launch into Cyberdriver.",
    description:
      "We’ll save your setup, keep the same backend behavior, and drop you into the most useful next screen.",
  },
];

export function CyberdriverOnboarding({ onComplete }: CyberdriverOnboardingProps) {
  const { settings, status, saveSettings } = useCyberdriver();
  const { updateSettings, settings: appSettings } = useSettings();
  const { sortedModels } = useModelManagementContext();
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
  const initializedStepRef = useRef(false);
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
  const [currentStep, setCurrentStep] = useState<OnboardingStepId>("welcome");
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

  const persistStep = useCallback(
    async (step: OnboardingStepId) => {
      await updateSettings({
        onboarding_completed: false,
        onboarding_step: step,
        onboarding_version: CURRENT_ONBOARDING_VERSION,
      });
    },
    [updateSettings]
  );

  useEffect(() => {
    if (!appSettings || initializedStepRef.current) {
      return;
    }

    initializedStepRef.current = true;
    const resolved = resolveOnboardingStep(
      appSettings.onboarding_step,
      appSettings.onboarding_version
    );
    setCurrentStep(resolved);

    if (
      appSettings.onboarding_step !== resolved ||
      appSettings.onboarding_version !== CURRENT_ONBOARDING_VERSION
    ) {
      void persistStep(resolved).catch((error) => {
        console.error("Failed to persist onboarding progress:", error);
      });
    }
  }, [appSettings, persistStep]);

  const missingRequiredPermissions = useMemo(() => {
    return snapshot ? getMissingRequiredPermissions(snapshot) : [];
  }, [snapshot]);

  const availableLocalModels = useMemo(
    () =>
      sortedModels.filter(([, model]) => {
        return isLocalModel(model) && model.downloaded && !model.requires_setup;
      }),
    [sortedModels]
  );

  const selectedModel = useMemo(() => {
    return availableLocalModels.find(([name]) => name === appSettings?.current_model) ?? null;
  }, [appSettings?.current_model, availableLocalModels]);

  const hasLocalDictationModel = Boolean(selectedModel);
  const shouldSendToModelsFirst = !hasLocalDictationModel;
  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const currentStepMeta = STEP_CONTENT.find((step) => step.id === currentStep) ?? STEP_CONTENT[0];
  const progress = ((currentIndex + 1) / STEP_ORDER.length) * 100;

  const goToStep = useCallback(
    async (step: OnboardingStepId) => {
      setCurrentStep(step);
      try {
        await persistStep(step);
      } catch (error) {
        console.error("Failed to save onboarding step:", error);
      }
    },
    [persistStep]
  );

  const handleComplete = async (destination: "home" | "models") => {
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
        recording_mode: "toggle",
        use_different_ptt_key: false,
        pause_media_during_recording: true,
        prefer_built_in_mic_when_bluetooth_output: true,
        computer_use_typing_mode_enabled: true,
        onboarding_completed: true,
        onboarding_step: "finish",
        onboarding_version: CURRENT_ONBOARDING_VERSION,
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
      onComplete(destination);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to finish onboarding.";
      console.error(message, error);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrimaryAction = async () => {
    switch (currentStep) {
      case "welcome":
        await goToStep("permissions");
        return;
      case "permissions":
        await goToStep("hotkeys");
        return;
      case "hotkeys":
        if (!dictationHotkey.trim() || !computerUseHotkey.trim()) {
          toast.error("Choose both voice mode hotkeys before continuing.");
          return;
        }
        await goToStep("cyberdesk");
        return;
      case "cyberdesk":
        if (!apiKey.trim()) {
          toast.error("Cyberdesk API key is required.");
          return;
        }
        await goToStep("dictation");
        return;
      case "dictation":
        await goToStep("finish");
        return;
      case "finish":
        await handleComplete(shouldSendToModelsFirst ? "models" : "home");
        return;
      default:
        return;
    }
  };

  const handleSecondaryFinishAction = async () => {
    await handleComplete("home");
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full max-w-5xl gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-border bg-card p-6">
            <div className="space-y-6">
              <div className="space-y-3">
                <AppChip className="w-fit">
                  <Bot className="h-3.5 w-3.5" />
                  Guided setup
                </AppChip>
                <div className="space-y-1.5">
                  <h1 className="text-lg font-semibold text-foreground">
                    Setup
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    One step at a time. You can finish optional setup later.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {STEP_CONTENT.map((step, index) => {
                  const isCurrent = step.id === currentStep;
                  const isAvailable = index <= currentIndex;
                  const isCompleted = index < currentIndex;
                  return (
                    <button
                      key={step.id}
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => {
                        if (isAvailable) {
                          void goToStep(step.id);
                        }
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isCurrent
                          ? "bg-accent text-foreground"
                          : isAvailable
                          ? "hover:bg-accent"
                          : "opacity-50"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold",
                          isCurrent
                            ? "border-transparent bg-primary text-primary-foreground"
                            : isCompleted
                            ? "border-emerald-300/35 bg-emerald-400/12 text-emerald-700 dark:text-emerald-300"
                            : "border-border/70 bg-background/70 text-muted-foreground"
                        )}
                      >
                        {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{step.label}</p>
                        <p className="text-[13px] text-muted-foreground">{step.kicker}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg bg-muted p-4">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    What you’re setting up
                  </p>
                  <ul className="space-y-2 text-sm leading-6 text-foreground">
                    <li>Computer use through Cyberdesk cloud</li>
                    <li>Local dictation with your own speech model</li>
                    <li>Mac permissions, hotkeys, and runtime readiness</li>
                  </ul>
                </div>
              </div>
            </div>
          </aside>

          <AppPanel className="p-0">
            <div className="space-y-8 p-6 md:p-8">
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {currentStepMeta.kicker}
                  </p>
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {currentStepMeta.title}
                  </h2>
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                    {currentStepMeta.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Step {currentIndex + 1} of {STEP_ORDER.length}
                  </p>
                </div>
              </div>

              <StepBody
                step={currentStep}
                snapshot={snapshot}
                requiredPermissionsGranted={requiredPermissionsGranted}
                missingRequiredPermissions={missingRequiredPermissions}
                permissionsLoading={permissionsLoading}
                isRefreshing={isRefreshing}
                requesting={requesting}
                screenCaptureNeedsRelaunch={screenCaptureNeedsRelaunch}
                onRefresh={async () => refresh(true)}
                onOpenSettings={openSettings}
                onRelaunch={relaunchApp}
                onRequestPermission={requestPermission}
                dictationHotkey={dictationHotkey}
                setDictationHotkey={setDictationHotkey}
                computerUseHotkey={computerUseHotkey}
                setComputerUseHotkey={setComputerUseHotkey}
                apiKey={apiKey}
                setApiKey={setApiKey}
                machineId={status?.machine_uuid || ""}
                hasLocalDictationModel={hasLocalDictationModel}
                selectedModelLabel={selectedModel?.[1].display_name || selectedModel?.[0] || ""}
                availableLocalModelCount={availableLocalModels.length}
                shouldSendToModelsFirst={shouldSendToModelsFirst}
              />

              <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="justify-start px-0 hover:bg-transparent"
                  onClick={() => {
                    if (currentIndex > 0) {
                      void goToStep(STEP_ORDER[currentIndex - 1]);
                    }
                  }}
                  disabled={currentIndex === 0 || saving}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {currentStep === "finish" && shouldSendToModelsFirst ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSecondaryFinishAction()}
                      disabled={saving}
                    >
                      Open Home Instead
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    className="min-w-[220px]"
                    onClick={() => void handlePrimaryAction()}
                    disabled={saving || permissionsLoading}
                  >
                    {saving
                      ? "Saving..."
                      : currentStep === "permissions"
                      ? requiredPermissionsGranted
                        ? "Continue"
                        : "Continue for now"
                      : currentStep === "dictation"
                      ? hasLocalDictationModel
                        ? "Continue"
                        : "Continue without dictation"
                      : currentStep === "finish"
                      ? shouldSendToModelsFirst
                        ? "Continue to Models"
                        : "Continue to Home"
                      : "Continue"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </AppPanel>
        </div>
      </div>
    </div>
  );
}

function StepBody({
  step,
  snapshot,
  requiredPermissionsGranted,
  missingRequiredPermissions,
  permissionsLoading,
  isRefreshing,
  requesting,
  screenCaptureNeedsRelaunch,
  onRefresh,
  onOpenSettings,
  onRelaunch,
  onRequestPermission,
  dictationHotkey,
  setDictationHotkey,
  computerUseHotkey,
  setComputerUseHotkey,
  apiKey,
  setApiKey,
  machineId,
  hasLocalDictationModel,
  selectedModelLabel,
  availableLocalModelCount,
  shouldSendToModelsFirst,
}: {
  step: OnboardingStepId;
  snapshot: ReturnType<typeof useCyberdriverPermissions>["snapshot"];
  requiredPermissionsGranted: boolean;
  missingRequiredPermissions: string[];
  permissionsLoading: boolean;
  isRefreshing: boolean;
  requesting: ReturnType<typeof useCyberdriverPermissions>["requesting"];
  screenCaptureNeedsRelaunch: boolean;
  onRefresh: () => Promise<void>;
  onOpenSettings: (permission: Parameters<ReturnType<typeof useCyberdriverPermissions>["openSettings"]>[0]) => Promise<void>;
  onRelaunch: () => Promise<void>;
  onRequestPermission: (permission: Parameters<ReturnType<typeof useCyberdriverPermissions>["requestPermission"]>[0]) => Promise<void>;
  dictationHotkey: string;
  setDictationHotkey: (value: string) => void;
  computerUseHotkey: string;
  setComputerUseHotkey: (value: string) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  machineId: string;
  hasLocalDictationModel: boolean;
  selectedModelLabel: string;
  availableLocalModelCount: number;
  shouldSendToModelsFirst: boolean;
}) {
  if (step === "welcome") {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureBlurb
            icon={<Mic className="h-4 w-4" />}
            title="Two voice modes"
            description="Separate shortcuts for dictation and computer use keep intent obvious."
          />
          <FeatureBlurb
            icon={<Cloud className="h-4 w-4" />}
            title="Cyberdesk connected"
            description="Send spoken tasks to the cloud agent while keeping runtime local."
          />
          <FeatureBlurb
            icon={<Cpu className="h-4 w-4" />}
            title="Local dictation"
            description="Keep fast voice-to-text on-device once your speech model is selected."
          />
        </div>

        <AppPanel className="p-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Setup takes about two minutes.</p>
            <p className="text-sm leading-6 text-muted-foreground">
              You can keep moving even if optional pieces are unfinished. Cyberdriver only stays off
              when required permissions are still missing.
            </p>
          </div>
        </AppPanel>
      </div>
    );
  }

  if (step === "permissions") {
    return (
      <div className="space-y-5">
        {snapshot && !requiredPermissionsGranted ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Remaining required permissions:{" "}
            <span className="font-semibold">{missingRequiredPermissions.join(", ")}</span>. You can
            continue, but Cyberdriver will stay off until those are ready.
          </div>
        ) : null}

        {snapshot && requiredPermissionsGranted ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            Required permissions are ready. Automation remains optional for dictation auto-paste.
          </div>
        ) : null}

        <CyberdriverPermissionChecklist
          snapshot={snapshot}
          isLoading={permissionsLoading}
          isRefreshing={isRefreshing}
          requesting={requesting}
          screenCaptureNeedsRelaunch={screenCaptureNeedsRelaunch}
          onRefresh={onRefresh}
          onOpenSettings={onOpenSettings}
          onRelaunch={onRelaunch}
          onRequestPermission={onRequestPermission}
        />
      </div>
    );
  }

  if (step === "hotkeys") {
    return (
      <div className="space-y-5">
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

        <div className="grid gap-3 md:grid-cols-2">
          <AppChip>
            <Keyboard className="h-3.5 w-3.5" />
            Single-key shortcuts are supported where expected.
          </AppChip>
          <AppChip>
            <ShieldCheck className="h-3.5 w-3.5" />
            Side-specific modifiers like Right Option and Right Command stay supported.
          </AppChip>
        </div>
      </div>
    );
  }

  if (step === "cyberdesk") {
    return (
      <div className="space-y-5">
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
            <Input value={machineId} readOnly disabled />
          </Field>
        </div>

        <AppPanel className="p-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Computer use mode depends on this key.</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Spoken tasks from your computer-use hotkey are sent to
              `api.cyberdesk.io/v1/computer/{machineId || "machine_id"}/task`, while dictation
              continues to use your local speech stack.
            </p>
          </div>
        </AppPanel>
      </div>
    );
  }

  if (step === "dictation") {
    return (
      <div className="space-y-5">
        <AppPanel className="p-5">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge variant={hasLocalDictationModel ? "secondary" : "outline"}>
                {hasLocalDictationModel ? "Ready" : "Needs setup"}
              </Badge>
              <p className="text-sm font-medium text-foreground">
                {hasLocalDictationModel
                  ? `Dictation will use ${selectedModelLabel}.`
                  : availableLocalModelCount > 0
                  ? "You have local models available, but none is selected yet."
                  : "No local speech model is ready yet."}
              </p>
            </div>

            <p className="text-sm leading-6 text-muted-foreground">
              {hasLocalDictationModel
                ? "You can continue directly into Home and start using both voice modes."
                : availableLocalModelCount > 0
                ? "After setup, we’ll send you to Models so you can choose which local speech path powers dictation."
                : "After setup, we’ll send you to Models so you can download a local speech model for dictation. Computer use mode can still work as soon as your API key is saved."}
            </p>
          </div>
        </AppPanel>

        <div className="grid gap-3 md:grid-cols-2">
          <FeatureBlurb
            icon={<Cloud className="h-4 w-4" />}
            title="Computer use is separate"
            description="It can be ready even before dictation setup is finished."
          />
          <FeatureBlurb
            icon={<Cpu className="h-4 w-4" />}
            title={shouldSendToModelsFirst ? "Next stop: Models" : "Next stop: Home"}
            description={
              shouldSendToModelsFirst
                ? "We’ll point you to model setup right after onboarding."
                : "You already have the local speech path needed for dictation."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Permissions"
          value={requiredPermissionsGranted ? "Ready" : "Partial"}
          detail={
            requiredPermissionsGranted
              ? "Required permissions granted"
              : missingRequiredPermissions.join(", ")
          }
        />
        <SummaryTile
          label="Voice Modes"
          value={dictationHotkey && computerUseHotkey ? "Ready" : "Missing"}
          detail="Two shortcuts saved"
        />
        <SummaryTile
          label="Cyberdesk"
          value={apiKey.trim() ? "Connected" : "Missing"}
          detail={machineId || "Machine ID unavailable"}
        />
        <SummaryTile
          label="Dictation"
          value={hasLocalDictationModel ? "Ready" : "Next step"}
          detail={
            hasLocalDictationModel ? selectedModelLabel : "Choose a local speech model"
          }
        />
      </div>

      <AppPanel className="p-5">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {shouldSendToModelsFirst
              ? "We’ll open Models next so you can finish dictation setup."
              : "We’ll open Home next so you can turn Cyberdriver on and start using it."}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            The prominent power button stays on Home, and the floating toolbar behavior remains the same.
          </p>
        </div>
      </AppPanel>
    </div>
  );
}

function FeatureBlurb({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <AppPanel className="p-5">
      <div className="space-y-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
          {icon}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
    </AppPanel>
  );
}

function SummaryTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <AppPanel className="p-4">
      <div className="space-y-1.5">
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </AppPanel>
  );
}

function resolveOnboardingStep(
  step: OnboardingStepId | undefined,
  version: number | undefined
) {
  if (version !== CURRENT_ONBOARDING_VERSION) {
    return "welcome";
  }

  if (!step || !STEP_ORDER.includes(step)) {
    return "welcome";
  }

  return step;
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
