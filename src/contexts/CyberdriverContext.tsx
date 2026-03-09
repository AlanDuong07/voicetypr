import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export interface CyberdriverStatus {
  local_server_running: boolean;
  local_server_port?: number | null;
  tunnel_connected: boolean;
  service_running: boolean;
  keepalive_enabled: boolean;
  black_screen_recovery: boolean;
  debug_enabled: boolean;
  last_error?: string | null;
  machine_uuid: string;
  version: string;
}

export interface CyberdriverSettings {
  host: string;
  port: number;
  secret: string;
  target_port: number;
  keepalive_enabled: boolean;
  keepalive_threshold_minutes: number;
  keepalive_click_x: number | null;
  keepalive_click_y: number | null;
  black_screen_recovery: boolean;
  black_screen_check_interval: number;
  debug: boolean;
  register_as_keepalive_for: string | null;
  experimental_space: boolean;
  driver_path: string | null;
}

interface CyberdriverContextValue {
  status: CyberdriverStatus | null;
  settings: CyberdriverSettings | null;
  isLoading: boolean;
  refreshStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  saveSettings: (next: CyberdriverSettings, restart?: boolean) => Promise<void>;
  powerOn: () => Promise<void>;
  powerOff: () => Promise<void>;
  restartRuntime: () => Promise<void>;
}

const defaultSettings: CyberdriverSettings = {
  host: "api.cyberdesk.io",
  port: 443,
  secret: "",
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
};

const CyberdriverContext = createContext<CyberdriverContextValue | null>(null);

export function CyberdriverProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CyberdriverStatus | null>(null);
  const [settings, setSettings] = useState<CyberdriverSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    const next = await invoke<CyberdriverStatus>("get_cyberdriver_status");
    setStatus(next);
  }, []);

  const refreshSettings = useCallback(async () => {
    const next = await invoke<CyberdriverSettings>("get_cyberdriver_settings");
    setSettings(next);
  }, []);

  const powerOff = useCallback(async () => {
    await invoke("disconnect_tunnel");
    await invoke("stop_local_api");
    await refreshStatus();
  }, [refreshStatus]);

  const powerOn = useCallback(async () => {
    const currentSettings = settings ?? defaultSettings;
    if (!currentSettings.secret.trim()) {
      throw new Error("Cyberdesk API key is required.");
    }
    await invoke("start_local_api");
    await invoke("connect_tunnel");
    await refreshStatus();
  }, [refreshStatus, settings]);

  const restartRuntime = useCallback(async () => {
    await powerOff();
    await powerOn();
  }, [powerOff, powerOn]);

  const saveSettings = useCallback(
    async (next: CyberdriverSettings, restart = false) => {
      await invoke("update_cyberdriver_settings", { settings: next });
      setSettings(next);
      if (restart) {
        await restartRuntime();
        toast.success("Cyberdriver settings saved and runtime restarted.");
      } else {
        await refreshStatus();
        toast.success("Cyberdriver settings saved.");
      }
    },
    [refreshStatus, restartRuntime]
  );

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        await Promise.all([refreshStatus(), refreshSettings()]);
      } catch (error) {
        console.error("Failed to initialize Cyberdriver context:", error);
        toast.error("Failed to load Cyberdriver settings.");
      } finally {
        setIsLoading(false);
      }
    };

    load();
    const timer = window.setInterval(() => {
      refreshStatus().catch((error) => {
        console.error("Failed to refresh Cyberdriver status:", error);
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [refreshSettings, refreshStatus]);

  const value = useMemo(
    () => ({
      status,
      settings,
      isLoading,
      refreshStatus,
      refreshSettings,
      saveSettings,
      powerOn,
      powerOff,
      restartRuntime,
    }),
    [isLoading, powerOff, powerOn, refreshSettings, refreshStatus, restartRuntime, saveSettings, settings, status]
  );

  return <CyberdriverContext.Provider value={value}>{children}</CyberdriverContext.Provider>;
}

export function useCyberdriver() {
  const context = useContext(CyberdriverContext);
  if (!context) {
    throw new Error("useCyberdriver must be used within a CyberdriverProvider");
  }
  return context;
}

export { defaultSettings as defaultCyberdriverSettings };
