/**
 * Party colours.
 *
 * Hue is fixed by real-world party identity — APC blue, PDP red, LP green — so
 * these are not free slots in a categorical palette and must not be re-hued to
 * satisfy a validator. What *was* free is lightness and chroma: the previous
 * values were Material 800 steps, which on the #0c1226 map surface put four
 * parties under 3:1 contrast and pushed three outside the dark-mode lightness
 * band. Each hue is now snapped to OKLCH L≈0.60, C≥0.13, which clears the
 * lightness, chroma and contrast checks with the hue left untouched.
 *
 * CVD separation cannot be cleared by colour here and never will be: PDP red
 * against LP green is the textbook deuteranopia collision, and both are real
 * party identities. That is why every surface using these MUST carry secondary
 * encoding — the party code as a direct label on the map, in the legend, and in
 * tooltips — so identity is never colour-alone. See StateDrillMap.
 */
export const PARTY_COLORS: Record<string, string> = {
  APC: "#3580dd",
  // Accord. Its INEC code really is the single letter "A", and on the 2026
  // Osun ballot it is APC's main rival — PDP is not on that ballot at all —
  // so it needs a real colour rather than the grey fallback. Amber is the
  // most distinct hue left against the existing twelve, and it separates
  // cleanly from APC blue, which is the pairing that actually decides
  // whether an Osun map is readable. Its weakest pair is against PDP red,
  // which cannot co-occur here; where it can, the map's direct labels carry
  // identity anyway.
  A: "#b2790c",
  PDP: "#dc403b",
  ADC: "#a058d5",
  LP: "#479449",
  NNPP: "#d74b01",
  SDP: "#d44176",
  APGA: "#139483",
  AA: "#7b69e5",
  ADP: "#d54c28",
  APM: "#10919e",
  ZLP: "#569241",
  YPP: "#c0623f",
  default: "#7b8794",
};

/** Party full names, for legend and tooltip text. */
export const PARTY_NAMES: Record<string, string> = {
  A: "Accord",
  APC: "All Progressives Congress",
  PDP: "Peoples Democratic Party",
  ADC: "African Democratic Congress",
  LP: "Labour Party",
  NNPP: "New Nigeria Peoples Party",
  SDP: "Social Democratic Party",
  APGA: "All Progressives Grand Alliance",
  AA: "Action Alliance",
  ADP: "Action Democratic Party",
  APM: "Allied Peoples Movement",
  ZLP: "Zenith Labour Party",
  YPP: "Young Progressives Party",
};

/**
 * Map states that are not a party. Kept distinct from PARTY_COLORS so a
 * "counting" LGA can never be mistaken for a party's fill.
 */
export const MAP_STATE_COLORS = {
  /** Election is live and this LGA has no tally yet. */
  counting: "#a16207",
  /** No result recorded and nothing in progress. */
  noData: "#2a3348",
} as const;

export const ACCENT_COLORS = {
  green: "#10b981",
  blue: "#3b82f6",
  orange: "#f59e0b",
  red: "#ef4444",
  purple: "#a78bfa",
  yellow: "#fbbf24",
  cyan: "#06b6d4",
};

// These are resolved dynamically at render time via useChartTheme hook
export const CHART_GRID_COLOR = "#1f2538";
export const CHART_TEXT_COLOR = "#6b7280";

export const REFRESH_INTERVAL = 15000; // 15 seconds — fast refresh for live election day
export const SCRAPE_CYCLE = 120000; // 2 minutes

// Server-Sent Events stream URL. DISABLED by default (empty string) because
// the broadcaster is a Phase B TODO — the backend only emits heartbeats, so
// there is no live data to push and data already refreshes via SWR polling
// (REFRESH_INTERVAL). An empty URL means useSSE never opens a connection, so
// the "RECONNECTING TO SERVER" banner never fires on a dead stream and no
// long-lived request ties up Flask's sync gunicorn workers.
//
// To re-enable once the broadcaster + async (gevent) workers land, set
// NEXT_PUBLIC_SSE_URL at build time to the same-origin path "/api/live/events"
// (routed to Flask via DO ingress) or a dedicated streaming host.
export const SSE_URL =
  typeof window !== "undefined" ? process.env.NEXT_PUBLIC_SSE_URL || "" : "";

export const NAV_ITEMS = [
  { name: "Overview", href: "/", icon: "home" },
  { name: "Elections", href: "/elections", icon: "chart-bar" },
  { name: "Analytics", href: "/analytics", icon: "chart-pie" },
] as const;

export function getPartyColor(party: string): string {
  return PARTY_COLORS[party] || PARTY_COLORS.default;
}

export function getPartyName(party: string): string {
  return PARTY_NAMES[party] || party;
}
