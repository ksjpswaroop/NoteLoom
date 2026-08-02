import { CustomThemeColors, HSLValue } from '@/types/theme'

/**
 * HSL CSS 
 */
function hslToCssValue(hsl: HSLValue): string {
  const [h, s, l] = hsl
  return `${h} ${s}% ${l}%`
}

/**
 * DOM
 * 
 * .dark 
 */
export function applyThemeColors(colors: CustomThemeColors): void {
  const root = document.documentElement

  // style
  let darkStyleTag = document.getElementById('custom-dark-theme')
  if (!darkStyleTag) {
    darkStyleTag = document.createElement('style')
    darkStyleTag.id = 'custom-dark-theme'
    document.head.appendChild(darkStyleTag)
  }

  // CSS
  let darkCssRules = '.dark {\n'

  // :root（）
  Object.entries(colors.light).forEach(([key, value]) => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    if (value) {
      root.style.setProperty(cssVar, hslToCssValue(value))
    } else {
      // null，（）
      root.style.removeProperty(cssVar)
    }
  })

  // CSS
  Object.entries(colors.dark).forEach(([key, value]) => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    if (value) {
      darkCssRules += `  ${cssVar}: ${hslToCssValue(value)};\n`
    }
    // null，， CSS
  })

  darkCssRules += '}'

  //
  darkStyleTag.textContent = darkCssRules
}

/**
 * 
 */
export function removeThemeColors(): void {
  const root = document.documentElement

  // :root
  const lightVars = [
    'background', 'foreground', 'card', 'cardForeground',
    'primary', 'primaryForeground', 'secondary', 'secondaryForeground',
    'third', 'thirdForeground',
    'muted', 'mutedForeground', 'accent', 'accentForeground', 'border',
    'shadow'
  ]

  lightVars.forEach(key => {
    const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    root.style.removeProperty(cssVar)
  })

  //
  const darkStyleTag = document.getElementById('custom-dark-theme')
  if (darkStyleTag) {
    darkStyleTag.remove()
  }
}

/**
 * HSL 
 */
export function hexToHsl(hex: string): HSLValue | null {
  // #
  hex = hex.replace('#', '')

  // RGB
  let r = 0, g = 0, b = 0
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else if (hex.length === 6) {
    r = parseInt(hex.substring(0, 2), 16)
    g = parseInt(hex.substring(2, 4), 16)
    b = parseInt(hex.substring(4, 6), 16)
  } else {
    return null
  }

  // HSL
  r /= 255
  g /= 255
  b /= 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

/**
 * HSL Hex
 */
export function hslToHex(hsl: HSLValue): string {
  const [h, s, l] = hsl

  const sNormalized = s / 100
  const lNormalized = l / 100

  const c = (1 - Math.abs(2 * lNormalized - 1)) * sNormalized
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lNormalized - c / 2

  let r = 0, g = 0, b = 0

  if (h >= 0 && h < 60) {
    r = c
    g = x
    b = 0
  } else if (h >= 60 && h < 120) {
    r = x
    g = c
    b = 0
  } else if (h >= 120 && h < 180) {
    r = 0
    g = c
    b = x
  } else if (h >= 180 && h < 240) {
    r = 0
    g = x
    b = c
  } else if (h >= 240 && h < 300) {
    r = x
    g = 0
    b = c
  } else if (h >= 300 && h < 360) {
    r = c
    g = 0
    b = x
  }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0')
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0')
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0')

  return `#${rHex}${gHex}${bHex}`
}
