// NVIDIA NIM (OpenAI-compatible) chat client with Josiah's read-only DB tools.
// Server-only.

import { JOSIAH_TOOLS, runJosiahTool } from "./josiah-tools.server";

const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
export const DEFAULT_NIM_MODEL = "nvidia/nemotron-3-super-120b-a12b";

type NimMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

type NimResponse = {
  choices: Array<{ message: NimMsg; finish_reason?: string }>;
  error?: { message?: string };
};

export function hasNim(): boolean {
  return Boolean(process.env.NVIDIA_NIM_API_KEY);
}

async function nimCall(messages: NimMsg[], model: string, useTools: boolean): Promise<NimMsg> {
  let lastErr = "";
  // NIM occasionally returns a transient 500/429 — retry with short backoff.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(NIM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3 + attempt * 0.07,
        max_tokens: 3000,
        ...(useTools ? { tools: JOSIAH_TOOLS } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      lastErr = `NVIDIA NIM ${res.status}: ${body.slice(0, 300)}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(lastErr);
    }
    const j = (await res.json()) as NimResponse;
    if (j.error?.message) throw new Error(`NVIDIA NIM: ${j.error.message}`);
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error("NVIDIA NIM returned no choices");
    return msg;
  }
  throw new Error(lastErr || "NVIDIA NIM unavailable");
}

/**
 * Run a Josiah turn on NVIDIA NIM with live read-only database access.
 * The model may call list_tables / run_sql / search_cases / get_case /
 * aircraft_dossier as many times as it needs (bounded), then answers.
 */
export async function nimInvestigate(opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  tools?: boolean;
  maxSteps?: number;
}): Promise<{ text: string; model: string; toolCalls: number }> {
  const model = opts.model ?? process.env.NVIDIA_NIM_MODEL ?? DEFAULT_NIM_MODEL;
  const useTools = opts.tools !== false;
  const toolBrief = useTools
    ? `\n\n# LIVE DATABASE ACCESS\nYou are connected to the live Watchtower Neon PostgreSQL corpus and the case files. You have these tools:\n- list_tables(filter) — discover tables/columns before writing SQL\n- run_sql(sql) — read-only SELECT against live data (always LIMIT)\n- search_cases(query) — find case files by case id, tail, ICAO, owner, county\n- get_case(case_id) — full case file plus linked detections and violations\n- aircraft_dossier(identifier) — tail/ICAO dossier: registry owner, flight stats, low-altitude counts, violations, anomalies\n\nRULES: When the operator asks anything factual — counts, tails, owners, dates, cases — CALL A TOOL and answer from the returned rows. Never guess a number. If a query errors, call list_tables and correct the column names. Cite the tail numbers, case ids and counts you retrieved. Speak plain English to a non-technical operator: explain what the data means, never dump raw SQL unless asked.`
    : "";
  const convo: NimMsg[] = [{ role: "system", content: opts.system + toolBrief }, ...opts.messages];
  const maxSteps = opts.maxSteps ?? 5;
  let toolCalls = 0;

  for (let step = 0; step < maxSteps; step++) {
    const msg = await nimCall(convo, model, useTools);
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      return { text: (msg.content ?? "").trim(), model, toolCalls };
    }
    convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls.slice(0, 4)) {
      toolCalls++;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await runJosiahTool(call.function.name, args);
      convo.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  // Out of tool budget — ask for the final answer with tools disabled.
  const final = await nimCall(
    [...convo, { role: "user", content: "Stop querying. Answer now using what you have retrieved." }],
    model,
    false,
  );
  return { text: (final.content ?? "").trim(), model, toolCalls };
}
