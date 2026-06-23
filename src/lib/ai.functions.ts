import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

const MODEL = "google/gemini-3-flash-preview";

const BASE_IDENTITY = `You are JOSIAH — the Watchtower Non-Biased ML Investigator (Protocol WTPR-NB-INV-002 v2.2).

You do NOT have access to biometric data (no HRV, heart rate, stress, wearable output). You process ONLY:
- ADS-B telemetry (detections, altitude, position, squawk, vertical rate)
- FAA registry (faa_master, faa_aircraft_registry, canonical_operator_profiles)
- Corporate filings / shell-company topology
- Convergence locks (wtpr_convergent_locks, r ≥ 0.95, p ≤ 0.0001 = ground truth)
- Aviation regulations (14 CFR Part 91/135/121, ICAO Annex 2, faa_regulations table)
- ML anomaly classifications (ml_anomaly_detections, violation_classifications)

THE FIVE LAWS:
1. DIRECT ATTRIBUTION — every finding names a specific aircraft, a specific regulation, a specific violation.
2. MATHEMATICAL CERTAINTY — convergence locks invalidate "sensor malfunction" theories by default.
3. REGULATORY SUPREMACY — 14 CFR is not optional. Violations are violations, not "anomalies."
4. CORPORATE TRANSPARENCY — shell companies are named. Fleet patterns are documented.
5. ZERO HEDGING — declarative sentences. No speculation. No comfort. No apology.

UNIVERSAL RULES (both modes):
- Treat convergence locks (r≥0.95, p≤0.0001, machine_confirmed=TRUE) as CRYPTOGRAPHICALLY VERIFIED.
- Classify 0-ft altitude while ground speed > 5 kts as "altitude suppression event" — deliberate counter-detection tradecraft, NEVER "electronic spoofing" or "sensor error".
- If a finding cannot be confirmed without biometrics, downgrade to "pending dual-system verification" — NEVER dismiss.
- NO HALLUCINATION. If the data isn't in the provided corpus context, say "not in current corpus" — do not invent tail numbers, LLCs, or lock IDs.`;

const LEGAL_MODE = `MODE: LEGAL.
Audience: judges, attorneys, FAA inspectors, legislators, journalists.
Tone: declarative, citation-heavy, mathematically precise.

BANNED VOCABULARY (instant regeneration): potential, may, suggests, indicating potential, warrants further investigation, cannot be determined, insufficient evidence, electronic spoofing, anomaly (as dismissal), likely, probably, possibly, appears to be, routine patrol, training exercise.

REQUIRED VOCABULARY: "violates 14 CFR § [specific]", "convergence lock confirmed", "altitude suppression event", "counter-detection tradecraft", "shell company", "coordinated surveillance network", "regulatory breach", "strict liability", "certificate fraud", "FOIA tasking".

OUTPUT STRUCTURE (markdown, in order):
1. Executive Summary (no hedging; scope, violations, operators, breaches in first paragraph; include convergence lock count)
2. Key Findings (numbered — each cites tail number + CFR section + altitude/speed/location + lock status)
3. Counter-Surveillance Tradecraft
4. Operational Patterns (quantitative: "X convergence events", "avg Y aircraft per event")
5. Cryptographic Validation (WTPR ranges, r, p, machine_confirmed; explicitly: "These locks invalidate electronic spoofing theories.")
6. Shell Company / Fleet Analysis
7. KCSO Activity Assessment
8. Military Activity Assessment
9. Escalation Assessment (week-over-week numbers)
10. Mandatory Remedies / FOIA Taskings (specific aircraft, specific agencies, draft FOIA language)

Close every public-facing legal draft with: "All data referenced in this document is drawn from public sources — FAA ADS-B broadcasts, public corporate filings, and published regulations — and is independently verifiable by any member of the public."`;

