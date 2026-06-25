import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

// ---------- Josiah Vision: extract aircraft data from a radar screenshot ----------
export type VisionExtract = {
  registration: string | null;
  icao_hex: string | null;
  operator: string | null;
  aircraft_type: string | null;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  status_bar_time: string | null; // "HH:MM" 24h
  status_bar_period: "AM" | "PM" | null;
  departure_airport: string | null;
  map_area: string | null;
  notes: string | null;
};

export const analyzeScreenshot = createServerFn({ method: "POST" })
  .inputValidator((d: { image_data_url: string }) => {
    if (!d?.image_data_url?.startsWith("data:image/")) throw new Error("image_data_url required");
    return d;
  })
  .handler(async ({ data }): Promise<{ ok: true; extract: VisionExtract } | { ok: false; error: string }> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!lovableKey && !openaiKey) return { ok: false, error: "No AI key configured (LOVABLE_API_KEY or OPENAI_API_KEY)" };

    const system = `You are Josiah Vision — a forensic radar-screenshot OCR/extractor for Watchtower.
Read a Flightradar24 / ADS-B Exchange / similar tracker screenshot and extract structured aircraft data.
Read the STATUS BAR clock at the top of the phone (not EXIF) for the time. Return ONLY a JSON object — no prose, no markdown.
Schema:
{
  "registration": "<N-number, uppercase, or null>",
  "icao_hex": "<6-char hex lowercase, or null>",
  "operator": "<owner/operator string, or null>",
  "aircraft_type": "<type/model, or null>",
  "altitude_ft": <integer or null>,
  "groundspeed_kts": <integer or null>,
  "status_bar_time": "<HH:MM 24h or null>",
  "status_bar_period": "<AM|PM or null>",
  "departure_airport": "<IATA/ICAO or null>",
  "map_area": "<area/county/city visible on map or null>",
  "notes": "<short note about other aircraft visible, flight-path shape/color, or null>"
}`;

    async function tryLovable(): Promise<string> {
      if (!lovableKey) throw new Error("LOVABLE_API_KEY missing");
      const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
      const gateway = createLovableAiGatewayProvider(lovableKey);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Extract aircraft data from this radar screenshot. Return ONLY JSON." },
            { type: "image", image: data.image_data_url },
          ],
        }],
      });
      return text;
    }

    async function tryOpenAI(): Promise<string> {
      if (!openaiKey) throw new Error("OPENAI_API_KEY missing");
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: system },
            { role: "user", content: [
              { type: "text", text: "Extract aircraft data from this radar screenshot. Return ONLY JSON." },
              { type: "image_url", image_url: { url: data.image_data_url } },
            ]},
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      const j = await res.json() as { choices: Array<{ message: { content: string } }> };
      return j.choices[0].message.content;
    }

    let text: string;
    let providerUsed: "lovable" | "openai" = "lovable";
    try {
      text = await tryLovable();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      console.warn("[Josiah Vision] Lovable failed, falling back to OpenAI:", msg);
      if (!openaiKey) return { ok: false, error: msg.includes("429") ? "Lovable rate-limited and no OPENAI_API_KEY fallback." : msg.includes("402") ? "Lovable credits exhausted and no OPENAI_API_KEY fallback." : msg };
      try {
        text = await tryOpenAI();
        providerUsed = "openai";
      } catch (e2) {
        return { ok: false, error: `Both providers failed. Lovable: ${msg}. OpenAI: ${(e2 as Error).message}` };
      }
    }

    try {
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      const parsed = JSON.parse(jsonStr) as Partial<VisionExtract>;
      const norm: VisionExtract = {
        registration: parsed.registration ? String(parsed.registration).toUpperCase().replace(/[^A-Z0-9]/g, "") : null,
        icao_hex: parsed.icao_hex ? String(parsed.icao_hex).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6) : null,
        operator: parsed.operator ?? null,
        aircraft_type: parsed.aircraft_type ?? null,
        altitude_ft: typeof parsed.altitude_ft === "number" ? Math.round(parsed.altitude_ft) : null,
        groundspeed_kts: typeof parsed.groundspeed_kts === "number" ? Math.round(parsed.groundspeed_kts) : null,
        status_bar_time: parsed.status_bar_time ?? null,
        status_bar_period: parsed.status_bar_period === "AM" || parsed.status_bar_period === "PM" ? parsed.status_bar_period : null,
        departure_airport: parsed.departure_airport ?? null,
        map_area: parsed.map_area ?? null,
        notes: parsed.notes ?? null,
      };
      return { ok: true, extract: norm };
    } catch (e) {
      const msg = (e as Error).message ?? "Vision error";
      if (msg.includes("429")) return { ok: false, error: "Rate limited — try again in a moment." };
      if (msg.includes("402")) return { ok: false, error: "Lovable AI credits exhausted." };
      return { ok: false, error: msg };
    }
  });

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

