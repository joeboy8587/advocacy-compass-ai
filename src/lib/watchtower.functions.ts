import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

// ---------- KPIs ----------
export type Kpis = {
  detections_24h: number;
  anomalies_24h: number;
  critical_alerts_24h: number;
  active_cases: number;
  violations_7d: number;
  convergences_24h: number;
  unique_aircraft_24h: number;
  low_alt_24h: number;
  spoofing_24h: number;
  masked_alt_24h: number;
  coordination_locks: number;
  incursions_7d: number;
};

export const getKpis = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await q<Kpis>(`
    SELECT
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS detections_24h,
      (SELECT count(*)::int FROM anomaly_events WHERE detected_at > now() - interval '24 hours') AS anomalies_24h,
      (SELECT count(*)::int FROM aoi_alerts WHERE captured_at > now() - interval '24 hours' AND alert_level = 'CRITICAL') AS critical_alerts_24h,
      (SELECT count(*)::int FROM cases WHERE status IN ('DRAFT','REVIEW','OPEN','CONFIRMED')) AS active_cases,
      (SELECT count(*)::int FROM violation_classifications WHERE captured_at > now() - interval '7 days') AS violations_7d,
      (SELECT count(*)::int FROM convergence_events WHERE detected_at > now() - interval '24 hours') AS convergences_24h,
      (SELECT count(DISTINCT icao_hex)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS unique_aircraft_24h,
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours' AND altitude_ft IS NOT NULL AND altitude_ft < 500 AND on_ground = false) AS low_alt_24h,
      (SELECT count(*)::int FROM ml_anomaly_detections WHERE detected_at > now() - interval '24 hours' AND anomaly_type = 'SPOOFING_SIGNAL') AS spoofing_24h,
      (SELECT count(*)::int FROM ml_anomaly_detections WHERE detected_at > now() - interval '24 hours' AND anomaly_type = 'MASKED_ALTITUDE') AS masked_alt_24h,
      (SELECT count(*)::int FROM wtpr_convergent_locks WHERE machine_confirmed = true) AS coordination_locks,
      (SELECT count(*)::int FROM incursion_events WHERE event_timestamp > now() - interval '7 days') AS incursions_7d
  `);
  return rows[0];
});

// ---------- Spoofing analysis ----------
export type SpoofEvent = {
  id: string;
  detected_at: string;
  aircraft_registration: string | null;
  icao24: string | null;
  callsign: string | null;
  anomaly_type: string;
  anomaly_score: string | null;
  confidence_level: string | null;
  county: string | null;
  features: unknown;
};

export const getSpoofingFeed = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; type?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 60, 200);
    const params: unknown[] = [limit];
    let where = `anomaly_type IN ('SPOOFING_SIGNAL','MASKED_ALTITUDE','IMPOSSIBLE_PHYSICS','SURVEILLANCE_MASKING')`;
    if (data.type) {
      params.push(data.type);
      where = `anomaly_type = $${params.length}`;
    }
    return q<SpoofEvent>(
      `SELECT id, detected_at, aircraft_registration, icao24, callsign, anomaly_type,
              anomaly_score, confidence_level, county, features
         FROM ml_anomaly_detections
        WHERE ${where}
        ORDER BY detected_at DESC NULLS LAST
        LIMIT $1`,
      params,
    );
  });

export const getSpoofingBreakdown = createServerFn({ method: "GET" }).handler(async () => {
  return q<{ anomaly_type: string; n: number; avg_score: string; aircraft: number }>(`
    SELECT anomaly_type,
           count(*)::int AS n,
           ROUND(AVG(anomaly_score)::numeric, 2)::text AS avg_score,
           count(DISTINCT icao24)::int AS aircraft
      FROM ml_anomaly_detections
     WHERE detected_at > now() - interval '7 days'
       AND anomaly_type IN ('SPOOFING_SIGNAL','MASKED_ALTITUDE','IMPOSSIBLE_PHYSICS','SURVEILLANCE_MASKING','CALIBRATION_ERROR')
     GROUP BY anomaly_type
     ORDER BY n DESC
  `);
});

