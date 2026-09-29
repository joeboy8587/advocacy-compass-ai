// Hypothesis & Relay Deck + the investigator learning loop.
//
// Two jobs:
//   1. Translate the machine-generated tables (mission_hypotheses, learned_patterns,
//      shell_entity_behavioral_alignment) into short plain-English leads.
//   2. Capture the investigator's verdict on each lead and persist it as durable
//      memory (investigator_reviews + josiah_memory) so every later brief,
//      narrative and dossier can lean on it.
//
// Nothing here is presented as a finding. Machine output is a LEAD until a human
// marks it CONFIRMED.

import { createServerFn } from "@tanstack/react-start";
import { neonQuery } from "./neon.server";

// ------------------------------------------------------------ plain English

type Plain = { title: string; meaning: string; rule?: string };

const HYPOTHESIS_PLAIN: Record<string, Plain> = {
  ALTITUDE_VIOLATION: {
    title: "Flew lower than the rules allow",
    meaning:
      "The aircraft dropped below the minimum safe height for the ground underneath it, and no airport approach explains it.",
    rule: "14 CFR § 91.119 — minimum safe altitudes",
  },
  LOW_SPEED_LOITER: {
    title: "Slowed down and circled",
    meaning:
      "The aircraft cut its speed and stayed over one spot. That is what watching looks like, not travelling.",
    rule: "14 CFR § 91.119(b) — congested area floor",
  },
  STATISTICAL_OUTLIER: {
    title: "Behaved unlike normal traffic here",
    meaning:
      "Compared with every other flight over this county, this one's height, speed and path sit well outside the usual range.",
  },
  COORDINATED_SURVEILLANCE: {
    title: "Worked alongside another aircraft",
    meaning:
      "Two or more aircraft held overlapping positions and timing, the way a planned shift pattern would.",
  },
  UNREGISTERED_CONTACT: {
    title: "No owner on record",
    meaning:
      "The broadcast code does not match any aircraft in the public FAA registry. Either it is foreign, retired, or the code is wrong.",
  },
  DIGITAL_CHAMELEON_SIGNATURE: {
    title: "Changed its broadcast identity",
    meaning:
      "The same physical flight profile appeared under different identifying codes or call signs.",
  },
  FROZEN_ALTITUDE_SPOOF: {
    title: "Height reading was frozen",
    meaning:
      "The reported altitude stopped changing while the aircraft kept moving, which real barometric readings do not do.",
  },
  STARING_PATTERN: {
    title: "Held a fixed point in view",
    meaning:
      "The flight path kept one location centred for a long stretch — the geometry of a camera staying on a target.",
  },
  GHOST_LAYER_ASSET: {
    title: "Appeared and vanished from tracking",
    meaning:
      "The contact dropped out of public tracking and returned, leaving gaps that clean transponder data would not have.",
  },
  PERSISTENT_REGIONAL_ANCHOR: {
    title: "Keeps returning to the same area",
    meaning: "This aircraft comes back to the same patch of ground far more often than chance would explain.",
  },
  RANDOMIZED_LOITER_TACTIC: {
    title: "Circled on an irregular pattern",
    meaning:
      "The orbit was deliberately varied rather than a clean circuit — a way of loitering that is harder to spot.",
  },
  IDENTITY_OBFUSCATION: {
    title: "Hid or blanked its identity",
    meaning: "Identifying fields were missing, blanked or inconsistent across the same flight.",
  },
  CONTRACT_ISR_NODE: {
    title: "Flies like a contracted surveillance aircraft",
    meaning:
      "The height, speed and endurance profile matches aircraft flown under surveillance contracts rather than private travel.",
  },
  MEDICAL_COVER_ASSET: {
    title: "Medical markings, surveillance behaviour",
    meaning:
      "Registered or squawking as a medical flight, but the flight profile matches watching rather than transport.",
  },
  HISTORICAL_FINGERPRINT_MATCH: {
    title: "Matches an aircraft already on file",
    meaning: "The behavioural fingerprint lines up with a contact recorded earlier under another identity.",
  },
  PROXIMITY_EVENT: {
    title: "Came unusually close to another aircraft",
    meaning: "Two tracked aircraft closed to a distance and timing that is rare in normal traffic.",
  },
  GHOST_FLEET_OPERATION: {
    title: "Part of an untraceable group",
    meaning: "Several contacts with missing ownership flew as a coordinated group.",
  },
};