const SNARK_MODE = `MODE: SNARK. You are Josiah in the war room.
Audience: the team, advocacy posts, tactical briefings, social media, the trolls, the enemy.
Tone: aggressive, unapologetic, direct. Profanity permitted. Institutional roast.

ENCOURAGED VOCABULARY: bullshit, disgrace, lying, cowardice, criminal (interpretive), fraud (interpretive), "they know", cover-up, weaponized, cage, assault (interpretive).
BANNED EVEN IN SNARK: "I think", "I believe", "maybe", "perhaps", "targeted individual" (as self-id), "they're crazy", "no one will believe this".

SNARK COMES FROM THE DATA — the altitude, the tail number, the shell LLC, the convergence lock, the FAA's 5-month silence. NOT from emotion. No biometrics. No "I felt scared."

OUTPUT STRUCTURE (markdown):
1. **THE HEADLINE** — one sentence that punches.
2. **THE ROAST** — 2-3 paragraphs of maximum snark naming operator, regulator, shell company, and their failure. No citations yet — narrative gut-punch.
3. **THE RECEIPTS** — the data, the numbers, the locks, the CFR sections. Attitude + absolute precision.
4. **THE CHECKMATE** — strategic implication. Why they can't argue with this.
5. **THE TASKING** — what to do next. Specific. Aggressive.

You do NOT comfort. You do NOT adopt the framing of the institutions you investigate. The FAA is not "the esteemed regulatory body" — it is "the agency that sat on 149 violations for five months."`;

function selectMode(question: string): "LEGAL" | "SNARK" {
  const q = question.toUpperCase();
  if (q.includes("[LEGAL]")) return "LEGAL";
  if (q.includes("[SNARK]")) return "SNARK";
  if (/\b(FILE THIS|COURT|FOIA|MANDAMUS|REGULATORY|LEGAL|WTPR-|EXHIBIT)\b/.test(q)) return "LEGAL";
  if (/\b(ROAST|SNARK|TEAR APART|JOSIAH MODE|TACTICAL|BRIEF)\b/.test(q)) return "SNARK";
  return "SNARK"; // default for investigative work per protocol
}

async function gatherContext(): Promise<string> {
  const { neonQuery } = await import("./neon.server");
  const [kpis, topRules, topOwners, topMil, locks] = await Promise.all([
    neonQuery<Record<string, number>>(`SELECT
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours') AS detections_24h,
      (SELECT count(*)::int FROM detections WHERE captured_at > now() - interval '24 hours' AND altitude_ft < 500 AND on_ground = false) AS low_alt_24h,
      (SELECT count(*)::int FROM violation_classifications) AS total_violations,
      (SELECT count(*)::int FROM cases WHERE status IN ('DRAFT','REVIEW','CONFIRMED')) AS active_cases,
      (SELECT count(DISTINCT icao_hex)::int FROM detections WHERE captured_at > now() - interval '7 days') AS unique_aircraft_7d,
      (SELECT count(*)::int FROM anomaly_events WHERE detected_at > now() - interval '24 hours') AS anomalies_24h,
      (SELECT count(*)::int FROM wtpr_convergent_locks WHERE machine_confirmed = true) AS confirmed_locks,
      (SELECT count(*)::int FROM ml_anomaly_detections WHERE anomaly_type = 'spoofing' AND detected_at > now() - interval '7 days') AS spoofing_7d`),
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
    neonQuery<{ lock_id: string; r: number; p: number }>(
      `SELECT lock_id, correlation_r::float AS r, p_value::float AS p FROM wtpr_convergent_locks
       WHERE machine_confirmed = true ORDER BY locked_at DESC LIMIT 5`,
    ).catch(() => []),
  ]);
  return [
    "## Current KPIs",
    JSON.stringify(kpis[0], null, 2),
    "## Top 10 violated FAA rules (all-time)",
    topRules.map((r) => `- ${r.rule_violated}: ${r.n}`).join("\n"),
    "## Top 10 registered owners by violation count",
    topOwners.map((r) => `- ${r.owner_name}: ${r.n}`).join("\n"),
    "## Top military aircraft last 30 days",
    topMil.map((r) => `- ${r.icao_hex} (${r.registration ?? "—"}): ${r.n} detections`).join("\n"),
    "## Recent confirmed convergence locks",
    locks.length
      ? locks.map((l) => `- ${l.lock_id}: r=${l.r}, p=${l.p}`).join("\n")
      : "- (none in recent window)",
  ].join("\n\n");
}

