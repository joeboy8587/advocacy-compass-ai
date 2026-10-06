// Intelligence Vault: server-only storage, AI analysis, embeddings and recall.
import { neonQuery, neonExecScript } from "./neon.server";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const CHAT_MODEL = "openai/gpt-6-astra";
const EMBED_MODEL = "google/gemini-embedding-2";

let ensured = false;
export async function ensureVault() {
  if (ensured) return;
  await neonExecScript(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS vault_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      kind text NOT NULL DEFAULT 'other',
      source_filename text,
      source_ref text,
      sha256 text NOT NULL UNIQUE,
      byte_size integer,
      content text NOT NULL,
      summary text,
      key_findings text[] DEFAULT '{}',
      conclusion text,
      case_id text,
      embedding vector(3072),
      status text NOT NULL DEFAULT 'pending',
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vault_items_created_idx ON vault_items (created_at DESC);
    CREATE INDEX IF NOT EXISTS vault_items_case_idx ON vault_items (case_id);
    CREATE TABLE IF NOT EXISTS vault_entities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      name text NOT NULL,
      canonical_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (entity_type, canonical_key)
    );
    CREATE TABLE IF NOT EXISTS vault_mentions (
      item_id uuid NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
      entity_id uuid NOT NULL REFERENCES vault_entities(id) ON DELETE CASCADE,
      context text,
      PRIMARY KEY (item_id, entity_id)
    );
    CREATE INDEX IF NOT EXISTS vault_mentions_entity_idx ON vault_mentions (entity_id);
  `);
  ensured = true;
}

export const ENTITY_TYPES = ["aircraft", "organization", "person", "location", "regulation", "case"] as const;

export function canonicalKey(type: string, name: string): string {
  let k = name.trim().toUpperCase().replace(/\s+/g, " ").replace(/[.,]+$/g, "");
  if (type === "aircraft") {
    k = k.replace(/[\s-]/g, "");
    // ICAO hex stays as-is; N-numbers normalised with leading N
    if (!/^[0-9A-F]{6}$/.test(k) && /^\d/.test(k)) k = `N${k}`;
  }
  return k;
}

function key(): string {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("AI is not configured (LOVABLE_API_KEY missing)");
  return k;
}

async function gatewayError(res: Response): Promise<Error> {
  let msg = `AI request failed (${res.status})`;
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
    const m = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
    if (m) msg = `${msg}: ${m}`;
  } catch {
    /* ignore */
  }
  const e = new Error(msg) as Error & { status?: number };
  e.status = res.status;
  return e;
}

async function openaiEmbed(text: string): Promise<number[]> {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("No backup AI key configured");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 24_000), dimensions: 768 }),
  });
  if (!res.ok) throw new Error(`Backup embedding failed (${res.status})`);
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data[0].embedding;
}

async function openaiRespond(system: string, user: string): Promise<string> {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("No backup AI key configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Backup AI failed (${res.status})`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  return j.choices[0]?.message?.content ?? "";
}

export async function embed(text: string): Promise<number[]> {
  try {
    return await primaryEmbed(text);
  } catch (e) {
    console.warn("[vault] primary embed failed, using backup:", (e as Error).message);
    return openaiEmbed(text);
  }
}

async function primaryEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${GATEWAY}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({ model: EMBED_MODEL, input: [text.slice(0, 24_000)] }),
  });
  if (!res.ok) throw await gatewayError(res);
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data[0].embedding;
}

/** Streams a Responses call and returns the final text. */
async function respond(system: string, user: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Lovable-API-Key": key(),
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: [{ role: "user", content: [{ type: "input_text", text: user }] }],
    }),
  });
  if (!res.ok || !res.body) throw await gatewayError(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload) as { type?: string; delta?: string; error?: { message?: string } };
        if (ev.type === "response.output_text.delta" && ev.delta) out += ev.delta;
        if (ev.type === "error" || ev.type === "response.failed") {
          throw new Error(ev.error?.message ?? "AI analysis failed");
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return out;
}

export type VaultAnalysis = {
  title: string | null;
  kind: string;
  summary: string;
  key_findings: string[];
  conclusion: string | null;
  entities: { type: string; name: string; context: string | null }[];
};