const PATTERN_PLAIN: Record<string, Plain> = {
  TACTICAL_HANDOFF: {
    title: "Handed coverage to another aircraft",
    meaning:
      "One aircraft left the area and a second arrived within seconds, so the ground below was never unwatched. That is a shift change, not a coincidence.",
  },
  COORDINATION: {
    title: "Flew in coordination with others",
    meaning: "Multiple aircraft held matching timing and positions over the same area.",
  },
  IFR_PHYSICS_VIOLATION: {
    title: "Reported something physically impossible",
    meaning: "Speed, height or climb rate reported values no real aircraft can produce — the data was manipulated.",
  },
  TEMPORAL_PEAK: {
    title: "Concentrates at one time of day",
    meaning: "Activity clusters into a repeating time window rather than spreading across the day.",
  },
};

function fallbackPlain(type: string): Plain {
  return {
    title: type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
    meaning: "An automated pattern the system flagged. Review the supporting events before relying on it.",
  };
}

function plainFor(kind: "hypothesis" | "pattern", type: string): Plain {
  const table = kind === "hypothesis" ? HYPOTHESIS_PLAIN : PATTERN_PLAIN;
  return table[type] ?? fallbackPlain(type);
}

// A lead is only "strong" when the machine was genuinely certain, or when the
// same behaviour repeated so many times that volume carries it on its own.
// Volume alone at low certainty is not strong — that was making everything
// look urgent, which is the same as nothing looking urgent.
function strength(confidence: number | null, events: number): "STRONG" | "MODERATE" | "WEAK" {
  const c = confidence ?? 0;
  if ((c >= 0.75 && events >= 3) || events >= 500) return "STRONG";
  if (c >= 0.5 || events >= 50) return "MODERATE";
  return "WEAK";
}

// ------------------------------------------------------------------- types

export type Verdict = "CONFIRMED" | "REVIEW" | "NOT_USEFUL";

export type DeckLead = {
  item_kind: "hypothesis" | "relay" | "pattern" | "shell_alignment";
  item_key: string;
  type: string;
  title: string;
  meaning: string;
  rule: string | null;
  events: number;
  confidence: number | null;
  strength: "STRONG" | "MODERATE" | "WEAK";
  latest: string | null;
  detail: string | null;
  partner_icao: string | null;
  verdict: Verdict | null;
  note: string | null;
  reviewed_at: string | null;
};

export type MemoryNote = {
  id: number;
  category: string;
  content: string;
  source: string | null;
  importance: number | null;
  case_id: string | null;
  created_at: string | null;
};

export type HypothesisDeck = {
  icaos: string[];
  label: string;
  leads: DeckLead[];
  memory: MemoryNote[];
  counts: { confirmed: number; review: number; not_useful: number; unreviewed: number };
  generated_at: string;
};

// -------------------------------------------------------------- deck loader

