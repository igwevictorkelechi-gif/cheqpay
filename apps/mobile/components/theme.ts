/**
 * CheqPay mobile palette, switchable at runtime.
 *
 * Why `colors` is a mutable object rather than a React context: it is read at
 * 463 call sites across 43 files, many inside `style={{ ... }}` during render.
 * Keeping the same exported object and swapping its VALUES means every one of
 * those sites keeps working untouched and simply reads the active theme on the
 * next render. The root remounts the tree when the theme changes (see
 * app/_layout.tsx), so nothing can be left holding a stale colour.
 *
 * Tailwind/NativeWind classes are handled separately — NativeWind v2 has no
 * CSS variables, so those use `dark:` variants driven by setColorScheme.
 */

export interface Palette {
  brand: string;
  brandDark: string;
  brandLight: string;
  surface: string;
  surfaceSoft: string;
  card: string;
  circle: string;
  border: string;
  ink: string;
  muted: string;
  positive: string;
  white: string;
  /** Translucent fill for the floating tab bar. */
  barFill: string;
  /** Hairline/edge on the tab bar and other glass surfaces. */
  barEdge: string;
  /** Active-tab capsule fill. */
  capsule: string;
}

/** Brand hues are fixed; only the neutrals flip between themes. */
export const darkPalette: Palette = {
  brand: '#6B5B95',
  brandDark: '#574A7A',
  brandLight: '#8A7BB5',
  surface: '#14121A',
  surfaceSoft: '#1F1B29',
  card: '#1F1B29',
  circle: '#2C2738',
  border: '#2A2535',
  ink: '#F4F3F7',
  muted: '#9A93AD',
  positive: '#34C759',
  white: '#FFFFFF',
  barFill: 'rgba(31,27,41,0.94)',
  barEdge: 'rgba(255,255,255,0.10)',
  capsule: 'rgba(255,255,255,0.09)',
};

/** Mirrors the web light theme (apps/web globals.css) so the two match. */
export const lightPalette: Palette = {
  brand: '#6B5B95',
  brandDark: '#574A7A',
  brandLight: '#7A6AA6', // darkened: brandLight on white fails contrast
  surface: '#F6F5FA',
  surfaceSoft: '#FFFFFF',
  card: '#FFFFFF',
  circle: '#EAE7F2',
  border: '#E0DDEA',
  ink: '#1B1726',
  muted: '#6E6880',
  positive: '#1E9E4A', // darkened for contrast on white
  white: '#FFFFFF',
  barFill: 'rgba(255,255,255,0.96)',
  barEdge: 'rgba(27,23,38,0.08)',
  capsule: 'rgba(27,23,38,0.07)',
};

/**
 * The live palette. Import this everywhere (`import { colors } from
 * '@/components/brand'`) — never destructure it at module scope, or the value
 * is captured before the theme is applied.
 */
export const colors: Palette = { ...darkPalette };

/** Swap the live palette in place. Call before the tree renders. */
export function applyPalette(dark: boolean): void {
  Object.assign(colors, dark ? darkPalette : lightPalette);
}
