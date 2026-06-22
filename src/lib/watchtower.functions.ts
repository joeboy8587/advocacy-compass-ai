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
  violations_24h: number;
  convergences_24h: number;
  unique_aircraft_24h: number;
  low_alt_violators_24h: number;
};

export const getKpis = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await q<Kpis>(`
    SELECT
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS detections_24h,
      (SELECT count(*)::int FROM anomaly_events WHERE detected_at > now() - interval '24 hours') AS anomalies_24h,
      (SELECT count(*)::int FROM aoi_alerts WHERE captured_at > now() - interval '24 hours' AND alert_level = 'CRITICAL') AS critical_alerts_24h,
      (SELECT count(*)::int FROM cases WHERE status IN ('DRAFT','REVIEW','OPEN')) AS active_cases,
      (SELECT count(*)::int FROM sentinel_violations WHERE detection_timestamp > now() - interval '24 hours') AS violations_24h,
      (SELECT count(*)::int FROM convergence_events WHERE detected_at > now() - interval '24 hours') AS convergences_24h,
      (SELECT count(DISTINCT icao_hex)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS unique_aircraft_24h,
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours' AND is_91_227_violator = true) AS low_alt_violators_24h
  `);
  return rows[0];
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
           MAX(ap.owner_name) AS owner,
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
