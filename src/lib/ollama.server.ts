// Ollama Cloud (OpenAI-compatible) chat client. Server-only.
import { JOSIAH_TOOLS } from "./josiah-tools.server";
import { runJosiahToolLoop, type JosiahModelMessage } from "./josiah-tool-loop.server";
const OLLAMA_URL = "https://ollama.com/v1/chat/completions";
export const DEFAULT_OLLAMA_MODEL = "gpt-oss:120b";

export function hasOllama(): boolean {
  return Boolean(process.env.OLLAMA_API_KEY);
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function ollamaChat(opts: { messages: Msg[]; json?: boolean; model?: string; tools?: boolean }): Promise<{ text: string; model: string }> {
  const k = process.env.OLLAMA_API_KEY;
  if (!k) throw new Error("OLLAMA_API_KEY missing");
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const call = async (messages: JosiahModelMessage[], tools: boolean): Promise<JosiahModelMessage> => {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(tools ? { tools: JOSIAH_TOOLS } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { choices?: { message?: JosiahModelMessage }[] };
  const message = j.choices?.[0]?.message;
  if (!message) throw new Error("Ollama returned no choices");
  return message;
  };
  if (opts.tools && !opts.json) {
    const result = await runJosiahToolLoop({ messages: opts.messages, call });
    return { text: result.text, model };
  }
  const text = (await call(opts.messages, false)).content ?? "";
  if (!text) throw new Error("Ollama returned empty text");
  return { text, model };
}
