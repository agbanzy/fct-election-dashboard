"use client";

/**
 * One concluded race: who won, who came second, and by how much.
 *
 * This replaced a cumulative block that summed a presidential race and a
 * governorship into a single set of party bars. That total described no
 * election that was ever held, and its "55.2% APC" read as a result. A race
 * is the unit a reader can actually reason about, so each gets its own row.
 *
 * The margin is given twice — as votes and as percentage points — because
 * neither alone travels well. 89,425 votes means little without the size of
 * the electorate behind it; 14.3 points hides whether that was a landslide in
 * a small race or a squeaker in a large one.
 */

import { getPartyColor, getPartyName } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

interface Standing {
  party: string;
  party_name: string;
  color: string | null;
  votes: number;
  share: number;
  candidate: string | null;
}

export interface RaceResult {
  election_id: number;
  election_type: string;
  election_type_label: string;
  cycle: number;
  election_date: string | null;
  total_votes: number;
  winner: Standing;
  runner_up: Standing | null;
  margin_votes: number | null;
  margin_points: number | null;
  standings: Standing[];
}

export function RaceResultCard({ race }: { race: RaceResult }) {
  const { winner, runner_up, margin_points, margin_votes } = race;

  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="text-[13px] font-bold text-primary">
          {race.election_type_label}{" "}
          <span className="font-normal text-dim">{race.cycle}</span>
        </div>
        <div className="text-[11px] text-dim font-mono">
          {formatNumber(race.total_votes)} votes
        </div>
      </div>

      {/* Share bar — the whole race in one line, ordered by finish. */}
      <div className="flex h-2 rounded-sm overflow-hidden mb-2.5 gap-px">
        {race.standings.map((s) => (
          <div
            key={s.party}
            style={{
              width: `${Math.max(s.share * 100, 0.4)}%`,
              background: getPartyColor(s.party),
            }}
            title={`${getPartyName(s.party)} — ${(s.share * 100).toFixed(1)}%`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 text-[12px]">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: getPartyColor(winner.party) }}
          aria-hidden
        />
        <span className="font-extrabold text-primary">{winner.party}</span>
        {winner.candidate && (
          <span className="text-dim truncate">{winner.candidate}</span>
        )}
        <span className="ml-auto font-mono font-bold text-primary">
          {(winner.share * 100).toFixed(1)}%
        </span>
        <span className="font-mono text-dim w-20 text-right">
          {formatNumber(winner.votes)}
        </span>
      </div>

      {runner_up && (
        <div className="flex items-center gap-2 text-[12px] mt-1 opacity-75">
          <span
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ background: getPartyColor(runner_up.party) }}
            aria-hidden
          />
          <span className="font-bold text-primary">{runner_up.party}</span>
          {runner_up.candidate && (
            <span className="text-dim truncate">{runner_up.candidate}</span>
          )}
          <span className="ml-auto font-mono text-dim">
            {(runner_up.share * 100).toFixed(1)}%
          </span>
          <span className="font-mono text-dim w-20 text-right">
            {formatNumber(runner_up.votes)}
          </span>
        </div>
      )}

      {margin_points !== null && margin_votes !== null && (
        <div className="mt-2 pt-2 border-t border-dashboard-border text-[11px] text-dim">
          <span className="font-bold text-primary">
            {winner.party} +{(margin_points * 100).toFixed(1)} pts
          </span>{" "}
          over {runner_up?.party} — a margin of {formatNumber(margin_votes)}{" "}
          {margin_votes === 1 ? "vote" : "votes"}
        </div>
      )}
    </div>
  );
}
