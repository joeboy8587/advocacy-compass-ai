import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

// ============================================================
// SUBJECT DOSSIER — registry + ownership + lifetime stats
// ============================================================
export type Dossier = {
  icao_hex: string | null;
  registration: string | null;
  owner: string | null;
  owner_city: string | null;
  owner_state: string | null;
  type_registrant: string | null;
  aircraft_mfr: string | null;
  aircraft_model: string | null;
  year_mfr: string | null;
  status_code: string | null;
  is_military: boolean;
  is_kcso: boolean;
  is_med: boolean;
  detections_total: number;
  detections_30d: number;
  low_alt_total: number;
  low_alt_30d: number;
  violations_total: number;
  first_seen: string | null;
  last_seen: string | null;
  top_counties: string | null;
  prior_cases: { case_id: string; status: string; wti_tier: number | null; opened_at: string }[];
};

export const getSubjectDossier = createServerFn({ method: "GET" })
  .inputValidator((d: { icao?: string; reg?: string }) => d)
  .handler(async ({ data }) => {
    if (!data.icao && !data.reg) throw new Error("icao or reg required");

    // Resolve a canonical icao+reg pair from whatever we were given.
    const resolved = await q<{ icao_hex: string | null; registration: string | null }>(
      `
      SELECT DISTINCT d.icao_hex, d.registration
      FROM detections d
      WHERE ($1::text IS NOT NULL AND d.icao_hex = $1)
         OR ($2::text IS NOT NULL AND d.registration ILIKE $2)
      ORDER BY d.registration NULLS LAST
      LIMIT 1
      `,
      [data.icao ?? null, data.reg ?? null],
    );
    const icao = resolved[0]?.icao_hex ?? data.icao ?? null;
    const reg = resolved[0]?.registration ?? data.reg ?? null;

    const reg_n = reg?.replace(/^N/i, "") ?? null;

    const rows = await q<Dossier>(
      `
      WITH det AS (
        SELECT count(*)::int AS n,
               sum(CASE WHEN captured_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS n30,
               sum(CASE WHEN is_91_227_violator THEN 1 ELSE 0 END)::int AS low,
               sum(CASE WHEN is_91_227_violator AND captured_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS low30,
               bool_or(is_military) AS mil,
               min(captured_at) AS first_seen,
               max(captured_at) AS last_seen
        FROM detections
        WHERE icao_hex = $1
      ),
      cty AS (
        SELECT string_agg(county || ' (' || c::text || ')', ', ' ORDER BY c DESC) AS counties
        FROM (
          SELECT county, count(*)::int c
          FROM detections
          WHERE icao_hex = $1 AND county IS NOT NULL
          GROUP BY county
          ORDER BY count(*) DESC
          LIMIT 5
        ) t
      ),
      vio AS (
        SELECT count(*)::int AS n FROM violation_classifications WHERE icao_hex = $1
      ),
      reg AS (
        SELECT name AS owner, city AS owner_city, state AS owner_state, type_registrant,
               year_mfr, status_code
        FROM faa_master
        WHERE $2::text IS NOT NULL AND n_number = $2
        LIMIT 1
      ),
      pri AS (
        SELECT json_agg(json_build_object(
          'case_id', case_id, 'status', status, 'wti_tier', wti_tier, 'opened_at', opened_at
        ) ORDER BY opened_at DESC) AS cases
        FROM cases
        WHERE subject_icao = $1 OR subject_reg = $3
      ),
      cop AS (
        SELECT bool_or(is_kcso) AS is_kcso, bool_or(is_med) AS is_med
        FROM canonical_operator_profiles
        WHERE $3::text IS NOT NULL AND (n_number = $3 OR n_number = $2)
      ),
      ap AS (
        SELECT registered_owner FROM aircraft_profiles WHERE icao_hex = $1 LIMIT 1
      )
      SELECT
        $1 AS icao_hex,
        $3 AS registration,
        COALESCE(NULLIF(trim(reg.owner), ''), ap.registered_owner) AS owner,
        reg.owner_city, reg.owner_state, reg.type_registrant, reg.year_mfr, reg.status_code,
        NULL::text AS aircraft_mfr, NULL::text AS aircraft_model,
        COALESCE(det.mil, false) AS is_military,
        COALESCE(cop.is_kcso, false) AS is_kcso,
        COALESCE(cop.is_med, false) AS is_med,
        COALESCE(det.n, 0) AS detections_total,
        COALESCE(det.n30, 0) AS detections_30d,
        COALESCE(det.low, 0) AS low_alt_total,
        COALESCE(det.low30, 0) AS low_alt_30d,
        COALESCE(vio.n, 0) AS violations_total,
        det.first_seen, det.last_seen,
        cty.counties AS top_counties,
        COALESCE(pri.cases, '[]'::json) AS prior_cases
      FROM det
      CROSS JOIN cty
      CROSS JOIN vio
      LEFT JOIN reg ON true
      LEFT JOIN pri ON true
      LEFT JOIN cop ON true
      LEFT JOIN ap ON true
      `,
      [icao, reg_n, reg],
    );
    return rows[0] ?? null;
  });

