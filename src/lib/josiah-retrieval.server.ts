import { neonQuery, neonUserError } from "./reference-neon.server";
import { aircraftIdentifiers, detectionStatement, pacificTimestamp, type ChatTurn, type DetectionSearch } from "./josiah-retrieval";

type Result = { rows: Record<string, unknown>[] };
const READ_ONLY = { "Neon-Batch-Read-Only": "true" };

export async function searchDetections(input: DetectionSearch) {
  try {
    const id = input.identifier?.trim().toUpperCase();
    const registry = id ? await neonQuery<Result>(
      `SELECT n_number, registration, name AS faa_title_owner, mode_s_code_hex FROM public.faa_master
       WHERE n_number = $1 OR registration = $2 OR mode_s_code_hex IN ($2, lower($2)) LIMIT 6`,
      [id.replace(/^N/, ""), id],
    ) : { rows: [] };
    const hexes = registry.rows.flatMap(r => typeof r.mode_s_code_hex === "string" ? [r.mode_s_code_hex] : []);
    const statement = detectionStatement(input, hexes);
    const { results } = await neonQuery<{ results: Result[] }>([statement], [], READ_ONLY);
    const rows = (results[0]?.rows ?? []).map(row => ({ ...row, captured_at_pacific: pacificTimestamp(row.captured_at) }));
    return { source: "public.detections", registry: registry.rows, returned: rows.length, sampleOnly: true,
      note: "Latest matching sightings, not total events. Reported altitude is not verified height above ground. Ground rows are not airborne violations. No results means no match for these filters, not that the aircraft is cleared.", rows };
  } catch (error) {
    console.error("Josiah detection retrieval", error);
    return { error: neonUserError(error).message };
  }
}

/** Provider-independent evidence: every chat brain gets the same relevant source rows. */
export async function gatherQuestionContext(question: string, history: ChatTurn[] = [], caseId?: string | null): Promise<string> {
  const identifiers = aircraftIdentifiers(question, history);
  const subject = identifiers.length ? identifiers.join(" OR ") : question;
  try {
    const queries = [
      { query: `SELECT case_id, subject_reg, subject_icao, subject_owner, status, related_tails,
          left(COALESCE(public_summary, auto_summary, ''), 500) AS summary
          FROM public.cases WHERE status <> 'MERGED' ORDER BY case_id LIMIT 100`, params: [] },
      { query: `SELECT id, title, kind, case_id, sha256, to_json(created_at) AS filed,
          left(summary, 1200) AS summary, key_findings, left(conclusion, 700) AS conclusion
          FROM public.vault_items i WHERE status = 'ready' AND (
            case_id = $1 OR to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || content)
            @@ websearch_to_tsquery('english', $2)
            OR EXISTS (SELECT 1 FROM public.vault_mentions m JOIN public.vault_entities e ON e.id = m.entity_id
              WHERE m.item_id = i.id AND upper(e.name) = ANY($3::text[])))
          ORDER BY created_at DESC LIMIT 8`, params: [caseId ?? null, subject.slice(0, 2000), identifiers] },
    ];
    const [{ results }, sightings] = await Promise.all([
      neonQuery<{ results: Result[] }>(queries, [], READ_ONLY),
      Promise.all((identifiers.length ? identifiers : [undefined]).map(identifier => searchDetections({ identifier, limit: identifiers.length ? 20 : 30 }))),
    ]);
    return `# Question-specific records (read-only Neon retrieval)
The directory is a list of stored case subjects, not verified ownership or guilt. It is not the whole aircraft database. All operators are searchable, not just leaderboard entries. Use only relevant entries. Historical research and machine labels are not confirmed findings. Citation fields and source dates are supplied below.
## Case directory\n${JSON.stringify(results[0]?.rows ?? [])}
## Relevant filed research\n${JSON.stringify(results[1]?.rows ?? [])}
## Detection sightings\n${JSON.stringify(sightings)}`;
  } catch (error) {
    console.error("Josiah question retrieval", error);
    return `# Question-specific retrieval unavailable\n${neonUserError(error).message}\nDo not treat missing retrieval as proof that no records exist.`;
  }
}