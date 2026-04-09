/**
 * @open-hax/uxx/tokens
 *
 * Design tokens for the Open Hax UXX component library.
 */

// Core palette + theme registry
export {
  monokai,
  nightOwl,
  proxyConsole,
  themes,
  colors,
  withAlpha,
  createThemeDefinition,
  defaultThemeName,
  getTheme,
  getThemeCssVariables,
  resolveTheme,
  resolveThemeTokens,
} from './colors.js';
export type {
  ColorToken,
  MonokaiColor,
  NightOwlColor,
  ProxyConsoleColor,
  ThemeColors,
  ThemeCssVariables,
  ThemeDefinition,
  ThemeName,
  ThemePalette,
  ThemePreference,
} from './colors.js';

// Spacing
export { spacing, space } from './spacing.js';
export type { SpacingToken } from './spacing.js';

// Typography
export {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  typography,
} from './typography.js';
export type {
  FontFamilyToken,
  FontSizeToken,
  FontWeightToken,
  LineHeightToken,
} from './typography.js';

// Motion
export { duration, easing, motion, transitions } from './motion.js';
export type { DurationToken, EasingToken } from './motion.js';

// Shadows & Elevation
export { shadow, elevation, zIndex } from './shadows.js';
export type { ShadowToken, ElevationLevel, ZIndexToken } from './shadows.js';

// Radius
export { radius } from './radius.js';
export type { RadiusToken } from './radius.js';

// Themes
export {
  createThemeCssVarRefs,
  createThemePack,
  defaultThemePack,
  deepMerge,
  getThemeCssVarName,
  getThemeCssVars,
  themePacks,
} from './theme.js';
export type { DeepPartial, ThemePack, ThemeOverride, ThemePackName } from './theme.js';

// Keybindings
export { defaultChords, modeColors, leaderKey } from './keybindings.js';
export type { ModalMode, ChordBinding } from './keybindings.js';

// Re-export everything for convenience
import { colors, monokai, nightOwl, proxyConsole, themes } from './colors.js';
import { spacing, space } from './spacing.js';
import { fontFamily, fontSize, fontWeight, lineHeight, typography } from './typography.js';
import { duration, easing, motion, transitions } from './motion.js';
import { shadow, elevation, zIndex } from './shadows.js';
import { radius } from './radius.js';
import { createThemeCssVarRefs, themePacks } from './theme.js';
import { defaultChords, modeColors, leaderKey } from './keybindings.js';

const runtimeColors = createThemeCssVarRefs(themePacks.monokai.colors, ['colors']);
const runtimePalette = createThemeCssVarRefs(themePacks.monokai.palette, ['palette']);
const runtimeFontFamily = createThemeCssVarRefs(themePacks.monokai.fontFamily, ['fontFamily']);
const runtimeFontSize = createThemeCssVarRefs(themePacks.monokai.fontSize, ['fontSize']);
const runtimeShadow = createThemeCssVarRefs(themePacks.monokai.shadow, ['shadow']);
const runtimeRadius = createThemeCssVarRefs(themePacks.monokai.radius, ['radius']);

const runtimeTypography = {
  h1: {
    fontSize: runtimeFontSize['4xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
  },
  h2: {
    fontSize: runtimeFontSize['3xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
  },
  h3: {
    fontSize: runtimeFontSize['2xl'],
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  h4: {
    fontSize: runtimeFontSize.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
  },
  h5: {
    fontSize: runtimeFontSize.lg,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  h6: {
    fontSize: runtimeFontSize.base,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
  },
  body: {
    fontSize: runtimeFontSize.base,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  bodySm: {
    fontSize: runtimeFontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  label: {
    fontSize: runtimeFontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.none,
  },
  caption: {
    fontSize: runtimeFontSize.xs,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  code: {
    fontFamily: runtimeFontFamily.mono,
    fontSize: runtimeFontSize.sm,
    fontWeight: fontWeight.normal,
    lineHeight: lineHeight.normal,
  },
  codeInline: {
    fontFamily: runtimeFontFamily.mono,
    fontSize: runtimeFontSize.inlineCode,
    fontWeight: fontWeight.normal,
  },
} as const;

/**
 * Complete raw token collection for non-runtime uses such as docs generation.
 */
export const tokenValues = {
  colors,
  monokai,
  nightOwl,
  proxyConsole,
  themes,
  spacing,
  space,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  typography,
  duration,
  easing,
  motion,
  transitions,
  shadow,
  elevation,
  zIndex,
  radius,
  chords: defaultChords,
  modeColors,
  leaderKey,
} as const;

/**
 * Runtime token collection used by React components.
 * Themeable visual categories resolve through CSS variables with Monokai fallbacks.
 */
export const tokens = {
  colors: runtimeColors,
  palette: runtimePalette,
  monokai: runtimePalette,
  spacing,
  space,
  fontFamily: runtimeFontFamily,
  fontSize: runtimeFontSize,
  fontWeight,
  lineHeight,
  typography: runtimeTypography,
  duration,
  easing,
  motion,
  transitions,
  shadow: runtimeShadow,
  elevation,
  zIndex,
  radius: runtimeRadius,
  chords: defaultChords,
  modeColors,
  leaderKey,
} as const;

export type Tokens = typeof tokens;
export type TokenValues = typeof tokenValues;
