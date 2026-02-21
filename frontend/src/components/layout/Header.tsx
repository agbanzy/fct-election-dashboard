"use client";

import { useApiData } from "@/hooks/useApiData";
import { useCountdown } from "@/hooks/useCountdown";
import { useLiveClock } from "@/hooks/useLiveClock";
import { useDashboard } from "@/context/DashboardContext";
import { useTheme } from "@/context/ThemeContext";
import { ScraperStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useCallback, useState, useRef, useEffect } from "react";
import {
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  SunIcon,
  MoonIcon,
} from "@heroicons/react/24/outline";

export default function Header() {
  const { data: status } = useApiData<ScraperStatus>("/api/status", 5000);
  const [scraping, setScraping] = useState(false);
  const { time, date } = useLiveClock();
  const { theme, toggleTheme } = useTheme();
  const {
    isFullscreen,
    isMuted,
    toggleFullscreen,
    toggleMute,
    lastDataUpdate,
  } = useDashboard();

  // Fix stale closure: use ref to store latest reset function
  const refreshCountdownRef = useRef<() => void>(() => {});

  const handleRefresh = useCallback(() => {
    refreshCountdownRef.current();
  }, []);

  const { display, reset: refreshCountdown } = useCountdown(handleRefresh);

  useEffect(() => {
    refreshCountdownRef.current = refreshCountdown;
  }, [refreshCountdown]);

  const forceScrape = async () => {
    setScraping(true);
    try {
      await fetch("/api/force-scrape", { method: "POST" });
    } catch {
      // ignore
    }
    setTimeout(() => setScraping(false), 15000);
  };

  const scraperActive = status?.status === "scraping" || scraping;

  // Data freshness
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastDataUpdate) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [lastDataUpdate]);

  const freshness = lastDataUpdate
    ? `${Math.floor((Date.now() - lastDataUpdate) / 1000)}s ago`
    : null;

  return (
    <header className="sticky top-0 z-30 border-b-2 border-nigeria-green bg-gradient-to-r from-[var(--header-from)] via-[var(--header-via)] to-[var(--header-to)]">
      {/* Main header */}
      <div className="flex items-center justify-between px-5 py-3 lg:px-7">
        <div className={cn(isFullscreen ? "pl-0" : "lg:pl-0 pl-10")}>
          <h1
            className={cn(
              "font-extrabold text-white tracking-tight",
              isFullscreen ? "text-xl" : "text-lg"
            )}
          >
            FCT 2026 Area Council Elections
          </h1>
          <p className="text-[11px] text-white/50 mt-0.5">
            Live Results Dashboard &bull; INEC IReV &bull; {date}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Live clock */}
          <div className="hidden sm:flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
            <span className="text-[13px] font-mono font-bold text-white tabular-nums">
              {time}
            </span>
          </div>

          {/* LIVE badge */}
          <div className="flex items-center gap-1.5 bg-red-500/15 px-3 py-1 rounded-full border border-red-500/30 animate-glow-pulse">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[11px] font-bold text-red-500">LIVE</span>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={`${theme === "dark" ? "Light" : "Dark"} mode (T)`}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            {theme === "dark" ? (
              <SunIcon className="w-4 h-4" />
            ) : (
              <MoonIcon className="w-4 h-4" />
            )}
          </button>

          {/* Mute toggle */}
          <button
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute alerts" : "Mute alerts"}
            title={`${isMuted ? "Unmute" : "Mute"} (M)`}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            {isMuted ? (
              <SpeakerXMarkIcon className="w-4 h-4" />
            ) : (
              <SpeakerWaveIcon className="w-4 h-4" />
            )}
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={`${isFullscreen ? "Exit" : "Enter"} fullscreen (F)`}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
          >
            {isFullscreen ? (
              <ArrowsPointingInIcon className="w-4 h-4" />
            ) : (
              <ArrowsPointingOutIcon className="w-4 h-4" />
            )}
          </button>

          {/* Refresh button */}
          <button
            onClick={forceScrape}
            disabled={scraperActive}
            aria-label="Refresh data now"
            title="Force refresh (R)"
            className={cn(
              "px-4 py-1.5 rounded-lg text-[12px] font-bold text-white transition-all",
              scraperActive
                ? "bg-nigeria-green/40 cursor-not-allowed"
                : "bg-nigeria-green hover:bg-[#00a65a] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-nigeria-green/30"
            )}
          >
            {scraperActive ? "Scraping..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-5 lg:px-7 py-1.5 bg-black/20 border-t border-white/10 text-[11px] text-white/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                status?.status === "scraping"
                  ? "bg-accent-orange animate-pulse"
                  : status?.status === "error"
                  ? "bg-accent-red"
                  : "bg-accent-green"
              )}
            />
            <span>
              {status?.status === "scraping"
                ? `Scraping: ${status.message || "..."}`
                : status?.error
                ? `Error: ${status.error}`
                : "Connected to INEC IReV"}
            </span>
          </div>
          {freshness && (
            <span className="text-accent-green/80 font-semibold">
              Updated {freshness}
            </span>
          )}
        </div>
        <span className="tabular-nums">Next refresh in {display}</span>
      </div>
    </header>
  );
}
