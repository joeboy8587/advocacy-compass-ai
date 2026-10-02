import { createServerFn } from "@tanstack/react-start";
import type { VaultHit } from "./vault.server";

export type { VaultHit };

export type VaultItemRow = {
  id: string;
  title: string;
  kind: string;
  source_filename: string | null;
  sha256: string;
  status: string;
  error: string | null;
  summary: string | null;
  key_findings: string[] | null;
  conclusion: string | null;
  case_id: string | null;
  created_at: string;
  entity_count: number;
};

export type VaultEntityRow = { id: string; entity_type: string; name: string; files: number };

export const listVault = createServerFn({ method: "GET" }).handler(async () => {
  const { ensureVault } = await import("./vault.server");
  const { neonQuery } = await import("./neon.server");
  await ensureVault();
  const [items, entities, stats] = await Promise.all([
    neonQuery<VaultItemRow>(
      `SELECT i.id, i.title, i.kind, i.source_filename, i.sha256, i.status, i.error, i.summary, i.key_findings,
              i.conclusion, i.case_id, i.created_at::text,
              (SELECT count(*)::int FROM vault_mentions m WHERE m.item_id=i.id) AS entity_count
         FROM vault_items i ORDER BY i.created_at DESC LIMIT 300`,
    ),
    neonQuery<VaultEntityRow>(
      `SELECT e.id, e.entity_type, e.name, count(m.item_id)::int AS files
         FROM vault_entities e JOIN vault_mentions m ON m.entity_id=e.id
        GROUP BY e.id ORDER BY files DESC, e.name LIMIT 120`,
    ),
    neonQuery<{ total: number; ready: number; pending: number; errors: number; entities: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='ready')::int AS ready,
              count(*) FILTER (WHERE status='pending')::int AS pending,
              count(*) FILTER (WHERE status='error')::int AS errors,
              (SELECT count(*)::int FROM vault_entities) AS entities
         FROM vault_items`,
    ),
  ]);
  return { items, entities, stats: stats[0] };
});

export const addToVault = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { title: string; content: string; sha256: string; sourceFilename?: string; byteSize?: number; caseId?: string; kind?: string; sourceRef?: string }) => {
      if (!d?.title?.trim()) throw new Error("title required");
      if (!d?.content?.trim()) throw new Error("This file has no readable text");
      if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? "")) throw new Error("fingerprint required");
      if (d.content.length > 5_000_000) throw new Error("File too large (over 5MB of text)");
      return d;
    },
  )
  .handler(async ({ data }) => {
    const { ensureVault, processItem } = await import("./vault.server");
    const { neonQuery } = await import("./neon.server");
    await ensureVault();
    const existing = await neonQuery<{ id: string; status: string; title: string }>(
      `SELECT id, status, title FROM vault_items WHERE sha256=$1`,
      [data.sha256],
    );
    if (existing[0] && existing[0].status === "ready") {
      return { id: existing[0].id, duplicate: true as const, title: existing[0].title };
    }
    const id =
      existing[0]?.id ??
      (
        await neonQuery<{ id: string }>(
          `INSERT INTO vault_items (title, kind, source_filename, source_ref, sha256, byte_size, content, case_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [data.title.trim(), data.kind ?? "other", data.sourceFilename ?? null, data.sourceRef ?? null, data.sha256, data.byteSize ?? null, data.content, data.caseId?.trim() || null],
        )
      )[0].id;
    await processItem(id);
    return { id, duplicate: false as const, title: data.title };
  });

export const retryVaultItem = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { ensureVault, processItem } = await import("./vault.server");
    await ensureVault();
    await processItem(data.id);
    return { ok: true };
  });

export const deleteVaultItem = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    await neonQuery(`DELETE FROM vault_items WHERE id=$1`, [data.id]);
    await neonQuery(`DELETE FROM vault_entities e WHERE NOT EXISTS (SELECT 1 FROM vault_mentions m WHERE m.entity_id=e.id)`);
    return { ok: true };
  });

export const searchVault = createServerFn({ method: "POST" })
  .inputValidator((d: { query: string }) => {
    if (!d?.query?.trim()) throw new Error("query required");
    return d;
  })
  .handler(async ({ data }) => {
    const { searchVaultCore } = await import("./vault.server");
    return searchVaultCore(data.query, 15);
  });

export const getEntityFiles = createServerFn({ method: "GET" })
  .inputValidator((d: { entityId: string }) => d)
  .handler(async ({ data }) => {
    const { neonQuery } = await import("./neon.server");
    const ent = await neonQuery<{ entity_type: string; name: string; canonical_key: string }>(
      `SELECT entity_type, name, canonical_key FROM vault_entities WHERE id=$1`,
      [data.entityId],
    );
    if (!ent[0]) return null;
    const { recallFor } = await import("./vault.server");
    const files = await recallFor([ent[0].canonical_key]);
    const related = await neonQuery<{ entity_type: string; name: string; shared: number }>(
      `SELECT e2.entity_type, e2.name, count(*)::int AS shared
         FROM vault_mentions m1 JOIN vault_mentions m2 ON m2.item_id=m1.item_id AND m2.entity_id<>m1.entity_id
         JOIN vault_entities e2 ON e2.id=m2.entity_id
        WHERE m1.entity_id=$1 GROUP BY e2.id ORDER BY shared DESC LIMIT 20`,
      [data.entityId],
    );
    return { entity: ent[0], files, related };
  });

export const recallVault = createServerFn({ method: "GET" })
  .inputValidator((d: { identifiers: string[]; caseId?: string }) => d)
  .handler(async ({ data }) => {
    const { recallFor } = await import("./vault.server");
    return recallFor(data.identifiers.slice(0, 20), data.caseId);
  });

/** Pull Doctrine Library documents into the vault (a few per call). */
export const importDoctrineToVault = createServerFn({ method: "POST" }).handler(async () => {
  const { ensureVault, processItem } = await import("./vault.server");
  const { neonQuery } = await import("./neon.server");
  await ensureVault();
  const docs = await neonQuery<{ id: string; title: string; original_filename: string | null; sha256: string; byte_size: number | null; content: string }>(
    `SELECT d.id, d.title, d.original_filename, d.sha256, d.byte_size, d.content FROM doctrine_documents d
      WHERE NOT EXISTS (SELECT 1 FROM vault_items v WHERE v.sha256=d.sha256) ORDER BY d.uploaded_at LIMIT 3`,
  ).catch(() => []);
  let done = 0;
  for (const d of docs) {
    const ins = await neonQuery<{ id: string }>(
      `INSERT INTO vault_items (title, kind, source_filename, source_ref, sha256, byte_size, content)
       VALUES ($1,'research',$2,$3,$4,$5,$6) ON CONFLICT (sha256) DO NOTHING RETURNING id`,
      [d.title, d.original_filename, `doctrine:${d.id}`, d.sha256, d.byte_size, d.content],
    );
    if (ins[0]) {
      await processItem(ins[0].id).catch(() => undefined);
      done++;
    }
  }
  const left = await neonQuery<{ n: number }>(
    `SELECT count(*)::int AS n FROM doctrine_documents d WHERE NOT EXISTS (SELECT 1 FROM vault_items v WHERE v.sha256=d.sha256)`,
  ).catch(() => [{ n: 0 }]);
  return { imported: done, remaining: left[0]?.n ?? 0 };
});
