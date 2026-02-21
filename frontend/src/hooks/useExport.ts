"use client";

import { useState, useCallback } from "react";

export function useExport() {
  const [loading, setLoading] = useState(false);

  const download = useCallback(
    async (endpoint: string, filename: string, format: "csv" | "xlsx" = "csv") => {
      setLoading(true);
      try {
        const res = await fetch(`${endpoint}?format=${format}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("Export failed:", err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { download, loading };
}
