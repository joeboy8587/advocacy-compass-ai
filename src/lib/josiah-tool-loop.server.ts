import { JOSIAH_TOOLS, runJosiahTool } from "./josiah-tools.server";

export type JosiahToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type JosiahModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: JosiahToolCall[];
  tool_call_id?: string;
};

// Some compatible providers emit a JSON action in content instead of tool_calls.
// Only complete, allowlisted commands are executable; prose is never scanned.
export function contentToolCalls(content: string | null): JosiahToolCall[] {
  const text = (content ?? "").trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return []; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !("action" in value)) return [];
  const command = value as Record<string, unknown>;
  if (typeof command["action"] !== "string" || !JOSIAH_TOOLS.some(t => t.function.name === command["action"])) {
    throw new Error("Josiah requested an unsupported command. Please try the question again.");
  }
  const args = command["arguments"] ?? command["parameters"] ?? command["args"] ??
    Object.fromEntries(Object.entries(command).filter(([key]) => key !== "action"));
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Josiah returned invalid command arguments. Please try again.");
  return [{ id: "content_action", type: "function", function: { name: command["action"], arguments: JSON.stringify(args) } }];
}

export function requireJosiahAnswer(text: string): string {
  if (!text.trim() || contentToolCalls(text).length) {
    throw new Error("Josiah did not finish his answer. Please try the question again.");
  }
  return text;
}

export async function runJosiahToolLoop(opts: {
  messages: JosiahModelMessage[];
  call: (messages: JosiahModelMessage[], tools: boolean) => Promise<JosiahModelMessage>;
  maxSteps?: number;
  execute?: typeof runJosiahTool;
}): Promise<{ text: string; toolCalls: number }> {
  const conversation = [...opts.messages];
  let toolCalls = 0;
  for (let step = 0; step < (opts.maxSteps ?? 5); step++) {
    const message = await opts.call(conversation, true);
    const calls = message.tool_calls?.length ? message.tool_calls : contentToolCalls(message.content);
    if (!calls.length) {
      const text = (message.content ?? "").trim();
      if (!text) throw new Error("Josiah returned an empty answer. Please try again.");
      return { text, toolCalls };
    }
    conversation.push({ role: "assistant", content: null, tool_calls: calls });
    for (const call of calls) {
      if (!JOSIAH_TOOLS.some(t => t.function.name === call.function.name)) throw new Error("Josiah requested an unsupported command. Please try again.");
      let args: unknown;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = null; }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Josiah returned invalid command arguments. Please try again.");
      const result = await (opts.execute ?? runJosiahTool)(call.function.name, args as Record<string, unknown>);
      toolCalls++;
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  const final = await opts.call([...conversation, { role: "user", content: "Stop querying. Answer in plain English using the retrieved evidence, state any gaps, and do not output commands or JSON actions." }], false);
  if (final.tool_calls?.length || contentToolCalls(final.content).length || !final.content?.trim()) {
    throw new Error("Josiah could not finish his answer after checking the records. Please narrow the question and try again.");
  }
  return { text: final.content.trim(), toolCalls };
}