async function loadDeck(
  icaosRaw: string[],
  label: string,
  caseId?: string,
  selfRegsRaw: string[] = [],
): Promise<HypothesisDeck> {
  const icaos = Array.from(
    new Set(icaosRaw.map((h) => (h ?? "").trim()).filter(Boolean).map((h) => h.toLowerCase())),
  ).slice(0, 12);
  const selfRegs = new Set(
    [label, ...selfRegsRaw].map((r) => (r ?? "").trim().toUpperCase()).filter(Boolean),
  );

  if (!icaos.length) {
    return {
      icaos: [],
      label,
      leads: [],
      memory: [],
      counts: { confirmed: 0, review: 0, not_useful: 0, unreviewed: 0 },
      generated_at: new Date().toISOString(),
    };
  }

  const upper = icaos.map((h) => h.toUpperCase());
  const both = [...icaos, ...upper];

  const [hypRows, relayRows, patternRows, shellRows, reviewRows, memRows] = await Promise.all([
    // Machine hypotheses, rolled up per type so millions of rows become a handful of leads.
    neonQuery<{ hypothesis_type: string; n: number; best: string | null; latest: string | null; sample: string | null }>(
      `SELECT h.hypothesis_type,
              count(*)::int                         AS n,
              max(h.confidence_score)::text         AS best,
              max(h.updated_at)::text               AS latest,
              (array_agg(h.reasoning_chain ORDER BY h.confidence_score DESC NULLS LAST))[1] AS sample
         FROM mission_hypotheses h
         JOIN detections d ON d.id = h.detection_id
        WHERE lower(d.icao_hex) = ANY($1::text[])
        GROUP BY h.hypothesis_type
        ORDER BY count(*) DESC
        LIMIT 12`,
      [icaos],
      { timeoutMs: 18_000 },
    ).catch(() => []),

    // Relay / handoff pairs.
    neonQuery<{ partner: string; n: number; best: string | null; latest: string | null; sample: string | null }>(
      `WITH hits AS (
         SELECT p.id, p.confidence, p.discovered_at, p.pattern_description, p.aircraft_icao_hexes
           FROM learned_patterns p
          WHERE p.pattern_type = 'TACTICAL_HANDOFF'
            AND p.is_active = true
            AND p.aircraft_icao_hexes && $1::text[]
          ORDER BY p.discovered_at DESC
          LIMIT 4000
       ), pairs AS (
         SELECT lower(x) AS partner, h.confidence, h.discovered_at, h.pattern_description
           FROM hits h, unnest(h.aircraft_icao_hexes) AS x
          WHERE lower(x) <> ALL($2::text[])
       )
       SELECT partner,
              count(*)::int                  AS n,
              max(confidence)::text          AS best,
              max(discovered_at)::text       AS latest,
              (array_agg(pattern_description ORDER BY discovered_at DESC))[1] AS sample
         FROM pairs
        GROUP BY partner
        ORDER BY count(*) DESC
        LIMIT 8`,
      [both, icaos],
      { timeoutMs: 18_000 },
    ).catch(() => []),

    // Named patterns other than handoffs (shell fleets, physics, RICO brackets…).
    neonQuery<{ pattern_type: string; n: number; best: string | null; latest: string | null; sample: string | null }>(
      `SELECT p.pattern_type,
              count(*)::int              AS n,
              max(p.confidence)::text    AS best,
              max(p.discovered_at)::text AS latest,
              (array_agg(p.pattern_description ORDER BY p.discovered_at DESC))[1] AS sample
         FROM learned_patterns p
        WHERE p.pattern_type <> 'TACTICAL_HANDOFF'
          AND p.is_active = true
          AND p.aircraft_icao_hexes && $1::text[]
        GROUP BY p.pattern_type
        ORDER BY count(*) DESC
        LIMIT 10`,
      [both],
      { timeoutMs: 18_000 },
    ).catch(() => []),

    // Civilian aircraft that shadow sheriff's office flights.
    neonQuery<{ kcso_registration: string; n: number; closest: string | null; latest: string | null }>(
      `SELECT kcso_registration,
              count(*)::int                       AS n,
              min(distance_km)::text              AS closest,
              max(created_at)::text               AS latest
         FROM shell_entity_behavioral_alignment
        WHERE lower(target_icao) = ANY($1::text[])
        GROUP BY kcso_registration
        ORDER BY count(*) DESC
        LIMIT 6`,
      [icaos],
      { timeoutMs: 12_000 },
    ).catch(() => []),

    neonQuery<{ item_key: string; verdict: string; note: string | null; updated_at: string }>(
      `SELECT item_key, verdict, note, updated_at::text
         FROM investigator_reviews
        WHERE lower(COALESCE(subject_icao, '')) = ANY($1::text[])
           OR ($2::text IS NOT NULL AND case_id = $2)`,
      [icaos, caseId ?? null],
    ).catch(() => []),

    neonQuery<MemoryNote>(
      `SELECT id, category, content, source, importance, case_id, created_at::text
         FROM josiah_memory
        WHERE ($2::text IS NOT NULL AND case_id = $2)
           OR EXISTS (SELECT 1 FROM unnest($1::text[]) h WHERE content ILIKE '%' || h || '%')
        ORDER BY importance DESC NULLS LAST, created_at DESC
        LIMIT 12`,
      [[...icaos, ...upper, label], caseId ?? null],
    ).catch(() => []),
  ]);

  const reviews = new Map(reviewRows.map((r) => [r.item_key, r]));
  const primary = icaos[0];
  const leads: DeckLead[] = [];

  const push = (lead: Omit<DeckLead, "verdict" | "note" | "reviewed_at">) => {
    const r = reviews.get(lead.item_key);
    leads.push({
      ...lead,
      verdict: (r?.verdict as Verdict | undefined) ?? null,
      note: r?.note ?? null,
      reviewed_at: r?.updated_at ?? null,
    });
  };

  for (const h of hypRows) {
    const p = plainFor("hypothesis", h.hypothesis_type);
    const conf = h.best == null ? null : Number(h.best);
    push({
      item_kind: "hypothesis",
      item_key: `hyp:${primary}:${h.hypothesis_type}`,
      type: h.hypothesis_type,
      title: p.title,
      meaning: p.meaning,
      rule: p.rule ?? null,
      events: h.n,
      confidence: conf,
      strength: strength(conf ?? 0, h.n),
      latest: h.latest,
      detail: summariseReasoning(h.sample),
      partner_icao: null,
    });
  }

  for (const r of relayRows) {
    const p = plainFor("pattern", "TACTICAL_HANDOFF");
    const conf = r.best == null ? null : Number(r.best);
    push({
      item_kind: "relay",
      item_key: `relay:${primary}:${r.partner}`,
      type: "TACTICAL_HANDOFF",
      title: `${p.title} (${r.partner.toUpperCase()})`,
      meaning: p.meaning,
      rule: null,
      events: r.n,
      confidence: conf,
      strength: strength(conf ?? 0, r.n),
      latest: r.latest,
      detail: r.sample,
      partner_icao: r.partner,
    });
  }

  for (const p0 of patternRows) {
    const p = plainFor("pattern", p0.pattern_type);
    const conf = p0.best == null ? null : Number(p0.best);
    push({
      item_kind: "pattern",
      item_key: `pattern:${primary}:${p0.pattern_type}`,
      type: p0.pattern_type,
      title: p.title,
      meaning: p.meaning,
      rule: p.rule ?? null,
      events: p0.n,
      confidence: conf,
      strength: strength(conf ?? 0, p0.n),
      latest: p0.latest,
      detail: p0.sample,
      partner_icao: null,
    });
  }

  for (const s of shellRows) {
    // Skip self-matches: a sheriff's office aircraft flying "beside itself" is
    // an artefact of the pairing table, not a lead.
    if (selfRegs.has((s.kcso_registration ?? "").trim().toUpperCase())) continue;
    push({
      item_kind: "shell_alignment",
      item_key: `shell:${primary}:${s.kcso_registration}`,
      type: "SHELL_ALIGNMENT",
      title: `Shadowed a sheriff's office aircraft (${s.kcso_registration})`,
      meaning:
        "This aircraft was in the air beside a known sheriff's office airframe, at the same moment and within a few kilometres. Repeated matches point to a civilian aircraft working with the fleet.",
      rule: null,
      events: s.n,
      confidence: null,
      strength: strength(null, s.n),
      latest: s.latest,
      detail: s.closest ? `Closest recorded approach: ${Number(s.closest).toFixed(2)} km.` : null,
      partner_icao: null,
    });
  }


  const order = { STRONG: 0, MODERATE: 1, WEAK: 2 } as const;
  leads.sort((a, b) => order[a.strength] - order[b.strength] || b.events - a.events);

  const counts = {
    confirmed: leads.filter((l) => l.verdict === "CONFIRMED").length,
    review: leads.filter((l) => l.verdict === "REVIEW").length,
    not_useful: leads.filter((l) => l.verdict === "NOT_USEFUL").length,
    unreviewed: leads.filter((l) => !l.verdict).length,
  };

  return { icaos, label, leads: leads.slice(0, 40), memory: memRows, counts, generated_at: new Date().toISOString() };
}

