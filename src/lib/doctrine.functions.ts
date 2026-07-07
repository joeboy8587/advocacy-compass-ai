import { createServerFn } from "@tanstack/react-start";

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

let _ensured = false;
async function ensureTable() {
  if (_ensured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS doctrine_documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      source_type text NOT NULL,
      classification text NOT NULL DEFAULT 'REFERENCE',
      original_filename text,
      sha256 text NOT NULL,
      byte_size integer,
      page_count integer,
      char_count integer,
      content text NOT NULL,
      summary text,
      tags text[] DEFAULT '{}',
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (sha256)
    );
    CREATE INDEX IF NOT EXISTS doctrine_documents_uploaded_idx ON doctrine_documents (uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS doctrine_documents_classification_idx ON doctrine_documents (classification);
    CREATE TABLE IF NOT EXISTS case_doctrine_links (
      case_id text NOT NULL,
      doctrine_id uuid NOT NULL REFERENCES doctrine_documents(id) ON DELETE CASCADE,
      linked_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (case_id, doctrine_id)
    );
    CREATE INDEX IF NOT EXISTS case_doctrine_links_case_idx ON case_doctrine_links (case_id);
  `);
  _ensured = true;
}


export type DoctrineDoc = {
  id: string;
  title: string;
  source_type: string;
  classification: string;
  original_filename: string | null;
  sha256: string;
  byte_size: number | null;
  page_count: number | null;
  char_count: number | null;
  summary: string | null;
  tags: string[] | null;
  uploaded_at: string;
};

export type DoctrineDocFull = DoctrineDoc & { content: string };

export const listDoctrine = createServerFn({ method: "GET" }).handler(async () => {
  await ensureTable();
  return q<DoctrineDoc>(
    `SELECT id, title, source_type, classification, original_filename, sha256,
            byte_size, page_count, char_count, summary, tags, uploaded_at
     FROM doctrine_documents
     ORDER BY uploaded_at DESC`,
  );
});

export const getDoctrineDoc = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await ensureTable();
    const rows = await q<DoctrineDocFull>(
      `SELECT id, title, source_type, classification, original_filename, sha256,
              byte_size, page_count, char_count, summary, tags, uploaded_at, content
       FROM doctrine_documents WHERE id = $1 LIMIT 1`,
      [data.id],
    );
    return rows[0] ?? null;
  });

export const ingestDoctrine = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      title: string;
      sourceType: string;
      classification?: string;
      originalFilename?: string;
      sha256: string;
      byteSize?: number;
      pageCount?: number;
      content: string;
      tags?: string[];
    }) => {
      if (!d?.title?.trim()) throw new Error("title required");
      if (!d?.sha256) throw new Error("sha256 required");
      if (!d?.content?.trim()) throw new Error("content required");
      if (d.content.length > 5_000_000) throw new Error("Document too large (>5MB text)");
      return d;
    },
  )
  .handler(async ({ data }) => {
    await ensureTable();
    const rows = await q<{ id: string; existed: boolean }>(
      `WITH ins AS (
         INSERT INTO doctrine_documents
           (title, source_type, classification, original_filename, sha256, byte_size, page_count, char_count, content, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (sha256) DO NOTHING
         RETURNING id
       )
       SELECT id, false AS existed FROM ins
       UNION ALL
       SELECT id, true AS existed FROM doctrine_documents WHERE sha256 = $5 AND NOT EXISTS (SELECT 1 FROM ins)
       LIMIT 1`,
      [
        data.title.trim(),
        data.sourceType,
        data.classification ?? "REFERENCE",
        data.originalFilename ?? null,
        data.sha256,
        data.byteSize ?? null,
        data.pageCount ?? null,
        data.content.length,
        data.content,
        data.tags ?? [],
      ],
    );
    return rows[0];
  });

export const deleteDoctrine = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await ensureTable();
    await q(`DELETE FROM doctrine_documents WHERE id = $1`, [data.id]);
    return { ok: true };
  });

// Keyword-match doctrine snippets for Josiah context injection.
export async function fetchDoctrineContext(query: string, limit = 2): Promise<string> {
  try {
    await ensureTable();
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3)
      .slice(0, 6);
    if (!terms.length) return "";
    const like = `%${terms.join("%")}%`;
    const rows = await q<{ title: string; classification: string; snippet: string }>(
      `SELECT title, classification,
              substring(content from 1 for 1800) AS snippet
       FROM doctrine_documents
       WHERE lower(content) ILIKE $1 OR lower(title) ILIKE $1
       ORDER BY uploaded_at DESC
       LIMIT $2`,
      [like, limit],
    );
    if (!rows.length) return "";
    return rows
      .map(
        (r) =>
          `### Doctrine: ${r.title} [${r.classification}]\n${r.snippet}${r.snippet.length >= 1800 ? "…" : ""}`,
      )
      .join("\n\n");
  } catch {
    return "";
  }
}
