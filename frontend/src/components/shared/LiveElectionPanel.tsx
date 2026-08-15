"use client";

/**
 * Polling-day hero. Replaces the countdown while an election is in progress:
 * how much of the state has reported, and the running tallies as INEC
 * publishes result forms to IReV.
 *
 * Renders nothing when no election is live, so the dashboard falls back to
 * its normal countdown.
 */

import { useApiData } from "@/hooks/useApiData";
import { formatNumber } from "@/lib/utils";

interface Tally {
  party: string;
  party_name: string;
  color: string | null;
  candidate: string | null;
  votes: number;
  share: number;
}

interface LiveElection {
  election_id: number;
  election_type_label: string;
  election_date: string | null;
  state_name: string | null;
  state_code: string | null;
  status: string;
  reporting: { expected_pus: number; uploaded_pus: number; pct: number };
  total_votes: number;
  tallies: Tally[];
  tally_coverage?: { pus_with_votes: number; reported_pus: number; pct: number };
  results_synced_at: string | null;
}

/**
 * Minimum share of reported polling units that must carry transcribed votes
 * before any total is shown.
 *
 * INEC publishes result sheets as scanned images, so a live election's vote
 * rows are fragmentary — Osun sat at 404 votes across 2,266 reported units
 * while the panel announced a party "leading on 60% reporting". Below this
 * threshold the numbers describe a rounding error, not an election.
 */
const MIN_TALLY_COVERAGE = 0.2;

interface LiveNow {
  live: boolean;
  as_of: string;
  elections: LiveElection[];
}

const FALLBACK_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#a78bfa", "#ef4444"];

function ReportingBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div
      className="h-2 rounded-full bg-black/30 overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Polling units reported"
    >
      <div
        className="h-full bg-accent-green transition-[width] duration-700 ease-out"
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

export default function LiveElectionPanel({
  stateCode = null,
}: {
  /** Restrict to one state — used on state pages. Null shows every live race. */
  stateCode?: string | null;
}) {
  // 60s: the scraper itself runs a 120s live cycle, so polling faster only
  // re-reads the same numbers.
  const { data, error } = useApiData<LiveNow>("/api/live/now", 60_000);

  if (error || !data?.live) return null;

  const elections = stateCode
    ? data.elections.filter(
        (e) => e.state_code?.toUpperCase() === stateCode.toUpperCase(),
      )
    : data.elections;

  if (elections.length === 0) return null;

  return (
    <div className="space-y-3">
      {elections.map((e) => {
        const { expected_pus, uploaded_pus, pct } = e.reporting;
        // Having tallies is not the same as having enough of them to publish.
        const coverage = e.tally_coverage?.pct ?? 0;
        const counting = e.tallies.length > 0 && coverage >= MIN_TALLY_COVERAGE;
        const fragmentary = e.tallies.length > 0 && !counting;
        const leader = counting ? e.tallies[0] : null;

        return (
          <section
            key={e.election_id}
            className="rounded-lg border-2 border-accent-red/60 bg-accent-red/[0.06] p-4"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
              <span className="flex items-center gap-2 text-accent-red font-bold text-sm">
                <span className="inline-block w-2 h-2 rounded-full bg-accent-red animate-pulse" />
                LIVE
              </span>
              <h2 className="text-sm font-bold text-primary">
                {e.state_name ? `${e.state_name} ` : ""}
                {e.election_type_label}
              </h2>
              <span className="text-[11px] text-dim">{e.election_date}</span>
            </div>

            <div className="mb-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] uppercase tracking-wider text-dim font-semibold">
                  Polling units reported
                </span>
                <span className="text-[13px] font-mono font-bold text-primary tabular-nums">
                  {formatNumber(uploaded_pus)}
                  <span className="text-dim font-normal">
                    {" "}
                    / {formatNumber(expected_pus)}
                  </span>
                  <span className="text-accent-green ml-2">
                    {(pct * 100).toFixed(1)}%
                  </span>
                </span>
              </div>
              <ReportingBar pct={pct} />
            </div>

            {!counting && uploaded_pus === 0 && (
              <div className="text-[13px] text-dim italic">
                Polls are open. INEC has not published any result forms to IReV
                yet — this bar moves as they upload.
              </div>
            )}

            {/* Forms are arriving but carry no machine-readable votes. Saying
                "tallies appear here as they upload" would promise something
                the pipeline cannot deliver: IReV serves EC8A scans, and the
                PU payload's votes field is null for this election. */}
            {!counting && uploaded_pus > 0 && (
              <div className="text-[13px] text-dim">
                <span className="font-semibold text-primary">
                  {formatNumber(uploaded_pus)} result{" "}
                  {uploaded_pus === 1 ? "form" : "forms"}
                </span>{" "}
                published so far. INEC uploads these as scanned EC8A sheets, not
                as vote counts — party totals appear here only once the sheets
                are transcribed, so this figure tracks{" "}
                <span className="italic">reporting progress</span>, not results.
                {fragmentary && (
                  <>
                    {" "}
                    Votes have been read from{" "}
                    {formatNumber(e.tally_coverage?.pus_with_votes ?? 0)} of them
                    — far too few to stand for a total, so none is shown.
                  </>
                )}
              </div>
            )}

            {counting && (
              <>
                <ul className="space-y-2">
                  {e.tallies.slice(0, 5).map((t, i) => (
                    <li key={t.party}>
                      <div className="flex items-baseline justify-between text-[13px] mb-1">
                        <span className="font-semibold text-primary truncate">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                            style={{
                              background:
                                t.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
                            }}
                          />
                          {t.party}
                          {t.candidate && (
                            <span className="text-dim font-normal">
                              {" "}
                              · {t.candidate}
                            </span>
                          )}
                        </span>
                        <span className="font-mono tabular-nums shrink-0 ml-3">
                          {formatNumber(t.votes)}
                          <span className="text-dim ml-2">
                            {(t.share * 100).toFixed(1)}%
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                        <div
                          className="h-full transition-[width] duration-700 ease-out"
                          style={{
                            width: `${Math.max(0, Math.min(1, t.share)) * 100}%`,
                            background:
                              t.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="text-[11px] text-dim mt-3 pt-2 border-t border-accent-red/20">
                  {formatNumber(e.total_votes)} votes counted from{" "}
                  {formatNumber(e.tally_coverage?.pus_with_votes ?? 0)} of{" "}
                  {formatNumber(uploaded_pus)} reported polling units
                  {leader && pct < 0.95 && (
                    <>
                      {" · "}
                      <span className="text-primary font-semibold">
                        {leader.party} leads
                      </span>{" "}
                      on {(pct * 100).toFixed(0)}% reporting — not a projection
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