const ANALYZE_SYSTEM = `You index files for Watchtower, a civilian airspace-accountability watchdog. You read one file (research, case law, FAA lookup, court record, analysis, AI agent output, log, report, or a radar-screenshot extraction) and produce a recall card so investigators never repeat work.
Rules:
- Report only what the file actually says. No speculation. Neutral, plain English.
- Never dismiss an aircraft because of its owner type (LLC, lease, flight school) or airframe; record ownership as a fact only.
- Do not name private individuals unless they are public officials or registered corporate parties named in public records.
Return ONLY JSON:
{"title": "<short descriptive title or null>",
 "kind": "<research|case_law|faa_lookup|court_file|analysis|agent_output|log|report|screenshot|other>",
 "summary": "<2-3 plain-English sentences: what this file is and what it established>",
 "key_findings": ["<up to 6 concrete findings, each one sentence>"],
 "conclusion": "<the file's bottom-line verdict if any, else null>",
 "entities": [{"type":"<aircraft|organization|person|location|regulation|case>","name":"<e.g. N913KC, a9a1b6, FF22 LLC, Meadows Field (KBFL), 14 CFR 91.119, WTPR-2026-0020>","context":"<one short phrase on how it appears>"}]}
List every aircraft tail/ICAO hex, company, agency, airport/place, statute/regulation and case number mentioned (max 40).`;

export async function analyzeContent(title: string, content: string): Promise<VaultAnalysis> {
  const head = content.length > 60_000 ? `${content.slice(0, 45_000)}\n...\n${content.slice(-15_000)}` : content;
  const userMsg = `File name: ${title}\n\n---\n${head}`;
  let text = "";
  try {
    text = await respond(ANALYZE_SYSTEM, userMsg);
  } catch (e) {
    console.warn("[vault] primary analysis failed, using backup:", (e as Error).message);
  }
  if (!/\{[\s\S]*\}/.test(text)) text = await openaiRespond(ANALYZE_SYSTEM, userMsg);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI returned no recall card");
  const j = JSON.parse(m[0]) as Partial<VaultAnalysis>;
  return {
    title: j.title ?? null,
    kind: String(j.kind ?? "other"),
    summary: String(j.summary ?? ""),
    key_findings: Array.isArray(j.key_findings) ? j.key_findings.map(String).slice(0, 8) : [],
    conclusion: j.conclusion ? String(j.conclusion) : null,
    entities: Array.isArray(j.entities)
      ? j.entities
          .filter((e) => e && e.name && ENTITY_TYPES.includes(e.type as never))
          .slice(0, 40)
          .map((e) => ({ type: e.type, name: String(e.name).slice(0, 120), context: e.context ? String(e.context).slice(0, 200) : null }))
      : [],
  };
}

// Regex safety net so tails / hexes / cases are linked even if the AI misses them.
function regexEntities(text: string): { type: string; name: string }[] {
  const out = new Map<string, { type: string; name: string }>();
  for (const m of text.matchAll(/\bN[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}\b/g)) out.set(`a:${m[0]}`, { type: "aircraft", name: m[0] });
  for (const m of text.matchAll(/\bWTP?R?-\d{4}-\d{4}\b/g)) out.set(`c:${m[0]}`, { type: "case", name: m[0] });
  for (const m of text.matchAll(/\b14\s*CFR\s*(?:§\s*)?\d+(?:\.\d+)?/gi)) out.set(`r:${m[0].toUpperCase()}`, { type: "regulation", name: m[0] });
  return [...out.values()].slice(0, 60);
}

