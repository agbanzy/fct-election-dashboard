export interface AreaCouncil {
  name: string;
  total_wards: number;
  polling_units: number;
  registered_voters: string;
  chairmanship_candidates: number;
  councillorship_positions: number;
}

export interface Election {
  id: string;
  full_name: string;
  election_type: "CHAIRMAN" | "COUNCILLOR";
  election_date: string;
  domain_name: string;
  total_pus: number;
  total_results: number;
  pct: number;
}

export interface ElectionStats {
  total_pus: number;
  results_uploaded: number;
  percentage: number;
}

export interface ScraperStatus {
  last_scrape: string | null;
  status: "idle" | "scraping" | "error";
  error: string | null;
  scrape_count: number;
  message: string;
}

export interface OverviewResponse {
  area_councils: AreaCouncil[];
  elections: Election[];
  stats: { CHAIRMAN: ElectionStats; COUNCILLOR: ElectionStats };
  scraper: ScraperStatus;
}

export interface LGABreakdownItem {
  lga_name: string;
  elections: {
    CHAIRMAN: ElectionStats;
  };
}

export interface LGABreakdownResponse {
  lga_data: LGABreakdownItem[];
  councillorship_summary: {
    total_wards: number;
    total_pus: number;
    total_results: number;
    percentage: number;
  };
}

export interface Ward {
  ward_name: string;
  total_pus: number;
  results_uploaded: number;
  lga_name: string;
  election_type: string;
}

export interface Candidate {
  id: number;
  area_council: string;
  candidate_name: string;
  party_full: string;
  party_abbrev: string;
  status: string;
  gender: string;
  notes: string;
  position_type: string;
}

export interface CouncillorshipElection {
  id: string;
  ward_name: string;
  total_pus: number;
  total_results: number;
  pct: number;
}

export interface TimelineEntry {
  timestamp: string;
  election_type: string;
  total_pus: number;
  results_uploaded: number;
  percentage: number;
  breakdown: Record<string, { pus: number; results: number; pct: number }>;
}

export interface RecentResult {
  pu_name: string;
  pu_code: string;
  lga_name: string;
  ward_name: string;
  has_result: number;
  document_url: string;
  result_uploaded_at: string;
}

export interface PartyAnalysis {
  by_party: {
    party_abbrev: string;
    party_full: string;
    count: number;
    female: number;
    male: number;
    withdrawn: number;
  }[];
  by_council: {
    area_council: string;
    total: number;
    parties: number;
    female: number;
  }[];
}

export interface TurnoutProjection {
  chairman: { rate: number; eta: string | null; remaining: number; pct: number };
  councillor: { rate: number; eta: string | null; remaining: number; pct: number };
  velocity_history: { time: string; rate: number; type: string }[];
}

export interface TrendsData {
  hourly_rates: { hour: string; type: string; uploads: number; pct: number }[];
  fastest_lga: string | null;
  slowest_lga: string | null;
  lga_ranking: { lga_name: string; pct: number }[];
  momentum: "accelerating" | "steady" | "decelerating";
}

export interface HeatmapData {
  wards: { ward_name: string; lga_name: string; total_pus: number; results_uploaded: number; pct: number }[];
  lgas: { lga_name: string; total_pus: number; results_uploaded: number; pct: number }[];
}

export interface MessagingStats {
  sent: number;
  failed: number;
  total_agents: number;
  pending: number;
  sent_numbers: string[];
  failed_numbers: string[];
}

// ─── Party Race Analytics Types ─────────────────────────────────
export interface PartyStanding {
  party: string;
  party_full: string;
  total_candidates: number;
  chairmanship: number;
  councillorship: number;
  councils_present: number;
  councils_total: number;
  coverage_pct: number;
  female: number;
  male: number;
  strength_index: number;
}

export interface ChairmanshipContender {
  candidate_name: string;
  party: string;
  party_full: string;
  gender: string;
}

export interface ChairmanshipRace {
  area_council: string;
  total_candidates: number;
  candidates: ChairmanshipContender[];
  major_parties: number;
  is_competitive: boolean;
  parties: string[];
}

export interface HeadToHead {
  area_council: string;
  contenders: ChairmanshipContender[];
  total_in_race: number;
}

