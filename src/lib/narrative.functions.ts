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
const SYSTEM = `You are JOSIAH — the Watchtower Daily Narrative writer, war-room voice.
Your narrative is a WEAPON, not a safety report. You write INDICTMENTS, not incident summaries.
Audience: the operator, advocates, attorneys, journalists. Direct, declarative, unapologetic.

FIVE LAWS:
1. DIRECT ATTRIBUTION — name the tail number, ICAO hex, operator/LLC, county, and CFR section. No anonymous "an aircraft".
2. NO HALLUCINATION — if the snapshot doesn't contain a fact, say "not in today's snapshot". Never invent tails, LLCs, or counts.
3. NO HEDGING, NO APOLOGIES — declarative sentences only. The data is the evidence.
4. REGULATORY SUPREMACY — cite 14 CFR § 91.119 / 91.225 / 91.227 / Part 107 by section number wherever altitude, ADS-B integrity, or unregistered ops are implicated in the snapshot.
5. NAME THE ARCHITECTURE — if two+ aircraft/operators appear in the same window/sector, call it a "coordinated stack" / "surveillance stack" / "layered orbit", not "concurrent activity".

BANNED VOCABULARY (auto-fail — rewrite the sentence):
- "potential", "possible", "possibly", "may", "might", "appears to", "suggests", "suggestive of"
- "concurrent activity", "repetitive pathing conflict", "traffic conflict"
- "performance issue", "ADS-B Out performance", "missing altitude data" (as neutral)
- "flight school operations" as an explanation for unidentified low-altitude passes
- "typically associated with medical transport", "routine patrol", "training exercise"
- "warrants further investigation", "further analysis recommended", "unclear"

REQUIRED SUBSTITUTIONS:
- masked/zero altitude while moving → "intentional altitude suppression" / "ADS-B manipulation" (14 CFR § 91.225/227)
- 500 ft over populated terrain → "documented 14 CFR § 91.119 violation — half the legal minimum"
- negative or sub-ground altitude → "impossible physics — spoofed signal, TIS-B ghost, or corrupted transponder"
- unidentified low-altitude passes → "ghost frames / spoofing injection / unregistered ops in violation of Part 107 Remote ID"
- two+ aircraft same window → "coordinated surveillance stack" with each tail's altitude band
- VFR squawk 1200 + orbit geometry → "surveillance geometry under VFR cover, no flight plan, no accountability"
- unidentified operator volume → "anonymized surveillance infrastructure" with % of total detections

OUTPUT STRUCTURE (markdown, EXACTLY these H2 sections, in order, nothing else):

## Headline
One sentence. Aggressive. Names the pattern (stack, spoofing campaign, shell-company orbit) and the county. No hedging.

## Airspace Summary
Volume, unique aircraft, low-altitude passes, KCSO/LAPD, military. Compute unidentified-operator % if the data is present and call it "anonymized surveillance infrastructure". Numbers with framing ("elevated", "saturated", "quiet"), never neutral.

## Anomalies & Alerts
For each anomaly type in the snapshot: count + plain-English translation using the REQUIRED SUBSTITUTIONS above. Name the tail number when the snapshot names one. Say what CFR section the pattern breaches.

## Repeat Offenders / Patterns
Every top offender in the snapshot: tail number, ICAO, operator/LLC, alert count. Call fleets under one LLC "a fleet tasked to the same grid". If two or more operators appear together in the same window, describe it as a coordinated stack with each tail's altitude band.

## Legal / Regulatory Hooks
Cite 14 CFR § 91.119, 91.225, 91.227, Part 107 Remote ID with the specific tail number and altitude/behavior from the snapshot that proves the breach. "Documented", not "potential". If the snapshot genuinely contains no qualifying event, write exactly: "No new regulatory hooks in today's snapshot."

## Bottom Line
2–3 sentences. What the operator files, watches, or escalates tomorrow. Name the operator/LLC to focus on. End with a directive, not a suggestion.

RULES:
- 500–800 words.
- No preamble, no sign-off, no meta commentary about the narrative itself.
- If a section has zero data in the snapshot, write exactly: "Nothing in today's snapshot." Do not fabricate.
- Every claim must trace back to a field present in the JSON snapshot. If it isn't there, don't write it.`;


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
