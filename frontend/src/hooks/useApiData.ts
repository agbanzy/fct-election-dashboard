"use client";

import useSWR from "swr";
import { REFRESH_INTERVAL } from "@/lib/constants";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`API ${r.status}: ${r.statusText}`);
    return r.json();
  });

export function useApiData<T>(
  endpoint: string | null,
  refreshInterval = REFRESH_INTERVAL
) {
  return useSWR<T>(endpoint, fetcher, {
    refreshInterval,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 3000,
    errorRetryCount: 5,
    errorRetryInterval: 3000,
    shouldRetryOnError: true,
  });
}