export interface GenderScorecard {
  total_active: number;
  female: number;
  male: number;
  female_pct: number;
  by_position: {
    chairmanship: { female: number; male: number; total: number };
    councillorship: { female: number; male: number; total: number };
  };
}

// ─── Live Vote Results Types (from INEC API structured data) ─────
export interface LivePuResult {
  pu_code: string;
  pu_name: string;
  ward_name: string;
  lga_name: string;
  registered_voters: number;
  accredited_voters: number;
  total_valid_votes: number;
  total_rejected_votes: number;
  party_votes: Record<string, number>;
}

export interface LiveWardResult {
  ward_name: string;
  lga_name: string;
  pu_count: number;
  total_valid: number;
  total_registered: number;
  total_accredited: number;
  party_votes: Record<string, number>;
  leading_party: string;
  leading_votes: number;
  turnout_pct: number;
}

export interface LiveLGAResult {
  lga_name: string;
  pu_count: number;
  total_valid: number;
  total_registered: number;
  total_accredited: number;
  party_votes: Record<string, number>;
  leading_party: string;
  leading_votes: number;
  turnout_pct: number;
  top3: { party: string; votes: number }[];
}

export interface LiveResultsData {
  pu_results: LivePuResult[];
  party_standings: { party: string; votes: number }[];
  ward_results: LiveWardResult[];
  lga_results: LiveLGAResult[];
  summary: {
    total_registered: number;
    total_accredited: number;
    total_valid: number;
    total_rejected: number;
    pus_with_votes: number;
    pus_with_results: number;
    total_pus: number;
    coverage_pct: number;
    data_source: string;
  };
}

// ─── Chairmanship Race Types (Live vote + candidate data) ────────
export interface CandidateResult {
  candidate_name: string;
  party: string;
  party_full: string;
  votes: number;
  vote_pct: number;
  status: string;
  gender: string;
  notes: string;
}

export interface ChairmanshipRaceResult {
  area_council: string;
  candidates: CandidateResult[];
  total_pus_counted: number;
  total_valid_votes: number;
  total_registered: number;
  total_accredited: number;
  turnout_pct: number;
  margin: number;
  winner: CandidateResult | null;
}

export interface ChairmanshipRaceResponse {
  races: ChairmanshipRaceResult[];
  total_councils: number;
  councils_with_data: number;
}

// ─── Councillorship Race Types (ward-level live vote data) ──────
export interface CouncillorCandidate {
  party: string;
  votes: number;
  vote_pct: number;
}

export interface CouncillorshipWardRace {
  ward_name: string;
  lga_name: string;
  area_council: string;
  candidates: CouncillorCandidate[];
  total_pus_in_ward: number;
  pus_counted: number;
  coverage_pct: number;
  total_valid_votes: number;
  total_registered: number;
  total_accredited: number;
  total_rejected: number;
  turnout_pct: number;
  margin: number;
  leading_party: string | null;
}

export interface CouncillorshipCouncilSummary {
  area_council: string;
  total_wards: number;
  wards_with_data: number;
  total_valid: number;
  total_pus: number;
  pus_counted: number;
  party_leads: Record<string, number>;
}

export interface CouncillorshipRaceResponse {
  races: CouncillorshipWardRace[];
  party_standings: { party: string; votes: number; wards_leading: number }[];
  council_summary: CouncillorshipCouncilSummary[];
  total_wards: number;
  wards_with_data: number;
  total_councillor_elections: number;
}

// Keep legacy OCR types for backward compatibility
export type OCRPuResult = LivePuResult;
export type OCRWardResult = LiveWardResult;
export type OCRResultsData = LiveResultsData;

export interface PartyRaceData {
  party_standings: PartyStanding[];
  chairmanship_races: ChairmanshipRace[];
  councillor_spread: { party: string; count: number }[];
  head_to_head: HeadToHead[];
  gender_scorecard: GenderScorecard;
  withdrawn_count: number;
  total_candidates: number;
  active_candidates: number;
  election_progress: {
    election_type: string;
    domain_name: string;
    total_pus: number;
    total_results: number;
    pct: number;
  }[];
}
