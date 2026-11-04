// Ollama Cloud (OpenAI-compatible) chat client. Server-only.
const OLLAMA_URL = "https://ollama.com/v1/chat/completions";
export const DEFAULT_OLLAMA_MODEL = "gpt-oss:120b";

export function hasOllama(): boolean {
  return Boolean(process.env.OLLAMA_API_KEY);
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function ollamaChat(opts: { messages: Msg[]; json?: boolean; model?: string }): Promise<{ text: string; model: string }> {
  const k = process.env.OLLAMA_API_KEY;
  if (!k) throw new Error("OLLAMA_API_KEY missing");
  const model = opts.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Ollama returned empty text");
  return { text, model };
}
