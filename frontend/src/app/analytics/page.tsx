"use client";

import { useMemo, useState } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useChartTheme } from "@/hooks/useChartTheme";
import ExportButton from "@/components/shared/ExportButton";
import MiniProgress from "@/components/shared/MiniProgress";
import { SkeletonCard } from "@/components/shared/SkeletonLoader";
import {
  TimelineEntry,
  PartyAnalysis,
  TurnoutProjection,
  TrendsData,
  HeatmapData,
  PartyRaceData,
  LiveResultsData,
  ChairmanshipRaceResponse,
  CouncillorshipRaceResponse,
} from "@/lib/types";
import { pctColor, formatNumber } from "@/lib/utils";
import { PARTY_COLORS } from "@/lib/constants";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

// ─── Tab type for analytics sections ─────────────────────────────
type AnalyticsTab = "chairmanship" | "councillorship" | "results" | "race" | "progress" | "heatmap";

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("chairmanship");
  const chartTheme = useChartTheme();

  const { data: timeline, error: timelineErr } =
    useApiData<TimelineEntry[]>("/api/timeline");
  const { data: partyData, error: partyErr } =
    useApiData<PartyAnalysis>("/api/party-analysis");
  const { data: projection, error: projectionErr } =
    useApiData<TurnoutProjection>("/api/analytics/turnout-projection");
  const { data: trends, error: trendsErr } =
    useApiData<TrendsData>("/api/analytics/trends");
  const { data: heatmap, error: heatmapErr } =
    useApiData<HeatmapData>("/api/analytics/heatmap");
  const { data: raceData, error: raceErr } =
    useApiData<PartyRaceData>("/api/analytics/party-race");
  const { data: liveResults, error: liveErr } =
    useApiData<LiveResultsData>("/api/live-results");
  const { data: chairRace, error: chairErr } =
    useApiData<ChairmanshipRaceResponse>("/api/chairmanship-race");
  const { data: councillorRace, error: councillorErr } =
    useApiData<CouncillorshipRaceResponse>("/api/councillorship-race");

  const hasError = timelineErr || partyErr || projectionErr || trendsErr || heatmapErr || raceErr || liveErr || chairErr || councillorErr;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Error Banner */}
      {hasError && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl px-4 py-3 text-[13px] text-accent-red font-semibold animate-fade-in-down">
          Failed to load some analytics data. Retrying automatically...
        </div>
      )}

      <div className="flex items-center justify-between animate-fade-in-up">
        <SectionTitle>Analytics Dashboard</SectionTitle>
        <ExportButton endpoint="/api/export/analytics" filename="analytics" />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-dashboard-card border border-dashboard-border rounded-xl p-1 overflow-x-auto animate-fade-in-up">
        {([
          { id: "chairmanship" as const, label: "Chairmanship" },
          { id: "councillorship" as const, label: "Councillorship" },
          { id: "results" as const, label: "Live Results" },
          { id: "race" as const, label: "Party & Candidates" },
          { id: "progress" as const, label: "Upload Progress" },
          { id: "heatmap" as const, label: "Heat Map" },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 px-3 rounded-lg text-[11px] font-bold transition-all duration-200 whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-accent-green/15 text-accent-green shadow-sm tab-active"
                : "text-dim hover:text-primary hover:bg-[var(--hover-overlay)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 1: CHAIRMANSHIP RACE (Primary — who is winning)         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "chairmanship" && (
        <ChairmanshipTab chairRace={chairRace} />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 2: COUNCILLORSHIP RACE (ward-level — who is winning)    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "councillorship" && (
        <CouncillorshipTab councillorRace={councillorRace} />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 3: PARTY RACE & CANDIDATES                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "race" && (
        <PartyRaceTab raceData={raceData} partyData={partyData} />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 2: VOTE RESULTS (OCR)                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "results" && (
        <VoteResultsTab liveResults={liveResults} />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 3: UPLOAD PROGRESS                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "progress" && (
        <ProgressTab
          projection={projection}
          projectionErr={!!projectionErr}
          trends={trends}
          timeline={timeline}
          partyData={partyData}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  TAB 3: HEAT MAP                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "heatmap" && <HeatmapTab heatmap={heatmap} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PARTY RACE TAB
// ═══════════════════════════════════════════════════════════════════
function PartyRaceTab({
  raceData,
  partyData,
}: {
  raceData: PartyRaceData | undefined;
  partyData: PartyAnalysis | undefined;
}) {
  if (!raceData && !partyData) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Summary Cards ──────────────────────────────────────── */}
      {raceData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatMini
            label="Total Candidates"
            value={raceData.total_candidates}
            color="#3b82f6"
          />
          <StatMini
            label="Active Candidates"
            value={raceData.active_candidates}
            color="#10b981"
          />
          <StatMini
            label="Withdrawn"
            value={raceData.withdrawn_count}
            color="#ef4444"
          />
          <StatMini
            label="Parties Fielding"
            value={raceData.party_standings.length}
            color="#a78bfa"
          />
        </div>
      )}

      {/* ─── Party Strength Rankings ────────────────────────────── */}
      {raceData && raceData.party_standings.length > 0 && (
        <PartyStrengthRankings standings={raceData.party_standings} />
      )}

      {/* ─── Chairmanship Battles ───────────────────────────────── */}
      {raceData && raceData.chairmanship_races.length > 0 && (
        <>
          <SectionTitle>Chairmanship Battles</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {raceData.chairmanship_races.map((race) => (
              <ChairmanshipBattleCard key={race.area_council} race={race} />
            ))}
          </div>
        </>
      )}

      {/* ─── Head-to-Head Matchups ──────────────────────────────── */}
      {raceData && raceData.head_to_head.length > 0 && (
        <>
          <SectionTitle>Key Head-to-Head Matchups</SectionTitle>
          <div className="space-y-3">
            {raceData.head_to_head.map((matchup) => (
              <HeadToHeadCard key={matchup.area_council} matchup={matchup} />
            ))}
          </div>
        </>
      )}

      {/* ─── Party Charts Row ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Councillorship Spread */}
        {raceData && raceData.councillor_spread.length > 0 && (
          <CouncillorshipSpreadChart spread={raceData.councillor_spread} />
        )}

        {/* Party Radar */}
        {raceData && raceData.party_standings.length > 0 && (
          <PartyRadarChart standings={raceData.party_standings} />
        )}
      </div>

      {/* ─── Gender Scorecard ───────────────────────────────────── */}
      {raceData && <GenderScorecard scorecard={raceData.gender_scorecard} />}
    </div>
  );
}

// ─── Party Strength Rankings ─────────────────────────────────────
function PartyStrengthRankings({
  standings,
}: {
  standings: PartyRaceData["party_standings"];
}) {
  const chartTheme = useChartTheme();
  const maxStrength = standings[0]?.strength_index || 1;

  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">Party Strength Rankings</h3>
        <span className="text-[10px] text-dim uppercase font-semibold">
          By candidate coverage &amp; depth
        </span>
      </div>

      <div className="space-y-2.5">
        {standings.map((party, idx) => {
          const color = PARTY_COLORS[party.party] || PARTY_COLORS.default;
          const barWidth = (party.strength_index / maxStrength) * 100;
          return (
            <div key={party.party} className="group">
              <div className="flex items-center gap-3">
                {/* Rank badge */}
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-extrabold flex-shrink-0"
                  style={{
                    backgroundColor: idx < 3 ? `${color}25` : `${chartTheme.gridColor}15`,
                    color: idx < 3 ? color : chartTheme.textColor,
                  }}
                >
                  {idx + 1}
                </div>

                {/* Party name + bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-[13px] font-bold">{party.party}</span>
                      <span className="text-[10px] text-dim truncate hidden sm:inline">
                        {party.party_full}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] tabular-nums">
                      <span className="text-dim">
                        <strong className="text-primary">{party.chairmanship}</strong> Chair
                      </span>
                      <span className="text-dim">
                        <strong className="text-primary">{party.councillorship}</strong> Council
                      </span>
                      <span
                        className="font-bold px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          backgroundColor: `${color}20`,
                          color,
                        }}
                      >
                        {party.coverage_pct}% Coverage
                      </span>
                    </div>
                  </div>
                  {/* Strength bar */}
                  <div className="h-2 bg-dashboard-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Chairmanship Battle Card ────────────────────────────────────
function ChairmanshipBattleCard({
  race,
}: {
  race: PartyRaceData["chairmanship_races"][0];
}) {
  const [expanded, setExpanded] = useState(false);
  const displayCands = expanded ? race.candidates : race.candidates.slice(0, 4);

  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-bold truncate">{race.area_council}</h4>
        <div className="flex items-center gap-2">
          {race.is_competitive && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-accent-orange/15 text-accent-orange">
              Competitive
            </span>
          )}
          <span className="text-[10px] text-dim bg-dashboard-border px-1.5 py-0.5 rounded">
            {race.total_candidates} candidates
          </span>
        </div>
      </div>

      {/* Party dots */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {race.parties.map((p) => (
          <span
            key={p}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${PARTY_COLORS[p] || PARTY_COLORS.default}20`,
              color: PARTY_COLORS[p] || PARTY_COLORS.default,
            }}
          >
            {p}
          </span>
        ))}
      </div>

      {/* Candidate list */}
      <div className="space-y-1.5">
        {displayCands.map((cand, i) => {
          const color = PARTY_COLORS[cand.party] || PARTY_COLORS.default;
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg hover:bg-dashboard-card-hover transition-colors"
            >
              <div
                className="w-1.5 h-8 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold truncate">
                  {cand.candidate_name}
                </p>
                <p className="text-[10px] text-dim">
                  {cand.party_full}
                </p>
              </div>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ backgroundColor: `${color}20`, color }}
              >
                {cand.party}
              </span>
              {cand.gender === "F" && (
                <span className="text-[9px] text-pink-400">F</span>
              )}
            </div>
          );
        })}
      </div>

      {race.candidates.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[11px] text-accent-green hover:text-accent-green/80 font-semibold"
        >
          {expanded ? "Show less" : `+${race.candidates.length - 4} more candidates`}
        </button>
      )}
    </div>
  );
}

// ─── Head-to-Head Card ───────────────────────────────────────────
function HeadToHeadCard({
  matchup,
}: {
  matchup: PartyRaceData["head_to_head"][0];
}) {
  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-bold">{matchup.area_council}</h4>
        <span className="text-[10px] text-dim">
          {matchup.total_in_race} total in race
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {matchup.contenders.map((c, i) => {
          const color = PARTY_COLORS[c.party] || PARTY_COLORS.default;
          return (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-[11px] font-extrabold text-accent-orange mx-1">VS</span>
              )}
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 border"
                style={{
                  borderColor: `${color}40`,
                  backgroundColor: `${color}10`,
                }}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold truncate max-w-[120px]">
                    {c.candidate_name.split(" ").slice(-1)[0]}
                  </p>
                  <p className="text-[9px] font-semibold" style={{ color }}>
                    {c.party}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Councillorship Spread Chart ─────────────────────────────────
function CouncillorshipSpreadChart({
  spread,
}: {
  spread: PartyRaceData["councillor_spread"];
}) {
  const chartTheme = useChartTheme();
  const chartData = useMemo(
    () =>
      spread.slice(0, 12).map((s) => ({
        name: s.party,
        count: s.count,
        fill: PARTY_COLORS[s.party] || PARTY_COLORS.default,
      })),
    [spread]
  );

  return (
    <ChartPanel title="Councillorship Candidates by Party">
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
            <XAxis
              dataKey="name"
              tick={{ fill: chartTheme.textColor, fontSize: 10 }}
            />
            <YAxis tick={{ fill: chartTheme.textColor, fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
                borderRadius: 8,
                color: chartTheme.tooltipText,
              }}
            />
            <Bar dataKey="count" name="Candidates" radius={[6, 6, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[280px] flex items-center justify-center text-dim text-sm">
          No councillorship data yet...
        </div>
      )}
    </ChartPanel>
  );
}

// ─── Party Radar Chart ───────────────────────────────────────────
function PartyRadarChart({
  standings,
}: {
  standings: PartyRaceData["party_standings"];
}) {
  const chartTheme = useChartTheme();
  const top6 = standings.slice(0, 6);
  const maxVals = {
    candidates: Math.max(...top6.map((p) => p.total_candidates), 1),
    coverage: 100,
    chairmanship: Math.max(...top6.map((p) => p.chairmanship), 1),
    councillorship: Math.max(...top6.map((p) => p.councillorship), 1),
  };

  const radarData = useMemo(
    () => [
      {
        metric: "Candidates",
        ...Object.fromEntries(
          top6.map((p) => [p.party, Math.round((p.total_candidates / maxVals.candidates) * 100)])
        ),
      },
      {
        metric: "Coverage",
        ...Object.fromEntries(
          top6.map((p) => [p.party, Math.round(p.coverage_pct)])
        ),
      },
      {
        metric: "Chairman",
        ...Object.fromEntries(
          top6.map((p) => [p.party, Math.round((p.chairmanship / maxVals.chairmanship) * 100)])
        ),
      },
      {
        metric: "Councillor",
        ...Object.fromEntries(
          top6.map((p) => [p.party, Math.round((p.councillorship / maxVals.councillorship) * 100)])
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [standings]
  );

  return (
    <ChartPanel title="Top Party Comparison Radar">
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={radarData}>
          <PolarGrid stroke={chartTheme.gridColor} />
          <PolarAngleAxis
            dataKey="metric"
            tick={{ fill: chartTheme.textColor, fontSize: 10 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fill: chartTheme.textColor, fontSize: 9 }}
            tickCount={4}
          />
          {top6.map((p) => (
            <Radar
              key={p.party}
              name={p.party}
              dataKey={p.party}
              stroke={PARTY_COLORS[p.party] || PARTY_COLORS.default}
              fill={PARTY_COLORS[p.party] || PARTY_COLORS.default}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{
              background: chartTheme.tooltipBg,
              border: `1px solid ${chartTheme.tooltipBorder}`,
              borderRadius: 8,
              fontSize: 11,
              color: chartTheme.tooltipText,
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

// ─── Gender Scorecard ────────────────────────────────────────────
function GenderScorecard({
  scorecard,
}: {
  scorecard: PartyRaceData["gender_scorecard"];
}) {
  const chartTheme = useChartTheme();
  const femalePct = scorecard.female_pct;
  const malePct = 100 - femalePct;

  const chairFPct =
    scorecard.by_position.chairmanship.total > 0
      ? Math.round(
          (scorecard.by_position.chairmanship.female /
            scorecard.by_position.chairmanship.total) *
            100
        )
      : 0;

  const councilFPct =
    scorecard.by_position.councillorship.total > 0
      ? Math.round(
          (scorecard.by_position.councillorship.female /
            scorecard.by_position.councillorship.total) *
            100
        )
      : 0;

  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <h3 className="text-sm font-bold mb-4">Gender Representation Scorecard</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Overall */}
        <div className="text-center">
          <p className="text-[10px] text-dim uppercase font-semibold mb-2">
            Overall Balance
          </p>
          <div className="relative w-24 h-24 mx-auto">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke={chartTheme.gridColor}
                strokeWidth="3"
              />
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="rgba(236,72,153,0.7)"
                strokeWidth="3"
                strokeDasharray={`${femalePct}, 100`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-extrabold" style={{ color: "rgba(236,72,153,0.9)" }}>
                {femalePct}%
              </span>
              <span className="text-[9px] text-dim">Female</span>
            </div>
          </div>
          <div className="flex justify-center gap-4 mt-2 text-[11px]">
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-pink-400 mr-1" />
              {scorecard.female} Female
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />
              {scorecard.male} Male
            </span>
          </div>
        </div>

        {/* Chairmanship */}
        <div className="text-center">
          <p className="text-[10px] text-dim uppercase font-semibold mb-2">
            Chairmanship
          </p>
          <div className="flex items-end justify-center gap-2 h-20">
            <div className="text-center">
              <div
                className="w-10 rounded-t-md bg-blue-500/60"
                style={{
                  height: `${Math.max(((100 - chairFPct) / 100) * 64, 8)}px`,
                }}
              />
              <p className="text-[10px] font-bold mt-1">{100 - chairFPct}%</p>
              <p className="text-[9px] text-dim">Male</p>
            </div>
            <div className="text-center">
              <div
                className="w-10 rounded-t-md bg-pink-400/60"
                style={{
                  height: `${Math.max((chairFPct / 100) * 64, 8)}px`,
                }}
              />
              <p className="text-[10px] font-bold mt-1">{chairFPct}%</p>
              <p className="text-[9px] text-dim">Female</p>
            </div>
          </div>
          <p className="text-[10px] text-dim mt-1">
            {scorecard.by_position.chairmanship.total} total
          </p>
        </div>

        {/* Councillorship */}
        <div className="text-center">
          <p className="text-[10px] text-dim uppercase font-semibold mb-2">
            Councillorship
          </p>
          <div className="flex items-end justify-center gap-2 h-20">
            <div className="text-center">
              <div
                className="w-10 rounded-t-md bg-blue-500/60"
                style={{
                  height: `${Math.max(((100 - councilFPct) / 100) * 64, 8)}px`,
                }}
              />
              <p className="text-[10px] font-bold mt-1">{100 - councilFPct}%</p>
              <p className="text-[9px] text-dim">Male</p>
            </div>
            <div className="text-center">
              <div
                className="w-10 rounded-t-md bg-pink-400/60"
                style={{
                  height: `${Math.max((councilFPct / 100) * 64, 8)}px`,
                }}
              />
              <p className="text-[10px] font-bold mt-1">{councilFPct}%</p>
              <p className="text-[9px] text-dim">Female</p>
            </div>
          </div>
          <p className="text-[10px] text-dim mt-1">
            {scorecard.by_position.councillorship.total} total
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  CHAIRMANSHIP TAB — Who is winning each Area Council
// ═══════════════════════════════════════════════════════════════════
function ChairmanshipTab({
  chairRace,
}: {
  chairRace: ChairmanshipRaceResponse | undefined;
}) {
  const chartTheme = useChartTheme();
  if (!chairRace) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  const { races, councils_with_data, total_councils } = chairRace;

  // Compute aggregate stats
  const totalVotes = races.reduce((s, r) => s + r.total_valid_votes, 0);
  const totalRegistered = races.reduce((s, r) => s + r.total_registered, 0);
  const totalAccredited = races.reduce((s, r) => s + r.total_accredited, 0);
  const totalPUs = races.reduce((s, r) => s + r.total_pus_counted, 0);

  // Party win count
  const partyWins: Record<string, number> = {};
  races.forEach((r) => {
    if (r.winner) {
      partyWins[r.winner.party] = (partyWins[r.winner.party] || 0) + 1;
    }
  });

  // Aggregate party votes across all councils for the bar chart
  const partyTotals: Record<string, number> = {};
  races.forEach((r) => {
    r.candidates.forEach((c) => {
      if (c.votes > 0 && c.party !== "TBD") {
        partyTotals[c.party] = (partyTotals[c.party] || 0) + c.votes;
      }
    });
  });
  const chartData = Object.entries(partyTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([party, votes]) => ({
      party,
      votes,
      fill: PARTY_COLORS[party] || PARTY_COLORS.default,
    }));

  return (
    <div className="space-y-5">
      {/* Summary Banner */}
      <div className="bg-gradient-to-r from-accent-green/15 via-accent-blue/10 to-accent-purple/10 border border-accent-green/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            FCT Area Council Chairmanship Race
          </h3>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] bg-accent-green/20 text-accent-green px-2 py-0.5 rounded-full font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
              LIVE
            </span>
            <span className="text-[10px] text-dim font-semibold">
              {councils_with_data}/{total_councils} reporting
            </span>
          </div>
        </div>
        <p className="text-[11px] text-dim">
          Live results from INEC IReV — {formatNumber(totalVotes)} total votes counted across {formatNumber(totalPUs)} polling units.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatMini label="Total Votes" value={totalVotes} color="#10b981" />
        <StatMini label="Polling Units" value={totalPUs} color="#3b82f6" />
        <StatMini label="Registered Voters" value={totalRegistered} color="#a78bfa" />
        <StatMini label="Accredited" value={totalAccredited} color="#f59e0b" />
      </div>

      {/* Party Wins Summary + Vote Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Party scoreboard */}
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-3">Councils Won by Party</h3>
          <div className="space-y-2">
            {Object.entries(partyWins)
              .sort((a, b) => b[1] - a[1])
              .map(([party, wins]) => {
                const color = PARTY_COLORS[party] || PARTY_COLORS.default;
                return (
                  <div key={party} className="flex items-center gap-3">
                    <span
                      className="text-[12px] font-extrabold px-2 py-1 rounded w-12 text-center"
                      style={{ backgroundColor: `${color}25`, color }}
                    >
                      {party}
                    </span>
                    <div className="flex-1 h-6 bg-dashboard-border rounded-lg overflow-hidden">
                      <div
                        className="h-full rounded-lg flex items-center px-2 transition-all duration-700"
                        style={{ width: `${(wins / total_councils) * 100}%`, backgroundColor: color }}
                      >
                        <span className="text-[11px] font-extrabold text-white">{wins}/{total_councils}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {races.filter(r => r.winner?.party === party).map(r => (
                        <span key={r.area_council} className="text-[8px] text-dim bg-dashboard-bg px-1 py-0.5 rounded">
                          {r.area_council}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Vote chart */}
        {chartData.length > 0 && (
          <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
            <h3 className="text-sm font-bold mb-3">Total Chairmanship Votes by Party</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 5, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
                <XAxis type="number" tick={{ fontSize: 10, fill: chartTheme.textColor }} tickFormatter={(v: number) => formatNumber(v)} />
                <YAxis type="category" dataKey="party" tick={{ fontSize: 11, fontWeight: 700, fill: chartTheme.textColor }} width={45} />
                <Tooltip
                  contentStyle={{ backgroundColor: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8, color: chartTheme.tooltipText }}
                  formatter={(val: number | undefined) => [formatNumber(val ?? 0), "Votes"]}
                />
                <Bar dataKey="votes" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.party} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Race Cards — One per Area Council */}
      <SectionTitle>Race Results by Area Council</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {races.map((race) => {
          const topCandidate = race.candidates[0];
          const runnerUp = race.candidates[1];
          const leadColor = topCandidate?.party
            ? PARTY_COLORS[topCandidate.party] || PARTY_COLORS.default
            : chartTheme.textColor;
          const hasData = race.total_valid_votes > 0;

          return (
            <div
              key={race.area_council}
              className="bg-dashboard-card border-2 rounded-xl overflow-hidden"
              style={{ borderColor: hasData ? `${leadColor}40` : "#e2e8f030" }}
            >
              {/* Race Header */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ backgroundColor: hasData ? `${leadColor}10` : "#f3f4f608" }}
              >
                <div>
                  <h4 className="text-[14px] font-extrabold">{race.area_council}</h4>
                  <p className="text-[10px] text-dim">
                    {formatNumber(race.total_pus_counted)} PUs · {formatNumber(race.total_valid_votes)} votes · {race.turnout_pct}% turnout
                  </p>
                </div>
                {hasData && topCandidate && (
                  <div
                    className="px-3 py-1 rounded-full text-[10px] font-extrabold text-white"
                    style={{ backgroundColor: leadColor }}
                  >
                    {topCandidate.party} LEADING
                  </div>
                )}
              </div>

              {/* Candidates List */}
              <div className="p-4 space-y-2.5">
                {race.candidates
                  .filter((c) => c.candidate_name !== "Candidate 5" && c.party !== "TBD")
                  .map((cand, idx) => {
                  const color = PARTY_COLORS[cand.party] || PARTY_COLORS.default;
                  const barW = race.total_valid_votes > 0
                    ? (cand.votes / race.total_valid_votes) * 100
                    : 0;
                  const isLeading = idx === 0 && cand.votes > 0;

                  return (
                    <div
                      key={`${cand.party}-${cand.candidate_name}`}
                      className={`rounded-lg p-3 border ${
                        isLeading
                          ? "border-2 shadow-sm"
                          : "border-dashboard-border"
                      }`}
                      style={isLeading ? { borderColor: `${color}60`, backgroundColor: `${color}08` } : {}}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold flex-shrink-0"
                          style={{
                            backgroundColor: isLeading ? color : `${chartTheme.textColor}20`,
                            color: isLeading ? "#fff" : chartTheme.textColor,
                          }}
                        >
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="text-[11px] font-extrabold px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: `${color}25`, color }}
                              >
                                {cand.party}
                              </span>
                              <span className={`text-[12px] font-bold truncate ${isLeading ? "text-primary" : "text-dim"}`}>
                                {cand.candidate_name}
                              </span>
                              {cand.gender === "F" && (
                                <span className="text-[9px] bg-pink-100 text-pink-600 px-1 rounded font-bold">♀</span>
                              )}
                              {cand.status?.includes("Incumbent") && (
                                <span className="text-[8px] bg-blue-100 text-blue-600 px-1 rounded font-bold">INC</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span
                                className="text-[14px] font-extrabold tabular-nums"
                                style={{ color: isLeading ? color : chartTheme.textColor }}
                              >
                                {formatNumber(cand.votes)}
                              </span>
                              <span className="text-[10px] text-dim tabular-nums">
                                {cand.vote_pct}%
                              </span>
                            </div>
                          </div>
                          <div className="h-2 bg-dashboard-border rounded-full overflow-hidden mt-1.5">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${barW}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {hasData && race.margin > 0 && topCandidate && runnerUp && (
                  <div className="flex items-center justify-center gap-2 pt-2 border-t border-dashboard-border">
                    <span className="text-[10px] text-dim">Lead margin:</span>
                    <span className="text-[12px] font-extrabold" style={{ color: leadColor }}>
                      +{formatNumber(race.margin)} votes
                    </span>
                    <span className="text-[10px] text-dim">
                      ({topCandidate.party} over {runnerUp.party})
                    </span>
                  </div>
                )}

                {!hasData && (
                  <div className="text-center py-4">
                    <p className="text-[11px] text-dim">Awaiting vote data...</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  COUNCILLORSHIP TAB (ward-level races)
// ═══════════════════════════════════════════════════════════════════
function CouncillorshipTab({
  councillorRace,
}: {
  councillorRace: CouncillorshipRaceResponse | undefined;
}) {
  const chartTheme = useChartTheme();
  const [selectedCouncil, setSelectedCouncil] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  if (!councillorRace) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  const {
    races, party_standings, council_summary,
    total_wards, wards_with_data,
  } = councillorRace;

  const filteredRaces = selectedCouncil === "all"
    ? races
    : races.filter((r) => r.area_council === selectedCouncil);

  // Get unique council names
  const councils = Array.from(new Set(races.map((r) => r.area_council))).filter(Boolean).sort();

  return (
    <div className="space-y-5">
      {/* Summary Banner */}
      <div className="bg-gradient-to-r from-accent-blue/15 via-accent-purple/10 to-accent-green/10 border border-accent-blue/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span className="text-lg">🗳️</span>
            FCT Councillorship Races
          </h3>
          <span className="text-[10px] text-dim font-semibold">
            {wards_with_data}/{total_wards} wards reporting
          </span>
        </div>
        <p className="text-[11px] text-dim">
          Live results from INEC IReV — each ward elects one councillor. Showing which parties are leading across all {total_wards} ward races.
        </p>
      </div>

      {/* Overall Party Standings for Councillorship */}
      {party_standings.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">Councillorship Party Standings</h3>
            <span className="text-[10px] text-dim font-semibold uppercase">
              Total votes + Wards leading
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {party_standings.slice(0, 12).map((ps) => {
              const color = PARTY_COLORS[ps.party] || PARTY_COLORS.default;
              return (
                <div
                  key={ps.party}
                  className="rounded-lg border p-2.5 text-center"
                  style={{ borderColor: `${color}40`, backgroundColor: `${color}08` }}
                >
                  <div
                    className="text-[12px] font-extrabold mb-1"
                    style={{ color }}
                  >
                    {ps.party}
                  </div>
                  <div className="text-[16px] font-extrabold tabular-nums">
                    {formatNumber(ps.votes)}
                  </div>
                  <div className="text-[10px] text-dim">votes</div>
                  {ps.wards_leading > 0 && (
                    <div
                      className="mt-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full inline-block"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {ps.wards_leading} ward{ps.wards_leading > 1 ? "s" : ""} leading
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Council Summary Cards */}
      {council_summary.length > 0 && (
        <>
          <SectionTitle>Area Council Breakdown</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {council_summary.map((cs) => {
              const topParty = Object.entries(cs.party_leads).sort((a, b) => b[1] - a[1])[0];
              const topColor = topParty ? (PARTY_COLORS[topParty[0]] || PARTY_COLORS.default) : chartTheme.textColor;
              const coverage = cs.total_pus > 0 ? (cs.pus_counted / cs.total_pus * 100) : 0;
              return (
                <div
                  key={cs.area_council}
                  className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 cursor-pointer hover:border-accent-blue/40 transition-colors"
                  onClick={() => setSelectedCouncil(selectedCouncil === cs.area_council ? "all" : cs.area_council)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[13px] font-extrabold">{cs.area_council}</h4>
                    {topParty && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: topColor }}
                      >
                        {topParty[0]} leads {topParty[1]} wards
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[18px] font-extrabold text-accent-blue">{cs.wards_with_data}</div>
                      <div className="text-[9px] text-dim">of {cs.total_wards} wards</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-extrabold text-accent-green">{formatNumber(cs.total_valid)}</div>
                      <div className="text-[9px] text-dim">total votes</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-extrabold text-accent-orange">{coverage.toFixed(0)}%</div>
                      <div className="text-[9px] text-dim">PU coverage</div>
                    </div>
                  </div>
                  {/* Party leads breakdown */}
                  {Object.keys(cs.party_leads).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(cs.party_leads)
                        .sort((a, b) => b[1] - a[1])
                        .map(([party, count]) => {
                          const c = PARTY_COLORS[party] || PARTY_COLORS.default;
                          return (
                            <span
                              key={party}
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: `${c}20`, color: c }}
                            >
                              {party}: {count}
                            </span>
                          );
                        })}
                    </div>
                  )}
                  {selectedCouncil === cs.area_council && (
                    <div className="mt-2 text-center text-[9px] text-accent-blue font-bold">
                      ▼ Showing wards below — click to show all
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Ward Filter + View Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SectionTitle>Ward Results</SectionTitle>
          {selectedCouncil !== "all" && (
            <button
              onClick={() => setSelectedCouncil("all")}
              className="text-[10px] text-accent-blue font-bold hover:underline"
            >
              Show All →
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-dashboard-bg rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("cards")}
            className={`px-2.5 py-1 rounded text-[10px] font-bold ${
              viewMode === "cards" ? "bg-accent-green/15 text-accent-green" : "text-dim"
            }`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`px-2.5 py-1 rounded text-[10px] font-bold ${
              viewMode === "table" ? "bg-accent-green/15 text-accent-green" : "text-dim"
            }`}
          >
            Table
          </button>
        </div>
      </div>

      {/* Ward Race Cards or Table */}
      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredRaces.map((race) => {
            const leader = race.candidates[0];
            const runnerUp = race.candidates[1];
            const leadColor = leader?.party
              ? PARTY_COLORS[leader.party] || PARTY_COLORS.default
              : chartTheme.textColor;
            const hasData = race.total_valid_votes > 0;

            return (
              <div
                key={`${race.area_council}-${race.ward_name}`}
                className="bg-dashboard-card border rounded-xl overflow-hidden"
                style={{ borderColor: hasData ? `${leadColor}30` : "#e2e8f020" }}
              >
                {/* Ward Header */}
                <div
                  className="px-3 py-2 flex items-center justify-between"
                  style={{ backgroundColor: hasData ? `${leadColor}08` : "#f3f4f605" }}
                >
                  <div>
                    <h4 className="text-[12px] font-extrabold">{race.ward_name}</h4>
                    <p className="text-[9px] text-dim">
                      {race.area_council} · {race.pus_counted}/{race.total_pus_in_ward} PUs · {race.coverage_pct}% coverage
                    </p>
                  </div>
                  {hasData && leader && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[9px] font-extrabold text-white"
                      style={{ backgroundColor: leadColor }}
                    >
                      {leader.party}
                    </span>
                  )}
                </div>

                {/* Party Results */}
                <div className="p-3 space-y-1.5">
                  {race.candidates.slice(0, 5).map((cand, idx) => {
                    const color = PARTY_COLORS[cand.party] || PARTY_COLORS.default;
                    const barW = race.total_valid_votes > 0
                      ? (cand.votes / race.total_valid_votes) * 100
                      : 0;
                    const isLeading = idx === 0 && cand.votes > 0;

                    return (
                      <div key={cand.party} className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-extrabold w-10 text-right flex-shrink-0"
                          style={{ color }}
                        >
                          {cand.party}
                        </span>
                        <div className="flex-1 h-3 bg-dashboard-border rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${barW}%`, backgroundColor: color }}
                          />
                        </div>
                        <span
                          className={`text-[11px] tabular-nums w-14 text-right flex-shrink-0 ${
                            isLeading ? "font-extrabold" : "text-dim"
                          }`}
                          style={isLeading ? { color } : {}}
                        >
                          {formatNumber(cand.votes)}
                        </span>
                      </div>
                    );
                  })}

                  {/* Stats row */}
                  {hasData && (
                    <div className="flex items-center justify-between pt-1.5 border-t border-dashboard-border text-[9px] text-dim">
                      <span>{formatNumber(race.total_valid_votes)} votes</span>
                      <span>{race.turnout_pct}% turnout</span>
                      {race.margin > 0 && leader && runnerUp && (
                        <span>
                          <strong style={{ color: leadColor }}>+{formatNumber(race.margin)}</strong> margin
                        </span>
                      )}
                    </div>
                  )}

                  {!hasData && (
                    <div className="text-center py-2">
                      <p className="text-[10px] text-dim">Awaiting vote data...</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-dashboard-border bg-dashboard-bg/50">
                  <th className="text-left px-3 py-2 font-bold text-dim">Ward</th>
                  <th className="text-left px-3 py-2 font-bold text-dim">Council</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">PUs</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">Votes</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">Leading</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">2nd</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">Margin</th>
                  <th className="text-center px-3 py-2 font-bold text-dim">Turnout</th>
                </tr>
              </thead>
              <tbody>
                {filteredRaces.map((race) => {
                  const leader = race.candidates[0];
                  const runnerUp = race.candidates[1];
                  const leadColor = leader?.party
                    ? PARTY_COLORS[leader.party] || PARTY_COLORS.default
                    : chartTheme.textColor;
                  const hasData = race.total_valid_votes > 0;

                  return (
                    <tr
                      key={`${race.area_council}-${race.ward_name}`}
                      className="border-b border-dashboard-border/50 hover:bg-dashboard-card-hover"
                    >
                      <td className="px-3 py-2 font-bold">{race.ward_name}</td>
                      <td className="px-3 py-2 text-dim">{race.area_council}</td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {race.pus_counted}/{race.total_pus_in_ward}
                      </td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums">
                        {hasData ? formatNumber(race.total_valid_votes) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {leader && hasData ? (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-extrabold"
                            style={{ backgroundColor: `${leadColor}20`, color: leadColor }}
                          >
                            {leader.party} ({formatNumber(leader.votes)})
                          </span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {runnerUp && hasData ? (
                          <span className="text-dim">
                            {runnerUp.party} ({formatNumber(runnerUp.votes)})
                          </span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-bold tabular-nums" style={{ color: hasData ? leadColor : chartTheme.textColor }}>
                        {hasData && race.margin > 0 ? `+${formatNumber(race.margin)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {hasData ? `${race.turnout_pct}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  VOTE RESULTS TAB (Live INEC data)
// ═══════════════════════════════════════════════════════════════════
function VoteResultsTab({
  liveResults,
}: {
  liveResults: LiveResultsData | undefined;
}) {
  const chartTheme = useChartTheme();
  const [lgaFilter, setLgaFilter] = useState<string>("all");

  if (!liveResults) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  const { party_standings, ward_results, lga_results, summary } = liveResults;
  const maxVotes = party_standings[0]?.votes || 1;
  const topParties = party_standings.filter(p => p.votes > 0).slice(0, 10);
  const turnoutPct = summary.total_registered > 0
    ? ((summary.total_accredited / summary.total_registered) * 100).toFixed(1)
    : "0";

  // Unique LGA names for filter
  const lgaNames = [...new Set(ward_results.map(w => w.lga_name))].sort();
  const filteredWards = lgaFilter === "all"
    ? ward_results
    : ward_results.filter(w => w.lga_name === lgaFilter);

  return (
    <div className="space-y-5">
      {/* Live Results Banner */}
      <div className="bg-gradient-to-r from-accent-green/15 to-accent-blue/10 border border-accent-green/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-green animate-pulse" />
            INEC IReV Live Results
          </h3>
          <span className="text-[10px] text-dim font-semibold">
            {summary.data_source}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="text-center">
            <p className="text-[10px] text-dim uppercase font-semibold">PUs Counted</p>
            <p className="text-lg font-extrabold text-accent-green tabular-nums">
              {formatNumber(summary.pus_with_votes)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-dim uppercase font-semibold">Total PUs</p>
            <p className="text-lg font-extrabold text-primary tabular-nums">
              {formatNumber(summary.total_pus)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-dim uppercase font-semibold">Coverage</p>
            <p className="text-lg font-extrabold text-accent-blue tabular-nums">
              {summary.coverage_pct}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-dim uppercase font-semibold">Total Votes</p>
            <p className="text-lg font-extrabold text-accent-purple tabular-nums">
              {formatNumber(summary.total_valid)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-dim uppercase font-semibold">Turnout</p>
            <p className="text-lg font-extrabold text-accent-orange tabular-nums">
              {turnoutPct}%
            </p>
          </div>
        </div>
        {summary.total_pus > 0 && (
          <div className="mt-3">
            <MiniProgress pct={summary.coverage_pct} height={5} />
          </div>
        )}
      </div>

      {/* Vote Tallies */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatMini label="Total Registered" value={summary.total_registered} color="#3b82f6" />
        <StatMini label="Total Accredited" value={summary.total_accredited} color="#10b981" />
        <StatMini label="Valid Votes" value={summary.total_valid} color="#a78bfa" />
        <StatMini label="Rejected Votes" value={summary.total_rejected} color="#ef4444" />
      </div>

      {/* ── Area Council (LGA) Race Summary ─────────────────────── */}
      {lga_results && lga_results.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-4">Area Council Chairmanship Race</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lga_results.map((lga) => {
              const color = PARTY_COLORS[lga.leading_party?.toUpperCase()] || PARTY_COLORS.default;
              return (
                <div
                  key={lga.lga_name}
                  className="rounded-xl border-2 p-4"
                  style={{ borderColor: `${color}40`, backgroundColor: `${color}08` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[13px] font-extrabold">{lga.lga_name}</h4>
                    <span className="text-[10px] text-dim font-semibold">
                      {lga.pu_count} PUs
                    </span>
                  </div>
                  {/* Leading party badge */}
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="px-3 py-1.5 rounded-full text-[12px] font-extrabold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {lga.leading_party?.toUpperCase() || "—"}
                    </div>
                    <span className="text-[14px] font-extrabold tabular-nums" style={{ color }}>
                      {formatNumber(lga.leading_votes)}
                    </span>
                    <span className="text-[10px] text-dim">votes</span>
                  </div>
                  {/* Top 3 parties */}
                  {lga.top3 && (
                    <div className="space-y-1.5">
                      {lga.top3.map((t, i) => {
                        const pc = PARTY_COLORS[t.party?.toUpperCase()] || PARTY_COLORS.default;
                        const barPct = lga.total_valid > 0
                          ? (t.votes / lga.total_valid * 100)
                          : 0;
                        return (
                          <div key={t.party} className="flex items-center gap-2">
                            <span className="text-[10px] font-extrabold w-8" style={{ color: pc }}>
                              {t.party?.toUpperCase()}
                            </span>
                            <div className="flex-1 h-2 bg-dashboard-border rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${barPct}%`, backgroundColor: pc }}
                              />
                            </div>
                            <span className="text-[10px] font-bold tabular-nums w-14 text-right">
                              {formatNumber(t.votes)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-2 flex justify-between text-[9px] text-dim">
                    <span>Turnout: {lga.turnout_pct}%</span>
                    <span>Valid: {formatNumber(lga.total_valid)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Party Vote Standings (Who's Winning) */}
      {topParties.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold">
              Overall Party Vote Standings
            </h3>
            <span className="text-[10px] text-dim uppercase font-semibold">
              From {formatNumber(summary.pus_with_votes)} polling units
            </span>
          </div>
          <div className="space-y-3">
            {topParties.map((ps, idx) => {
              const color = PARTY_COLORS[ps.party.toUpperCase()] || PARTY_COLORS.default;
              const barW = (ps.votes / maxVotes) * 100;
              const votePct = summary.total_valid > 0
                ? ((ps.votes / summary.total_valid) * 100).toFixed(1)
                : "0";
              return (
                <div key={ps.party}>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-extrabold flex-shrink-0"
                      style={{
                        backgroundColor: idx < 3 ? `${color}30` : `${chartTheme.gridColor}15`,
                        color: idx < 3 ? color : chartTheme.textColor,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-[14px] font-extrabold">{ps.party.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[13px] font-extrabold tabular-nums" style={{ color }}>
                            {formatNumber(ps.votes)}
                          </span>
                          <span className="text-[11px] text-dim font-semibold tabular-nums">
                            {votePct}%
                          </span>
                        </div>
                      </div>
                      <div className="h-3 bg-dashboard-border rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${barW}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recharts bar chart — top parties */}
      {topParties.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-3">Vote Distribution Chart</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topParties.slice(0, 8).map(p => ({
              party: p.party.toUpperCase(),
              votes: p.votes,
              fill: PARTY_COLORS[p.party.toUpperCase()] || PARTY_COLORS.default,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
              <XAxis dataKey="party" tick={{ fontSize: 11, fill: chartTheme.textColor }} />
              <YAxis tick={{ fontSize: 10, fill: chartTheme.textColor }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1f2e",
                  border: "1px solid #2d3548",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(val: number | undefined) => [formatNumber(val ?? 0), "Votes"]}
              />
              <Bar dataKey="votes" radius={[4, 4, 0, 0]}>
                {topParties.slice(0, 8).map((p, i) => (
                  <Cell
                    key={p.party}
                    fill={PARTY_COLORS[p.party.toUpperCase()] || PARTY_COLORS.default}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Ward-Level Results Map */}
      {ward_results.length > 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold">Ward-Level Results</h3>
            <select
              value={lgaFilter}
              onChange={e => setLgaFilter(e.target.value)}
              className="text-[11px] bg-dashboard-border rounded-lg px-2 py-1 text-primary border-0 outline-none"
            >
              <option value="all">All Area Councils</option>
              {lgaNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {filteredWards.map((w) => {
              const color = PARTY_COLORS[w.leading_party?.toUpperCase()] || PARTY_COLORS.default;
              return (
                <div
                  key={`${w.lga_name}-${w.ward_name}`}
                  className="rounded-lg p-3 border border-dashboard-border text-center"
                  style={{ backgroundColor: `${color}12` }}
                >
                  <p className="text-[10px] text-dim font-semibold truncate">
                    {w.ward_name}
                  </p>
                  <p className="text-[9px] text-dim truncate">{w.lga_name}</p>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[13px] font-extrabold" style={{ color }}>
                      {w.leading_party?.toUpperCase() || "—"}
                    </span>
                  </div>
                  <p className="text-[9px] text-dim mt-0.5 tabular-nums">
                    {formatNumber(w.leading_votes)} votes
                  </p>
                  <p className="text-[8px] text-dim">
                    {w.pu_count} PU{w.pu_count !== 1 ? "s" : ""} · {w.turnout_pct}% turnout
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No data state */}
      {topParties.length === 0 && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-8 text-center">
          <div className="text-dim text-4xl mb-3">📊</div>
          <h3 className="text-sm font-bold mb-1">Waiting for Vote Data</h3>
          <p className="text-[12px] text-dim max-w-md mx-auto">
            Live vote results from INEC IReV will appear here as polling units
            submit their results. The dashboard refreshes automatically every 30 seconds.
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  PROGRESS TAB (original upload analytics)
// ═══════════════════════════════════════════════════════════════════
function ProgressTab({
  projection,
  projectionErr,
  trends,
  timeline,
  partyData,
}: {
  projection: TurnoutProjection | undefined;
  projectionErr: boolean;
  trends: TrendsData | undefined;
  timeline: TimelineEntry[] | undefined;
  partyData: PartyAnalysis | undefined;
}) {
  const chartTheme = useChartTheme();
  const mergedTimeline = useMemo(() => {
    const rev = [...(timeline || [])].reverse();
    const chairTimeline = rev
      .filter((d) => d.election_type === "CHAIRMAN")
      .map((d) => ({
        time: d.timestamp?.substring(11, 16) || "",
        pct: d.percentage,
      }));
    const councilTimeline = rev
      .filter((d) => d.election_type === "COUNCILLOR")
      .map((d) => ({
        time: d.timestamp?.substring(11, 16) || "",
        pct: d.percentage,
      }));
    const maxLen = Math.max(chairTimeline.length, councilTimeline.length);
    return Array.from({ length: maxLen }, (_, i) => ({
      time: (chairTimeline[i] || councilTimeline[i])?.time || "",
      chairman: chairTimeline[i]?.pct ?? null,
      councillor: councilTimeline[i]?.pct ?? null,
    }));
  }, [timeline]);

  const lgaComparison = useMemo(
    () =>
      (trends?.lga_ranking || []).map((l) => ({
        name: l.lga_name,
        pct: l.pct || 0,
      })),
    [trends]
  );

  const partyChartData = useMemo(
    () =>
      (partyData?.by_party || []).map((p) => ({
        name: p.party_abbrev,
        value: p.count,
        color: PARTY_COLORS[p.party_abbrev] || PARTY_COLORS.default,
      })),
    [partyData]
  );

  const genderData = useMemo(
    () =>
      (partyData?.by_council || []).map((c) => ({
        name: c.area_council,
        Male: (c.total || 0) - (c.female || 0),
        Female: c.female || 0,
      })),
    [partyData]
  );

  return (
    <div className="space-y-5">
      {/* Turnout Projection Cards */}
      {projection ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProjectionCard
            title="Chairmanship Projection"
            rate={projection.chairman?.rate || 0}
            eta={projection.chairman?.eta}
            remaining={projection.chairman?.remaining || 0}
            pct={projection.chairman?.pct || 0}
            color="#10b981"
          />
          <ProjectionCard
            title="Councillorship Projection"
            rate={projection.councillor?.rate || 0}
            eta={projection.councillor?.eta}
            remaining={projection.councillor?.remaining || 0}
            pct={projection.councillor?.pct || 0}
            color="#3b82f6"
          />
        </div>
      ) : !projectionErr ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {/* Trend Momentum */}
      {trends && (
        <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-dim uppercase font-semibold">
              Momentum
            </span>
            <span
              className={`text-sm font-extrabold ${
                trends.momentum === "accelerating"
                  ? "text-accent-green"
                  : trends.momentum === "decelerating"
                  ? "text-accent-red"
                  : "text-accent-orange"
              }`}
            >
              {trends.momentum === "accelerating"
                ? "Accelerating"
                : trends.momentum === "decelerating"
                ? "Decelerating"
                : "Steady"}
            </span>
          </div>
          {trends.fastest_lga && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-dim uppercase font-semibold">
                Fastest LGA
              </span>
              <span className="text-sm font-bold text-accent-green">
                {trends.fastest_lga}
              </span>
            </div>
          )}
          {trends.slowest_lga && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-dim uppercase font-semibold">
                Slowest LGA
              </span>
              <span className="text-sm font-bold text-accent-red">
                {trends.slowest_lga}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartPanel title="Results Upload Timeline">
          {mergedTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={mergedTimeline}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartTheme.gridColor}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: chartTheme.textColor, fontSize: 11 }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: chartTheme.textColor, fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: chartTheme.tooltipBg,
                    border: `1px solid ${chartTheme.tooltipBorder}`,
                    borderRadius: 8,
                    color: chartTheme.tooltipText,
                  }}
                  labelStyle={{ color: chartTheme.tooltipText }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="chairman"
                  name="Chairmanship %"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="councillor"
                  name="Councillorship %"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-dim text-sm">
              Waiting for timeline data...
            </div>
          )}
        </ChartPanel>

        <ChartPanel title="LGA Results Comparison">
          {lgaComparison.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={lgaComparison}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartTheme.gridColor}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: chartTheme.textColor, fontSize: 11 }}
                />
                <YAxis tick={{ fill: chartTheme.textColor, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: chartTheme.tooltipBg,
                    border: `1px solid ${chartTheme.tooltipBorder}`,
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="pct" name="Progress %" radius={[6, 6, 0, 0]}>
                  {lgaComparison.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={pctColor(entry.pct)}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-dim text-sm">
              Waiting for LGA data...
            </div>
          )}
        </ChartPanel>

        <ChartPanel title="Party Candidate Distribution">
          {partyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={partyChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={2}
                >
                  {partyChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: chartTheme.tooltipBg,
                    border: `1px solid ${chartTheme.tooltipBorder}`,
                    borderRadius: 8,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: chartTheme.textColor }}
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-dim text-sm">
              Waiting for party data...
            </div>
          )}
        </ChartPanel>

        <ChartPanel title="Gender Analysis by Council">
          {genderData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={genderData} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartTheme.gridColor}
                />
                <XAxis
                  type="number"
                  tick={{ fill: chartTheme.textColor, fontSize: 11 }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: chartTheme.textColor, fontSize: 11 }}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    background: chartTheme.tooltipBg,
                    border: `1px solid ${chartTheme.tooltipBorder}`,
                    borderRadius: 8,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="Male"
                  stackId="a"
                  fill="rgba(59,130,246,0.7)"
                  radius={[0, 4, 4, 0]}
                />
                <Bar
                  dataKey="Female"
                  stackId="a"
                  fill="rgba(236,72,153,0.7)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-dim text-sm">
              Waiting for gender data...
            </div>
          )}
        </ChartPanel>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  HEATMAP TAB
// ═══════════════════════════════════════════════════════════════════
function HeatmapTab({ heatmap }: { heatmap: HeatmapData | undefined }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Ward-Level Results Heat Map</SectionTitle>
      <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
        {(heatmap?.lgas || []).length > 0 ? (
          <div className="space-y-4">
            {(heatmap?.lgas || []).map((lga) => {
              const lgaWards = (heatmap?.wards || []).filter(
                (w) => w.lga_name === lga.lga_name
              );
              return (
                <div key={lga.lga_name}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[13px] font-bold">{lga.lga_name}</h4>
                    <span
                      className="text-[12px] font-bold"
                      style={{ color: pctColor(lga.pct || 0) }}
                    >
                      {lga.pct || 0}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
                    {lgaWards.map((w, i) => (
                      <div
                        key={i}
                        className="rounded-lg p-2 text-center border border-dashboard-border"
                        style={{
                          backgroundColor: `${pctColor(w.pct || 0)}15`,
                        }}
                      >
                        <div className="text-[10px] font-semibold truncate">
                          {w.ward_name}
                        </div>
                        <div
                          className="text-[14px] font-extrabold mt-0.5"
                          style={{ color: pctColor(w.pct || 0) }}
                        >
                          {w.pct || 0}%
                        </div>
                        <div className="text-[9px] text-dim">
                          {w.results_uploaded}/{w.total_pus}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-dim py-8">
            No ward data available yet. Scraper is collecting...
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-extrabold flex items-center gap-2.5 tracking-tight section-title">
      {children}
      <span className="flex-1 h-px bg-dashboard-border" />
    </h2>
  );
}

function ChartPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <h3 className="text-sm font-bold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function StatMini({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-3 text-center">
      <p className="text-[10px] text-dim uppercase font-semibold mb-1">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums" style={{ color }}>
        {formatNumber(value)}
      </p>
    </div>
  );
}

function ProjectionCard({
  title,
  rate,
  eta,
  remaining,
  pct,
  color,
}: {
  title: string;
  rate: number;
  eta: string | null;
  remaining: number;
  pct: number;
  color: string;
}) {
  return (
    <div className="bg-dashboard-card border border-dashboard-border rounded-xl p-4">
      <h3 className="text-sm font-bold mb-3">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] text-dim uppercase font-semibold">
            Upload Rate
          </div>
          <div className="text-lg font-extrabold" style={{ color }}>
            {rate}
            <span className="text-[11px] text-dim font-normal">/min</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-dim uppercase font-semibold">
            ETA
          </div>
          <div className="text-lg font-extrabold" style={{ color }}>
            {eta || "--:--"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-dim uppercase font-semibold">
            Remaining
          </div>
          <div className="text-lg font-extrabold text-accent-orange">
            {formatNumber(remaining)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <MiniProgress pct={pct} height={6} />
      </div>
    </div>
  );
}
