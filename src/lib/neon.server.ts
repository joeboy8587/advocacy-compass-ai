import { Pool } from "pg";

// Singleton pool — reuse across server function invocations
declare global {
  // eslint-disable-next-line no-var
  var __neonPool: Pool | undefined;
}

// Hard cap for any single SQL round-trip. Cloudflare Workers cancel a
// request after ~30s of hang, so we must fail-fast individual queries
// well before then and let callers report a real error instead.
const STATEMENT_TIMEOUT_MS = 8_000;

export function getNeonPool(): Pool {
  if (!globalThis.__neonPool) {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NEON_DATABASE_URL is not set");
    }
    globalThis.__neonPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 5_000,
      // pg respects these — server-side statement_timeout is the real
      // safety net; query_timeout is the client-side abort.
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
    } as ConstructorParameters<typeof Pool>[0]);
    globalThis.__neonPool.on("error", (err) => {
      // A background socket error should not crash the worker.
      console.error("[neon pool] idle client error:", err.message);
    });
  }
  return globalThis.__neonPool;
}

export async function neonQuery<T = unknown>(
  text: string,
  params: unknown[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<T[]> {
  const pool = getNeonPool();
  const timeoutMs = opts.timeoutMs ?? STATEMENT_TIMEOUT_MS + 2_000;

  // Belt-and-suspenders: race the query against a JS timer so we never
  // wait for a hung socket. The server-side statement_timeout should fire
  // first and produce a clean pg error; this is the fallback.
  const timer = new Promise<never>((_, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Best-effort unref for Node envs; Workers ignore.
    (t as unknown as { unref?: () => void }).unref?.();
  });

  const res = await Promise.race([pool.query(text, params as never[]), timer]);
  return (res as { rows: T[] }).rows;
}
