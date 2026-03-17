import { invoke } from "@tauri-apps/api/core";

export type CyberdriverPermissionState = "granted" | "denied" | "not_determined" | "unknown";
export type CyberdriverPermissionName =
  | "microphone"
  | "accessibility"
  | "screenCapture"
  | "automation";

export interface CyberdriverPermissionSnapshot {
  microphone: CyberdriverPermissionState;
  accessibility: CyberdriverPermissionState;
  screenCapture: CyberdriverPermissionState;
  automation: CyberdriverPermissionState;
}

export const PERMISSION_SETTINGS_URLS: Record<CyberdriverPermissionName, string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenCapture: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  automation: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
};

export async function fetchPermissionSnapshot(): Promise<CyberdriverPermissionSnapshot> {
  return invoke<CyberdriverPermissionSnapshot>("get_permission_snapshot");
}

export function getMissingRequiredPermissions(
  snapshot: CyberdriverPermissionSnapshot
): string[] {
  const missing: string[] = [];

  if (snapshot.microphone !== "granted") {
    missing.push("Microphone");
  }

  if (snapshot.accessibility !== "granted") {
    missing.push("Accessibility");
  }

  if (snapshot.screenCapture !== "granted") {
    missing.push("Screen Recording");
  }

  return missing;
}

export function areRequiredPermissionsGranted(
  snapshot: CyberdriverPermissionSnapshot
): boolean {
  return getMissingRequiredPermissions(snapshot).length === 0;
}
