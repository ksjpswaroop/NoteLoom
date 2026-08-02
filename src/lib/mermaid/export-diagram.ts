'use client'

import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import mermaid from 'mermaid'
import { checkIsTauri } from '@/lib/check'

export type MermaidExportFormat = 'png' | 'svg'

const PNG_PIXEL_RATIO = 2

let mermaidReady = false

export function ensureMermaidInitialized() {
  if (mermaidReady || typeof window === 'undefined') return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: 'inherit',
  })
  mermaidReady = true
}

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

function parseSvgSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox=["']([^"']+)["']/i)?.[1]
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }

  const widthMatch = svg.match(/\bwidth=["']([\d.]+)(?:px)?["']/i)
  const heightMatch = svg.match(/\bheight=["']([\d.]+)(?:px)?["']/i)
  const width = widthMatch ? Number(widthMatch[1]) : NaN
  const height = heightMatch ? Number(heightMatch[1]) : NaN
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height }
  }

  return { width: 800, height: 600 }
}

export async function renderMermaidSvg(code: string): Promise<string> {
  ensureMermaidInitialized()
  const trimmed = code.trim()
  if (!trimmed) {
    throw new Error('Diagram is empty')
  }

  await mermaid.parse(trimmed)
  const id = `mermaid-export-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const { svg } = await mermaid.render(id, trimmed)
  return svg
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

/** Render a Mermaid diagram to a PNG data URL (for full-note export embedding). */
export async function renderMermaidPngDataUrl(
  code: string,
  pixelRatio = PNG_PIXEL_RATIO,
): Promise<string> {
  const svg = await renderMermaidSvg(code)
  const bytes = await svgStringToPngBytes(svg, pixelRatio)
  return bytesToDataUrl(bytes, 'image/png')
}

async function svgStringToPngBytes(svg: string, pixelRatio = PNG_PIXEL_RATIO): Promise<Uint8Array> {
  const { width, height } = parseSvgSize(svg)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Failed to decode Mermaid SVG'))
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(width * pixelRatio))
    canvas.height = Math.max(1, Math.ceil(height * pixelRatio))
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.drawImage(image, 0, 0, width, height)

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('Failed to encode PNG'))
          return
        }
        resolve(result)
      }, 'image/png')
    })

    return new Uint8Array(await pngBlob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportMermaidDiagram(
  code: string,
  format: MermaidExportFormat,
  baseName = 'mermaid-diagram',
): Promise<boolean> {
  const safeName = baseName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mermaid-diagram'
  const svg = await renderMermaidSvg(code)

  if (format === 'svg') {
    const filename = `${safeName}.svg`
    if (checkIsTauri()) {
      const selectedPath = await save({
        title: 'Export Mermaid SVG',
        defaultPath: filename,
        filters: [{ name: 'SVG Images', extensions: ['svg'] }],
      })
      if (!selectedPath) return false
      await writeTextFile(ensureExtension(selectedPath, 'svg'), svg)
      return true
    }
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename)
    return true
  }

  const bytes = await svgStringToPngBytes(svg)
  const filename = `${safeName}.png`
  if (checkIsTauri()) {
    const selectedPath = await save({
      title: 'Export Mermaid PNG',
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