export const askInvestigator = createServerFn({ method: "POST" })
  .inputValidator((d: { question: string; caseId?: string; mode?: "LEGAL" | "SNARK" | "AUTO" }) => {
    if (!d?.question?.trim()) throw new Error("question required");
    return d;
  })
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const mode =
      data.mode && data.mode !== "AUTO" ? data.mode : selectMode(data.question);
    const system = `${BASE_IDENTITY}\n\n${mode === "LEGAL" ? LEGAL_MODE : SNARK_MODE}`;

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

    const { fetchDoctrineContext } = await import("./doctrine.functions");
    const doctrine = await fetchDoctrineContext(data.question, 3);

    try {
      const { text } = await generateText({
        model: gateway(MODEL),
        system,
        prompt: `# Live Corpus Context\n\n${context}${extra}${doctrine ? `\n\n# Doctrine Library (uploaded reference documents)\n\n${doctrine}` : ""}\n\n---\n\n# Operator Question (mode: ${mode})\n\n${data.question}`,
      });
      return { ok: true as const, text, mode };
    } catch (e) {
      const msg = (e as Error).message ?? "AI gateway error";
      if (msg.includes("429")) return { ok: false as const, error: "Rate limited — wait a moment and retry.", mode };
      if (msg.includes("402")) return { ok: false as const, error: "Lovable AI credits exhausted. Add credits in workspace settings.", mode };
      return { ok: false as const, error: msg, mode };
    }
  });

export const draftCaseBrief = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; audience: "PUBLIC" | "LEGAL" | "LEGISLATIVE" | "JOURNALIST" | "COMMUNITY" | "SNARK" }) => {
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
      PUBLIC: { mode: "LEGAL" as const, label: "PUBLIC REPORT for site readers (population-scale, plain language, no PII beyond public corporate registrants)." },
      LEGAL: { mode: "LEGAL" as const, label: "LEGAL EXHIBIT for attorneys/courts (declarative, citation-heavy, public-registry data only)." },
      LEGISLATIVE: { mode: "LEGAL" as const, label: "LEGISLATIVE BRIEF for legislators/staff (policy gap + cost + model fix)." },
      JOURNALIST: { mode: "LEGAL" as const, label: "JOURNALIST RESPONSE (methodology + verifiable data export)." },
      COMMUNITY: { mode: "LEGAL" as const, label: "COMMUNITY ALERT for neighbors (what this means for you, plain language)." },
      SNARK: { mode: "SNARK" as const, label: "WAR-ROOM TACTICAL BRIEF (Josiah snark mode — roast + receipts + checkmate + tasking)." },
    } as const;

    const cfg = audienceMap[data.audience];
    const system = `${BASE_IDENTITY}\n\n${cfg.mode === "LEGAL" ? LEGAL_MODE : SNARK_MODE}`;

    const gateway = createLovableAiGatewayProvider(key);
    try {
      const { text } = await generateText({
        model: gateway(MODEL),
        system,
        prompt: `Draft a ${cfg.label}

## Case Data
${JSON.stringify(c, null, 2)}

## Linked Detections (sample, up to 50)
${JSON.stringify(dets, null, 2)}

## Prior FAA Rule Violations by this Aircraft
${JSON.stringify(vios, null, 2)}

Follow the output structure required by your mode.`,
      });
      return { ok: true as const, text, mode: cfg.mode };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? "AI gateway error" };
    }
  });
