"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface SSEMessage {
  event?: string;
  [key: string]: unknown;
}

export function useSSE(url: string) {
  const [lastEvent, setLastEvent] = useState<SSEMessage | null>(null);
  const [connected, setConnected] = useState(true); // default true to avoid flashing banner
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    // Don't connect if URL is empty (server-side render or not configured)
    if (!url) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (mountedRef.current) {
          setConnected(true);
          retryCountRef.current = 0;
        }
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (mountedRef.current) {
            setLastEvent(data);
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (mountedRef.current) {
          // Only show disconnected after first successful connection has been lost
          if (retryCountRef.current > 0) {
            setConnected(false);
          }
          // Exponential backoff reconnect
          const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
          retryCountRef.current += 1;
          setTimeout(() => {
            if (mountedRef.current) connect();
          }, delay);
        }
      };
    } catch {
      // EventSource constructor failed (e.g. invalid URL)
      if (mountedRef.current && retryCountRef.current > 0) {
        setConnected(false);
      }
      const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000);
      retryCountRef.current += 1;
      setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    }
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      eventSourceRef.current?.close();
    };
  }, [connect]);

  return { lastEvent, connected };
}