// ============================================================
// REGISTRY CROSS-CHECK — compare case-stored values to live FAA registry
// ============================================================
export type RegistryCheck = {
  icao_hex: string | null;
  registration: string | null;
  faa_owner: string | null;
  case_owner: string | null;
  faa_status: string | null;
  faa_state: string | null;
  faa_city: string | null;
  mismatches: string[];
};

export const registryCrossCheck = createServerFn({ method: "GET" })
  .inputValidator((d: { caseId: string }) => d)
  .handler(async ({ data }) => {
    const caseRows = await q<{
      subject_icao: string | null;
      subject_reg: string | null;
      subject_owner: string | null;
    }>(
      `SELECT subject_icao, subject_reg, subject_owner FROM cases WHERE case_id=$1 OR id::text=$1 LIMIT 1`,
      [data.caseId],
    );
    const c = caseRows[0];
    if (!c) throw new Error("case not found");
    const reg_n = c.subject_reg?.replace(/^N/i, "") ?? null;
    const fa = reg_n
      ? await q<{ name: string | null; status_code: string | null; state: string | null; city: string | null }>(
          `SELECT name, status_code, state, city FROM faa_master WHERE n_number=$1 LIMIT 1`,
          [reg_n],
        )
      : [];
    const f = fa[0] ?? null;
    const mismatches: string[] = [];
    if (c.subject_owner && f?.name && c.subject_owner.trim().toLowerCase() !== f.name.trim().toLowerCase()) {
      mismatches.push(`Owner mismatch — case: "${c.subject_owner}" vs FAA: "${f.name}"`);
    }
    if (reg_n && !f) mismatches.push(`Registration ${c.subject_reg} not found in faa_master`);
    if (f?.status_code && f.status_code !== "V") mismatches.push(`FAA status code = "${f.status_code}" (not Valid)`);
    return {
      icao_hex: c.subject_icao,
      registration: c.subject_reg,
      faa_owner: f?.name ?? null,
      case_owner: c.subject_owner,
      faa_status: f?.status_code ?? null,
      faa_state: f?.state ?? null,
      faa_city: f?.city ?? null,
      mismatches,
    } satisfies RegistryCheck;
  });

// ============================================================
// TIMELINE — interleaved detections + anomalies + violations
// ============================================================
export type TimelineEvent = {
  ts: string;
  kind: "DETECTION" | "ANOMALY" | "VIOLATION" | "ALERT";
  label: string;
  altitude_ft: number | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  severity: string | null;
  detection_id: string | null;
};

