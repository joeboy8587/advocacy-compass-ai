import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

export type MapFilter = "all" | "low" | "masked" | "kcso" | "military";

export type MapContact = {
  icao_hex: string;
  registration: string | null;
  callsign: string | null;
  operator: string | null;
  aircraft_model: string | null;
  county: string | null;
  points: number;
  min_alt: number | null;
  last_seen: string;
  kcso: boolean;
  military: boolean;
  masked: boolean;
  low_alt: boolean;
  track: Array<{ lat: number; lon: number; alt: number | null; t: string }>;
};

export type MapZone = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_km: number;
  kind: "corridor" | "convergence";
  aircraft: number | null;
  detected_at: string | null;
};

export type AirspaceMap = {
  window_hours: number;
  anchor: string | null;
  bbox: { min_lat: number; max_lat: number; min_lon: number; max_lon: number } | null;
  contacts: MapContact[];
  zones: MapZone[];
  total_contacts: number;
};

const FILTER_SQL: Record<MapFilter, string> = {
  all: "TRUE",
  low: "d.altitude_ft IS NOT NULL AND d.altitude_ft < 500 AND d.on_ground IS NOT TRUE",
  masked: "(d.registration IS NULL OR d.registration = '' OR d.callsign IS NULL OR d.callsign = '')",
  kcso: "lower(d.icao_hex) IN (SELECT lower(icao_hex) FROM canonical_operator_profiles WHERE kcso_flag)",
  military: "d.is_military IS TRUE",
};

/**
 * The tactical layer. Everything is anchored to MAX(captured_at) so a paused
 * ingest shows the last real airspace picture instead of an empty map.
 */
