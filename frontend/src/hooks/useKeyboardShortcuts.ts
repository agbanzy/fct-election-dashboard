"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/context/DashboardContext";
import { useTheme } from "@/context/ThemeContext";

export function useKeyboardShortcuts() {
  const router = useRouter();
  const { toggleFullscreen, toggleMute } = useDashboard();
  const { toggleTheme } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key.toLowerCase()) {
        case "f":
          toggleFullscreen();
          break;
        case "m":
          toggleMute();
          break;
        case "t":
          toggleTheme();
          break;
        case "r":
          window.location.reload();
          break;
        case "1":
          router.push("/");
          break;
        case "2":
          router.push("/elections");
          break;
        case "3":
          router.push("/analytics");
          break;
        case "4":
          router.push("/messaging");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, toggleFullscreen, toggleMute, toggleTheme]);
}
