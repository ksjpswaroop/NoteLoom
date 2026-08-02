export enum ShortcutSettings {
  screenshot = "shotcut-screenshot",
  text = "shotcut-text",
  pin = "window-pin",
  link = "shotcut-link"
}

export enum ShortcutDefault {
  screenshot = "Control+Shift+S",
  text = "Control+Shift+T",
  pin = "Control+Shift+P",
  link = "Control+Shift+L",
}

/**
 * 
 * rename: F2 (Win/Linux) / Enter (macOS) - （）
 * copy: Ctrl+C (Win/Linux) / Cmd+C (macOS) - 
 * paste: Ctrl+V (Win/Linux) / Cmd+V (macOS) - 
 * cut: Ctrl+X (Win/Linux) / Cmd+X (macOS) - 
 * delete: Delete (Win/Linux) / Backspace (macOS) - 
 */
export const FileShortcuts = {
  rename: 'F2',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  cut: 'Ctrl+X',
  delete: 'Delete'
} as const