export const getAirspaceMap = createServerFn({ method: "GET" })
  .inputValidator((d: { hours?: number; filter?: MapFilter; limit?: number }) => ({
    hours: Math.min(Math.max(d?.hours ?? 6, 1), 168),
    filter: (d?.filter ?? "all") as MapFilter,
    limit: Math.min(Math.max(d?.limit ?? 70, 10), 150),
  }))
  .handler(async ({ data }): Promise<AirspaceMap> => {
    const cond = FILTER_SQL[data.filter] ?? "TRUE";

    const summary = await q<{
      icao_hex: string;
      registration: string | null;
      callsign: string | null;
      county: string | null;
      points: number;
      min_alt: number | null;
      last_seen: string;
      military: boolean | null;
      anchor: string | null;
      total: number;
    }>(
      `WITH mx AS (SELECT max(captured_at) AS m FROM detections),
       win AS (SELECT m AS hi, m - ($1 || ' hours')::interval AS lo FROM mx),
       f AS (
         SELECT d.* FROM detections d, win w
         WHERE d.captured_at BETWEEN w.lo AND w.hi
           AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
           AND (${cond})
       ),
       agg AS (
         SELECT icao_hex,
                max(registration) AS registration,
                max(callsign) AS callsign,
                max(county) AS county,
                count(*)::int AS points,
                min(altitude_ft) AS min_alt,
                max(captured_at) AS last_seen,
                bool_or(is_military) AS military
         FROM f GROUP BY icao_hex
       )
       SELECT a.*, (SELECT hi FROM win) AS anchor, (SELECT count(*)::int FROM agg) AS total
       FROM agg a ORDER BY a.points DESC LIMIT $2`,
      [String(data.hours), data.limit],
    );

    if (summary.length === 0) {
      return { window_hours: data.hours, anchor: null, bbox: null, contacts: [], zones: [], total_contacts: 0 };
    }

    const icaos = summary.map((r) => r.icao_hex);

    const [tracks, profiles, zones, convergences] = await Promise.all([
      q<{ icao_hex: string; lat: number; lon: number; alt: number | null; t: string }>(
        `WITH mx AS (SELECT max(captured_at) AS m FROM detections),
         win AS (SELECT m AS hi, m - ($1 || ' hours')::interval AS lo FROM mx),
         pts AS (
           SELECT d.icao_hex, d.latitude::float AS lat, d.longitude::float AS lon,
                  d.altitude_ft AS alt, d.captured_at AS t,
                  row_number() OVER (PARTITION BY d.icao_hex ORDER BY d.captured_at) AS rn,
                  count(*) OVER (PARTITION BY d.icao_hex) AS n
           FROM detections d, win w
           WHERE d.captured_at BETWEEN w.lo AND w.hi
             AND d.icao_hex = ANY($2::text[])
             AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
         )
         SELECT icao_hex, lat, lon, alt, t FROM pts
         WHERE rn % GREATEST(1, (n / 60)::int) = 0
         ORDER BY icao_hex, t`,
        [String(data.hours), icaos],
      ),
      q<{
        icao_hex: string;
        operator_resolved: string | null;
        faa_registrant_name: string | null;
        aircraft_model: string | null;
        kcso_flag: boolean | null;
        military_flag: boolean | null;
      }>(
        `SELECT icao_hex, operator_resolved, faa_registrant_name, aircraft_model, kcso_flag, military_flag
         FROM canonical_operator_profiles WHERE lower(icao_hex) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)`,
        [icaos],
      ),
      q<{ zone_id: number; zone_name: string; center_lat: number; center_lon: number; radius_km: number; unique_aircraft: number | null }>(
        `SELECT zone_id, zone_name, center_lat, center_lon, radius_km, unique_aircraft FROM corridor_zones`,
      ),
      q<{ id: string; county: string | null; center_lat: number; center_lon: number; radius_km: number; aircraft_count: number; detected_at: string }>(
        `WITH mx AS (SELECT max(detected_at) AS m FROM convergence_events)
         SELECT id::text, county, center_lat::float, center_lon::float, radius_km::float, aircraft_count, detected_at
         FROM convergence_events, mx
         WHERE detected_at > mx.m - ($1 || ' hours')::interval
           AND center_lat IS NOT NULL AND is_unusual IS TRUE
         ORDER BY aircraft_count DESC LIMIT 40`,
        [String(data.hours)],
      ),
    ]);

    const profByIcao = new Map(profiles.map((p) => [p.icao_hex.toLowerCase(), p]));
    const trackByIcao = new Map<string, MapContact["track"]>();
    for (const t of tracks) {
      const arr = trackByIcao.get(t.icao_hex) ?? [];
      arr.push({ lat: t.lat, lon: t.lon, alt: t.alt, t: String(t.t) });
      trackByIcao.set(t.icao_hex, arr);
    }

    const contacts: MapContact[] = summary.map((r) => {
      const p = profByIcao.get(r.icao_hex?.toLowerCase() ?? "");
      const reg = r.registration || null;
      return {
        icao_hex: r.icao_hex,
        registration: reg,
        callsign: r.callsign || null,
        operator: p?.operator_resolved || p?.faa_registrant_name || null,
        aircraft_model: p?.aircraft_model ?? null,
        county: r.county,
        points: r.points,
        min_alt: r.min_alt,
        last_seen: String(r.last_seen),
        kcso: Boolean(p?.kcso_flag),
        military: Boolean(r.military || p?.military_flag),
        masked: !reg,
        low_alt: r.min_alt != null && r.min_alt < 500,
        track: trackByIcao.get(r.icao_hex) ?? [],
      };
    });

    const all = contacts.flatMap((c) => c.track);
    const bbox = all.length
      ? {
          min_lat: Math.min(...all.map((p) => p.lat)),
          max_lat: Math.max(...all.map((p) => p.lat)),
          min_lon: Math.min(...all.map((p) => p.lon)),
          max_lon: Math.max(...all.map((p) => p.lon)),
        }
      : null;

    const zoneList: MapZone[] = [
      ...zones.map((z) => ({
        id: `corridor-${z.zone_id}`,
        name: z.zone_name,
        lat: Number(z.center_lat),
        lon: Number(z.center_lon),
        radius_km: Number(z.radius_km),
        kind: "corridor" as const,
        aircraft: z.unique_aircraft ?? null,
        detected_at: null,
      })),
      ...convergences.map((c) => ({
        id: `conv-${c.id}`,
        name: `${c.aircraft_count} aircraft converged${c.county ? ` · ${c.county}` : ""}`,
        lat: Number(c.center_lat),
        lon: Number(c.center_lon),
        radius_km: Number(c.radius_km) || 2,
        kind: "convergence" as const,
        aircraft: c.aircraft_count,
        detected_at: String(c.detected_at),
      })),
    ];

    return {
      window_hours: data.hours,
      anchor: summary[0]?.anchor ? String(summary[0].anchor) : null,
      bbox,
      contacts,
      zones: zoneList,
      total_contacts: summary[0]?.total ?? contacts.length,
    };
  });

// ---------------------------------------------------------------- entity graph