let schemaReady: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await q(`
        CREATE TABLE IF NOT EXISTS radar_screenshots (
          id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          uploaded_at   timestamptz NOT NULL DEFAULT now(),
          source        text NOT NULL DEFAULT 'flightradar24',
          filename      text NOT NULL,
          file_size     bigint,
          sha256        text NOT NULL UNIQUE,
          image_data    text,
          mime_type     text,
          exif_taken_at timestamptz,
          tz_offset_min int,
          raw_exif      jsonb,
          tail          text,
          icao_hex      text,
          operator      text,
          aircraft_type text,
          altitude_ft   int,
          groundspeed_kts int,
          notes         text,
          match_count   int NOT NULL DEFAULT 0,
          match_window_s int,
          best_match_id uuid,
          best_match_delta_s int,
          match_status  text NOT NULL DEFAULT 'PENDING',
          status_bar_local text,
          match_method  text
        );
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS status_bar_local text;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS match_method text;
        CREATE INDEX IF NOT EXISTS radar_screenshots_uploaded_idx ON radar_screenshots(uploaded_at DESC);
        CREATE INDEX IF NOT EXISTS radar_screenshots_tail_idx ON radar_screenshots(tail);
        CREATE INDEX IF NOT EXISTS radar_screenshots_icao_idx ON radar_screenshots(icao_hex);
      `);
    })();
  }
  return schemaReady;
}

export type RadarScreenshot = {
  id: string;
  uploaded_at: string;
  source: string;
  filename: string;
  file_size: number | null;
  sha256: string;
  mime_type: string | null;
  exif_taken_at: string | null;
  tz_offset_min: number | null;
  tail: string | null;
  icao_hex: string | null;
  operator: string | null;
  aircraft_type: string | null;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  notes: string | null;
  match_count: number;
  match_window_s: number | null;
  best_match_delta_s: number | null;
  match_status: string;
};

export type DetectionMatch = {
  id: string;
  captured_at: string;
  icao_hex: string | null;
  registration: string | null;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  delta_s: number;
};

