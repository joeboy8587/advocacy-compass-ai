import { neon, neonConfig } from "@neondatabase/serverless";

// The command center runs on a serverless Worker runtime where long-lived TCP
// pools (node-postgres) are unreliable: a saturated 3-connection pool made
// dashboard queries queue past the client-side deadline and surface as
// "Query timed out". The Neon HTTP driver issues each statement as a stateless
// fetch, so there is no pool to exhaust and no cold socket to wait on.
neonConfig.fetchConnectionCache = true;

const QUERY_TIMEOUT_MS = 20_000;

type SqlClient = ReturnType<typeof neon>;

declare global {
  // eslint-disable-next-line no-var
  var __neonSql: SqlClient | undefined;
}

function getSql(): SqlClient {
  if (!globalThis.__neonSql) {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NEON_DATABASE_URL is not set");
    }
    globalThis.__neonSql = neon(connectionString, { fullResults: true });
  }
  return globalThis.__neonSql;
}

export async function neonQuery<T = unknown>(
  text: string,
  params: unknown[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<T[]> {
  const sql = getSql();
  const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const res = (await Promise.race([
      sql.query(text, params as never[]),
      deadline,
    ])) as { rows: T[] };
    return res.rows;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
