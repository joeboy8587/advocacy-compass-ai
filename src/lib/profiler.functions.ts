import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

// ============================================================
// Plain-English translation of the ML feature vector.
// The operator of this command center is not technical: every
// number that reaches the screen must arrive with a sentence.
// ============================================================
type Features = Record<string, number>;

function pct(v: number | undefined, alreadyPct = false) {
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(alreadyPct ? v : v * 100);
}

export function explainFeatures(f: Features | null): string[] {
  if (!f) return [];
  const out: string[] = [];
  const night = pct(f.night_pct ?? f.profile_night_pct, true);
  if (night != null && night >= 15) out.push(`Flies at night ${night}% of the time — well above the typical civil pattern.`);
  const masked = pct(f.masked_ratio);
  if (masked != null && masked >= 5) out.push(`Broadcasts a masked or withheld identity on ${masked}% of its detections.`);
  const lowAlt = pct(f.low_alt_ratio);
  if (lowAlt != null && lowAlt >= 5) out.push(`Spends ${lowAlt}% of its time below the low-altitude threshold over populated ground.`);
  const veryLow = pct(f.very_low_ratio);
  if (veryLow != null && veryLow >= 2) out.push(`${veryLow}% of detections are at very low altitude — the profile of a hovering or orbiting mission, not transit.`);
  if ((f.heading_variance ?? 0) > 60 && (f.avg_altitude ?? 99999) < 6000) out.push(`Loiters: constant heading changes at low altitude, which is orbit behaviour rather than travel.`);
  const inside2 = pct(f.inside_2nm_ratio);
  if (inside2 != null && inside2 >= 1) out.push(`${inside2}% of detections sit within 2 nautical miles of a monitored location.`);
  const ground = pct(f.on_ground_ratio);
  if (ground != null && ground >= 30) out.push(`A third or more of its records are on the ground — short repeated sorties from a home base.`);
  if ((f.avg_distance_km ?? 0) > 100) out.push(`Operates an average of ${Math.round(f.avg_distance_km)} km from its registered base.`);
  if ((f.anomaly_count ?? 0) > 0) out.push(`Already carries ${Math.round(f.anomaly_count)} flagged anomaly record${f.anomaly_count === 1 ? "" : "s"} in the detection pipeline.`);
  if ((f.is_military ?? 0) > 0) out.push(`Registered or squawking as military/state aircraft.`);
  if ((f.det_count ?? 0) > 0) out.push(`Built from ${Math.round(f.det_count)} detections in the scoring window.`);
  return out;
}

function scoreLabel(score: number | null) {
  if (score == null) return "No score";
  if (score >= 85) return "Severe — behaves unlike almost every other aircraft in the database";
  if (score >= 65) return "Elevated — clearly outside the normal pattern";
  if (score >= 40) return "Watch — some unusual behaviour";
  return "Routine — behaves like the fleet baseline";
}

function driftLabel(drift: number | null) {
  if (drift == null) return "Drift unknown";
  if (drift >= 20) return "Changing fast — its flying pattern has shifted sharply since the last model run";
  if (drift >= 8) return "Drifting — the pattern is moving";
  return "Stable — flying the same way as before";
}

export type DeepProfile = {
  icao_hex: string;
  profile_score: number | null;
  drift_score: number | null;
  stability_score: number | null;
  behavioral_cluster: number | null;
  model_version: string | null;
  window_start: string | null;
  window_end: string | null;
  updated_at: string | null;
  score_label: string;
  drift_label: string;
  percentile: number | null;
  cluster_size: number | null;
  reasons: string[];
  top_dimensions: { name: string; weight: number }[];
  explanation: string | null;
};

