import { neon } from "@neondatabase/serverless";

// The command center runs on a serverless Worker runtime where long-lived TCP
// pools (node-postgres) are unreliable: a saturated 3-connection pool made
// dashboard queries queue past the client-side deadline and surface as
// "Query timed out". The Neon HTTP driver issues each statement as a stateless
// fetch, so there is no pool to exhaust and no cold socket to wait on.


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

/**
 * Neon's HTTP driver sends every statement as a prepared statement, and Postgres
 * rejects prepared statements that contain more than one command
 * ("cannot insert multiple commands into a prepared statement").
 * Schema bootstraps are written as multi-statement DDL scripts, so split them on
 * top-level semicolons and run each command on its own.
 */
export async function neonExecScript(script: string): Promise<void> {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inDollar: string | null = null;

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (inDollar) {
      current += ch;
      if (script.startsWith(inDollar, i)) {
        current += script.slice(i + 1, i + inDollar.length);
        i += inDollar.length - 1;
        inDollar = null;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(script.slice(i));
      if (m) {
        inDollar = m[0];
        current += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === ";" && !inSingle && !inDouble) {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  statements.push(current);

  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    await neonQuery(stmt);
  }
}