export type GraphNode = {
  id: string;
  label: string;
  kind: "aircraft" | "owner" | "shell" | "case" | "county";
  detail: string | null;
  weight: number;
  icao?: string | null;
  flagged?: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: "registered_to" | "co_flew" | "evidence_in" | "corporate" | "operates_in";
  label: string;
  weight: number;
};

export type EntityGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focus: string | null;
};

/**
 * The network layer. Aircraft are linked to their registered owners, to each
 * other through co-flight history, to the corporate filings behind those owners,
 * and to the case files they are evidence in.
 */
export const getEntityGraph = createServerFn({ method: "GET" })
  .inputValidator((d: { icao?: string; hours?: number; filter?: MapFilter }) => ({
    icao: d?.icao ? String(d.icao).toLowerCase().replace(/[^a-z0-9]/g, "") : null,
    hours: Math.min(Math.max(d?.hours ?? 24, 1), 720),
    filter: (d?.filter ?? "all") as MapFilter,
  }))
  .handler(async ({ data }): Promise<EntityGraph> => {
    const cond = FILTER_SQL[data.filter] ?? "TRUE";

    // Seed set: either the focused aircraft's world, or the busiest contacts in the window.
    let seeds: string[];
    if (data.icao) {
      const near = await q<{ icao: string }>(
        `SELECT DISTINCT CASE WHEN lower(icao_a)=$1 THEN icao_b ELSE icao_a END AS icao
         FROM aircraft_associations
         WHERE (lower(icao_a)=$1 OR lower(icao_b)=$1) AND assoc_score IS NOT NULL
         ORDER BY 1 LIMIT 18`,
        [data.icao],
      );
      seeds = [data.icao, ...near.map((r) => r.icao)].filter(Boolean);
    } else {
      const busiest = await q<{ icao_hex: string }>(
        `WITH mx AS (SELECT max(captured_at) AS m FROM detections),
         win AS (SELECT m AS hi, m - ($1 || ' hours')::interval AS lo FROM mx)
         SELECT d.icao_hex FROM detections d, win w
         WHERE d.captured_at BETWEEN w.lo AND w.hi AND (${cond})
         GROUP BY d.icao_hex ORDER BY count(*) DESC LIMIT 28`,
        [String(data.hours)],
      );
      seeds = busiest.map((r) => r.icao_hex);
    }

    if (seeds.length === 0) return { nodes: [], edges: [], focus: data.icao };

    const [profiles, links, caseRows] = await Promise.all([
      q<{
        icao_hex: string;
        registration: string | null;
        operator_resolved: string | null;
        faa_registrant_name: string | null;
        aircraft_model: string | null;
        kcso_flag: boolean | null;
        military_flag: boolean | null;
        occurrences_total: number | null;
      }>(
        `SELECT icao_hex, registration, operator_resolved, faa_registrant_name, aircraft_model,
                kcso_flag, military_flag, occurrences_total
         FROM canonical_operator_profiles
         WHERE lower(icao_hex) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)`,
        [seeds],
      ),
      q<{ icao_a: string; icao_b: string; co_events: number; counties: number; assoc_score: number | null; same_registrant: boolean | null }>(
        `SELECT icao_a, icao_b, co_events, counties, assoc_score, same_registrant
         FROM aircraft_associations
         WHERE lower(icao_a) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)
           AND lower(icao_b) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)
           AND co_events >= 3
         ORDER BY assoc_score DESC NULLS LAST LIMIT 80`,
        [seeds],
      ),
      q<{ case_id: string; severity: string | null; status: string | null; subject_icao: string | null; related_icaos: string[] | null; wti_score: number | null }>(
        `SELECT case_id, severity, status, subject_icao, related_icaos, wti_score FROM cases
         WHERE lower(coalesce(subject_icao,'')) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)
            OR EXISTS (
              SELECT 1 FROM unnest(coalesce(related_icaos, ARRAY[]::text[])) ri
              WHERE lower(ri) = ANY(SELECT lower(x) FROM unnest($1::text[]) x)
            )
         LIMIT 40`,
        [seeds],
      ),
    ]);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const profByIcao = new Map(profiles.map((p) => [p.icao_hex.toLowerCase(), p]));

    for (const icao of seeds) {
      const key = icao.toLowerCase();
      const p = profByIcao.get(key);
      nodes.set(`ac:${key}`, {
        id: `ac:${key}`,
        label: p?.registration || icao.toUpperCase(),
        kind: "aircraft",
        detail: p?.aircraft_model || (p?.registration ? null : "no registration broadcast"),
        weight: Number(p?.occurrences_total ?? 1),
        icao: key,
        flagged: Boolean(p?.kcso_flag || p?.military_flag),
      });
      const owner = p?.operator_resolved || p?.faa_registrant_name;
      if (owner) {
        const oid = `own:${owner.toLowerCase()}`;
        if (!nodes.has(oid)) {
          nodes.set(oid, { id: oid, label: owner, kind: "owner", detail: "registered owner", weight: 1, flagged: Boolean(p?.kcso_flag) });
        } else {
          const ownerNode = nodes.get(oid);
          if (ownerNode) ownerNode.weight += 1;
        }
        edges.push({ source: `ac:${key}`, target: oid, kind: "registered_to", label: "registered to", weight: 1 });
      }
    }

    for (const l of links) {
      const a = `ac:${l.icao_a.toLowerCase()}`;
      const b = `ac:${l.icao_b.toLowerCase()}`;
      if (!nodes.has(a) || !nodes.has(b)) continue;
      edges.push({
        source: a,
        target: b,
        kind: "co_flew",
        label: `flew together ${Number(l.co_events)}×${l.same_registrant ? " · same owner" : ""}`,
        weight: Number(l.co_events),
      });
    }

    for (const c of caseRows) {
      const cid = `case:${c.case_id}`;
      nodes.set(cid, {
        id: cid,
        label: c.case_id,
        kind: "case",
        detail: `${c.severity ?? "—"} · ${c.status ?? "—"}${c.wti_score != null ? ` · WTI ${c.wti_score}` : ""}`,
        weight: 2,
        flagged: (c.severity ?? "").toUpperCase() === "CRITICAL",
      });
      const tied = new Set(
        [c.subject_icao, ...(c.related_icaos ?? [])].filter(Boolean).map((x) => String(x).toLowerCase()),
      );
      for (const icao of tied) {
        if (nodes.has(`ac:${icao}`)) {
          edges.push({ source: `ac:${icao}`, target: cid, kind: "evidence_in", label: "evidence in", weight: 2 });
        }
      }
    }

    // Corporate filings behind the owners we just placed on the board.
    const ownerNames = [...nodes.values()].filter((n) => n.kind === "owner").map((n) => n.label);
    const regs = [...nodes.values()].filter((n) => n.kind === "aircraft").map((n) => n.label);
    if (ownerNames.length || regs.length) {
      const shell = await q<{ source_node: string; target_node: string; edge_type: string; weight: number | null; display_name: string | null; node_type: string | null }>(
        `SELECT e.source_node, e.target_node, e.edge_type, e.weight, n.display_name, n.node_type
         FROM shell_network_edges e
         LEFT JOIN shell_network_nodes n ON n.node_id = e.target_node
         WHERE upper(e.source_node) = ANY(SELECT upper(x) FROM unnest($1::text[]) x)
            OR upper(e.target_node) = ANY(SELECT upper(replace(x,' ','_')) FROM unnest($2::text[]) x)
         LIMIT 60`,
        [regs, ownerNames],
      );
      for (const s of shell) {
        const target = `shell:${s.target_node}`;
        if (!nodes.has(target)) {
          nodes.set(target, {
            id: target,
            label: s.display_name || s.target_node.replace(/_/g, " "),
            kind: "shell",
            detail: "corporate filing",
            weight: 1,
          });
        }
        const acNode = [...nodes.values()].find(
          (n) => n.kind === "aircraft" && n.label.toUpperCase() === s.source_node.toUpperCase(),
        );
        if (acNode) {
          edges.push({
            source: acNode.id,
            target,
            kind: "corporate",
            label: (s.edge_type || "linked").toLowerCase().replace(/_/g, " "),
            weight: Number(s.weight ?? 1),
          });
        }
      }
    }

    return { nodes: [...nodes.values()], edges, focus: data.icao };
  });

