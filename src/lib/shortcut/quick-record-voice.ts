import emitter from '@/lib/emitter';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

async function focusMainWindow(): Promise<number> {
  const window = getCurrentWebviewWindow()
  if (!window) return 0

  if (!(await window.isVisible())) {
    await window.show()
    await window.setFocus()
    await window.setAlwaysOnTop(true)
    await window.setAlwaysOnTop(false)
    return 300
  }

  if (await window.isMinimized()) {
    await window.unminimize()
    await window.show()
    await window.setFocus()
    await window.setAlwaysOnTop(true)
    await window.setAlwaysOnTop(false)
    return 100
  }

  if (!(await window.isFocused())) {
    await window.setFocus()
    await window.setAlwaysOnTop(true)
    await window.setAlwaysOnTop(false)
  }

  return 0
}

export default function initQuickRecordVoice() {
  emitter.on('quickRecordVoice', async () => {
    const delayMs = await focusMainWindow()
    if (delayMs > 0) {
      setTimeout(() => {
        emitter.emit('toolbar-shortcut-recording')
      }, delayMs)
      return
    }
    emitter.emit('toolbar-shortcut-recording')
  })
}
