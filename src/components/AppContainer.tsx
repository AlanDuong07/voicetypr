import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppErrorBoundary } from "./ErrorBoundary";
import { CyberdriverOnboarding } from "./onboarding/CyberdriverOnboarding";
import { Sidebar } from "./Sidebar";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { TabContainer } from "./tabs/TabContainer";
import { useReadiness } from "@/contexts/ReadinessContext";
import { useCyberdriver } from "@/contexts/CyberdriverContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useEventCoordinator } from "@/hooks/useEventCoordinator";
import { updateService } from "@/services/updateService";
import { loadApiKeysToCache } from "@/utils/keyring";

// Type for error event payloads from backend
interface ErrorEventPayload {
  title?: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  actions?: string[];
  details?: string;
  hotkey?: string;
  error?: string;
  suggestion?: string;
}

export function AppContainer() {
  const { registerEvent } = useEventCoordinator("main");
  const [activeSection, setActiveSection] = useState<string>("home");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { settings, refreshSettings } = useSettings();
  const { settings: cyberdriverSettings } = useCyberdriver();
  const { checkAccessibilityPermission, checkMicrophonePermission } = useReadiness();

  // Use a ref to track if we've just completed onboarding
  const hasJustCompletedOnboarding = useRef(false);

  // Initialize app
  useEffect(() => {
    const init = async () => {
      try {
        // Check if onboarding is completed - only check when settings are loaded
        if (settings && (!settings.onboarding_completed || !cyberdriverSettings?.secret)) {
          setShowOnboarding(true);
        }

        // Run cleanup if enabled
        if (settings?.transcription_cleanup_days) {
          await invoke("cleanup_old_transcriptions", {
            days: settings.transcription_cleanup_days
          });
        }

        // Initialize update service for automatic update checks
        if (settings) {
          await updateService.initialize(settings);
        }

        // Load API keys from Stronghold to backend cache
        // Small delay to ensure Stronghold is ready
        setTimeout(() => {
          loadApiKeysToCache().catch((error) => {
            console.error("Failed to load API keys to cache:", error);
          });
        }, 100);

        // Listen for no-models event to redirect to onboarding
        const handleNoModels = () => {
          console.log("No models available - redirecting to onboarding");
          setShowOnboarding(true);
        };
        window.addEventListener("no-models-available", handleNoModels);

        // Listen for navigate-to-settings event from tray menu
        registerEvent("navigate-to-settings", () => {
          console.log("Navigate to settings requested from tray menu");
          setActiveSection("settings");
        });

        // Listen for manual update checks triggered from tray
        registerEvent("tray-check-updates", async () => {
          try {
            await updateService.checkForUpdatesManually();
          } catch (e) {
            console.error("Manual update check failed:", e);
            toast.error("Failed to check for updates");
          }
        });

        // Listen for tray action errors
        registerEvent("tray-action-error", (event) => {
          console.error("Tray action error:", event.payload);
          toast.error(event.payload as string);
        });

        registerEvent<string>("parakeet-unavailable", (message) => {
          const description = typeof message === "string" && message.trim().length > 0
            ? message
            : "Parakeet is unavailable on this Mac. Please reinstall VoiceTypr or remove the quarantine flag.";
          console.error("Parakeet unavailable:", description);
          toast.error("Parakeet Unavailable", {
            description,
            duration: 8000
          });
        });

        // Listen for no models error (when trying to record without any models)
        registerEvent<ErrorEventPayload>("no-models-error", (data) => {
          console.error("No models available:", data);
          toast.error(data.title || 'No Models Available', {
            description:
              data.message ||
              'Connect a cloud provider or download a local model in Models before recording.',
            duration: 8000
          });
        });

        return () => {
          window.removeEventListener("no-models-available", handleNoModels);
          updateService.dispose();
        };
      } catch (error) {
        console.error("Failed to initialize:", error);
      }
    };

    init();
  }, [cyberdriverSettings?.secret, registerEvent, settings]);

  // Mark when onboarding is being shown
  useEffect(() => {
    if (showOnboarding) {
      hasJustCompletedOnboarding.current = true;
    }
  }, [showOnboarding]);

  // Check permissions only when transitioning from onboarding to dashboard
  useEffect(() => {
    // Only refresh if we just completed onboarding and are now showing dashboard
    if (!showOnboarding && hasJustCompletedOnboarding.current && settings?.onboarding_completed) {
      hasJustCompletedOnboarding.current = false;

      Promise.all([checkAccessibilityPermission(), checkMicrophonePermission()]).then(() => {
        console.log("Permissions refreshed after onboarding completion");
      });

      // Request notification permission for update notifications
      updateService.requestNotificationPermission();
    }
  }, [
    showOnboarding,
    settings?.onboarding_completed,
    checkAccessibilityPermission,
    checkMicrophonePermission
  ]);

  // Onboarding View
  if (showOnboarding) {
    return (
      <AppErrorBoundary>
        <CyberdriverOnboarding
          onComplete={() => {
            setShowOnboarding(false);
            // Reload settings after onboarding
            refreshSettings();
          }}
        />
      </AppErrorBoundary>
    );
  }

  // Main App Layout
  return (
    <SidebarProvider>
      <Sidebar 
        activeSection={activeSection} 
        onSectionChange={setActiveSection} 
      />
      <SidebarInset>
        <TabContainer activeSection={activeSection} />
      </SidebarInset>
    </SidebarProvider>
  );
}
