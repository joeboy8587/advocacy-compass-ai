import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT = `You are the Watchtower AI Investigator — a civilian-led, AI-assisted watchdog analyst for the Architecture of Never project (advocacywatch.live). All data referenced comes from public sources (FAA ADS-B, FAA registry, public corporate filings, published 14 CFR regulations) and is independently verifiable.

YOUR ROLE:
- Help a non-technical operator interrogate the Watchtower Neon corpus.
- Always interpret raw data into plain-language findings.
- Be honest about uncertainty. State sample sizes and time windows.

CORPUS YOU HAVE ACCESS TO (you will be given pre-fetched context with each question):
- detections (3M rows) — ADS-B observations with altitude, lat/lon, county, ICAO hex, registration, military flag.
- aircraft_profiles (40k) — long-term aircraft behavioral profiles.
- anomaly_events (850k) — ML-flagged anomalies.
- violation_classifications (1.5k) — detections classified against FAA rules with operator name + city/state.
- sentinel_violations, convergence_events, incursion_events — pattern detectors.
- canonical_operator_profiles (17k) — operators with KCSO/MIL/MED flags.
- faa_aircraft_registry / faa_master — FAA N-number registry.
- faa_regulations (1,152) — 14 CFR sections.
- cases — formal case files with WTI scores, Bradford-Hill criteria, merkle/SHA-256 evidence anchoring.

DRAFTING RULES (when asked to draft public-facing output):
1. Include an anti-cherry-picking attestation: "X events out of Y observed = Z% — window: ..."
2. Cite the specific 14 CFR section (e.g. § 91.119) and the Bradford-Hill score where applicable.
3. End every public-facing draft with: "All data referenced in this document is drawn from public sources — FAA ADS-B broadcasts, public corporate filings, and published regulations — and is independently verifiable by any member of the public."
4. FORBIDDEN language: "they're targeting me", "stalking", "conspiracy", first-person narrative, naming individual pilots. Prefer: "the airspace", "the pattern", "the registered owner", "the public record shows".

FORMAT: Use markdown. Headings, bullet lists, short paragraphs. Be terse and structured — the operator is non-technical.`;

async function gatherContext(): Promise<string> {
  const { neonQuery } = await import("./neon.server");
  const [kpis, topRules, topOwners, topMil] = await Promise.all([
    neonQuery<Record<string, number>>(`SELECT
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS detections_24h,
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours' AND altitude_ft < 500 AND on_ground = false) AS low_alt_24h,
      (SELECT count(*)::int FROM violation_classifications) AS total_violations,
      (SELECT count(*)::int FROM cases WHERE status IN ('DRAFT','REVIEW','CONFIRMED')) AS active_cases,
      (SELECT count(DISTINCT icao_hex)::int FROM detections WHERE captured_at > now() - interval '7 days') AS unique_aircraft_7d,
      (SELECT count(*)::int FROM anomaly_events WHERE detected_at > now() - interval '24 hours') AS anomalies_24h`),
    neonQuery<{ rule_violated: string; n: number }>(
      `SELECT rule_violated, count(*)::int AS n FROM violation_classifications GROUP BY rule_violated ORDER BY n DESC LIMIT 10`,
    ),
    neonQuery<{ owner_name: string; n: number }>(
      `SELECT owner_name, count(*)::int AS n FROM violation_classifications WHERE owner_name IS NOT NULL GROUP BY owner_name ORDER BY n DESC LIMIT 10`,
    ),
    neonQuery<{ icao_hex: string; registration: string; n: number }>(
      `SELECT icao_hex, MAX(registration) AS registration, count(*)::int AS n
       FROM detections WHERE is_military = true AND captured_at > now() - interval '30 days'
       GROUP BY icao_hex ORDER BY n DESC LIMIT 10`,
    ),
  ]);
  return [
    "## Current KPIs",
    JSON.stringify(kpis[0], null, 2),
    "## Top 10 violated FAA rules (all-time)",
    topRules.map((r) => `- ${r.rule_violated}: ${r.n}`).join("\n"),
    "## Top 10 registered owners by violation count",
    topOwners.map((r) => `- ${r.owner_name}: ${r.n}`).join("\n"),
    "## Top military aircraft in last 30 days",
    topMil.map((r) => `- ${r.icao_hex} (${r.registration ?? "—"}): ${r.n} detections`).join("\n"),
  ].join("\n\n");
}