export const getTopSpoofers = createServerFn({ method: "GET" }).handler(async () => {
  return q<{
    aircraft_registration: string | null;
    icao24: string | null;
    county: string | null;
    spoof_events: number;
    masked_events: number;
    last_seen: string;
  }>(`
    SELECT aircraft_registration,
           icao24,
           MAX(county) AS county,
           count(*) FILTER (WHERE anomaly_type = 'SPOOFING_SIGNAL')::int AS spoof_events,
           count(*) FILTER (WHERE anomaly_type = 'MASKED_ALTITUDE')::int AS masked_events,
           MAX(detected_at) AS last_seen
      FROM ml_anomaly_detections
     WHERE detected_at > now() - interval '30 days'
       AND anomaly_type IN ('SPOOFING_SIGNAL','MASKED_ALTITUDE')
     GROUP BY aircraft_registration, icao24
     ORDER BY spoof_events DESC, masked_events DESC
     LIMIT 25
  `);
});

// ---------- Coordination / Handoffs ----------
export type CoordinationLock = {
  id: number;
  main_wtpr: string;
  nb_wtpr: string;
  correlation_score: string;
  p_value: string;
  finding_type: string;
  machine_confirmed: boolean;
  created_at: string;
};

export const getCoordinationLocks = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 80, 300);
    return q<CoordinationLock>(
      `SELECT id, main_wtpr, nb_wtpr, correlation_score, p_value, finding_type, machine_confirmed, created_at
         FROM wtpr_convergent_locks
        ORDER BY correlation_score DESC, created_at DESC
        LIMIT $1`,
      [limit],
    );
  });

export const getHandoffHypotheses = createServerFn({ method: "GET" }).handler(async () => {
  return q<{ hypothesis_type: string; n: number; avg_conf: string }>(`
    SELECT hypothesis_type,
           count(*)::int AS n,
           ROUND(AVG(confidence_score)::numeric, 3)::text AS avg_conf
      FROM mission_hypotheses
     WHERE hypothesis_type IN (
        'COORDINATED_SURVEILLANCE','STARING_PATTERN','PERSISTENT_REGIONAL_ANCHOR',
        'GHOST_LAYER_ASSET','RANDOMIZED_LOITER_TACTIC','CONTRACT_ISR_NODE',
        'DIGITAL_CHAMELEON_SIGNATURE','FROZEN_ALTITUDE_SPOOF','IDENTITY_OBFUSCATION'
     )
     GROUP BY hypothesis_type
     ORDER BY n DESC
  `);
});

export const getRecentCoordinatedHypotheses = createServerFn({ method: "GET" }).handler(async () => {
  return q<{
    id: string;
    detection_id: string;
    hypothesis_type: string;
    confidence_score: string;
    reasoning_chain: string;
    updated_at: string;
  }>(`
    SELECT id, detection_id, hypothesis_type, confidence_score, reasoning_chain, updated_at
      FROM mission_hypotheses
     WHERE hypothesis_type IN ('COORDINATED_SURVEILLANCE','STARING_PATTERN','GHOST_LAYER_ASSET','CONTRACT_ISR_NODE')
       AND confidence_score >= 0.8
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 40
  `);
});

export const getIncursionFeed = createServerFn({ method: "GET" }).handler(async () => {
  return q<{
    id: string;
    icao_hex: string;
    registration: string;
    event_timestamp: string;
    altitude_ft: number;
    prev_min_alt: number;
    reasoning: string;
  }>(`
    SELECT id, icao_hex, registration, event_timestamp, altitude_ft, prev_min_alt, reasoning
      FROM incursion_events
     ORDER BY event_timestamp DESC
     LIMIT 50
  `);
});

// ---------- Recent Alerts ----------
export type AlertRow = {
  id: string;
  icao_hex: string | null;
  registration: string | null;
  altitude_ft: number | null;
  distance_mi: string | null;
  captured_at: string;
  alert_level: string;
  reason: string | null;
  sha256_hash: string | null;
};

export const getRecentAlerts = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; level?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 50, 200);
    const params: unknown[] = [limit];
    let where = "";
    if (data.level) {
      where = "WHERE alert_level = $2";
      params.push(data.level);
    }
    return q<AlertRow>(
      `SELECT id, icao_hex, registration, altitude_ft, distance_mi, captured_at, alert_level, reason, sha256_hash
       FROM aoi_alerts ${where}
       ORDER BY captured_at DESC NULLS LAST
       LIMIT $1`,
      params,
    );
  });

// ---------- Top Cases ----------
export type CaseRow = {
  id: string;
  case_id: string | null;
  case_type: string;
  severity: string;
  subject_icao: string | null;
  subject_reg: string | null;
  subject_owner: string | null;
  primary_county: string | null;
  wti_score: string | null;
  wti_tier: number | null;
  status: string;
  opened_at: string;
  bradford_hill_score: string | null;
  auto_summary: string | null;
  total_events: number | null;
  anomaly_type: string | null;
  is_published: boolean | null;
};

