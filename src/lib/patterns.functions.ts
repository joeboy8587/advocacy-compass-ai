import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

// ============================================================
// LEARNED PATTERNS — the autonomous pattern miner's output.
// 1.9M rows: every query is windowed + limited, never a full scan.
// ============================================================
export type PatternFamily = {
  pattern_type: string;
  label: string;
  n: number;
  latest: string | null;
  avg_confidence: number | null;
  total_evidence: number | null;
  freshness: string;
  stale: boolean;
};

const FAMILY_LABELS: Record<string, string> = {
  TACTICAL_HANDOFF: "Tactical handoffs — one aircraft leaves a zone as another arrives",
  COORDINATION: "Coordinated pairs flying the same ground together",
  IFR_PHYSICS_VIOLATION: "Flight physics that shouldn't be possible under IFR",
  PHYSICS_VIOLATION_RECURRING: "Repeat physics violations by the same airframe",
  TEMPORAL_PEAK: "Recurring time-of-day surges over the same ground",
  ICAO_REGISTRATION_CYCLING: "Aircraft cycling identity codes between flights",
  STIPULATED_JUDGMENT_VIOLATION: "Activity contrary to the stipulated judgment",
  STIPULATED_JUDGMENT_MONITORING: "Monitoring runs against the stipulated judgment",
  AUTONOMOUS_DISCOVERY: "Patterns the system found on its own",
};

function labelFor(t: string) {
  return FAMILY_LABELS[t] ?? t.replace(/_/g, " ").toLowerCase();
}

function freshnessOf(latest: string | null) {
  if (!latest) return { text: "never run", stale: true };
  const h = (Date.now() - new Date(latest).getTime()) / 3.6e6;
  if (h < 26) return { text: "updated today", stale: false };
  if (h < 24 * 7) return { text: `${Math.round(h / 24)} days since last find`, stale: false };
  return { text: `dormant — ${Math.round(h / 24)} days since last find`, stale: true };
}

export const getPatternFamilies = createServerFn({ method: "GET" })
  .inputValidator((d: { days?: number } = {}) => ({ days: Math.min(Math.max(d?.days ?? 30, 1), 180) }))
  .handler(async ({ data }): Promise<PatternFamily[]> => {
    const rows = await q<{
      pattern_type: string; n: number; latest: string | null;
      avg_confidence: number | null; total_evidence: number | null;
    }>(
      `SELECT pattern_type,
              count(*)::int AS n,
              max(discovered_at)::text AS latest,
              round(avg(confidence), 2)::float AS avg_confidence,
              sum(COALESCE(evidence_count, 0))::int AS total_evidence
         FROM learned_patterns
        WHERE discovered_at > now() - ($1 || ' days')::interval
        GROUP BY pattern_type
        ORDER BY n DESC`,
      [String(data.days)],
    );
    return rows.map((r) => {
      const f = freshnessOf(r.latest);
      return { ...r, label: labelFor(r.pattern_type), freshness: f.text, stale: f.stale };
    });
  });

export type PatternRow = {
  id: string;
  pattern_type: string;
  pattern_description: string | null;
  confidence: number | null;
  evidence_count: number | null;
  peak_hour: number | null;
  active_days: number | null;
  discovered_at: string;
  aircraft: string[] | null;
  is_active: boolean | null;
};

export const getPatterns = createServerFn({ method: "GET" })
  .inputValidator((d: { type?: string; days?: number; icao?: string; limit?: number } = {}) => ({
    type: d?.type?.trim() || null,
    days: Math.min(Math.max(d?.days ?? 3, 1), 90),
    icao: d?.icao?.trim() || null,
    limit: Math.min(d?.limit ?? 60, 200),
  }))
  .handler(async ({ data }): Promise<PatternRow[]> => {
    return q<PatternRow>(
      `SELECT id::text, pattern_type, pattern_description, confidence::float, evidence_count,
              peak_hour, active_days, discovered_at::text, aircraft_icao_hexes AS aircraft, is_active
         FROM learned_patterns
        WHERE discovered_at > now() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR pattern_type = $2)
          AND ($3::text IS NULL OR aircraft_icao_hexes && ARRAY[lower($3), upper($3)])
        ORDER BY confidence DESC NULLS LAST, discovered_at DESC
        LIMIT $4`,
      [String(data.days), data.type, data.icao, data.limit],
    );
  });