// ------------------------------------------------------------- node inspector

export type Twin = { icao_hex: string; registration: string | null; operator: string | null; similarity: number };

export type NodeDossier = {
  icao_hex: string;
  registration: string | null;
  operator: string | null;
  aircraft_model: string | null;
  kcso: boolean;
  military: boolean;
  occurrences: number | null;
  last_seen: string | null;
  detections_30d: number;
  low_alt_30d: number;
  anomalies: number;
  top_anomaly: string | null;
  counties: string[];
  cases: Array<{ case_id: string; severity: string | null; status: string | null }>;
  behaviour_cluster: number | null;
  drift_score: number | null;
  twins: Twin[];
};

export const getNodeDossier = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string }) => {
    const icao = String(d?.icao ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!icao) throw new Error("icao required");
    return { icao };
  })
  .handler(async ({ data }): Promise<NodeDossier> => {
    const [prof, det, anom, cases, deep] = await Promise.all([
      q<{
        registration: string | null;
        operator_resolved: string | null;
        faa_registrant_name: string | null;
        aircraft_model: string | null;
        kcso_flag: boolean | null;
        military_flag: boolean | null;
        occurrences_total: number | null;
        last_seen: string | null;
      }>(
        `SELECT registration, operator_resolved, faa_registrant_name, aircraft_model,
                kcso_flag, military_flag, occurrences_total, last_seen
         FROM canonical_operator_profiles WHERE lower(icao_hex)=$1 LIMIT 1`,
        [data.icao],
      ),
      q<{ total: number; low: number; counties: string[] }>(
        `WITH mx AS (SELECT max(captured_at) AS m FROM detections)
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE altitude_ft < 500 AND on_ground IS NOT TRUE)::int AS low,
                array_remove(array_agg(DISTINCT county), NULL) AS counties
         FROM detections, mx
         WHERE lower(icao_hex)=$1 AND captured_at > mx.m - interval '30 days'`,
        [data.icao],
      ),
      q<{ n: number; top: string | null }>(
        `SELECT count(*)::int AS n,
                (SELECT anomaly_type FROM anomaly_events WHERE lower(icao_hex)=$1
                  GROUP BY anomaly_type ORDER BY count(*) DESC LIMIT 1) AS top
         FROM anomaly_events WHERE lower(icao_hex)=$1`,
        [data.icao],
      ),
      q<{ case_id: string; severity: string | null; status: string | null }>(
        `SELECT case_id, severity, status FROM cases
         WHERE lower(coalesce(subject_icao,''))=$1
            OR EXISTS (SELECT 1 FROM unnest(coalesce(related_icaos, ARRAY[]::text[])) ri WHERE lower(ri)=$1)
         LIMIT 10`,
        [data.icao],
      ),
      q<{ behavioral_cluster: number | null; drift_score: number | null }>(
        `SELECT behavioral_cluster, drift_score FROM aircraft_deep_profiles
         WHERE lower(icao_hex)=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
        [data.icao],
      ),
    ]);

    let twins: Twin[] = [];
    try {
      twins = await q<Twin>(
        `WITH me AS (
           SELECT embedding_vector FROM aircraft_deep_profiles
           WHERE lower(icao_hex)=$1 AND embedding_vector IS NOT NULL LIMIT 1
         )
         SELECT p.icao_hex,
                c.registration,
                coalesce(c.operator_resolved, c.faa_registrant_name) AS operator,
                round((1 - (p.embedding_vector <=> me.embedding_vector))::numeric, 4)::float AS similarity
         FROM aircraft_deep_profiles p, me
         LEFT JOIN canonical_operator_profiles c ON lower(c.icao_hex) = lower(p.icao_hex)
         WHERE p.embedding_vector IS NOT NULL AND lower(p.icao_hex) <> $1
         ORDER BY p.embedding_vector <=> me.embedding_vector
         LIMIT 8`,
        [data.icao],
      );
    } catch {
      twins = [];
    }

    const p = prof[0];
    return {
      icao_hex: data.icao,
      registration: p?.registration ?? null,
      operator: p?.operator_resolved || p?.faa_registrant_name || null,
      aircraft_model: p?.aircraft_model ?? null,
      kcso: Boolean(p?.kcso_flag),
      military: Boolean(p?.military_flag),
      occurrences: p?.occurrences_total ?? null,
      last_seen: p?.last_seen ? String(p.last_seen) : null,
      detections_30d: det[0]?.total ?? 0,
      low_alt_30d: det[0]?.low ?? 0,
      anomalies: anom[0]?.n ?? 0,
      top_anomaly: anom[0]?.top ?? null,
      counties: det[0]?.counties ?? [],
      cases: cases,
      behaviour_cluster: deep[0]?.behavioral_cluster ?? null,
      drift_score: deep[0]?.drift_score ?? null,
      twins: twins.filter((t) => Number(t.similarity) > 0),
    };
  });
