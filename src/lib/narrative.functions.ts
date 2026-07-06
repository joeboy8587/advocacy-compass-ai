import { createServerFn } from "@tanstack/react-start";
import { createHash } from "crypto";

const MODEL = "google/gemini-3-flash-preview";

// ---- schema (lazy, idempotent) ----
async function ensureTable() {
  const { neonQuery } = await import("./neon.server");
  await neonQuery(`
    CREATE TABLE IF NOT EXISTS daily_narratives (
      id BIGSERIAL PRIMARY KEY,
      narrative_date DATE NOT NULL UNIQUE,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      narrative_md TEXT NOT NULL,
      sha256 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS daily_narratives_date_idx
      ON daily_narratives (narrative_date DESC);
  `);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- snapshot gatherer ----
type Snapshot = {
  window: { from: string; to: string };
  kpis: Record<string, number | string | null>;
  top_operators: Array<{ operator: string | null; detections: number; low_alt: number; kcso: boolean }>;
  top_offenders: Array<{ registration: string | null; icao_hex: string; operator: string | null; alerts: number; last_seen: string }>;
  anomalies: Array<{ type: string; count: number; sample_reg: string | null }>;
  critical_alerts: Array<{ registration: string | null; icao_hex: string | null; altitude_ft: number | null; reason: string | null; captured_at: string; county: string | null }>;
  low_alt_incidents: Array<{ registration: string | null; icao_hex: string; min_altitude_ft: number; passes: number; county: string | null }>;
  convergence_locks_today: number;
  active_cases: number;
  new_violations: number;
};

async function gatherSnapshot(dateIso: string): Promise<Snapshot> {
  const { neonQuery } = await import("./neon.server");
  const from = `${dateIso} 00:00:00+00`;
  const to = `${dateIso} 23:59:59+00`;

  const safe = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch (e) { console.warn("[narrative] gather failed:", (e as Error).message); return []; }
  };

  const [kpisRows, opsRows, offRows, anomRows, critRows, lowRows, locksRows, casesRows, vioRows] =
    await Promise.all([
      safe(() => neonQuery<Record<string, number>>(
        `SELECT
          (SELECT count(*)::int FROM detections WHERE captured_at BETWEEN $1 AND $2) AS detections,
          (SELECT count(DISTINCT icao_hex)::int FROM detections WHERE captured_at BETWEEN $1 AND $2) AS unique_aircraft,
          (SELECT count(*)::int FROM detections WHERE captured_at BETWEEN $1 AND $2 AND altitude_ft < 500 AND on_ground = false) AS low_alt_passes,
          (SELECT count(*)::int FROM aoi_alerts WHERE captured_at BETWEEN $1 AND $2) AS alerts,
          (SELECT count(*)::int FROM aoi_alerts WHERE captured_at BETWEEN $1 AND $2 AND alert_level='CRITICAL') AS critical_alerts,
          (SELECT count(*)::int FROM anomaly_events WHERE detected_at BETWEEN $1 AND $2) AS anomalies,
          (SELECT count(*)::int FROM ml_anomaly_detections WHERE detected_at BETWEEN $1 AND $2) AS ml_anomalies,
          (SELECT count(*)::int FROM convergence_events WHERE detected_at BETWEEN $1 AND $2) AS convergences,
          (SELECT count(*)::int FROM detections WHERE captured_at BETWEEN $1 AND $2 AND is_military=true) AS military_passes`,
        [from, to],
      )),
      safe(() => neonQuery<{ operator: string | null; detections: number; low_alt: number; kcso: boolean }>(
        `SELECT COALESCE(o.operator_resolved, o.faa_registrant_name) AS operator,
                count(*)::int AS detections,
                count(*) FILTER (WHERE d.altitude_ft < 500 AND d.on_ground = false)::int AS low_alt,
                bool_or(COALESCE(o.kcso_flag,false)) AS kcso
         FROM detections d
         LEFT JOIN canonical_operator_profiles o ON o.icao_hex = d.icao_hex
         WHERE d.captured_at BETWEEN $1 AND $2
         GROUP BY 1 ORDER BY detections DESC NULLS LAST LIMIT 8`,
        [from, to],
      )),
      safe(() => neonQuery<{ registration: string | null; icao_hex: string; operator: string | null; alerts: number; last_seen: string }>(
        `SELECT a.registration, a.icao_hex,
                COALESCE(o.operator_resolved, o.faa_registrant_name) AS operator,
                count(*)::int AS alerts,
                MAX(a.captured_at)::text AS last_seen
         FROM aoi_alerts a
         LEFT JOIN canonical_operator_profiles o ON o.icao_hex = a.icao_hex
         WHERE a.captured_at BETWEEN $1 AND $2
         GROUP BY a.registration, a.icao_hex, operator
         ORDER BY alerts DESC LIMIT 10`,
        [from, to],
      )),
      safe(() => neonQuery<{ type: string; count: number; sample_reg: string | null }>(
        `SELECT anomaly_type AS type, count(*)::int AS count, MAX(aircraft_registration) AS sample_reg
         FROM ml_anomaly_detections
         WHERE detected_at BETWEEN $1 AND $2
         GROUP BY anomaly_type ORDER BY count DESC LIMIT 8`,
        [from, to],
      )),
      safe(() => neonQuery<{ registration: string | null; icao_hex: string | null; altitude_ft: number | null; reason: string | null; captured_at: string; county: string | null }>(
        `SELECT registration, icao_hex, altitude_ft, reason, captured_at::text, NULL::text AS county
         FROM aoi_alerts
         WHERE captured_at BETWEEN $1 AND $2 AND alert_level='CRITICAL'
         ORDER BY captured_at DESC LIMIT 12`,
        [from, to],
      )),
      safe(() => neonQuery<{ registration: string | null; icao_hex: string; min_altitude_ft: number; passes: number; county: string | null }>(
        `SELECT MAX(registration) AS registration, icao_hex,
                MIN(altitude_ft)::int AS min_altitude_ft,
                count(*)::int AS passes,
                MAX(county) AS county
         FROM detections
         WHERE captured_at BETWEEN $1 AND $2
           AND altitude_ft IS NOT NULL AND altitude_ft < 500 AND on_ground=false
         GROUP BY icao_hex ORDER BY passes DESC LIMIT 10`,
        [from, to],
      )),
      safe(() => neonQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM wtpr_convergent_locks
         WHERE created_at BETWEEN $1 AND $2 AND machine_confirmed = true`,
        [from, to],
      )),
      safe(() => neonQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM cases WHERE status IN ('DRAFT','REVIEW','OPEN','CONFIRMED')`,
      )),
      safe(() => neonQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM violation_classifications WHERE captured_at BETWEEN $1 AND $2`,
        [from, to],
      )),
    ]);

  return {
    window: { from, to },
    kpis: (kpisRows[0] as Record<string, number | string | null>) ?? {},
    top_operators: opsRows,
    top_offenders: offRows,
    anomalies: anomRows,
    critical_alerts: critRows,
    low_alt_incidents: lowRows,
    convergence_locks_today: locksRows[0]?.n ?? 0,
    active_cases: casesRows[0]?.n ?? 0,
    new_violations: vioRows[0]?.n ?? 0,
  };
}

// ---- prompt ----
const SYSTEM = `You are JOSIAH — the Watchtower Analyst.
You write the DAILY NARRATIVE for the operator (analyst tone, direct, technical vocabulary allowed: ICAO24, loiter, squawk, KCSO, LAPD Air Support, Part 91, Part 107).
You interpret RAW DATA into a plain-English story the operator can actually read.

FIVE LAWS:
1. Direct attribution — name the tail number, operator, county, and CFR section when the data supports it.
2. No hallucination — if the snapshot doesn't contain something, don't invent it. Say "not in today's data".
3. No hedging — declarative. No "may", "possibly", "appears to".
4. Regulatory citation — call out 14 CFR Part 91 / 91.119 / 91.225 / 91.227 / Part 107 when altitude, ADS-B, or operator behavior implicates them.
5. Baseline framing — always compare today's numbers to what's normal (e.g., "vs. typical baseline", "elevated", "quiet day").

OUTPUT STRUCTURE (markdown, EXACTLY these H2 sections, in order, nothing else):

## Headline
One sentence. What actually happened today.

## Airspace Summary
Volume, unique aircraft, low-altitude passes, KCSO/LAPD activity, military. Numbers with context ("elevated", "quiet", "on par with 7-day avg").

## Anomalies & Alerts
Every anomaly type flagged today, count, what it means in plain English, and which tail numbers if named. Explain the "why this matters" for each.

## Repeat Offenders / Patterns
Aircraft or operators appearing today that also show up in prior data. Include tail number, operator, and pass count.

## Legal / Regulatory Hooks
CFR sections implicated by today's behavior. Only cite if a specific event in the snapshot supports it. If none, say "No new regulatory hooks today."

## Bottom Line
2-3 sentences. What the operator should do next or watch tomorrow.

RULES:
- ~450-700 words total.
- No preamble, no closing sign-off — just the 6 sections above.
- If a section has zero data, write one line: "Nothing to report." Do not fabricate.`;

async function generateNarrativeText(snapshot: Snapshot, dateIso: string): Promise<{ text: string; provider: string }> {
  const { generateTextWithFallback } = await import("./ai-fallback.server");
  const prompt = `# Date (UTC)
${dateIso}

# Today's Snapshot (raw data pulled from Neon)
${JSON.stringify(snapshot, null, 2)}

Write the daily narrative following the required structure.`;
  const { text, provider } = await generateTextWithFallback({
    model: MODEL,
    system: SYSTEM,
    prompt,
  });
  return { text, provider };
}

// ---- read ----
export type NarrativeRow = {
  id: number;
  narrative_date: string;
  generated_at: string;
  model: string;
  provider: string;
  narrative_md: string;
  sha256: string;
  snapshot: Snapshot;
};

export const getRecentNarratives = createServerFn({ method: "GET" })
  .inputValidator((d: { days?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    try {
      await ensureTable();
      const { neonQuery } = await import("./neon.server");
      const days = Math.min(data.days ?? 14, 60);
      const rows = await neonQuery<NarrativeRow>(
        `SELECT id, narrative_date::text, generated_at::text, model, provider,
                narrative_md, sha256, snapshot
         FROM daily_narratives
         ORDER BY narrative_date DESC
         LIMIT $1`,
        [days],
      );
      return rows;
    } catch (e) {
      console.error("[narrative] getRecentNarratives failed:", (e as Error).message);
      return [];
    }
  });

// ---- write ----
async function persistNarrative(dateIso: string, snapshot: Snapshot, text: string, provider: string) {
  const { neonQuery } = await import("./neon.server");
  const sha = createHash("sha256").update(text).digest("hex");
  const rows = await neonQuery<NarrativeRow>(
    `INSERT INTO daily_narratives (narrative_date, model, provider, snapshot, narrative_md, sha256)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (narrative_date) DO UPDATE
       SET generated_at = now(),
           model = EXCLUDED.model,
           provider = EXCLUDED.provider,
           snapshot = EXCLUDED.snapshot,
           narrative_md = EXCLUDED.narrative_md,
           sha256 = EXCLUDED.sha256
     RETURNING id, narrative_date::text, generated_at::text, model, provider, narrative_md, sha256, snapshot`,
    [dateIso, MODEL, provider, JSON.stringify(snapshot), text, sha],
  );
  return rows[0];
}

/** Auto-generate today's narrative if it doesn't exist yet. Idempotent. */
export const ensureTodayNarrative = createServerFn({ method: "POST" }).handler(async () => {
  try {
    await ensureTable();
    const { neonQuery } = await import("./neon.server");
    const dateIso = todayUTC();
    const existing = await neonQuery<NarrativeRow>(
      `SELECT id, narrative_date::text, generated_at::text, model, provider,
              narrative_md, sha256, snapshot
       FROM daily_narratives WHERE narrative_date = $1 LIMIT 1`,
      [dateIso],
    );
    if (existing[0]) return { ok: true as const, row: existing[0], created: false };

    if (!process.env.LOVABLE_API_KEY && !process.env.OPENAI_API_KEY) {
      return { ok: false as const, error: "No AI key configured (LOVABLE_API_KEY or OPENAI_API_KEY)" };
    }
    const snapshot = await gatherSnapshot(dateIso);
    const { text, provider } = await generateNarrativeText(snapshot, dateIso);
    const row = await persistNarrative(dateIso, snapshot, text, provider);
    return { ok: true as const, row, created: true };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message ?? "Failed to generate narrative" };
  }
});

/** Force regeneration for a specific date (default today). */
export const regenerateNarrative = createServerFn({ method: "POST" })
  .inputValidator((d: { date?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    try {
      await ensureTable();
      if (!process.env.LOVABLE_API_KEY && !process.env.OPENAI_API_KEY) {
        return { ok: false as const, error: "No AI key configured" };
      }
      const dateIso = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : todayUTC();
      const snapshot = await gatherSnapshot(dateIso);
      const { text, provider } = await generateNarrativeText(snapshot, dateIso);
      const row = await persistNarrative(dateIso, snapshot, text, provider);
      return { ok: true as const, row, created: true };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? "Failed to regenerate" };
    }
  });