export const getSubjectTimeline = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string; hours?: number }) => d)
  .handler(async ({ data }) => {
    const hours = Math.min(Math.max(data.hours ?? 24, 1), 24 * 30);
    const rows = await q<TimelineEvent>(
      `
      (SELECT captured_at AS ts, 'DETECTION'::text AS kind,
              COALESCE(callsign, registration, icao_hex) AS label,
              altitude_ft, county, latitude::float, longitude::float,
              CASE WHEN is_91_227_violator THEN 'LOW_ALT' WHEN is_military THEN 'MIL' ELSE NULL END AS severity,
              id::text AS detection_id
       FROM detections WHERE icao_hex = $1 AND captured_at > now() - ($2 || ' hours')::interval
       ORDER BY captured_at DESC LIMIT 500)
      UNION ALL
      (SELECT detected_at AS ts, 'ANOMALY'::text AS kind,
              anomaly_type AS label, NULL, NULL, NULL, NULL,
              severity::text, NULL
       FROM ml_anomaly_detections WHERE icao_hex = $1 AND detected_at > now() - ($2 || ' hours')::interval
       ORDER BY detected_at DESC LIMIT 200)
      UNION ALL
      (SELECT captured_at AS ts, 'VIOLATION'::text AS kind,
              rule_violated AS label, altitude_ft, NULL, NULL, NULL,
              NULL, detection_id::text
       FROM violation_classifications WHERE icao_hex = $1 AND captured_at > now() - ($2 || ' hours')::interval
       ORDER BY captured_at DESC LIMIT 200)
      UNION ALL
      (SELECT captured_at AS ts, 'ALERT'::text AS kind,
              reason AS label, altitude_ft, NULL, NULL, NULL,
              alert_level::text, NULL
       FROM aoi_alerts WHERE icao_hex = $1 AND captured_at > now() - ($2 || ' hours')::interval
       ORDER BY captured_at DESC LIMIT 200)
      ORDER BY ts DESC LIMIT 800
      `,
      [data.icao, String(hours)],
    );
    return rows;
  });

// ============================================================
// CO-FLIERS — other aircraft near the subject at the same time
// ============================================================
export type CoFlier = {
  icao_hex: string;
  registration: string | null;
  owner: string | null;
  encounter_count: number;
  min_dist_km: number;
  min_dt_sec: number;
  first_at: string;
  last_at: string;
  is_military: boolean;
};

export const getCoFliers = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string; hours?: number; radiusKm?: number; windowSec?: number }) => d)
  .handler(async ({ data }) => {
    const hours = Math.min(data.hours ?? 24, 24 * 14);
    const radiusKm = Math.min(data.radiusKm ?? 5, 50);
    const windowSec = Math.min(data.windowSec ?? 120, 600);
    const rows = await q<CoFlier>(
      `
      WITH subj AS (
        SELECT captured_at, latitude::float AS lat, longitude::float AS lon
        FROM detections
        WHERE icao_hex = $1
          AND captured_at > now() - ($2 || ' hours')::interval
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY captured_at DESC
        LIMIT 300
      ),
      near AS (
        SELECT d.icao_hex, d.registration,
               EXTRACT(EPOCH FROM (d.captured_at - s.captured_at))::int AS dt,
               -- haversine, km
               (2 * 6371 * asin(sqrt(
                 power(sin(radians((d.latitude::float - s.lat)/2)),2) +
                 cos(radians(s.lat)) * cos(radians(d.latitude::float)) *
                 power(sin(radians((d.longitude::float - s.lon)/2)),2)
               ))) AS dist_km,
               d.captured_at, d.is_military
        FROM subj s
        JOIN detections d
          ON d.icao_hex <> $1
         AND d.captured_at BETWEEN s.captured_at - ($4 || ' seconds')::interval
                                AND s.captured_at + ($4 || ' seconds')::interval
         AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
         AND abs(d.latitude::float - s.lat) < 0.5
         AND abs(d.longitude::float - s.lon) < 0.5
      )
      SELECT n.icao_hex,
             MAX(n.registration) AS registration,
             MAX(ap.registered_owner) AS owner,
             count(*)::int AS encounter_count,
             MIN(n.dist_km)::float AS min_dist_km,
             MIN(abs(n.dt))::int AS min_dt_sec,
             MIN(n.captured_at) AS first_at,
             MAX(n.captured_at) AS last_at,
             bool_or(n.is_military) AS is_military
      FROM near n
      LEFT JOIN aircraft_profiles ap ON ap.icao_hex = n.icao_hex
      WHERE n.dist_km <= $3
      GROUP BY n.icao_hex
      ORDER BY encounter_count DESC, min_dist_km ASC
      LIMIT 30
      `,
      [data.icao, String(hours), radiusKm, String(windowSec)],
    );
    return rows;
  });

