import { createServerFn } from "@tanstack/react-start";
import { selectMode, systemFor } from "./josiah-prompts";
import { chatHistory, type ChatTurn } from "./josiah-retrieval";


const MODEL = "google/gemini-3-flash-preview";

export const askInvestigator = createServerFn({ method: "POST" })
  .inputValidator((d: { question: string; caseId?: string; mode?: "LEGAL" | "SNARK" | "AUTO"; history?: ChatTurn[] }) => {
    if (!d?.question?.trim()) throw new Error("question required");
    return { ...d, history: chatHistory(d.history) };
  })
  .handler(async ({ data }) => {
    if (!process.env.NVIDIA_NIM_API_KEY && !process.env.LOVABLE_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error("No AI key configured (NVIDIA_NIM_API_KEY, LOVABLE_API_KEY or OPENAI_API_KEY)");
    }

    const mode =
      data.mode && data.mode !== "AUTO" ? data.mode : selectMode(data.question);
    const system = systemFor(mode, true);

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
      const { fetchOsintContextForCase } = await import("./osint.functions");
      const osintCtx = await fetchOsintContextForCase(data.caseId);
      if (osintCtx) extra += `\n\n## OSINT Findings for Case ${data.caseId}\n${osintCtx}`;
    }

    const { gatherQuestionContext } = await import("./josiah-retrieval.server");
    const context = await gatherQuestionContext(data.question, data.history, data.caseId);
    const { referenceContext } = await import("./investigation-references.server");
    extra += `\n\n${await referenceContext({ caseId: data.caseId, catalog: true })}`;

    const { fetchDoctrineContext } = await import("./doctrine.functions");
    const doctrine = await fetchDoctrineContext(data.question, 3);

    const { fetchInvestigatorMemory } = await import("./intelligence.functions");
    const memory = await fetchInvestigatorMemory().catch(() => "");

    try {
      const { generateTextWithFallback } = await import("./ai-fallback.server");
      const { text, provider } = await generateTextWithFallback({
        model: MODEL,
        system: `${system}\n\n# Live Corpus Context\n\n${context}${extra}${doctrine ? `\n\n# Doctrine Library (uploaded reference documents)\n\n${doctrine}` : ""}${memory ? `\n\n# Investigator Memory (binding)\n\n${memory}` : ""}`,
        messages: [...(data.history ?? []), { role: "user", content: data.question }],
      });
      return { ok: true as const, text, mode, provider };
    } catch (e) {
      const msg = (e as Error).message ?? "AI gateway error";
      return { ok: false as const, error: msg, mode };
    }
  });

export const draftCaseBrief = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; audience: "PUBLIC" | "LEGAL" | "LEGISLATIVE" | "JOURNALIST" | "COMMUNITY" | "SNARK" }) => {
    if (!d?.caseId) throw new Error("caseId required");
    return d;
  })
  .handler(async ({ data }) => {
    if (!process.env.NVIDIA_NIM_API_KEY && !process.env.LOVABLE_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error("No AI key configured (NVIDIA_NIM_API_KEY, LOVABLE_API_KEY or OPENAI_API_KEY)");
    }
    const { neonQuery } = await import("./neon.server");

    const caseRows = await neonQuery<Record<string, unknown>>(
      `SELECT * FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
      [data.caseId],
    );
    if (!caseRows[0]) return { ok: false as const, error: "Case not found" };
    const c = caseRows[0] as { detection_ids?: string[] | null; subject_icao?: string | null };
    const { referenceContext } = await import("./investigation-references.server");
    const references = await referenceContext({ caseId: data.caseId });

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
           FROM violation_classifications WHERE icao_hex IN (upper($1), lower($1)) LIMIT 10`,
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
    const system = systemFor(cfg.mode);

    const { fetchInvestigatorMemory } = await import("./intelligence.functions");
    const memory = await fetchInvestigatorMemory().catch(() => "");

    try {
      const { generateTextWithFallback } = await import("./ai-fallback.server");
      const { text, provider } = await generateTextWithFallback({
        model: MODEL,
        system,
        prompt: `Draft a ${cfg.label}

## Case Data
${references}
${JSON.stringify(c, null, 2)}

## Linked Detections (sample, up to 50)
${JSON.stringify(dets, null, 2)}

## Prior FAA Rule Violations by this Aircraft
${JSON.stringify(vios, null, 2)}
${memory ? `\n## Investigator Memory (binding)\n${memory}\n` : ""}
Follow the output structure required by your mode.`,
      });
      return { ok: true as const, text, mode: cfg.mode, provider };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message ?? "AI gateway error" };
    }
  });