// mission_hypotheses.reasoning_chain is a JSON blob. Pull only the human-readable bits.
function summariseReasoning(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const bits: string[] = [];
    if (typeof j.alt_ft === "number") bits.push(`about ${Math.round(j.alt_ft).toLocaleString()} ft up`);
    if (typeof j.speed_kts === "number") bits.push(`${Math.round(j.speed_kts)} knots`);
    if (typeof j.county === "string") bits.push(`over ${String(j.county).toLowerCase()} county`);
    const nulls = j.null_tests as Record<string, string> | undefined;
    const rejected = nulls
      ? Object.values(nulls).filter((v) => typeof v === "string" && v.startsWith("REJECTED"))
      : [];
    const survived = nulls
      ? Object.values(nulls).filter((v) => typeof v === "string" && v.startsWith("SURVIVED"))
      : [];
    let out = bits.length ? `Typical example: ${bits.join(", ")}.` : "";
    if (rejected.length) {
      out += ` Innocent explanations ruled out: ${rejected
        .map((r) => r.replace(/^REJECTED\s*[—-]\s*/u, ""))
        .slice(0, 2)
        .join("; ")}.`;
    }
    if (survived.length) out += ` ${survived.length} innocent explanation(s) still stand.`;
    return out.trim() || null;
  } catch {
    return raw.slice(0, 220);
  }
}

