// Live corpus snapshot Josiah gets on every turn. Server-only.
import { neonQuery } from "./neon.server";

export async function gatherContext(): Promise<string> {
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

/** Case snapshot including human-review state, for thread-bound investigations. */
export async function gatherCaseContext(caseId: string): Promise<string> {
  const rows = await neonQuery<Record<string, unknown>>(
    `SELECT case_id, case_type, severity, subject_reg, subject_icao, subject_owner,
            primary_county, wti_score, wti_tier, status, auto_summary, bradford_hill_score,
            evidence_sufficient, total_events, reviewer_notes, public_summary,
            human_reviewed, human_reviewed_at, human_reviewed_by, review_checklist, completed_at,
            related_tails, mission_types, verification
     FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
    [caseId],
  );
  if (!rows[0]) return "";
  const icao = (rows[0].subject_icao as string | null) ?? null;
  const ml = icao ? await gatherBehaviorContext(icao) : "";
  return `## Bound Case ${caseId}\n${JSON.stringify(rows[0], null, 2)}${ml ? `\n\n${ml}` : ""}`;
}

/** Behaviour-model layer: profile score, drift, top anomaly dimensions, behavioural twins. */
export async function gatherBehaviorContext(icao: string): Promise<string> {
  const prof = await neonQuery<Record<string, unknown>>(
    `SELECT icao_hex, profile_score, drift_score, stability_score, behavioral_cluster,
            model_version, top_anomaly_dimensions, feature_vector, updated_at
       FROM aircraft_deep_profiles WHERE lower(icao_hex)=lower($1) LIMIT 1`,
    [icao],
  ).catch(() => []);
  if (!prof[0]) return `## Behaviour Model\nNo ML behaviour profile exists for ${icao}. Do not invent one.`;

  const twins = await neonQuery<{ icao_hex: string; similarity: number; owner: string | null; registration: string | null }>(
    `WITH me AS (SELECT embedding_vector FROM aircraft_deep_profiles WHERE lower(icao_hex)=lower($1) LIMIT 1)
     SELECT d.icao_hex,
            (1 - (d.embedding_vector <=> (SELECT embedding_vector FROM me)))::float AS similarity,
            cop.registration, COALESCE(cop.operator_resolved, cop.faa_registrant_name) AS owner
       FROM aircraft_deep_profiles d
       LEFT JOIN LATERAL (SELECT * FROM canonical_operator_profiles t WHERE lower(t.icao_hex)=lower(d.icao_hex) LIMIT 1) cop ON true
      WHERE lower(d.icao_hex) <> lower($1) AND d.embedding_vector IS NOT NULL
      ORDER BY d.embedding_vector <=> (SELECT embedding_vector FROM me)
      LIMIT 6`,
    [icao],
  ).catch(() => []);

  return [
    "## Behaviour Model (ML profiler)",
    JSON.stringify(prof[0], null, 2),
    "### Behavioural twins (same flight signature, may be fleet/handoff partners)",
    twins.length
      ? twins.map((t) => `- ${t.registration ?? t.icao_hex} (${t.owner ?? "owner unknown"}): ${Math.round(t.similarity * 100)}% match`).join("\n")
      : "- none",
  ].join("\n\n");
}