// ============================================================
// LINKED SCREENSHOTS — visual evidence cross-ref
// ============================================================
export type SubjectScreenshot = {
  id: string;
  uploaded_at: string;
  filename: string;
  sha256: string;
  exif_taken_at: string | null;
  match_status: string;
  altitude_ft: number | null;
  best_match_delta_s: number | null;
};

export const getSubjectScreenshots = createServerFn({ method: "GET" })
  .inputValidator((d: { icao?: string | null; reg?: string | null }) => d)
  .handler(async ({ data }) => {
    const rows = await q<SubjectScreenshot>(
      `SELECT id::text, uploaded_at, filename, sha256, exif_taken_at,
              match_status, altitude_ft, best_match_delta_s
       FROM radar_screenshots
       WHERE ($1::text IS NOT NULL AND icao_hex = $1)
          OR ($2::text IS NOT NULL AND tail ILIKE $2)
       ORDER BY uploaded_at DESC LIMIT 50`,
      [data.icao ?? null, data.reg ?? null],
    );
    return rows;
  });

// ============================================================
// ATTACH DETECTIONS TO CASE (uuid array append)
// ============================================================
export const attachDetectionsToCase = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; detectionIds: string[] }) => {
    if (!d?.caseId) throw new Error("caseId required");
    if (!Array.isArray(d.detectionIds) || d.detectionIds.length === 0) throw new Error("detectionIds required");
    return d;
  })
  .handler(async ({ data }) => {
    const rows = await q<{ id: string; n: number }>(
      `UPDATE cases
       SET detection_ids = (
         SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(detection_ids,'{}'::uuid[]) || $2::uuid[]) AS x
       ),
       total_events = COALESCE(total_events,0) + $3::int,
       updated_at = now()
       WHERE case_id=$1 OR id::text=$1
       RETURNING id::text, cardinality(detection_ids) AS n`,
      [data.caseId, data.detectionIds, data.detectionIds.length],
    );
    return { ok: true, attached: data.detectionIds.length, total: rows[0]?.n ?? 0 };
  });

// ============================================================
// MANUAL CASE CREATION
// ============================================================
export const createCase = createServerFn({ method: "POST" })
  .inputValidator((d: {
    icao?: string | null;
    reg?: string | null;
    owner?: string | null;
    county?: string | null;
    case_type?: string;
    severity?: string;
    notes?: string | null;
  }) => {
    if (!d.icao && !d.reg) throw new Error("icao or reg required");
    return d;
  })
  .handler(async ({ data }) => {
    // Generate case_id WT-YYYY-NNNN
    const seq = await q<{ year: number; n: number }>(
      `SELECT EXTRACT(YEAR FROM now())::int AS year,
              COALESCE(MAX(case_number),0)+1 AS n
       FROM cases WHERE case_year = EXTRACT(YEAR FROM now())::int`,
    );
    const year = seq[0]?.year ?? new Date().getFullYear();
    const n = seq[0]?.n ?? 1;
    const case_id = `WT-${year}-${String(n).padStart(4, "0")}`;

    const rows = await q<{ id: string; case_id: string }>(
      `INSERT INTO cases (case_id, case_year, case_number, case_type, severity,
        subject_icao, subject_reg, subject_owner, primary_county, status,
        reviewer_notes, opened_at, total_events)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10, now(), 0)
       RETURNING id::text, case_id`,
      [
        case_id, year, n,
        data.case_type ?? "MANUAL",
        data.severity ?? "MEDIUM",
        data.icao ?? null,
        data.reg ?? null,
        data.owner ?? null,
        data.county ?? null,
        data.notes ?? null,
      ],
    );
    return rows[0];
  });

