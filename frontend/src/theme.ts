// Design tokens for EDN Prep. Sober medical palette (sky-blue / slate).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

export const fonts = {
  regular: "PlusJakartaSans-Regular",
  semibold: "PlusJakartaSans-SemiBold",
  bold: "PlusJakartaSans-Bold",
  extrabold: "PlusJakartaSans-ExtraBold",
};

const light = {
  surface: "#ffffff",
  onSurface: "#0f172a",
  surfaceSecondary: "#f8fafc",
  onSurfaceSecondary: "#334155",
  surfaceTertiary: "#f1f5f9",
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#0f172a",
  onSurfaceInverse: "#ffffff",
  muted: "#64748b",

  brand: "#0284c7",
  onBrand: "#ffffff",
  brandPrimary: "#0284c7",
  onBrandPrimary: "#ffffff",
  brandSecondary: "#1e293b",
  onBrandSecondary: "#ffffff",
  brandTertiary: "#e0f2fe",
  onBrandTertiary: "#0369a1",

  success: "#16a34a",
  onSuccess: "#ffffff",
  successSurface: "#dcfce7",
  warning: "#d97706",
  onWarning: "#ffffff",
  warningSurface: "#fef3c7",
  error: "#dc2626",
  onError: "#ffffff",
  errorSurface: "#fee2e2",
  info: "#0ea5e9",
  onInfo: "#ffffff",

  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  divider: "#f1f5f9",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
