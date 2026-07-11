import { create } from "zustand";
import { useColorScheme } from "react-native";

import { storage } from "@/src/utils/storage";

export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "wanstudio.theme";

const light = {
  surface: "#FAFAFA",
  onSurface: "#171717",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#525252",
  surfaceTertiary: "#F5F5F5",
  onSurfaceTertiary: "#A3A3A3",
  surfaceInverse: "#0A0A0A",
  onSurfaceInverse: "#FAFAFA",
  brand: "#059669",
  brandPrimary: "#059669",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D1FAE5",
  onBrandSecondary: "#065F46",
  brandTertiary: "#ECFDF5",
  onBrandTertiary: "#059669",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#3B82F6",
  border: "#E5E5E5",
  borderStrong: "#D4D4D4",
  divider: "#F0F0F0",
  glassTint: "rgba(255,255,255,0.72)",
  scrim: "rgba(10,10,10,0.45)",
};

const dark = {
  surface: "#0A0A0A",
  onSurface: "#FAFAFA",
  surfaceSecondary: "#141414",
  onSurfaceSecondary: "#A3A3A3",
  surfaceTertiary: "#1F1F1F",
  onSurfaceTertiary: "#737373",
  surfaceInverse: "#FAFAFA",
  onSurfaceInverse: "#171717",
  brand: "#10B981",
  brandPrimary: "#10B981",
  onBrandPrimary: "#022C22",
  brandSecondary: "#064E3B",
  onBrandSecondary: "#6EE7B7",
  brandTertiary: "#022C22",
  onBrandTertiary: "#A7F3D0",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  info: "#60A5FA",
  border: "#262626",
  borderStrong: "#404040",
  divider: "#1A1A1A",
  glassTint: "rgba(20,20,20,0.78)",
  scrim: "rgba(0,0,0,0.55)",
};

export type ThemeColors = typeof light;

export const brandGradient = (isDark: boolean): [string, string] =>
  isDark ? ["#10B981", "#059669"] : ["#059669", "#047857"];

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const font = {
  display: "Fraunces_600SemiBold",
};

type ThemeStore = {
  mode: ThemeMode;
  hydrated: boolean;
  setMode: (m: ThemeMode) => void;
  hydrate: () => Promise<void>;
};

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: "system",
  hydrated: false,
  setMode: (m) => {
    set({ mode: m });
    storage.setItem(THEME_KEY, m);
  },
  hydrate: async () => {
    const stored = (await storage.getItem<string>(THEME_KEY, "system")) as ThemeMode;
    set({ mode: stored ?? "system", hydrated: true });
  },
}));

export function useTheme() {
  const system = useColorScheme();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const isDark = mode === "system" ? system === "dark" : mode === "dark";
  const colors = isDark ? dark : light;
  return { colors, isDark, mode, setMode };
}