// ============================================================
// SUGGESTED CASES — high-impact subjects without an open case
// ============================================================
export type SuggestedCase = {
  icao_hex: string;
  registration: string | null;
  owner: string | null;
  low_alt_7d: number;
  detections_7d: number;
  top_county: string | null;
  is_military: boolean;
};

export const getSuggestedCases = createServerFn({ method: "GET" }).handler(async () => {
  return q<SuggestedCase>(
    `
    WITH agg AS (
      SELECT d.icao_hex,
             MAX(d.registration) AS registration,
             MAX(ap.registered_owner) AS owner,
             count(*)::int AS detections_7d,
             sum(CASE WHEN d.is_91_227_violator THEN 1 ELSE 0 END)::int AS low_alt_7d,
             (SELECT county FROM detections d2 WHERE d2.icao_hex=d.icao_hex
              AND d2.county IS NOT NULL GROUP BY county ORDER BY count(*) DESC LIMIT 1) AS top_county,
             bool_or(d.is_military) AS is_military
      FROM detections d
      LEFT JOIN aircraft_profiles ap ON ap.icao_hex = d.icao_hex
      WHERE d.captured_at > now() - interval '7 days'
      GROUP BY d.icao_hex
      HAVING sum(CASE WHEN d.is_91_227_violator THEN 1 ELSE 0 END) >= 3
    )
    SELECT a.* FROM agg a
    WHERE NOT EXISTS (
      SELECT 1 FROM cases c
      WHERE (c.subject_icao = a.icao_hex OR c.subject_reg = a.registration)
        AND c.status IN ('DRAFT','REVIEW','CONFIRMED','OPEN')
    )
    ORDER BY a.low_alt_7d DESC, a.detections_7d DESC
    LIMIT 12
    `,
  );
});

// ============================================================
// AI CORROBORATION — Josiah second-opinion on a case
// ============================================================
export const corroborateCase = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string }) => {
    if (!d?.caseId) throw new Error("caseId required");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");
    const { neonQuery } = await import("./neon.server");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");

    const caseRows = await neonQuery<Record<string, unknown>>(
      `SELECT * FROM cases WHERE case_id=$1 OR id::text=$1 LIMIT 1`,
      [data.caseId],
    );
    const c = caseRows[0];
    if (!c) throw new Error("case not found");

    const det = (c.detection_ids as string[] | null)?.length
      ? await neonQuery(
          `SELECT captured_at, altitude_ft, county, is_91_227_violator, is_military
           FROM detections WHERE id = ANY($1::uuid[]) ORDER BY captured_at LIMIT 50`,
          [(c.detection_ids as string[]).slice(0, 50)],
        )
      : [];

    const gateway = createLovableAiGatewayProvider(key);
    const system = `You are Josiah's verification subroutine. You re-read a case file and detection sample and return a STRUCTURED JSON object with these keys ONLY:
{
  "verdict": "CORROBORATED" | "WEAK" | "CONTRADICTED",
  "confidence": 0-100,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "missing_evidence": ["..."],
  "recommended_status": "DRAFT" | "REVIEW" | "CONFIRMED" | "DISMISSED",
  "one_line_summary": "..."
}
No prose, no markdown, no code fences. Only the JSON object.`;

    try {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system,
        prompt: `## Case file\n${JSON.stringify(c, null, 2)}\n\n## Detection sample (up to 50)\n${JSON.stringify(det, null, 2)}`,
      });
      // best-effort JSON parse
      let parsed: Record<string, unknown> | null = null;
      try {
        const m = text.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : null;
      } catch {
        parsed = null;
      }
      return { ok: true as const, raw: text, parsed };
    } catch (e) {
      const msg = (e as Error).message ?? "AI gateway error";
      return { ok: false as const, error: msg };
    }
  });
