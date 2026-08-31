// Read-only investigative tools Josiah can call during a chat turn.
// Everything here is server-only and strictly SELECT-only.

import { neonQuery } from "./neon.server";

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const JOSIAH_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "list_tables",
      description:
        "List the tables and their columns available in the Watchtower Neon database. Use this before writing SQL if you are unsure of a column name.",
      parameters: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "Optional substring to filter table names (e.g. 'case', 'detect', 'anomaly').",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_sql",
      description:
        "Run a READ-ONLY SQL SELECT against the live Watchtower Neon database and get rows back as JSON. Single statement only. Always add a LIMIT. Use this whenever the operator asks a factual question about detections, violations, operators, aircraft, anomalies, convergence locks or cases.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "A single read-only SELECT (or WITH ... SELECT) statement." },
          purpose: { type: "string", description: "One short line on what this query proves." },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_cases",
      description:
        "Search Watchtower case files by case id, tail number, ICAO hex, owner or county. Returns the case rows with status, WTI score and summary.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Free text: case id, tail, ICAO hex, owner or county." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_case",
      description: "Load one full case file (all columns) plus its recent linked detections and violations.",
      parameters: {
        type: "object",
        properties: { case_id: { type: "string", description: "Case id such as WTPR-2026-0020." } },
        required: ["case_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aircraft_dossier",
      description:
        "Full dossier for one aircraft by tail number or ICAO hex: FAA registry owner, detection stats, low-altitude counts, violations and anomaly events.",
      parameters: {
        type: "object",
        properties: { identifier: { type: "string", description: "Tail number (N913KC) or ICAO hex (a1b2c3)." } },
        required: ["identifier"],
      },
    },
  },
];

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|merge)\b/i;

function guardSql(sqlRaw: string): string {
  const sql = sqlRaw.trim().replace(/;+\s*$/, "");
  if (sql.includes(";")) throw new Error("Only one statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT / WITH queries are allowed.");
  if (FORBIDDEN.test(sql)) throw new Error("Write operations are not permitted.");
  return /\blimit\b/i.test(sql) ? sql : `${sql} LIMIT 200`;
}

export async function runJosiahTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case "list_tables": {
        const filter = typeof args.filter === "string" ? `%${args.filter}%` : "%";
        const rows = await neonQuery<{ table_name: string; columns: string }>(
          `SELECT table_name, string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) AS columns
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name ILIKE $1
            GROUP BY table_name ORDER BY table_name LIMIT 120`,
          [filter],
        );
        return rows;
      }
      case "run_sql": {
        const sql = guardSql(String(args.sql ?? ""));
        const rows = await neonQuery<Record<string, unknown>>(sql);
        return { row_count: rows.length, rows: rows.slice(0, 100) };
      }
      case "search_cases": {
        const q = `%${String(args.query ?? "").trim()}%`;
        const rows = await neonQuery<Record<string, unknown>>(
          `SELECT case_id, case_type, status, severity, subject_reg, subject_icao, subject_owner,
                  primary_county, wti_score, wti_tier, total_events, related_tails,
                  left(COALESCE(auto_summary, public_summary, ''), 400) AS summary
             FROM cases
            WHERE case_id ILIKE $1 OR subject_reg ILIKE $1 OR subject_icao ILIKE $1
               OR subject_owner ILIKE $1 OR primary_county ILIKE $1
               OR array_to_string(COALESCE(related_tails, '{}'), ',') ILIKE $1
            ORDER BY wti_score DESC NULLS LAST LIMIT 25`,
          [q],
        );
        return rows;
      }
      case "get_case": {
        const id = String(args.case_id ?? "");
        const rows = await neonQuery<Record<string, unknown>>(
          `SELECT * FROM cases WHERE case_id = $1 OR id::text = $1 LIMIT 1`,
          [id],
        );
        if (!rows[0]) return { error: "case not found" };
        const c = rows[0] as { subject_icao?: string | null; detection_ids?: string[] | null };
        const [dets, vios] = await Promise.all([
          c.detection_ids?.length
            ? neonQuery(
                `SELECT captured_at, registration, altitude_ft, county, is_military
                   FROM detections WHERE id = ANY($1::uuid[]) ORDER BY captured_at DESC LIMIT 40`,
                [c.detection_ids.slice(0, 200)],
              ).catch(() => [])
            : Promise.resolve([]),
          c.subject_icao
            ? neonQuery(
                `SELECT rule_violated, owner_name, aircraft_mfr, aircraft_model
                   FROM violation_classifications WHERE lower(icao_hex) = lower($1) LIMIT 25`,
                [c.subject_icao],
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        return { case: rows[0], detections: dets, violations: vios };
      }
      case "aircraft_dossier": {
        const id = String(args.identifier ?? "").trim();
        const [stats, vios, anomalies] = await Promise.all([
          neonQuery<Record<string, unknown>>(
            `SELECT icao_hex, MAX(registration) AS registration, count(*)::int AS detections,
                    count(*) FILTER (WHERE altitude_ft < 500 AND on_ground = false)::int AS low_altitude,
                    min(captured_at)::text AS first_seen, max(captured_at)::text AS last_seen,
                    array_agg(DISTINCT county) FILTER (WHERE county IS NOT NULL) AS counties
               FROM detections
              WHERE lower(icao_hex) = lower($1) OR upper(registration) = upper($1)
              GROUP BY icao_hex ORDER BY detections DESC LIMIT 3`,
            [id],
          ).catch(() => []),
          neonQuery<Record<string, unknown>>(
            `SELECT rule_violated, count(*)::int AS n, MAX(owner_name) AS owner_name
               FROM violation_classifications
              WHERE lower(icao_hex) = lower($1) OR upper(registration) = upper($1)
              GROUP BY rule_violated ORDER BY n DESC LIMIT 15`,
            [id],
          ).catch(() => []),
          neonQuery<Record<string, unknown>>(
            `SELECT anomaly_type, count(*)::int AS n, max(detected_at)::text AS latest
               FROM anomaly_events WHERE lower(icao_hex) = lower($1)
              GROUP BY anomaly_type ORDER BY n DESC LIMIT 15`,
            [id],
          ).catch(() => []),
        ]);
        return { identifier: id, flight_stats: stats, violations: vios, anomalies };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
}
