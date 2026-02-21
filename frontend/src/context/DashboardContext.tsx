"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { useSSE } from "@/hooks/useSSE";
import { useSWRConfig } from "swr";
import { SSE_URL } from "@/lib/constants";

interface DashboardState {
  isFullscreen: boolean;
  isMuted: boolean;
  isOnline: boolean;
  sseConnected: boolean;
  lastDataUpdate: number | null;
  toggleFullscreen: () => void;
  toggleMute: () => void;
}

const DashboardContext = createContext<DashboardState>({
  isFullscreen: false,
  isMuted: false,
  isOnline: true,
  sseConnected: false,
  lastDataUpdate: null,
  toggleFullscreen: () => {},
  toggleMute: () => {},
});

function playAlertSound(type: "update" | "error" | "milestone") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.1;
    osc.frequency.value =
      type === "error" ? 300 : type === "milestone" ? 800 : 520;
    osc.type = "sine";
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Audio not available
  }
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [lastDataUpdate, setLastDataUpdate] = useState<number | null>(null);
  const isMutedRef = useRef(isMuted);
  const { mutate } = useSWRConfig();

  // Keep ref in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // SSE connection directly to Flask (bypasses Next.js proxy which buffers streams)
  const { lastEvent, connected: sseConnected } = useSSE(SSE_URL);

  // React to SSE events
  useEffect(() => {
    if (!lastEvent) return;
    const evt = lastEvent as Record<string, unknown>;

    if (evt.event === "scrape_complete") {
      setLastDataUpdate(Date.now());
      mutate(() => true, undefined, { revalidate: true });
      if (!isMutedRef.current) {
        playAlertSound("update");
      }
    }

    if (evt.event === "scrape_error" && !isMutedRef.current) {
      playAlertSound("error");
    }
  }, [lastEvent, mutate]);

  // Online/offline detection
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  return (
    <DashboardContext.Provider
      value={{
        isFullscreen,
        isMuted,
        isOnline,
        sseConnected,
        lastDataUpdate,
        toggleFullscreen,
        toggleMute,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DashboardContext);
}
