import { platform } from "@tauri-apps/plugin-os";

//
let cachedResult: boolean | null = null;
let cachedTauriResult: boolean | null = null;

//
export function isMobileDevice() {
  // ，
  if (cachedResult !== null) {
    return cachedResult;
  }

  try {
    const platformName = platform();
    cachedResult = platformName === 'android' || platformName === 'ios';
    return cachedResult;
  } catch (error) {
    console.error('Error detecting platform:', error);
    // Tauri API ， user agent
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase();
      cachedResult = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      return cachedResult;
    }
    cachedResult = false;
    return false;
  }
}

// Tauri
export function checkIsTauri(): boolean {
  // ，
  if (cachedTauriResult !== null) {
    return cachedTauriResult;
  }

  try {
    // Tauri API， Tauri
    platform();
    cachedTauriResult = true;
    return true;
  } catch {
    cachedTauriResult = false;
    return false;
  }
}