export const getDeepProfile = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string }) => {
    if (!d?.icao?.trim()) throw new Error("icao required");
    return { icao: d.icao.trim() };
  })
  .handler(async ({ data }): Promise<DeepProfile | null> => {
    const rows = await q<{
      icao_hex: string; profile_score: number | null; drift_score: number | null;
      stability_score: number | null; behavioral_cluster: number | null;
      model_version: string | null; window_start: string | null; window_end: string | null;
      updated_at: string | null; top_anomaly_dimensions: Features | null; feature_vector: Features | null;
      percentile: number | null; cluster_size: number | null;
    }>(
      `SELECT p.icao_hex, p.profile_score, p.drift_score, p.stability_score, p.behavioral_cluster,
              p.model_version, p.window_start, p.window_end, p.updated_at,
              p.top_anomaly_dimensions, p.feature_vector,
              (SELECT round(100.0 * count(*) / NULLIF((SELECT count(*) FROM aircraft_deep_profiles), 0))
                 FROM aircraft_deep_profiles x WHERE x.profile_score <= p.profile_score)::int AS percentile,
              (SELECT count(*)::int FROM aircraft_deep_profiles c WHERE c.behavioral_cluster = p.behavioral_cluster) AS cluster_size
         FROM aircraft_deep_profiles p
        WHERE lower(p.icao_hex) = lower($1)
        LIMIT 1`,
      [data.icao],
    );
    if (!rows[0]) return null;
    const r = rows[0];

    const ex = await q<{ explanation: string }>(
      `SELECT explanation FROM profiler_explanations WHERE lower(icao_hex)=lower($1) ORDER BY created_at DESC LIMIT 1`,
      [data.icao],
    ).catch(() => []);

    const top = Object.entries(r.top_anomaly_dimensions ?? {})
      .map(([name, weight]) => ({ name: name.replace(/_/g, " "), weight: Number(weight) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);

    return {
      icao_hex: r.icao_hex,
      profile_score: r.profile_score,
      drift_score: r.drift_score,
      stability_score: r.stability_score,
      behavioral_cluster: r.behavioral_cluster,
      model_version: r.model_version,
      window_start: r.window_start,
      window_end: r.window_end,
      updated_at: r.updated_at,
      score_label: scoreLabel(r.profile_score),
      drift_label: driftLabel(r.drift_score),
      percentile: r.percentile,
      cluster_size: r.cluster_size,
      reasons: explainFeatures(r.feature_vector),
      top_dimensions: top,
      explanation: ex[0]?.explanation ?? null,
    };
  });

// ============================================================
// BEHAVIORAL TWINS — cosine similarity over the 64-dim fingerprint
// ============================================================
export type Twin = {
  icao_hex: string;
  similarity: number;
  match_label: string;
  profile_score: number | null;
  behavioral_cluster: number | null;
  registration: string | null;
  owner: string | null;
  detections: number | null;
  case_id: string | null;
};

function simLabel(s: number) {
  if (s >= 0.97) return "Near-identical flight behaviour";
  if (s >= 0.9) return "Very similar behaviour";
  if (s >= 0.8) return "Similar behaviour";
  return "Loosely similar";
}

export const findBehavioralTwins = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string; limit?: number }) => {
    if (!d?.icao?.trim()) throw new Error("icao required");
    return { icao: d.icao.trim(), limit: Math.min(d.limit ?? 8, 25) };
  })
  .handler(async ({ data }): Promise<Twin[]> => {
    const rows = await q<Omit<Twin, "match_label">>(
      `WITH me AS (
         SELECT embedding_vector FROM aircraft_deep_profiles WHERE lower(icao_hex)=lower($1) LIMIT 1
       ),
       near AS (
         SELECT d.icao_hex, d.profile_score, d.behavioral_cluster,
                (1 - (d.embedding_vector <=> (SELECT embedding_vector FROM me)))::float AS similarity
           FROM aircraft_deep_profiles d
          WHERE lower(d.icao_hex) <> lower($1) AND d.embedding_vector IS NOT NULL
          ORDER BY d.embedding_vector <=> (SELECT embedding_vector FROM me)
          LIMIT $2
       )
       SELECT n.icao_hex, n.similarity, n.profile_score, n.behavioral_cluster,
              COALESCE(cop.registration, ap.observed_registration, 'N' || fm.n_number) AS registration,
              COALESCE(cop.operator_resolved, cop.faa_registrant_name, ap.registered_owner, fm.name) AS owner,
              ap.total_detections AS detections,
              (SELECT c.case_id FROM cases c WHERE upper(c.subject_icao) = upper(n.icao_hex) ORDER BY c.opened_at DESC LIMIT 1) AS case_id
         FROM near n
         LEFT JOIN LATERAL (SELECT * FROM canonical_operator_profiles t WHERE t.icao_hex = upper(n.icao_hex) LIMIT 1) cop ON true
         LEFT JOIN LATERAL (SELECT * FROM aircraft_profiles t WHERE t.icao_hex = upper(n.icao_hex) ORDER BY t.total_detections DESC NULLS LAST LIMIT 1) ap ON true
         LEFT JOIN LATERAL (SELECT * FROM faa_master t WHERE t.mode_s_code_hex = upper(n.icao_hex) LIMIT 1) fm ON true
        ORDER BY n.similarity DESC`,
      [data.icao, data.limit],
    );
    return rows.map((r) => ({ ...r, match_label: simLabel(r.similarity) }));
  });

