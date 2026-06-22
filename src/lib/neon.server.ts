import { Pool } from "pg";

// Singleton pool — reuse across server function invocations
declare global {
  // eslint-disable-next-line no-var
  var __neonPool: Pool | undefined;
}

export function getNeonPool(): Pool {
  if (!globalThis.__neonPool) {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NEON_DATABASE_URL is not set");
    }
    globalThis.__neonPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalThis.__neonPool;
}

export async function neonQuery<T = unknown>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getNeonPool();
  const res = await pool.query(text, params as never[]);
  return res.rows as T[];
}
