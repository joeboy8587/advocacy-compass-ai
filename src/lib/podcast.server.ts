// Daily Narrative → two-host audio briefing.
// Script: NVIDIA NIM first (via generateTextWithFallback), voices: OpenAI TTS.
import { neonQuery, neonExecScript } from "./neon.server";

let ensured = false;
export async function ensurePodcastTable() {
  if (ensured) return;
  await neonExecScript(`
    CREATE TABLE IF NOT EXISTS podcast_episodes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      narrative_id integer NOT NULL,
      narrative_date text NOT NULL,
      script jsonb NOT NULL,
      audio_b64 text NOT NULL,
      sha256 text NOT NULL,
      script_provider text,
      voice_provider text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS podcast_episodes_narr_idx ON podcast_episodes (narrative_id, created_at DESC);
  `);
  ensured = true;
}

export type ScriptLine = { speaker: "A" | "B"; text: string };

const HOSTS = {
  A: { name: "Maya", voice: "coral", style: "Warm, clear public-radio host. Measured pace, plain English." },
  B: { name: "Eli", voice: "ash", style: "Calm, thoughtful co-host. Curious, steady, never dramatic." },
} as const;

const SCRIPT_SYSTEM = `You write a short two-host audio briefing for Watchtower, a civilian airspace-accountability watchdog in Kern County.
Hosts: Maya (A) leads; Eli (B) asks the questions a neighbour would ask and explains what things mean.
Rules:
- Use only facts in the narrative provided. Never invent numbers, tails or events.
- Plain spoken English for non-technical listeners. Say tail numbers naturally (e.g. "N nine one three K C").
- Neutral, population-scale framing. Never say "targeting", "stalking", "conspiracy". Never name private individuals.
- Never dismiss an aircraft because of who owns it; judge by how it flew.
- 14 to 22 lines total, each line 1-3 sentences. Open with the date, close with: "All data is from public sources and can be checked by anyone."
Return ONLY JSON: {"lines":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]}`;

export async function writeScript(narrativeDate: string, narrativeMd: string): Promise<{ lines: ScriptLine[]; provider: string }> {
  const { generateTextWithFallback } = await import("./ai-fallback.server");
  const { text, provider } = await generateTextWithFallback({
    model: "google/gemini-3-flash-preview",
    system: SCRIPT_SYSTEM,
    prompt: `Date: ${narrativeDate}\n\nDAILY NARRATIVE:\n${narrativeMd.slice(0, 20_000)}`,
    tools: false,
  });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("The script writer didn't return a script. Try again.");
  const j = JSON.parse(m[0]) as { lines?: Array<{ speaker?: string; text?: string }> };
  const lines = (j.lines ?? [])
    .map((l) => ({ speaker: (l.speaker === "B" ? "B" : "A") as "A" | "B", text: String(l.text ?? "").trim() }))
    .filter((l) => l.text)
    .slice(0, 26);
  if (lines.length < 4) throw new Error("The script came back too short. Try again.");
  return { lines, provider };
}

async function speak(line: ScriptLine): Promise<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No voice service key configured (OPENAI_API_KEY).");
  const host = HOSTS[line.speaker];
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: host.voice,
      input: line.text.slice(0, 3000),
      instructions: host.style,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`Voice service failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Voices every line (5 at a time, order kept) and joins them into one MP3. */
export async function voiceScript(lines: ScriptLine[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 5) {
    const batch = lines.slice(i, i + 5);
    const out = await Promise.all(batch.map((l) => speak(l)));
    out.forEach((b, k) => (parts[i + k] = b));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    merged.set(p, off);
    off += p.length;
  }
  return merged;
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const HOST_NAMES = { A: HOSTS.A.name, B: HOSTS.B.name };
export { neonQuery };
