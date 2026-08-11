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
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Feature, FeatureCollection } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { getPartyColor } from "@/lib/constants";

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
  /** "election" colours LGAs by winning party; "cbm" by CBM member density. */
  source?: "election" | "cbm";
}

interface CbmLga {
  name: string;
  members: number;
  wardsWithLeader: number;
  hasLgaDirector: boolean;
}

const CBM_API = process.env.NEXT_PUBLIC_CBM_API || "https://cbmnigeria.org";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Green intensity ramp for CBM member density (mirrors NigeriaLeafletMap).
function metricColor(value: number, max: number): string {
  if (max === 0 || value === 0) return "#1f2538";
  const t = Math.min(1, value / max);
  return `rgb(${Math.round(16 + t * 16)}, ${Math.round(70 + t * 110)}, ${Math.round(40 + t * 50)})`;
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
    const fill = row?.winner_party ? getPartyColor(row.winner_party) : liveRef.current ? "#78350f" : "#1f2538";
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
  }, [selectedLga, byLga, live, cbmByLga, cbm]);

  const onEachLga = (feature: Feature, layer: L.Layer) => {
    const name = (feature.properties as { name: string }).name;
    const tip = () => {
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
        return (
          `<div style="font-weight:700">${name}</div>` +
          `<div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${getPartyColor(row.winner_party)};margin-right:5px"></span>${row.winner_party} leading</div>` +
          `<div style="opacity:.7;font-size:11px">${row.total_votes.toLocaleString()} votes</div>`
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
            {cbm ? (
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
