"use client";

import { useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";

export function useChartTheme() {
  const { theme } = useTheme();

  return useMemo(
    () => ({
      gridColor: theme === "dark" ? "#1f2538" : "#e2e8f0",
      textColor: theme === "dark" ? "#6b7280" : "#718096",
      tooltipBg: theme === "dark" ? "#141821" : "#ffffff",
      tooltipBorder: theme === "dark" ? "#1f2538" : "#e2e8f0",
      tooltipText: theme === "dark" ? "#e8eaf0" : "#1a202c",
      isDark: theme === "dark",
    }),
    [theme]
  );
}
