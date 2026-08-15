"use client";

/**
 * State drill-down map (SVG via Leaflet vector paths). Renders a state's LGAs
 * from /maps/<code>-lgas.geojson; clicking an LGA zooms in and reveals that
 * LGA's wards from /maps/<code>-wards.geojson. LGAs/wards are coloured by the
 * winning party for the selected election when results exist, otherwise shown
 * in a neutral "pending" tone (live elections have forms but no tally yet).
 *
 * Geometry properties are normalised by backend/tools/build_state_geojson.py to
 * { name, state } (LGAs) and { name, lga, state } (wards), so the join here is
 * a simple normalised-name match against the API's by-lga standings.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { PartyLegend, RampLegend } from "@/components/shared/MapLegend";
import { getPartyColor, getPartyName, MAP_STATE_COLORS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

interface Standing {
  party_code: string;
  candidate: string | null;
  votes: number;
  share: number;
}
interface LgaRow {
  lga_id: number;
  lga_name: string;
  total_votes: number;
  winner_party: string | null;
  standings: Standing[];
}
interface ByLgaResp {
  election: { election_id: number; type: string; cycle: number } | null;
  by_lga: LgaRow[];
}

interface Props {
  stateCode: string;
  stateName: string;
  electionId?: number | null;
  /** When true, render the "LIVE — counting" treatment for LGAs without a tally. */
  live?: boolean;
  /**
   * "election" colours LGAs by winning party, "reporting" by share of polling
   * units whose result sheet is published, "cbm" by CBM member density.
   */
  source?: "election" | "reporting" | "cbm";
}

interface ReportingRow {
  lga_id: number;
  lga_name: string;
  expected_pus: number;
  reported_pus: number;
  pct: number | null;
}

interface CbmLga {
  name: string;
  members: number;
  wardsWithLeader: number;
  hasLgaDirector: boolean;
}

