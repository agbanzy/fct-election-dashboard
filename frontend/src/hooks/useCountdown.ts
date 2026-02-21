"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SCRAPE_CYCLE } from "@/lib/constants";

export function useCountdown(onExpire?: () => void) {
  const [remaining, setRemaining] = useState(SCRAPE_CYCLE);
  const targetRef = useRef(Date.now() + SCRAPE_CYCLE);

  const reset = useCallback(() => {
    targetRef.current = Date.now() + SCRAPE_CYCLE;
    setRemaining(SCRAPE_CYCLE);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const r = Math.max(0, targetRef.current - Date.now());
      setRemaining(r);
      if (r <= 0) {
        targetRef.current = Date.now() + SCRAPE_CYCLE;
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [onExpire]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return { remaining, display, reset };
}