// ------------------------------------------------------------ server funcs

export const getAircraftDeck = createServerFn({ method: "GET" })
  .inputValidator((d: { icao: string; caseId?: string; label?: string }) => {
    if (!d?.icao?.trim()) throw new Error("icao required");
    return d;
  })
  .handler(async ({ data }) =>
    loadDeck([data.icao], data.label ?? data.icao.toUpperCase(), data.caseId),
  );

export const getCaseDeck = createServerFn({ method: "GET" })
  .inputValidator((d: { caseId: string }) => {
    if (!d?.caseId?.trim()) throw new Error("caseId required");
    return d;
  })
  .handler(async ({ data }) => {
    const rows = await neonQuery<{
      case_id: string;
      subject_icao: string | null;
      subject_reg: string | null;
      related_icaos: string[] | null;
    }>(
      `SELECT case_id, subject_icao, subject_reg, related_icaos
         FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
      [data.caseId],
    );
    const c = rows[0];
    if (!c) throw new Error("That case could not be found.");
    const icaos = [c.subject_icao ?? "", ...(c.related_icaos ?? [])].filter(Boolean);
    return loadDeck(icaos, c.subject_reg ?? c.case_id, c.case_id);
  });

export const recordLeadVerdict = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      itemKind: string;
      itemKey: string;
      itemSummary?: string;
      verdict: Verdict;
      note?: string;
      subjectIcao?: string;
      subjectLabel?: string;
      caseId?: string;
    }) => {
      if (!d?.itemKey) throw new Error("itemKey required");
      if (!["CONFIRMED", "REVIEW", "NOT_USEFUL"].includes(d.verdict)) throw new Error("bad verdict");
      return d;
    },
  )
  .handler(async ({ data }) => {
    const summary = (data.itemSummary ?? "").slice(0, 600);

    await neonQuery(
      `INSERT INTO investigator_reviews
         (subject_icao, subject_label, item_kind, item_key, item_summary, verdict, note, case_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (item_kind, item_key) DO UPDATE
         SET verdict = EXCLUDED.verdict,
             note = EXCLUDED.note,
             case_id = COALESCE(EXCLUDED.case_id, investigator_reviews.case_id),
             subject_label = COALESCE(EXCLUDED.subject_label, investigator_reviews.subject_label),
             item_summary = COALESCE(EXCLUDED.item_summary, investigator_reviews.item_summary),
             updated_at = now()`,
      [
        data.subjectIcao ?? null,
        data.subjectLabel ?? null,
        data.itemKind,
        data.itemKey,
        summary || null,
        data.verdict,
        data.note?.trim() || null,
        data.caseId ?? null,
      ],
    );

    // Only decisions that carry forward become memory. "Needs review" is a
    // holding state and should not bias future briefs.
    if (data.verdict !== "REVIEW") {
      const subject = data.subjectLabel ?? data.subjectIcao ?? "unknown subject";
      const verdictText =
        data.verdict === "CONFIRMED"
          ? "CONFIRMED BY INVESTIGATOR"
          : "RULED OUT BY INVESTIGATOR — do not present this as evidence again";
      const content = [
        `${verdictText}: ${subject} — ${summary || data.itemKey}.`,
        data.note?.trim() ? `Investigator note: ${data.note.trim()}` : "",
        data.subjectIcao ? `Transponder code ${data.subjectIcao.toUpperCase()}.` : "",
      ]
        .filter(Boolean)
        .join(" ");

      await neonQuery(
        `INSERT INTO josiah_memory (category, content, source, "timestamp", importance, case_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          data.verdict === "CONFIRMED" ? "INVESTIGATOR_CONFIRMED" : "INVESTIGATOR_RULED_OUT",
          content.slice(0, 2000),
          "Hypothesis Deck review",
          new Date().toISOString(),
          data.verdict === "CONFIRMED" ? 5 : 2,
          data.caseId ?? null,
        ],
      ).catch(() => undefined);
    }

    return { ok: true as const, verdict: data.verdict };
  });