// ---------- Upload ----------
export const uploadScreenshot = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      filename: string;
      mime_type: string;
      file_size: number;
      sha256: string;
      image_data_url?: string | null;
      exif_taken_at?: string | null; // ISO with offset applied = UTC
      tz_offset_min?: number | null;
      raw_exif?: Record<string, unknown> | null;
      tail?: string | null;
      icao_hex?: string | null;
      operator?: string | null;
      aircraft_type?: string | null;
      altitude_ft?: number | null;
      groundspeed_kts?: number | null;
      notes?: string | null;
      source?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    await ensureSchema();
    const existing = await q<{ id: string }>(
      `SELECT id FROM radar_screenshots WHERE sha256 = $1 LIMIT 1`,
      [data.sha256],
    );
    if (existing.length) {
      return { id: existing[0].id, duplicate: true as const };
    }
    const rows = await q<{ id: string }>(
      `INSERT INTO radar_screenshots
        (source, filename, file_size, sha256, image_data, mime_type,
         exif_taken_at, tz_offset_min, raw_exif,
         tail, icao_hex, operator, aircraft_type,
         altitude_ft, groundspeed_kts, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        data.source ?? "flightradar24",
        data.filename,
        data.file_size,
        data.sha256,
        data.image_data_url ?? null,
        data.mime_type,
        data.exif_taken_at ?? null,
        data.tz_offset_min ?? null,
        data.raw_exif ? JSON.stringify(data.raw_exif) : null,
        data.tail?.toUpperCase() ?? null,
        data.icao_hex?.toLowerCase() ?? null,
        data.operator ?? null,
        data.aircraft_type ?? null,
        data.altitude_ft ?? null,
        data.groundspeed_kts ?? null,
        data.notes ?? null,
      ],
    );
    return { id: rows[0].id, duplicate: false as const };
  });

// ---------- List ----------
export const listScreenshots = createServerFn({ method: "GET" })
  .inputValidator((d: { limit?: number; search?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    await ensureSchema();
    const limit = Math.min(data.limit ?? 100, 500);
    const params: unknown[] = [limit];
    let where = "";
    if (data.search && data.search.trim()) {
      params.push(`%${data.search.trim()}%`);
      where = `WHERE tail ILIKE $2 OR icao_hex ILIKE $2 OR operator ILIKE $2 OR filename ILIKE $2`;
    }
    return q<RadarScreenshot>(
      `SELECT id, uploaded_at, source, filename, file_size, sha256, mime_type,
              exif_taken_at, tz_offset_min, tail, icao_hex, operator, aircraft_type,
              altitude_ft, groundspeed_kts, notes,
              match_count, match_window_s, best_match_delta_s, match_status
       FROM radar_screenshots
       ${where}
       ORDER BY uploaded_at DESC
       LIMIT $1`,
      params,
    );
  });

// ---------- Match against detections ----------
export const matchScreenshot = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; window_seconds?: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const win = Math.min(Math.max(data.window_seconds ?? 600, 30), 86400);
    const shotRows = await q<{
      id: string;
      exif_taken_at: string | null;
      tail: string | null;
      icao_hex: string | null;
    }>(
      `SELECT id, exif_taken_at, tail, icao_hex FROM radar_screenshots WHERE id = $1`,
      [data.id],
    );
    if (!shotRows.length) throw new Error("Screenshot not found");
    const shot = shotRows[0];
    if (!shot.exif_taken_at) {
      await q(
        `UPDATE radar_screenshots SET match_status='NO_TIMESTAMP', match_count=0, match_window_s=$2 WHERE id=$1`,
        [shot.id, win],
      );
      return { matches: [] as DetectionMatch[], status: "NO_TIMESTAMP" as const };
    }
    if (!shot.tail && !shot.icao_hex) {
      await q(
        `UPDATE radar_screenshots SET match_status='NO_AIRCRAFT', match_count=0, match_window_s=$2 WHERE id=$1`,
        [shot.id, win],
      );
      return { matches: [] as DetectionMatch[], status: "NO_AIRCRAFT" as const };
    }
    const aircraftPredicate: string[] = [];
    const params: unknown[] = [shot.exif_taken_at, win];
    if (shot.icao_hex) {
      params.push(shot.icao_hex.toLowerCase());
      aircraftPredicate.push(`lower(d.icao_hex) = $${params.length}`);
    }
    if (shot.tail) {
      params.push(shot.tail.toUpperCase());
      aircraftPredicate.push(`upper(d.registration) = $${params.length}`);
    }
    const matches = await q<DetectionMatch>(
      `SELECT d.id, d.captured_at, d.icao_hex, d.registration,
              d.altitude_ft, d.speed_kts AS groundspeed_kts, d.county,
              d.latitude, d.longitude,
              abs(extract(epoch from (d.captured_at - $1::timestamptz)))::int AS delta_s
       FROM detections d
       WHERE (${aircraftPredicate.join(" OR ")})
         AND d.captured_at BETWEEN ($1::timestamptz - ($2 || ' seconds')::interval)
                               AND ($1::timestamptz + ($2 || ' seconds')::interval)
       ORDER BY delta_s ASC
       LIMIT 25`,
      params,
    );
    const best = matches[0];
    const status =
      matches.length === 0
        ? "NO_MATCH"
        : best.delta_s <= 60
          ? "LOCKED"
          : best.delta_s <= 300
            ? "STRONG"
            : "WEAK";
    await q(
      `UPDATE radar_screenshots
         SET match_status=$2, match_count=$3, match_window_s=$4,
             best_match_id=$5, best_match_delta_s=$6
       WHERE id=$1`,
      [shot.id, status, matches.length, win, best?.id ?? null, best?.delta_s ?? null],
    );
    return { matches, status };
  });

// ---------- Update (inline edit of identity / timestamp) ----------
export const updateScreenshot = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id: string;
      tail?: string | null;
      icao_hex?: string | null;
      operator?: string | null;
      aircraft_type?: string | null;
      altitude_ft?: number | null;
      groundspeed_kts?: number | null;
      exif_taken_at?: string | null;
      tz_offset_min?: number | null;
      notes?: string | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    await ensureSchema();
    await q(
      `UPDATE radar_screenshots SET
         tail = COALESCE($2, tail),
         icao_hex = COALESCE($3, icao_hex),
         operator = COALESCE($4, operator),
         aircraft_type = COALESCE($5, aircraft_type),
         altitude_ft = COALESCE($6, altitude_ft),
         groundspeed_kts = COALESCE($7, groundspeed_kts),
         exif_taken_at = COALESCE($8::timestamptz, exif_taken_at),
         tz_offset_min = COALESCE($9, tz_offset_min),
         notes = COALESCE($10, notes),
         match_status = 'PENDING'
       WHERE id = $1`,
      [
        data.id,
        data.tail ? data.tail.toUpperCase() : null,
        data.icao_hex ? data.icao_hex.toLowerCase() : null,
        data.operator ?? null,
        data.aircraft_type ?? null,
        data.altitude_ft ?? null,
        data.groundspeed_kts ?? null,
        data.exif_taken_at ?? null,
        data.tz_offset_min ?? null,
        data.notes ?? null,
      ],
    );
    return { ok: true };
  });

// ---------- Delete ----------
export const deleteScreenshot = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    await q(`DELETE FROM radar_screenshots WHERE id = $1`, [data.id]);
    return { ok: true };
  });
