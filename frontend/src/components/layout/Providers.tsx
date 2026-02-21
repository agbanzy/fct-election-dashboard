"use client";

import { DashboardProvider, useDashboard } from "@/context/DashboardContext";
import { ThemeProvider } from "@/context/ThemeContext";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import ConnectionBanner from "@/components/shared/ConnectionBanner";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { cn } from "@/lib/utils";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isFullscreen, isOnline, sseConnected } = useDashboard();
  useKeyboardShortcuts();

  return (
    <div
      className={cn(
        "flex h-screen overflow-hidden",
        isFullscreen && "tv-mode"
      )}
    >
      {!isFullscreen && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <ConnectionBanner isOnline={isOnline} sseConnected={sseConnected} />
        <Header />
        <main className="flex-1 overflow-y-auto p-5 lg:p-6">
          <ErrorBoundary>
            <div className={cn("mx-auto", isFullscreen ? "max-w-full" : "max-w-[1500px]")}>
              {children}
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <DashboardProvider>
        <DashboardShell>{children}</DashboardShell>
      </DashboardProvider>
    </ThemeProvider>
  );
}