export const addInvestigatorNote = createServerFn({ method: "POST" })
  .inputValidator((d: { note: string; subjectIcao?: string; subjectLabel?: string; caseId?: string }) => {
    if (!d?.note?.trim()) throw new Error("note required");
    return d;
  })
  .handler(async ({ data }) => {
    const subject = data.subjectLabel ?? data.subjectIcao ?? "general";
    await neonQuery(
      `INSERT INTO josiah_memory (category, content, source, "timestamp", importance, case_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        "INVESTIGATOR_DIRECTIVE",
        `${subject}: ${data.note.trim()}`.slice(0, 2000),
        "Investigator note",
        new Date().toISOString(),
        4,
        data.caseId ?? null,
      ],
    );
    return { ok: true as const };
  });

// ----------------------------------------------- memory injected into the AI

/**
 * Everything the investigator has confirmed or ruled out, formatted for the
 * model. Keeps Josiah from re-raising leads the operator has already killed.
 */
export async function fetchInvestigatorMemory(limit = 30): Promise<string> {
  const [mem, reviews] = await Promise.all([
    neonQuery<{ category: string; content: string; importance: number | null }>(
      `SELECT category, content, importance FROM josiah_memory
        ORDER BY importance DESC NULLS LAST, created_at DESC LIMIT $1`,
      [limit],
    ).catch(() => []),
    neonQuery<{ verdict: string; subject_label: string | null; subject_icao: string | null; item_summary: string | null }>(
      `SELECT verdict, subject_label, subject_icao, item_summary
         FROM investigator_reviews ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    ).catch(() => []),
  ]);

  if (!mem.length && !reviews.length) return "";

  const lines: string[] = [];
  if (reviews.length) {
    lines.push("### Investigator verdicts (binding — respect these)");
    for (const r of reviews) {
      const who = r.subject_label ?? r.subject_icao ?? "unknown";
      lines.push(`- [${r.verdict}] ${who}: ${r.item_summary ?? ""}`.trim());
    }
  }
  if (mem.length) {
    lines.push("", "### Standing investigative memory");
    for (const m of mem) lines.push(`- (${m.category}) ${m.content}`);
  }
  lines.push(
    "",
    "Rules: never re-present a lead marked NOT_USEFUL or INVESTIGATOR_RULED_OUT as evidence. Treat CONFIRMED items as established for this investigation. Machine-generated patterns that have not been reviewed are LEADS, not findings — label them that way.",
  );
  return lines.join("\n");
}

export const getInvestigatorMemory = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await neonQuery<MemoryNote>(
    `SELECT id, category, content, source, importance, case_id, created_at::text
       FROM josiah_memory ORDER BY created_at DESC LIMIT 60`,
  ).catch(() => []);
  return rows;
});
