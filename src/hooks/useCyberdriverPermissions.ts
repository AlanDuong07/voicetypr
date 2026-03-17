import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  areRequiredPermissionsGranted,
  fetchPermissionSnapshot,
  PERMISSION_SETTINGS_URLS,
  type CyberdriverPermissionName,
  type CyberdriverPermissionSnapshot,
  type CyberdriverPermissionState,
} from "@/lib/cyberdriverPermissions";

interface UseCyberdriverPermissionsOptions {
  refreshOnFocus?: boolean;
}

export function useCyberdriverPermissions(
  options: UseCyberdriverPermissionsOptions = {}
) {
  const { refreshOnFocus = true } = options;
  const [snapshot, setSnapshot] = useState<CyberdriverPermissionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [requesting, setRequesting] =
    useState<CyberdriverPermissionName | null>(null);
  const [screenCaptureNeedsRelaunch, setScreenCaptureNeedsRelaunch] =
    useState(false);
  const [automationOverride, setAutomationOverride] =
    useState<CyberdriverPermissionState | null>(null);

  const refresh = useCallback(
    async (background = true) => {
      if (background) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const next = await fetchPermissionSnapshot();
        setSnapshot(next);

        if (next.screenCapture === "granted") {
          setScreenCaptureNeedsRelaunch(false);
        }
      } catch (error) {
        console.error("Failed to refresh Cyberdriver permissions:", error);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  const openSettings = useCallback(async (permission: CyberdriverPermissionName) => {
    await open(PERMISSION_SETTINGS_URLS[permission]);
  }, []);

  const relaunchApp = useCallback(async () => {
    await relaunch();
  }, []);

  const requestPermission = useCallback(
    async (permission: CyberdriverPermissionName) => {
      setRequesting(permission);

      try {
        if (permission === "automation") {
          const granted = await invoke<boolean>("request_automation_permission");
          setAutomationOverride(granted ? "granted" : "denied");

          if (!granted) {
            await openSettings("automation");
            toast.info(
              "Automation is optional. Enable Cyberdriver in System Settings if you want dictation to auto-paste instead of staying in the clipboard."
            );
          }

          return;
        }

        if (permission === "microphone") {
          const currentState = snapshot?.microphone ?? "unknown";
          if (currentState === "denied") {
            await openSettings("microphone");
            toast.info(
              "Enable Microphone for Cyberdriver in System Settings, then return here and click Refresh."
            );
            return;
          }

          const granted = await invoke<boolean>("request_microphone_permission");
          await refresh(true);

          if (!granted) {
            await openSettings("microphone");
            toast.info(
              "Microphone access is still off. Enable Cyberdriver in System Settings, then return here and click Refresh."
            );
          }

          return;
        }

        if (permission === "accessibility") {
          const granted = await invoke<boolean>("request_accessibility_permission");
          await refresh(true);

          if (!granted) {
            await openSettings("accessibility");
            toast.info(
              "Enable Accessibility for Cyberdriver in System Settings, then return here and click Refresh."
            );
          }

          return;
        }

        const granted = await invoke<boolean>("request_screen_capture_permission");
        await refresh(true);

        if (!granted) {
          setScreenCaptureNeedsRelaunch(true);
          await openSettings("screenCapture");
          toast.info(
            "After granting Screen Recording, relaunch Cyberdriver once so the current app process can capture the screen."
          );
        }
      } catch (error) {
        console.error(`Failed to request ${permission} permission:`, error);
        toast.error(`Failed to request ${permission} permission.`);
      } finally {
        setRequesting(null);
      }
    },
    [openSettings, refresh, snapshot?.microphone]
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (!refreshOnFocus) {
      return;
    }

    const handleFocus = () => {
      void refresh(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh, refreshOnFocus]);

  const effectiveSnapshot = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    return {
      ...snapshot,
      automation: automationOverride ?? snapshot.automation,
    };
  }, [automationOverride, snapshot]);

  return {
    snapshot: effectiveSnapshot,
    isLoading,
    isRefreshing,
    requesting,
    screenCaptureNeedsRelaunch,
    requiredPermissionsGranted: effectiveSnapshot
      ? areRequiredPermissionsGranted(effectiveSnapshot)
      : false,
    refresh,
    openSettings,
    relaunchApp,
    requestPermission,
  };
}
