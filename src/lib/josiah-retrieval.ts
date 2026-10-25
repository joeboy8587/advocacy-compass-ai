export type ChatTurn = { role: "user" | "assistant"; content: string };

export function chatHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((turn) => {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") return [];
    return [{ role: turn.role, content: turn.content.slice(0, 6000) }];
  });
}

export function aircraftIdentifiers(question: string, history: ChatTurn[] = []): string[] {
  const extract = (text: string) => text.toUpperCase().match(/\bN[0-9]{1,5}[A-Z]{0,2}\b|\b[A-F0-9]{6}\b/g) ?? [];
  const current = extract(question);
  if (current.length) return [...new Set(current)].slice(0, 6);
  for (const turn of [...history].reverse()) {
    if (turn.role !== "user") continue;
    const ids = extract(turn.content);
    if (ids.length) return [...new Set(ids)].slice(0, 6);
  }
  return [];
}

export type DetectionSearch = { identifier?: string; county?: string; since?: string; before?: string; limit?: number };

export function detectionStatement(input: DetectionSearch, resolvedHexes: string[] = []) {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (input.identifier?.trim()) {
    const id = input.identifier.trim().toUpperCase();
    const hexes = [...new Set([...resolvedHexes.flatMap(h => [h.toUpperCase(), h.toLowerCase()]), ...(/^[A-F0-9]{6}$/.test(id) ? [id, id.toLowerCase()] : [])])];
    const clauses = [`registration = ${bind(id)}`];
    if (hexes.length) clauses.push(`icao_hex = ANY(${bind(hexes)}::text[])`);
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (input.county?.trim()) where.push(`upper(county) = ${bind(input.county.trim().toUpperCase())}`);
  for (const [key, op] of [["since", ">="], ["before", "<"]] as const) {
    const value = input[key];
    if (!value) continue;
    if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key} date`);
    where.push(`captured_at ${op} ${bind(new Date(value).toISOString())}::timestamptz`);
  }
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 30) || 30));
  return { query: `SELECT id, to_json(captured_at) AS captured_at, icao_hex, registration, callsign, altitude_ft, speed_kts, on_ground, county, latitude, longitude, source_type
    FROM public.detections ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY public.detections.captured_at DESC, id DESC LIMIT ${bind(limit)}`, params };
}