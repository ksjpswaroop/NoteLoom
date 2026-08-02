'use client'

import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { checkIsTauri } from '@/lib/check'

export type ExcalidrawExportFormat = 'png' | 'svg'

function ensureExtension(path: string, extension: string) {
  const normalized = path.trim()
  const suffix = `.${extension}`
  return normalized.toLowerCase().endsWith(suffix) ? normalized : `${normalized}${suffix}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function baseNameFromPath(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() || 'sketch'
  return name.replace(/\.excalidraw$/i, '') || 'sketch'
}

export async function exportExcalidrawScene(
  scene: {
    elements: readonly unknown[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
  },
  format: ExcalidrawExportFormat,
  filePathOrName = 'sketch',
): Promise<boolean> {
  const { exportToBlob, exportToSvg } = await import('@excalidraw/excalidraw')
  const safeName = baseNameFromPath(filePathOrName).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sketch'
  const elements = scene.elements as never
  const appState = {
    ...scene.appState,
    exportWithDarkMode: false,
    exportBackground: true,
  } as never
  const files = scene.files as never

  if (format === 'svg') {
    const svg = await exportToSvg({
      elements,
      appState,
      files,
      exportPadding: 16,
    })
    const svgString = svg.outerHTML
    const filename = `${safeName}.svg`
    if (checkIsTauri()) {
      const selectedPath = await save({
        title: 'Export Excalidraw SVG',
        defaultPath: filename,
        filters: [{ name: 'SVG Images', extensions: ['svg'] }],
      })
      if (!selectedPath) return false
      await writeTextFile(ensureExtension(selectedPath, 'svg'), svgString)
      return true
    }
    downloadBlob(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }), filename)
    return true
  }

  const blob = await exportToBlob({
    elements,
    appState,
    files,
    mimeType: 'image/png',
    exportPadding: 16,
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const filename = `${safeName}.png`
  if (checkIsTauri()) {
    const selectedPath = await save({
      title: 'Export Excalidraw PNG',
      defaultPath: filename,
      filters: [{ name: 'PNG Images', extensions: ['png'] }],
    })
    if (!selectedPath) return false
    await writeFile(ensureExtension(selectedPath, 'png'), bytes)
    return true
  }

  downloadBlob(new Blob([bytes], { type: 'image/png' }), filename)
  return true
}
