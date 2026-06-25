// Shared AI text helper: Lovable Gateway first, then OpenAI fallback.
// Centralizes the "Lovable is out / over quota / rate-limited" handling so
// every Josiah surface (chat, brief drafter, corroboration, vision) keeps
// working off the user's OPENAI_API_KEY when the Lovable Gateway fails.

import { generateText } from "ai";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export type LovableModel =
  | "google/gemini-3-flash-preview"
  | "google/gemini-2.5-pro"
  | "google/gemini-2.5-flash"
  | "openai/gpt-5"
  | "openai/gpt-5-mini";

// Map a Lovable model id → an OpenAI model id for the fallback path.
function openaiEquivalent(model: string): string {
  if (model.startsWith("openai/")) return model.slice("openai/".length);
  if (model.includes("pro")) return "gpt-4o";
  return "gpt-4o-mini";
}

export type GenResult = { text: string; provider: "lovable" | "openai"; model: string };

/** Generate text with automatic Lovable→OpenAI fallback. */
export async function generateTextWithFallback(opts: {
  model: LovableModel | string;
  system?: string;
  prompt?: string;
  messages?: Msg[];
}): Promise<GenResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Try Lovable Gateway first
  if (lovableKey) {
    try {
      const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
      const gateway = createLovableAiGatewayProvider(lovableKey);
      const args: Parameters<typeof generateText>[0] = { model: gateway(opts.model) };
      if (opts.system) args.system = opts.system;
      if (opts.messages) args.messages = opts.messages;
      else if (opts.prompt) args.prompt = opts.prompt;
      const { text } = await generateText(args);
      return { text, provider: "lovable", model: opts.model };
    } catch (e) {
      const msg = (e as Error).message ?? "";
      console.warn("[AI] Lovable failed, attempting OpenAI fallback:", msg.slice(0, 200));
      if (!openaiKey) throw e;
    }
  }

  if (!openaiKey) throw new Error("No AI key configured (LOVABLE_API_KEY or OPENAI_API_KEY).");

  const oaModel = openaiEquivalent(opts.model);
  const messages: Msg[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  if (opts.messages) messages.push(...opts.messages);
  if (opts.prompt) messages.push({ role: "user", content: opts.prompt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: oaModel, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return { text: j.choices[0].message.content ?? "", provider: "openai", model: oaModel };
}