export async function processItem(id: string): Promise<void> {
  const rows = await neonQuery<{ title: string; content: string }>(`SELECT title, content FROM vault_items WHERE id=$1`, [id]);
  const it = rows[0];
  if (!it) return;
  try {
    const a = await analyzeContent(it.title, it.content);
    const embedText = [a.title ?? it.title, a.summary, ...a.key_findings, a.conclusion ?? "", a.entities.map((e) => e.name).join(", "), it.content.slice(0, 6000)].join("\n");
    const vec = await embed(embedText);
    await neonQuery(
      `UPDATE vault_items SET title=COALESCE(NULLIF($2,''), title), kind=$3, summary=$4, key_findings=$5, conclusion=$6,
              embedding=$7::vector, status='ready', error=NULL WHERE id=$1`,
      [id, a.title ?? "", a.kind, a.summary, a.key_findings, a.conclusion, `[${vec.join(",")}]`],
    );
    const all = [...a.entities, ...regexEntities(it.content).map((e) => ({ ...e, context: null }))];
    const seen = new Set<string>();
    for (const e of all) {
      const ck = canonicalKey(e.type, e.name);
      if (!ck || seen.has(`${e.type}:${ck}`)) continue;
      seen.add(`${e.type}:${ck}`);
      const ent = await neonQuery<{ id: string }>(
        `INSERT INTO vault_entities (entity_type, name, canonical_key) VALUES ($1,$2,$3)
         ON CONFLICT (entity_type, canonical_key) DO UPDATE SET name = vault_entities.name RETURNING id`,
        [e.type, e.name, ck],
      );
      await neonQuery(
        `INSERT INTO vault_mentions (item_id, entity_id, context) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [id, ent[0].id, e.context],
      );
    }
  } catch (e) {
    await neonQuery(`UPDATE vault_items SET status='error', error=$2 WHERE id=$1`, [id, (e as Error).message.slice(0, 500)]);
    throw e;
  }
}

export type VaultHit = {
  id: string;
  title: string;
  kind: string;
  summary: string | null;
  key_findings: string[] | null;
  conclusion: string | null;
  case_id: string | null;
  source_filename: string | null;
  sha256: string;
  created_at: string;
  score: number | null;
  entities: { type: string; name: string }[];
};

const HIT_COLS = `i.id, i.title, i.kind, i.summary, i.key_findings, i.conclusion, i.case_id, i.source_filename, i.sha256, i.created_at::text,
  COALESCE((SELECT json_agg(json_build_object('type', e.entity_type, 'name', e.name)) FROM vault_mentions m JOIN vault_entities e ON e.id=m.entity_id WHERE m.item_id=i.id), '[]'::json) AS entities`;

export async function searchVaultCore(query: string, limit = 12): Promise<VaultHit[]> {
  await ensureVault();
  const q = query.trim();
  if (!q) return [];
  let semantic: VaultHit[] = [];
  try {
    const vec = await embed(q);
    semantic = await neonQuery<VaultHit>(
      `SELECT ${HIT_COLS}, (1 - (i.embedding <=> $1::vector))::float AS score
         FROM vault_items i WHERE i.embedding IS NOT NULL
        ORDER BY i.embedding <=> $1::vector LIMIT $2`,
      [`[${vec.join(",")}]`, limit],
    );
  } catch {
    /* fall back to keywords */
  }
  const kw = await neonQuery<VaultHit>(
    `SELECT ${HIT_COLS}, NULL::float AS score FROM vault_items i
      WHERE i.title ILIKE $1 OR i.summary ILIKE $1 OR i.content ILIKE $1
         OR EXISTS (SELECT 1 FROM vault_mentions m JOIN vault_entities e ON e.id=m.entity_id
                     WHERE m.item_id=i.id AND (e.canonical_key = $2 OR e.name ILIKE $1))
      ORDER BY i.created_at DESC LIMIT $3`,
    [`%${q}%`, canonicalKey("aircraft", q), limit],
  );
  const map = new Map<string, VaultHit>();
  for (const h of kw) map.set(h.id, { ...h, score: 1 });
  for (const h of semantic) if (!map.has(h.id) && (h.score ?? 0) > 0.35) map.set(h.id, h);
  return [...map.values()].slice(0, limit);
}

/** Everything the vault knows about specific aircraft / entities / case. */
export async function recallFor(identifiers: string[], caseId?: string): Promise<VaultHit[]> {
  await ensureVault();
  const keys = identifiers.filter(Boolean).flatMap((s) => [canonicalKey("aircraft", s), canonicalKey("organization", s)]);
  if (!keys.length && !caseId) return [];
  return neonQuery<VaultHit>(
    `SELECT ${HIT_COLS}, NULL::float AS score FROM vault_items i
      WHERE i.status='ready' AND (
        ($2::text IS NOT NULL AND i.case_id = $2)
        OR EXISTS (SELECT 1 FROM vault_mentions m JOIN vault_entities e ON e.id=m.entity_id
                    WHERE m.item_id=i.id AND (e.canonical_key = ANY($1::text[]) OR ($2::text IS NOT NULL AND e.canonical_key = upper($2)))))
      ORDER BY i.created_at DESC LIMIT 40`,
    [keys, caseId ?? null],
  );
}