export const getCases = createServerFn({ method: "GET" })
  .inputValidator((d: { status?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 100, 500);
    const params: unknown[] = [limit];
    let where = "";
    if (data.status && data.status !== "ALL") {
      where = "WHERE status = $2";
      params.push(data.status);
    }
    return q<CaseRow>(
      `SELECT id, case_id, case_type, severity, subject_icao, subject_reg, subject_owner,
              primary_county, wti_score, wti_tier, status, opened_at, bradford_hill_score,
              auto_summary, total_events, anomaly_type, is_published
       FROM cases ${where}
       ORDER BY wti_tier DESC NULLS LAST, opened_at DESC
       LIMIT $1`,
      params,
    );
  });

export type CaseDetail = CaseRow & {
  reviewer_notes: string | null;
  dismissed_reason: string | null;
  public_summary: string | null;
  sha256_hash: string | null;
  merkle_block: number | null;
  detection_ids: string[] | null;
  anomaly_ids: string[] | null;
  violation_ids: string[] | null;
  convergence_ids: string[] | null;
  reviewed_by: string | null;
  bh_strength: boolean | null;
  bh_consistency: boolean | null;
  bh_specificity: boolean | null;
  bh_temporality: boolean | null;
  bh_corroboration: boolean | null;
  evidence_sufficient: boolean | null;
};

