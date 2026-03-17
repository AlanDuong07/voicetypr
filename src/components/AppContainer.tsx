import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppErrorBoundary } from "./ErrorBoundary";
import { CyberdriverOnboarding } from "./onboarding/CyberdriverOnboarding";
import { Sidebar } from "./Sidebar";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";
import { TabContainer } from "./tabs/TabContainer";
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
  const { settings, refreshSettings, isLoading: settingsLoading } = useSettings();
  const {
    settings: cyberdriverSettings,
    isLoading: cyberdriverLoading,
  } = useCyberdriver();

  // Use a ref to track if we've just completed onboarding
  const hasJustCompletedOnboarding = useRef(false);

  useEffect(() => {
    if (settingsLoading || cyberdriverLoading) {
      return;
    }

    const shouldShowOnboarding =
      !settings?.onboarding_completed || !cyberdriverSettings?.secret?.trim();

    if (!shouldShowOnboarding) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setShowOnboarding(true);
      setActiveSection("home");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    cyberdriverLoading,
    cyberdriverSettings?.secret,
    settings?.onboarding_completed,
    settingsLoading,
  ]);

  // Register long-lived UI event handlers once.
  useEffect(() => {
    const handleNoModels = () => {
      console.log("No models available - redirecting to Models");
      setActiveSection("models");
      toast.info("Download or configure a speech model in Models before recording.");
    };

    window.addEventListener("no-models-available", handleNoModels);

    void registerEvent("navigate-to-settings", () => {
      console.log("Navigate to settings requested from tray menu");
      setActiveSection("settings");
    });

    void registerEvent("tray-check-updates", async () => {
      try {
        await updateService.checkForUpdatesManually();
      } catch (e) {
        console.error("Manual update check failed:", e);
        toast.error("Failed to check for updates");
      }
    });

    void registerEvent("tray-action-error", (event) => {
      console.error("Tray action error:", event.payload);
      toast.error(event.payload as string);
    });

    void registerEvent<string>("parakeet-unavailable", (message) => {
      const description =
        typeof message === "string" && message.trim().length > 0
          ? message
          : "Parakeet is unavailable on this Mac. Please reinstall Cyberdriver or remove the quarantine flag.";
      console.error("Parakeet unavailable:", description);
      toast.error("Parakeet Unavailable", {
        description,
        duration: 8000,
      });
    });

    void registerEvent<ErrorEventPayload>("no-models-error", (data) => {
      console.error("No models available:", data);
      toast.error(data.title || "No Models Available", {
        description:
          data.message ||
          "Connect a cloud provider or download a local model in Models before recording.",
        duration: 8000,
      });
    });

    return () => {
      window.removeEventListener("no-models-available", handleNoModels);
    };
  }, [registerEvent]);

  // Refresh backend-dependent app services whenever settings change.
  useEffect(() => {
    if (!settings) {
      return;
    }

    if (settings.transcription_cleanup_days) {
      void invoke("cleanup_old_transcriptions", {
        days: settings.transcription_cleanup_days,
      });
    }

    void updateService.initialize(settings);

    const loadApiKeysTimer = window.setTimeout(() => {
      loadApiKeysToCache().catch((error) => {
        console.error("Failed to load API keys to cache:", error);
      });
    }, 100);

    return () => {
      window.clearTimeout(loadApiKeysTimer);
      updateService.dispose();
    };
  }, [settings]);

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

      // Request notification permission for update notifications
      updateService.requestNotificationPermission();
    }
  }, [
    showOnboarding,
    settings?.onboarding_completed,
  ]);

  if (settingsLoading || cyberdriverLoading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Cyberdriver...
        </div>
      </div>
    );
  }

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
