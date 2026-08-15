"use client";

/**
 * Legend for the state drill map.
 *
 * The map had no key at all: LGAs were painted by winning party, by CBM
 * density, or in an amber "counting" tone, and nothing on screen said so.
 *
 * Party hue cannot be made colourblind-safe — PDP red against LP green is the
 * deuteranopia collision, and both are fixed real-world identities — so the
 * party code travels as text in every row here, and the map direct-labels each
 * LGA with the same code. Identity is never carried by colour alone.
 */

import { getPartyColor, getPartyName, MAP_STATE_COLORS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

interface PartyEntry {
  party: string;
  lgas: number;
  votes: number;
}

export function PartyLegend({
  parties,
  live,
  hasUntallied,
}: {
  parties: PartyEntry[];
  live?: boolean;
  hasUntallied: boolean;
}) {
  if (parties.length === 0 && !hasUntallied) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {parties.map((p) => (
        <div key={p.party} className="flex items-center gap-1.5" title={getPartyName(p.party)}>
          <span
            className="w-3 h-3 rounded-sm shrink-0 border border-black/30"
            style={{ background: getPartyColor(p.party) }}
            aria-hidden
          />
          <span className="text-[11px] font-bold text-primary">{p.party}</span>
          <span className="text-[11px] text-dim">
            {p.lgas} {p.lgas === 1 ? "LGA" : "LGAs"}
            {p.votes > 0 && ` · ${formatNumber(p.votes)}`}
          </span>
        </div>
      ))}

      {hasUntallied && (
        <div className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm shrink-0 border border-black/30"
            style={{
              background: live ? MAP_STATE_COLORS.counting : MAP_STATE_COLORS.noData,
            }}
            aria-hidden
          />
          <span className="text-[11px] text-dim">
            {live ? "Counting — no tally yet" : "No result recorded"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Sequential ramp key. Magnitude is one hue, light to dark, so the reader sees
 * the order in the colour — never a rainbow.
 */
export function RampLegend({
  label,
  max,
  colorAt,
  unit,
}: {
  label: string;
  max: number;
  /** t in 0..1 → css colour. Shared with the map so key and map cannot drift. */
  colorAt: (t: number) => string;
  unit?: string;
}) {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-dim shrink-0">{label}</span>
      <div className="flex items-center gap-0.5" aria-hidden>
        {steps.map((t) => (
          <span
            key={t}
            className="w-6 h-3 first:rounded-l-sm last:rounded-r-sm border border-black/30"
            style={{ background: colorAt(t) }}
          />
        ))}
      </div>
      <span className="text-[11px] font-mono text-dim shrink-0">
        0–{formatNumber(max)}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}