export const getCaseById = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const rows = await q<CaseDetail>(
      `SELECT * FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
      [data.id],
    );
    return rows[0] ?? null;
  });

// ---------- Hourly Stats ----------
export type HourlyStat = {
  hour: string;
  detections: number;
  anomalies: number;
  alerts: number;
};

export const getHourlyTimeline = createServerFn({ method: "GET" }).handler(async () => {
  return q<HourlyStat>(`
    WITH h AS (
      SELECT generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) AS hour
    )
    SELECT
      h.hour::text AS hour,
      COALESCE((SELECT count(*)::int FROM detections d WHERE d.captured_at >= h.hour AND d.captured_at < h.hour + interval '1 hour'), 0) AS detections,
      COALESCE((SELECT count(*)::int FROM anomaly_events a WHERE a.detected_at >= h.hour AND a.detected_at < h.hour + interval '1 hour'), 0) AS anomalies,
      COALESCE((SELECT count(*)::int FROM aoi_alerts al WHERE al.captured_at >= h.hour AND al.captured_at < h.hour + interval '1 hour'), 0) AS alerts
    FROM h
    ORDER BY h.hour
  `);
});

// ---------- Recent Detections ----------
export type DetectionRow = {
  id: string;
  captured_at: string;
  icao_hex: string;
  registration: string | null;
  callsign: string | null;
  altitude_ft: number | null;
  speed_kts: string | null;
  county: string | null;
  zone: string | null;
  latitude: string | null;
  longitude: string | null;
  is_military: boolean | null;
  is_91_227_violator: boolean | null;
  emergency: string | null;
};

export const getRecentDetections = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; lowAltOnly?: boolean } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 100, 500);
    const filter = data.lowAltOnly ? "WHERE is_91_227_violator = true" : "";
    return q<DetectionRow>(
      `SELECT id, captured_at, icao_hex, registration, callsign, altitude_ft, speed_kts,
              county, zone, latitude, longitude, is_military, is_91_227_violator, emergency
       FROM detections ${filter}
       ORDER BY captured_at DESC
       LIMIT $1`,
      [limit],
    );
  });

// ---------- Top Repeat Offenders ----------
export type OffenderRow = {
  icao_hex: string;
  registration: string | null;
  owner: string | null;
  detections_7d: number;
  low_alt_events: number;
  counties: string;
};

export const getTopOffenders = createServerFn({ method: "GET" }).handler(async () => {
  return q<OffenderRow>(`
    SELECT d.icao_hex,
           MAX(d.registration) AS registration,
           MAX(ap.registered_owner) AS owner,
           count(*)::int AS detections_7d,
           sum(CASE WHEN d.is_91_227_violator THEN 1 ELSE 0 END)::int AS low_alt_events,
           string_agg(DISTINCT d.county, ', ') AS counties
    FROM detections d
    LEFT JOIN aircraft_profiles ap ON ap.icao_hex = d.icao_hex
    WHERE d.captured_at > now() - interval '7 days'
    GROUP BY d.icao_hex
    HAVING sum(CASE WHEN d.is_91_227_violator THEN 1 ELSE 0 END) > 0
    ORDER BY low_alt_events DESC, detections_7d DESC
    LIMIT 25
  `);
});

// ---------- Case Mutations (Phase 2) ----------
export type CaseUpdateInput = {
  id: string;
  status?: "DRAFT" | "REVIEW" | "CONFIRMED" | "PUBLISHED" | "DISMISSED";
  reviewer_notes?: string | null;
  public_summary?: string | null;
  dismissed_reason?: string | null;
  reviewed_by?: string | null;
  is_published?: boolean;
};

export const updateCase = createServerFn({ method: "POST" })
  .inputValidator((d: CaseUpdateInput) => {
    if (!d?.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (data.status !== undefined) {
      push("status", data.status);
      if (data.status === "CONFIRMED" || data.status === "DISMISSED" || data.status === "PUBLISHED") {
        sets.push(`reviewed_at = now()`);
      }
    }
    if (data.reviewer_notes !== undefined) push("reviewer_notes", data.reviewer_notes);
    if (data.public_summary !== undefined) push("public_summary", data.public_summary);
    if (data.dismissed_reason !== undefined) push("dismissed_reason", data.dismissed_reason);
    if (data.reviewed_by !== undefined) push("reviewed_by", data.reviewed_by);
    if (data.is_published !== undefined) {
      push("is_published", data.is_published);
      if (data.is_published) sets.push(`published_at = COALESCE(published_at, now())`);
    }
    params.push(data.id);
    const rows = await q<{ id: string }>(
      `UPDATE cases SET ${sets.join(", ")}
       WHERE case_id = $${params.length} OR id::text = $${params.length}
       RETURNING id`,
      params,
    );
    return { ok: true, id: rows[0]?.id ?? null };
  });

// ---------- Case Evidence (joined detail for brief / export) ----------
export type CaseEvidence = {
  detections: DetectionRow[];
  alerts: AlertRow[];
};

export const getCaseEvidence = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const caseRows = await q<{ detection_ids: string[] | null; subject_icao: string | null }>(
      `SELECT detection_ids, subject_icao FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
      [data.id],
    );
    const c = caseRows[0];
    if (!c) return { detections: [], alerts: [] } as CaseEvidence;
    const ids = (c.detection_ids ?? []).slice(0, 50);
    const detections = ids.length
      ? await q<DetectionRow>(
          `SELECT id, captured_at, icao_hex, registration, callsign, altitude_ft, speed_kts,
                  county, zone, latitude, longitude, is_military, is_91_227_violator, emergency
           FROM detections WHERE id = ANY($1::uuid[]) ORDER BY captured_at DESC`,
          [ids],
        )
      : [];
    const alerts = c.subject_icao
      ? await q<AlertRow>(
          `SELECT id, icao_hex, registration, altitude_ft, distance_mi, captured_at, alert_level, reason, sha256_hash
           FROM aoi_alerts WHERE icao_hex = $1 ORDER BY captured_at DESC LIMIT 25`,
          [c.subject_icao],
        )
      : [];
    return { detections, alerts } as CaseEvidence;
  });

// ---------- Violations (real FAA-classified) ----------
export type ViolationRow = {
  detection_id: string;
  icao_hex: string;
  registration: string | null;
  altitude_ft: number | null;
  speed_kts: string | null;
  latitude: string | null;
  longitude: string | null;
  captured_at: string;
  rule_violated: string | null;
  owner_name: string | null;
  owner_city: string | null;
  owner_state: string | null;
  type_registrant: string | null;
  aircraft_mfr: string | null;
  aircraft_model: string | null;
};

export const getViolations = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; rule?: string; search?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 200, 1000);
    const params: unknown[] = [limit];
    const where: string[] = [];
    if (data.rule) { params.push(data.rule); where.push(`rule_violated = $${params.length}`); }
    if (data.search) {
      params.push(`%${data.search}%`);
      const i = params.length;
      where.push(`(owner_name ILIKE $${i} OR registration ILIKE $${i} OR icao_hex ILIKE $${i})`);
    }
    const wsql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return q<ViolationRow>(
      `SELECT detection_id, icao_hex, registration, altitude_ft, speed_kts, latitude, longitude,
              captured_at, rule_violated, owner_name, owner_city, owner_state,
              type_registrant, aircraft_mfr, aircraft_model
       FROM violation_classifications ${wsql}
       ORDER BY captured_at DESC
       LIMIT $1`,
      params,
    );
  });

