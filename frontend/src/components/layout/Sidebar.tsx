"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  ChartBarIcon,
  ChartPieIcon,
  ChatBubbleLeftRightIcon,
  Bars3Icon,
  XMarkIcon,
  SunIcon,
  MoonIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLiveClock } from "@/hooks/useLiveClock";
import { useTheme } from "@/context/ThemeContext";

const NAV_ITEMS = [
  { name: "Overview", href: "/", icon: HomeIcon },
  { name: "Elections", href: "/elections", icon: ChartBarIcon },
  { name: "Analytics", href: "/analytics", icon: ChartPieIcon },
  { name: "Messaging", href: "/messaging", icon: ChatBubbleLeftRightIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { date } = useLiveClock();
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-dashboard-card border border-dashboard-border text-primary"
      >
        <Bars3Icon className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 animate-fade-in"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-56 flex-shrink-0 bg-dashboard-card border-r border-dashboard-border flex flex-col",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ transition: "transform 200ms ease" }}
      >
        {/* Logo */}
        <div className="p-5 border-b border-dashboard-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-primary tracking-tight">
                FCT 2026
              </h2>
              <p className="text-[10px] text-dim mt-0.5">
                Area Council Elections
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden text-dim hover:text-primary"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-label={item.name}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all",
                  active
                    ? "bg-nigeria-green/15 text-accent-green border border-nigeria-green/30"
                    : "text-dim hover:text-primary hover:bg-dashboard-card-hover"
                )}
              >
                <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer with theme toggle */}
        <div className="p-4 border-t border-dashboard-border space-y-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-semibold text-dim hover:text-primary hover:bg-dashboard-card-hover transition-all"
          >
            <span className="flex items-center gap-2">
              {theme === "dark" ? (
                <MoonIcon className="w-4 h-4" />
              ) : (
                <SunIcon className="w-4 h-4" />
              )}
              {theme === "dark" ? "Dark Mode" : "Light Mode"}
            </span>
            <div
              className={cn(
                "w-8 h-4 rounded-full relative transition-colors duration-300",
                theme === "dark" ? "bg-accent-green/30" : "bg-accent-orange/30"
              )}
            >
              <div
                className={cn(
                  "absolute top-0.5 w-3 h-3 rounded-full transition-all duration-300",
                  theme === "dark"
                    ? "left-0.5 bg-accent-green"
                    : "left-[18px] bg-accent-orange"
                )}
              />
            </div>
          </button>

          <div className="text-[10px] text-dim">
            <p>INEC IReV Live Data</p>
            <p className="mt-0.5">{date}</p>
          </div>
        </div>
      </aside>
    </>
  );
}
