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
  return `## Bound Case ${caseId}\n${JSON.stringify(rows[0], null, 2)}`;
}