// Fingerprint-vote identity resolution: who do this airframe's closest
// behavioural twins belong to?
export const resolveByFingerprint = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string }) => {
    if (!d?.icao?.trim()) throw new Error("icao required");
    return { icao: d.icao.trim() };
  })
  .handler(async ({ data }) => {
    const rows = await q<{ owner: string | null; similarity: number }>(
      `WITH me AS (SELECT embedding_vector FROM aircraft_deep_profiles WHERE lower(icao_hex)=lower($1) LIMIT 1),
       near AS (
         SELECT d.icao_hex, (1 - (d.embedding_vector <=> (SELECT embedding_vector FROM me)))::float AS similarity
           FROM aircraft_deep_profiles d
          WHERE lower(d.icao_hex) <> lower($1) AND d.embedding_vector IS NOT NULL
          ORDER BY d.embedding_vector <=> (SELECT embedding_vector FROM me)
          LIMIT 12
       )
       SELECT COALESCE(cop.operator_resolved, cop.faa_registrant_name, ap.registered_owner, fm.name) AS owner,
              n.similarity
         FROM near n
         LEFT JOIN LATERAL (SELECT * FROM canonical_operator_profiles t WHERE t.icao_hex = upper(n.icao_hex) LIMIT 1) cop ON true
         LEFT JOIN LATERAL (SELECT * FROM aircraft_profiles t WHERE t.icao_hex = upper(n.icao_hex) ORDER BY t.total_detections DESC NULLS LAST LIMIT 1) ap ON true
         LEFT JOIN LATERAL (SELECT * FROM faa_master t WHERE t.mode_s_code_hex = upper(n.icao_hex) LIMIT 1) fm ON true
        ORDER BY n.similarity DESC`,
      [data.icao],
    );
    const votes = new Map<string, { n: number; sim: number }>();
    for (const r of rows) {
      const o = (r.owner ?? "").trim();
      if (!o) continue;
      const cur = votes.get(o) ?? { n: 0, sim: 0 };
      votes.set(o, { n: cur.n + 1, sim: Math.max(cur.sim, r.similarity) });
    }
    const considered = rows.filter((r) => (r.owner ?? "").trim()).length || 1;
    return [...votes.entries()]
      .map(([owner, v]) => ({
        owner,
        votes: v.n,
        considered,
        top_similarity: v.sim,
        confidence: Math.min(95, Math.round((v.n / considered) * 70 + v.sim * 25)),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 4);
  });

// ============================================================
// ML LEAD QUEUE — the shadow-eval backlog the rule engine missed
// ============================================================
export type MlLead = {
  id: string;
  icao_hex: string;
  profile_score: number | null;
  existing_max_score: number | null;
  match_status: string;
  existing_types: string[] | null;
  evaluated_at: string | null;
  reviewed: boolean;
  notes: string | null;
  registration: string | null;
  owner: string | null;
  detections: number | null;
  case_id: string | null;
  reason: string;
};

function leadReason(status: string, score: number | null, existing: number | null) {
  const s = score == null ? "unscored" : Math.round(score);
  if (status === "missed") return `The rule engine never flagged this aircraft, but the behaviour model scores it ${s}/100. This is an unworked lead.`;
  if (status === "new_signal") return `New behavioural signal at ${s}/100 that no existing rule covers (best rule score ${existing == null ? "none" : Math.round(existing)}).`;
  if (status === "agree") return `Both the rules and the behaviour model flag this aircraft (${s}/100) — strongest confidence.`;
  return `Quiet: nothing unusual (${s}/100).`;
}

export const getMlLeadQueue = createServerFn({ method: "GET" })
  .inputValidator((d: { status?: string; includeReviewed?: boolean; limit?: number } = {}) => ({
    status: d.status ?? "missed,new_signal",
    includeReviewed: !!d.includeReviewed,
    limit: Math.min(d.limit ?? 100, 300),
  }))
  .handler(async ({ data }) => {
    const statuses = data.status.split(",").map((s) => s.trim()).filter(Boolean);
    const rows = await q<Omit<MlLead, "reason">>(
      `WITH top AS (
         SELECT e.id, e.icao_hex, e.profile_score, e.existing_max_score, e.match_status,
                e.existing_types, e.evaluated_at, COALESCE(e.reviewed,false) AS reviewed, e.notes
           FROM profiler_shadow_eval e
          WHERE e.match_status = ANY($1)
            AND ($2::bool OR COALESCE(e.reviewed,false) = false)
          ORDER BY e.profile_score DESC NULLS LAST
          LIMIT $3
       )
       SELECT e.*,
              COALESCE(cop.registration, ap.observed_registration, 'N' || fm.n_number) AS registration,
              COALESCE(cop.operator_resolved, cop.faa_registrant_name, ap.registered_owner, fm.name) AS owner,
              ap.total_detections AS detections,
              (SELECT c.case_id FROM cases c WHERE upper(c.subject_icao)=upper(e.icao_hex) ORDER BY c.opened_at DESC LIMIT 1) AS case_id
         FROM top e
         LEFT JOIN LATERAL (SELECT * FROM canonical_operator_profiles t WHERE t.icao_hex = upper(e.icao_hex) LIMIT 1) cop ON true
         LEFT JOIN LATERAL (SELECT * FROM aircraft_profiles t WHERE t.icao_hex = upper(e.icao_hex) ORDER BY t.total_detections DESC NULLS LAST LIMIT 1) ap ON true
         LEFT JOIN LATERAL (SELECT * FROM faa_master t WHERE t.mode_s_code_hex = upper(e.icao_hex) LIMIT 1) fm ON true
        ORDER BY e.profile_score DESC NULLS LAST`,
      [statuses, data.includeReviewed, data.limit],
    );
    const counts = await q<{ match_status: string; n: number; open: number }>(
      `SELECT match_status, count(*)::int AS n,
              count(*) FILTER (WHERE COALESCE(reviewed,false)=false)::int AS open
         FROM profiler_shadow_eval GROUP BY match_status`,
    );
    return {
      leads: rows.map((r) => ({ ...r, reason: leadReason(r.match_status, r.profile_score, r.existing_max_score) })),
      counts,
    };
  });

export const reviewMlLead = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; reviewed: boolean; notes?: string }) => {
    if (!d?.id) throw new Error("id required");
    return { id: d.id, reviewed: !!d.reviewed, notes: d.notes ?? null };
  })
  .handler(async ({ data }) => {
    await q(
      `UPDATE profiler_shadow_eval SET reviewed=$2, notes=COALESCE($3, notes) WHERE id=$1`,
      [data.id, data.reviewed, data.notes],
    );
    return { ok: true };
  });