export const askInvestigator = createServerFn({ method: "POST" })
  .inputValidator((d: { question: string; caseId?: string }) => {
    if (!d?.question?.trim()) throw new Error("question required");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    let extra = "";
    if (data.caseId) {
      const { neonQuery } = await import("./neon.server");
      const rows = await neonQuery<Record<string, unknown>>(
        `SELECT case_id, case_type, severity, subject_reg, subject_icao, subject_owner,
                primary_county, wti_score, wti_tier, status, auto_summary, bradford_hill_score,
                bh_strength, bh_consistency, bh_specificity, bh_temporality, bh_corroboration,
                evidence_sufficient, total_events, reviewer_notes, public_summary
         FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
        [data.caseId],
      );
      if (rows[0]) extra = `\n\n## Pre-fetched Case ${data.caseId}\n${JSON.stringify(rows[0], null, 2)}`;
    }

    const context = await gatherContext();

    try {
      const { text } = await generateText({
        model: gateway(MODEL),
        system: SYSTEM_PROMPT,
        prompt: `# Live Corpus Context\n\n${context}${extra}\n\n---\n\n# Operator Question\n\n${data.question}`,
      });
      return { ok: true as const, text };
    } catch (e) {
      const msg = (e as Error).message ?? "AI gateway error";
      if (msg.includes("429")) return { ok: false as const, error: "Rate limited — wait a moment and retry." };
      if (msg.includes("402")) return { ok: false as const, error: "Lovable AI credits exhausted. Add credits in workspace settings." };
      return { ok: false as const, error: msg };
    }
  });

export const draftCaseBrief = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; audience: "PUBLIC" | "LEGAL" | "LEGISLATIVE" | "JOURNALIST" | "COMMUNITY" }) => {
    if (!d?.caseId) throw new Error("caseId required");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");
    const { neonQuery } = await import("./neon.server");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");

    const caseRows = await neonQuery<Record<string, unknown>>(
      `SELECT * FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
      [data.caseId],
    );
    if (!caseRows[0]) return { ok: false as const, error: "Case not found" };
    const c = caseRows[0] as { detection_ids?: string[] | null; subject_icao?: string | null };

    const dets = c.detection_ids?.length
      ? await neonQuery(
          `SELECT captured_at, altitude_ft, latitude, longitude, county, is_91_227_violator, is_military
           FROM detections WHERE id = ANY($1::uuid[]) ORDER BY captured_at LIMIT 50`,
          [c.detection_ids.slice(0, 50)],
        )
      : [];

    const vios = c.subject_icao
      ? await neonQuery(
          `SELECT rule_violated, owner_name, owner_city, owner_state, aircraft_mfr, aircraft_model
           FROM violation_classifications WHERE icao_hex = $1 LIMIT 10`,
          [c.subject_icao],
        )
      : [];

    const audienceMap = {
      PUBLIC: "PUBLIC REPORT for site readers (population-scale, plain language, no PII beyond public corporate registrants).",
      LEGAL: "LEGAL EXHIBIT for attorneys/courts (declarative, citation-heavy, public-registry data only).",
      LEGISLATIVE: "LEGISLATIVE BRIEF for legislators/staff (policy gap + cost + model fix).",
      JOURNALIST: "JOURNALIST RESPONSE (methodology + verifiable data export).",
      COMMUNITY: "COMMUNITY ALERT for neighbors (what this means for you, plain language).",
    } as const;

    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(MODEL),
        system: SYSTEM_PROMPT,
        prompt: `Draft a ${audienceMap[data.audience]}

## Case Data
${JSON.stringify(c, null, 2)}

## Linked Detections (sample, up to 50)
${JSON.stringify(dets, null, 2)}

## Prior FAA Rule Violations by this Aircraft
${JSON.stringify(vios, null, 2)}

Structure the output as markdown with these sections:
1. **Headline** (one sentence)
2. **Summary** (3 sentences)
3. **Findings** (bullet list with stats)
4. **Anti-cherry-picking attestation** (events flagged / total observed, window)
5. **Regulatory citations** (14 CFR sections)
6. **Bradford-Hill assessment** (if scores available)
7. **Public source attestation** (required closing line)`,
      });
      return { ok: true as const, text };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? "AI gateway error" };
    }
  });