// ============================================================
// THREAT DIGEST — pre-written plain-English assessments
// ============================================================
export const getThreatDigest = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number } = {}) => ({ limit: Math.min(d?.limit ?? 12, 50) }))
  .handler(async ({ data }) => {
    const threats = await q<{
      id: number; created_at: string; severity: string | null; tag: string | null;
      registration: string | null; icao_hex: string | null; county: string | null;
      altitude_ft: number | null; anomaly_type: string | null; description: string | null;
      detection_time: string | null;
    }>(
      `SELECT id, created_at::text, severity, tag, registration, icao_hex, county,
              altitude_ft, anomaly_type, description, detection_time::text
         FROM was_threat_assessments
        WHERE severity IN ('CRITICAL','HIGH','MEDIUM')
        ORDER BY created_at DESC
        LIMIT $1`,
      [data.limit],
    ).catch(() => []);
    const patterns = await q<{
      id: number; created_at: string; pattern_name: string; pattern_type: string | null;
      severity: string | null; evidence_count: number | null; description: string | null;
      first_seen: string | null;
    }>(
      `SELECT id, created_at::text, pattern_name, pattern_type, severity, evidence_count,
              description, first_seen::text
         FROM was_discovered_patterns
        ORDER BY created_at DESC
        LIMIT 10`,
    ).catch(() => []);
    return { threats, patterns };
  });

// ============================================================
// SHELL COMPANY NETWORK
// ============================================================
export const getShellNetwork = createServerFn({ method: "GET" }).handler(async () => {
  const nodes = await q<{ node_id: string; node_type: string; display_name: string | null }>(
    `SELECT node_id, node_type, display_name FROM shell_network_nodes ORDER BY node_type, node_id`,
  ).catch(() => []);
  const edges = await q<{
    source_node: string; target_node: string; edge_type: string; weight: number | null;
  }>(
    `SELECT source_node, target_node, edge_type, weight::float FROM shell_network_edges ORDER BY weight DESC NULLS LAST`,
  ).catch(() => []);

  const nameOf = new Map(nodes.map((n) => [n.node_id, n.display_name || n.node_id.replace(/_/g, " ")]));
  const companies = new Map<string, { company: string; aircraft: { tail: string; edge: string; weight: number | null }[] }>();
  for (const e of edges) {
    const key = e.target_node;
    const entry = companies.get(key) ?? { company: nameOf.get(key) ?? key.replace(/_/g, " "), aircraft: [] };
    entry.aircraft.push({ tail: nameOf.get(e.source_node) ?? e.source_node, edge: e.edge_type.replace(/_/g, " ").toLowerCase(), weight: e.weight });
    companies.set(key, entry);
  }

  const alignment = await q<{
    target_registration: string | null; target_icao: string | null; kcso_registration: string | null;
    events: number; min_distance_km: number | null; last_seen: string | null;
  }>(
    `SELECT target_registration, target_icao, kcso_registration,
            count(*)::int AS events,
            round(min(distance_km)::numeric, 2)::float AS min_distance_km,
            max(created_at)::text AS last_seen
       FROM shell_entity_behavioral_alignment
      GROUP BY target_registration, target_icao, kcso_registration
      ORDER BY events DESC
      LIMIT 40`,
  ).catch(() => []);

  return {
    node_count: nodes.length,
    company_count: nodes.filter((n) => n.node_type === "COMPANY").length,
    aircraft_count: nodes.filter((n) => n.node_type === "AIRCRAFT").length,
    companies: [...companies.values()].sort((a, b) => b.aircraft.length - a.aircraft.length),
    alignment,
  };
});

// ============================================================
// LEGAL EXPOSURE — penalty theories with statute citations
// ============================================================
export const getLegalExposure = createServerFn({ method: "GET" }).handler(async () => {
  return q<{
    theory_code: string; label: string | null; citation: string | null;
    reported_violations: string | null; max_penalty: string | null;
    basis: string | null; confidence: string | null;
  }>(
    `SELECT theory_code, label, citation, reported_violations, max_penalty, basis, confidence
       FROM watchtower_link.legal_exposure
      ORDER BY theory_code`,
  ).catch(() => []);
});