// ============================================================
// MODEL HEALTH
// ============================================================
export const getModelHealth = createServerFn({ method: "GET" }).handler(async () => {
  const runs = await q<{
    run_type: string; model_version: string; aircraft_count: number | null;
    mean_profile_score: number | null; max_profile_score: number | null; run_at: string;
  }>(
    `SELECT run_type, model_version, aircraft_count, mean_profile_score, max_profile_score, run_at
       FROM profiler_run_log ORDER BY run_at DESC LIMIT 10`,
  );
  const profiled = await q<{ n: number; scored: number; win_start: string | null; win_end: string | null }>(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE profile_score >= 65)::int AS scored,
            MIN(window_start)::text AS win_start,
            MAX(window_end)::text AS win_end
       FROM aircraft_deep_profiles`,
  );
  const last = runs[0];
  const ageH = last ? (Date.now() - new Date(last.run_at).getTime()) / 3.6e6 : null;
  return {
    last_run: last ?? null,
    runs,
    aircraft_profiled: profiled[0]?.n ?? 0,
    elevated_aircraft: profiled[0]?.scored ?? 0,
    hours_since_run: ageH == null ? null : Math.round(ageH),
    stale: ageH != null && ageH > 48,
    status_label: !last
      ? "No model runs recorded yet."
      : ageH != null && ageH > 48
        ? `Model numbers are ${Math.round(ageH)} hours old — treat scores as indicative until the profiler runs again.`
        : `Model is current — last scored ${Math.round(ageH ?? 0)} hour(s) ago on ${last.aircraft_count ?? 0} aircraft.`,
  };
});

// ============================================================
// OPERATOR NETWORK INDICES (GNN)
// ============================================================
export const getOperatorGnn = createServerFn({ method: "GET" })
  .inputValidator((d: { operator?: string } = {}) => ({ operator: d.operator?.trim() || null }))
  .handler(async ({ data }) => {
    const rows = await q<{
      operator_name: string; surveillance_index: number | null; coordination_index: number | null;
      community_id: number | null; community_label: string | null; aircraft_count: number | null;
      updated_at: string | null;
    }>(
      data.operator
        ? `SELECT * FROM operator_gnn_embeddings WHERE operator_name ILIKE $1 ORDER BY surveillance_index DESC NULLS LAST LIMIT 20`
        : `SELECT * FROM operator_gnn_embeddings ORDER BY surveillance_index DESC NULLS LAST LIMIT 50`,
      data.operator ? [`%${data.operator}%`] : [],
    );
    return rows;
  });
