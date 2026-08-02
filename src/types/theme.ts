/**
 * 
 * HSL ， [hue, saturation, lightness] null
 * null 
 */
export interface CustomThemeColors {
  //
  light: {
    background: HSLValue | null
    foreground: HSLValue | null
    card: HSLValue | null
    cardForeground: HSLValue | null
    primary: HSLValue | null
    primaryForeground: HSLValue | null
    secondary: HSLValue | null
    secondaryForeground: HSLValue | null
    third: HSLValue | null
    thirdForeground: HSLValue | null
    muted: HSLValue | null
    mutedForeground: HSLValue | null
    accent: HSLValue | null
    accentForeground: HSLValue | null
    border: HSLValue | null
    shadow: HSLValue | null
  }
  //
  dark: {
    background: HSLValue | null
    foreground: HSLValue | null
    card: HSLValue | null
    cardForeground: HSLValue | null
    primary: HSLValue | null
    primaryForeground: HSLValue | null
    secondary: HSLValue | null
    secondaryForeground: HSLValue | null
    third: HSLValue | null
    thirdForeground: HSLValue | null
    muted: HSLValue | null
    mutedForeground: HSLValue | null
    accent: HSLValue | null
    accentForeground: HSLValue | null
    border: HSLValue | null
    shadow: HSLValue | null
  }
}

/**
 * HSL 
 */
export type HSLValue = [number, number, number]

/**
 * CSS 
 */
export const THEME_VARIABLE_MAP = {
  light: {
    background: '--background',
    foreground: '--foreground',
    card: '--card',
    cardForeground: '--card-foreground',
    primary: '--primary',
    primaryForeground: '--primary-foreground',
    secondary: '--secondary',
    secondaryForeground: '--secondary-foreground',
    third: '--third',
    thirdForeground: '--third-foreground',
    muted: '--muted',
    mutedForeground: '--muted-foreground',
    accent: '--accent',
    accentForeground: '--accent-foreground',
    border: '--border',
    shadow: '--shadow',
  },
  dark: {
    background: '--background',
    foreground: '--foreground',
    card: '--card',
    cardForeground: '--card-foreground',
    primary: '--primary',
    primaryForeground: '--primary-foreground',
    secondary: '--secondary',
    secondaryForeground: '--secondary-foreground',
    third: '--third',
    thirdForeground: '--third-foreground',
    muted: '--muted',
    mutedForeground: '--muted-foreground',
    accent: '--accent',
    accentForeground: '--accent-foreground',
    border: '--border',
    shadow: '--shadow',
  },
} as const