const CBM_API = process.env.NEXT_PUBLIC_CBM_API || "https://cbmnigeria.org";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Sequential ramp for CBM member density: one hue, dark→light, so magnitude
// reads as intensity. Exposed as colorAt(t) so the legend and the map draw
// from the same function and cannot drift apart.
export function densityColorAt(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(16 + c * 16)}, ${Math.round(70 + c * 110)}, ${Math.round(40 + c * 50)})`;
}

function metricColor(value: number, max: number): string {
  if (max === 0 || value === 0) return MAP_STATE_COLORS.noData;
  return densityColorAt(value / max);
}

/**
 * Reporting-progress ramp — one hue, monotone lightness, so "more reported"
 * reads as "brighter". A party palette here would be a lie: these are result
 * sheets published, not votes.
 *
 * Built in OKLCH at a fixed hue (210°) rather than interpolated in RGB, which
 * drifted 77° across the ramp and made it a two-hue gradient. The teal is
 * deliberately outside every party hue so a reporting map can't be misread as
 * a party map, and the dark end clears the map surface at 2.25:1 so 0%
 * reported stays distinguishable from an LGA the scraper hasn't reached.
 */
const REPORTING_RAMP = ["#055762", "#0d7583", "#2293a3", "#35b2c5", "#47d2e8"];

export function reportingColorAt(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const pos = c * (REPORTING_RAMP.length - 1);
  const i = Math.min(REPORTING_RAMP.length - 2, Math.floor(pos));
  const f = pos - i;
  const [a, b] = [REPORTING_RAMP[i], REPORTING_RAMP[i + 1]].map((h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]);
  // Short interpolation between validated steps keeps the ramp continuous
  // without re-introducing the hue drift of a full-range RGB blend.
  const mix = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function FitTo({ feature }: { feature: Feature | null }) {
  const map = useMap();
  useEffect(() => {
    const target = feature
      ? L.geoJSON(feature).getBounds()
      : null;
    if (target && target.isValid()) {
      map.flyToBounds(target, { padding: [30, 30], maxZoom: 11, duration: 0.6 });
    }
  }, [feature, map]);
  return null;
}

export default function StateDrillMap({ stateCode, stateName, electionId, live, source = "election" }: Props) {
  const code = stateCode.toLowerCase();
  const cbm = source === "cbm";
  const reporting = source === "reporting";
  const [reportByLga, setReportByLga] = useState<Record<string, ReportingRow>>({});
  const reportRef = useRef(reportByLga);
  reportRef.current = reportByLga;
  const reportModeRef = useRef(reporting);
  reportModeRef.current = reporting;
  const [lgas, setLgas] = useState<FeatureCollection | null>(null);
  const [wards, setWards] = useState<FeatureCollection | null>(null);
  const [missing, setMissing] = useState(false);
  const [byLga, setByLga] = useState<Record<string, LgaRow>>({});
  // CBM member density per LGA (norm(name) → row), for the "CBM coverage" source.
  const [cbmByLga, setCbmByLga] = useState<Record<string, CbmLga>>({});
  const cbmMax = useMemo(() => Math.max(0, ...Object.values(cbmByLga).map((r) => r.members)), [cbmByLga]);
  const cbmRef = useRef(cbmByLga);
  cbmRef.current = cbmByLga;
  const cbmMaxRef = useRef(cbmMax);
  cbmMaxRef.current = cbmMax;
  const cbmModeRef = useRef(cbm);
  cbmModeRef.current = cbm;
  const [selectedLga, setSelectedLga] = useState<string | null>(null); // normalised name
  const lgaRef = useRef<L.GeoJSON | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = selectedLga;
  // The Leaflet onEachFeature handlers are bound once at mount, so reads of
  // live/byLga inside them would be stale (live starts false until the
  // elections API resolves). Route those reads through refs kept current.
  const liveRef = useRef(live);
  liveRef.current = live;
  const byLgaRef = useRef(byLga);
  byLgaRef.current = byLga;

  // Geometry
  useEffect(() => {
    let ok = true;
    fetch(`/maps/${code}-lgas.geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("404"))))
      .then((d) => ok && setLgas(d))
      .catch(() => ok && setMissing(true));
    fetch(`/maps/${code}-wards.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => ok && d && setWards(d))
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, [code]);

  // Results (per-LGA standings) for the selected election
  useEffect(() => {
    if (!electionId) {
      setByLga({});
      return;
    }
    let ok = true;
    fetch(`/api/elections/${electionId}/by-lga`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ByLgaResp | null) => {
        if (!ok || !d) return;
        const m: Record<string, LgaRow> = {};
        for (const row of d.by_lga || []) m[norm(row.lga_name)] = row;
        setByLga(m);
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, [electionId]);

  // Reporting progress per LGA for the selected election.
  useEffect(() => {
    if (!reporting || !electionId) {
      setReportByLga({});
      return;
    }
    let ok = true;
    const load = () =>
      fetch(`/api/elections/${electionId}/reporting-by-lga`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { by_lga?: ReportingRow[] } | null) => {
          if (!ok || !d) return;
          const m: Record<string, ReportingRow> = {};
          for (const row of d.by_lga || []) m[norm(row.lga_name)] = row;
          setReportByLga(m);
        })
        .catch(() => {});
    load();
    // Forms land continuously on election night; keep the map moving.
    const iv = setInterval(load, 60_000);
    return () => {
      ok = false;
      clearInterval(iv);
    };
  }, [reporting, electionId]);

  // CBM coverage per LGA (member density) for the selected state.
  useEffect(() => {
    if (!cbm) {
      setCbmByLga({});
      return;
    }
    let ok = true;
    fetch(`${CBM_API}/api/coverage/state/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ok || !d) return;
        const m: Record<string, CbmLga> = {};
        for (const row of d.data || []) m[norm(row.name)] = row;
        setCbmByLga(m);
      })
      .catch(() => {});
    return () => {
      ok = false;
    };
  }, [cbm, code]);

  const lgaStyle = (name: string): L.PathOptions => {
    if (reportModeRef.current) {
      const r = reportRef.current[norm(name)];
      const sel = selRef.current;
      const isSel = sel === norm(name);
      const dimmed = sel !== null && !isSel;
      return {
        fillColor: r?.pct != null ? reportingColorAt(r.pct) : MAP_STATE_COLORS.noData,
        color: isSel ? "#10b981" : "#0c1226",
        weight: isSel ? 3 : 1.2,
        fillOpacity: dimmed ? 0.25 : 0.85,
      };
    }
    if (cbmModeRef.current) {
      const c = cbmRef.current[norm(name)];
      const fill = metricColor(c?.members || 0, cbmMaxRef.current);
      const sel = selRef.current;
      const isSel = sel === norm(name);
      const dimmed = sel !== null && !isSel;
      return {
        fillColor: fill,
        color: isSel ? "#10b981" : "#0c1226",
        weight: isSel ? 3 : 1.2,
        fillOpacity: dimmed ? 0.25 : 0.85,
      };
    }
    const row = byLgaRef.current[norm(name)];
    const fill = row?.winner_party
      ? getPartyColor(row.winner_party)
      : liveRef.current
        ? MAP_STATE_COLORS.counting
        : MAP_STATE_COLORS.noData;
    const sel = selRef.current;
    const isSel = sel === norm(name);
    const dimmed = sel !== null && !isSel;
    return {
      fillColor: fill,
      color: isSel ? "#10b981" : liveRef.current && !row ? "#f59e0b" : "#0c1226",
      weight: isSel ? 3 : 1.2,
      fillOpacity: dimmed ? 0.25 : 0.85,
    };
  };

  // Re-style on selection / results change
  useEffect(() => {
    lgaRef.current?.setStyle((f) => lgaStyle(((f as Feature).properties as { name: string }).name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLga, byLga, live, cbmByLga, cbm, reportByLga, reporting]);

  const onEachLga = (feature: Feature, layer: L.Layer) => {
    const name = (feature.properties as { name: string }).name;

    const tip = () => {
      if (reportModeRef.current) {
        const r = reportRef.current[norm(name)];
        if (!r || r.pct === null) {
          return (
            `<div style="font-weight:700">${name}</div>` +
            `<div style="opacity:.6">Not yet walked by the scraper</div>`
          );
        }
        return (
          `<div style="font-weight:700">${name}</div>` +
          `<div style="font-size:12px"><b>${(r.pct * 100).toFixed(1)}%</b> of polling units reported</div>` +
          `<div style="opacity:.65;font-size:11px">${formatNumber(r.reported_pus)} of ${formatNumber(r.expected_pus)} result sheets</div>`
        );
      }
      if (cbmModeRef.current) {
        const c = cbmRef.current[norm(name)];
        return (
          `<div style="font-weight:700">${name}</div>` +
          `<div style="opacity:.85">${(c?.members || 0).toLocaleString()} CBM members</div>` +
          `<div style="opacity:.6;font-size:11px">${c?.wardsWithLeader || 0} wards with a leader${c?.hasLgaDirector ? " · LGA director ✓" : ""}</div>`
        );
      }
      const row = byLgaRef.current[norm(name)];
      if (row?.winner_party) {
        const top = row.standings.slice(0, 3);
        return (
          `<div style="font-weight:700">${name}</div>` +
          `<div style="opacity:.75;font-size:11px;margin-bottom:4px">${getPartyName(row.winner_party)} leading</div>` +
          top
            .map(
              (s) =>
                `<div style="display:flex;align-items:center;gap:5px;font-size:11px">` +
                `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${getPartyColor(s.party_code)}"></span>` +
                `<span style="font-weight:700">${s.party_code}</span>` +
                `<span style="margin-left:auto;opacity:.8">${formatNumber(s.votes)}</span>` +
                `<span style="opacity:.6;width:42px;text-align:right">${(s.share * 100).toFixed(1)}%</span>` +
                `</div>`,
            )
            .join("") +
          `<div style="opacity:.55;font-size:10px;margin-top:4px">${formatNumber(row.total_votes)} votes counted</div>`
        );
      }
      const lv = liveRef.current;
      return `<div style="font-weight:700">${name}</div><div style="${lv ? "color:#f59e0b;font-weight:600" : "opacity:.6"}">${lv ? "● LIVE — counting" : "No tally yet"}</div>`;
    };
    if ("bindTooltip" in layer) {
      // Pass the function (not its result) so Leaflet re-evaluates it on open,
      // picking up current live/results state instead of mount-time values.
      (layer as L.GeoJSON).bindTooltip(() => tip(), { sticky: true, className: "ng-map-tip", direction: "top" });
    }
    if ("on" in layer) {
      layer.on({
        click: () => setSelectedLga((p) => (p === norm(name) ? null : norm(name))),
        mouseover: (e) => {
          (e.target as L.Path).setStyle({ weight: 3, color: "#34d399" });
          (e.target as L.Path).bringToFront();
        },
        mouseout: (e) => (e.target as L.Path).setStyle(lgaStyle(name)),
      });
    }
  };

  const selectedFeature = useMemo(() => {
    if (!lgas || !selectedLga) return null;
    return (lgas.features as Feature[]).find((f) => norm((f.properties as { name: string }).name) === selectedLga) || null;
  }, [lgas, selectedLga]);

  // Wards belonging to the selected LGA
  const selectedWards = useMemo<FeatureCollection | null>(() => {
    if (!wards || !selectedLga) return null;
    const feats = (wards.features as Feature[]).filter(
      (f) => norm((f.properties as { lga?: string }).lga || "") === selectedLga,
    );
    return { type: "FeatureCollection", features: feats };
  }, [wards, selectedLga]);

  // Direct labels — the accessible channel for winner identity.
  //
  // Colour cannot carry it: PDP red against LP green is the deuteranopia
  // collision and both are fixed party identities, so the winning code is
  // written onto each LGA. Rendered as their own marker layer because a
  // Leaflet layer holds a single tooltip and the polygons already use theirs
  // for the hover card.
  const lgaLabels = useMemo(() => {
    // Party codes only — a reporting or density map has no winner to name.
    if (cbm || reporting || !lgas) return [];
    return (lgas.features as Feature[])
      .map((f) => {
        const name = (f.properties as { name: string }).name;
        const row = byLga[norm(name)];
        if (!row?.winner_party) return null;
        const c = L.geoJSON(f).getBounds().getCenter();
        return { name, party: row.winner_party, lat: c.lat, lng: c.lng };
      })
      .filter((x): x is { name: string; party: string; lat: number; lng: number } => x !== null);
  }, [lgas, byLga, cbm, reporting]);

  // State-wide roll-up for the legend: which parties are on this map, how many
  // LGAs each leads, and their vote totals.
  const legendParties = useMemo(() => {
    const acc: Record<string, { party: string; lgas: number; votes: number }> = {};
    for (const row of Object.values(byLga)) {
      if (!row.winner_party) continue;
      const e = (acc[row.winner_party] ||= { party: row.winner_party, lgas: 0, votes: 0 });
      e.lgas += 1;
      e.votes += row.standings.find((s) => s.party_code === row.winner_party)?.votes ?? 0;
    }
    return Object.values(acc).sort((a, b) => b.lgas - a.lgas || b.votes - a.votes);
  }, [byLga]);

  const totalLgaFeatures = (lgas?.features as Feature[] | undefined)?.length ?? 0;
  const hasUntallied = totalLgaFeatures > legendParties.reduce((n, p) => n + p.lgas, 0);

  const selectedRow = selectedLga ? byLga[selectedLga] : undefined;
  const selectedCbm = selectedLga && cbm ? cbmByLga[selectedLga] : undefined;
  const selectedName = selectedFeature
    ? (selectedFeature.properties as { name: string }).name
    : null;

  if (missing) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-6 text-center text-sm text-dim">
        SVG boundary map for {stateName} is not available yet.
      </div>
    );
  }
  if (!lgas) {
    return (
      <div className="rounded-lg border border-dashboard-border bg-dashboard-card p-8 text-center text-sm text-dim">
        Loading {stateName} map…
      </div>
    );
  }

  const center = L.geoJSON(lgas).getBounds().getCenter();

  return (
    <div className="rounded-lg border border-dashboard-border bg-dashboard-card overflow-hidden">
      <div className="px-4 py-2 border-b border-dashboard-border flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-primary">
          {stateName} · {wards ? "LGAs & wards" : "LGAs"}
          {live && <span className="ml-2 text-[11px] font-extrabold text-accent-red">● LIVE</span>}
        </h3>
        <span className="text-[10px] text-dim">
          {selectedLga ? "click LGA again to zoom out" : "click an LGA to see its wards"}
        </span>
      </div>

      <div className="relative">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={9}
          style={{ height: 520, width: "100%", background: "#0c1226" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO &copy; geoBoundaries"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <GeoJSON
            key="lgas"
            ref={lgaRef}
            data={lgas}
            style={(f) => lgaStyle(((f as Feature).properties as { name: string }).name)}
            onEachFeature={onEachLga}
          />
          {/* Winner codes drawn onto each LGA — see lgaLabels. */}
          {lgaLabels.map((l) => (
            <Marker
              key={`label-${l.name}`}
              position={[l.lat, l.lng]}
              interactive={false}
              icon={L.divIcon({
                className: "ng-map-label",
                html: `<span>${l.party}</span>`,
                iconSize: [40, 14],
                iconAnchor: [20, 7],
              })}
            />
          ))}

          {selectedWards && selectedWards.features.length > 0 && (
            <GeoJSON
              key={`wards-${selectedLga}`}
              data={selectedWards}
              style={{ fillColor: "#10b981", fillOpacity: 0.12, color: "#34d399", weight: 1, dashArray: "2 3" }}
              onEachFeature={(f, layer) => {
                const wn = (f.properties as { name: string }).name;
                if ("bindTooltip" in layer) {
                  (layer as L.GeoJSON).bindTooltip(`<div style="font-weight:600">${wn}</div><div style="opacity:.6;font-size:11px">Ward</div>`, {
                    sticky: true,
                    className: "ng-map-tip",
                    direction: "top",
                  });
                }
              }}
            />
          )}
          <FitTo feature={selectedFeature} />
        </MapContainer>

        {/* The key the map never had. */}
        <div className="absolute bottom-3 left-3 z-[1000] max-w-[calc(100%-1.5rem)] rounded-lg border border-dashboard-border bg-dashboard-card/95 backdrop-blur px-3 py-2">
          {reporting ? (
            <RampLegend
              label="Polling units reported"
              max={100}
              colorAt={reportingColorAt}
              unit="%"
            />
          ) : cbm ? (
            <RampLegend
              label="CBM members"
              max={cbmMax}
              colorAt={densityColorAt}
              unit="per LGA"
            />
          ) : (
            <PartyLegend
              parties={legendParties}
              live={live}
              hasUntallied={hasUntallied}
            />
          )}
        </div>

        {selectedName && (
          <div className="absolute top-3 right-3 z-[1000] w-[240px] max-w-[calc(100%-1.5rem)] rounded-xl border border-dashboard-border bg-dashboard-card/95 backdrop-blur shadow-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-base font-extrabold text-primary leading-tight">{selectedName}</div>
              <button
                onClick={() => setSelectedLga(null)}
                className="text-dim hover:text-primary text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="text-[11px] text-dim mt-0.5">
              {selectedWards?.features.length ?? 0} wards
            </div>
            {reporting ? (
              (() => {
                const r = selectedLga ? reportByLga[selectedLga] : undefined;
                if (!r || r.pct === null) {
                  return (
                    <div className="mt-3 text-[12px] text-dim">
                      The scraper has not walked this LGA yet.
                    </div>
                  );
                }
                return (
                  <div className="mt-3 space-y-2">
                    <div className="text-2xl font-extrabold text-primary">
                      {(r.pct * 100).toFixed(1)}
                      <span className="ml-1 text-xs font-normal text-dim">
                        % reported
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
                      <div
                        className="h-full transition-[width] duration-700"
                        style={{
                          width: `${r.pct * 100}%`,
                          background: reportingColorAt(r.pct),
                        }}
                      />
                    </div>
                    <div className="text-[12px] text-dim">
                      {formatNumber(r.reported_pus)} of {formatNumber(r.expected_pus)}{" "}
                      result sheets published
                    </div>
                    <div className="text-[10px] text-dim/70">
                      Sheets published, not votes counted.
                    </div>
                  </div>
                );
              })()
            ) : cbm ? (
              <div className="mt-3 space-y-2">
                <div className="text-2xl font-extrabold text-primary">
                  {(selectedCbm?.members || 0).toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-dim">CBM members</span>
                </div>
                <div className="text-[12px] text-dim">
                  {selectedCbm?.wardsWithLeader || 0} wards with a ward leader
                  {selectedCbm?.hasLgaDirector ? " · LGA director in place" : " · no LGA director"}
                </div>
                <a
                  href={`https://cbmnigeria.org/structure`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-bold text-accent-green underline hover:no-underline"
                >
                  View grassroots structure →
                </a>
              </div>
            ) : selectedRow?.standings?.length ? (
              <div className="mt-3 space-y-1.5">
                {selectedRow.standings.slice(0, 5).map((s) => (
                  <div key={s.party_code} className="flex items-center gap-2 text-[12px]">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: getPartyColor(s.party_code) }} />
                    <span className="font-bold text-primary">{s.party_code}</span>
                    <span className="ml-auto font-mono text-dim">{s.votes.toLocaleString()}</span>
                    <span className="font-mono text-[11px] text-dim w-12 text-right">{(s.share * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-accent-orange">
                {live ? "● Live — results pending" : "No tally entered for this LGA yet."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
