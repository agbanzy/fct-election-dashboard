"use client";

interface ConnectionBannerProps {
  isOnline: boolean;
  sseConnected: boolean;
}

export default function ConnectionBanner({
  isOnline,
  sseConnected,
}: ConnectionBannerProps) {
  if (isOnline && sseConnected) return null;

  const message = !isOnline
    ? "NETWORK OFFLINE \u2014 Check internet connection"
    : "RECONNECTING TO SERVER...";

  const bgClass = !isOnline ? "bg-accent-red" : "bg-accent-orange";

  return (
    <div
      className={`${bgClass} text-white text-center py-1.5 text-[12px] font-bold animate-pulse z-[100] sticky top-0`}
    >
      {message}
    </div>
  );
}