export type ViolationStat = { rule_violated: string; count: number; unique_aircraft: number };
export const getViolationStats = createServerFn({ method: "GET" }).handler(async () => {
  return q<ViolationStat>(`
    SELECT rule_violated, count(*)::int AS count, count(DISTINCT icao_hex)::int AS unique_aircraft
    FROM violation_classifications
    WHERE rule_violated IS NOT NULL
    GROUP BY rule_violated
    ORDER BY count DESC
    LIMIT 25
  `);
});

// ---------- Operators (canonical_operator_profiles) ----------
export type OperatorRow = {
  icao_hex: string;
  registration: string | null;
  faa_registrant_name: string | null;
  operator_resolved: string | null;
  aircraft_model: string | null;
  occurrences_total: number | null;
  confidence: string | null;
  last_seen: string | null;
  kcso_flag: boolean | null;
  military_flag: boolean | null;
  medical_flag: boolean | null;
  xp_services_flag: boolean | null;
  shell_links: number | null;
  violation_count: number;
};

export const getOperators = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; search?: string; flag?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const limit = Math.min(data.limit ?? 100, 500);
    const params: unknown[] = [limit];
    const where: string[] = [];
    if (data.search) {
      params.push(`%${data.search}%`);
      const i = params.length;
      where.push(`(o.faa_registrant_name ILIKE $${i} OR o.operator_resolved ILIKE $${i} OR o.registration ILIKE $${i} OR o.icao_hex ILIKE $${i})`);
    }
    if (data.flag && data.flag !== "ALL") {
      const col = { KCSO: "kcso_flag", MIL: "military_flag", MED: "medical_flag", XP: "xp_services_flag" }[data.flag];
      if (col) where.push(`o.${col} = true`);
    }
    const wsql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return q<OperatorRow>(
      `SELECT o.icao_hex, o.registration, o.faa_registrant_name, o.operator_resolved,
              o.aircraft_model, o.occurrences_total, o.confidence, o.last_seen::text,
              o.kcso_flag, o.military_flag, o.medical_flag, o.xp_services_flag, o.shell_links,
              COALESCE((SELECT count(*)::int FROM violation_classifications v WHERE v.icao_hex = o.icao_hex), 0) AS violation_count
       FROM canonical_operator_profiles o
       ${wsql}
       ORDER BY o.occurrences_total DESC NULLS LAST
       LIMIT $1`,
      params,
    );
  });

export type RegistryRow = {
  n_number: string;
  registrant_name: string | null;
  registrant_city: string | null;
  registrant_state: string | null;
  aircraft_manufacturer: string | null;
  aircraft_model: string | null;
  year_manufactured: number | null;
  status: string | null;
  mode_s_hex: string | null;
  registrant_type: string | null;
};

export const lookupRegistry = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string }) => d)
  .handler(async ({ data }) => {
    const search = `%${data.q}%`;
    return q<RegistryRow>(
      `SELECT n_number, registrant_name, registrant_city, registrant_state,
              aircraft_manufacturer, aircraft_model, year_manufactured, status,
              mode_s_hex, registrant_type
       FROM faa_aircraft_registry
       WHERE n_number ILIKE $1 OR registrant_name ILIKE $1 OR mode_s_hex ILIKE $1
       ORDER BY registrant_name NULLS LAST
       LIMIT 50`,
      [search],
    );
  });

// ---------- FAA Regulations ----------
export type RegulationRow = {
  id: number;
  title: string;
  part: string;
  section: string;
  heading: string;
  content: string | null;
};

export const getRegulations = createServerFn({ method: "GET" })
  .inputValidator((d: { part?: string; search?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const params: unknown[] = [];
    const where: string[] = [];
    if (data.part) { params.push(data.part); where.push(`part = $${params.length}`); }
    if (data.search) {
      params.push(`%${data.search}%`);
      const i = params.length;
      where.push(`(heading ILIKE $${i} OR section ILIKE $${i} OR content ILIKE $${i})`);
    }
    const wsql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return q<RegulationRow>(
      `SELECT id, title, part, section, heading, content
       FROM faa_regulations ${wsql}
       ORDER BY part::text, section
       LIMIT 200`,
      params,
    );
  });

export const getRegulationParts = createServerFn({ method: "GET" }).handler(async () => {
  return q<{ part: string; count: number }>(`
    SELECT part, count(*)::int AS count
    FROM faa_regulations
    GROUP BY part
    ORDER BY count DESC
  `);
});
