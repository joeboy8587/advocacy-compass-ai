import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

// ---------- Josiah Vision: structured scene extraction from a radar screenshot ----------
// This is NOT OCR. The model reads the screenshot as a structured scene: it understands
// that "REG: N/A" in the FR24 info panel means a MASKED contact (not an absent aircraft),
// and it reads the surrounding map labels ("No call sign" pins included).
export type VisionExtract = {
  shot_type: string | null; // "fr24" | "adsbx" | "welltory" | "other"
  registration: string | null;
  icao_hex: string | null;
  operator: string | null;
  aircraft_type: string | null;
  altitude_ft: number | null;
  groundspeed_kts: number | null;
  masked: boolean; // selected contact shows N/A registration => masked, NOT missing
  map_labels: string[]; // every label visible on the map, incl. "No call sign"
  contact_count: number | null; // how many aircraft contacts are visible on the scope
  status_bar_time: string | null; // "HH:MM" 24h
  status_bar_period: "AM" | "PM" | null;
  capture_date: string | null; // "YYYY-MM-DD" read from the radar/map date block
  capture_date_source: string | null; // where the date was read from
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

    const system = `You are Josiah Vision — a forensic scene extractor for Watchtower. You do STRUCTURED SCENE EXTRACTION, not character recognition.
You are looking at a flight-tracker screenshot (Flightradar24 / ADS-B Exchange / similar) or occasionally a biometrics panel.

CRITICAL SEMANTICS:
- If the selected-aircraft info panel shows "REG: N/A", "N/A", "—", or a blank registration/callsign, that is a MASKED contact. Set "masked": true and leave "registration" null. NEVER conclude "no aircraft" — a masked, loitering contact is the highest-value evidence class in this archive.
- Read EVERY label drawn on the map into "map_labels", including tail numbers and the literal string "No call sign".
- "contact_count" = how many distinct aircraft contacts/icons you can see on the scope.
- Read the STATUS BAR clock at the top of the phone (not EXIF) for the time.
- Find the DATE only if a date is actually visible (map/playback date label, flight-date row, timeline header, lock-screen date). NEVER guess a date from the filename. If no date is legible, return null.
Return ONLY a JSON object — no prose, no markdown.
Schema:
{
  "shot_type": "<fr24|adsbx|welltory|other>",
  "registration": "<N-number of the SELECTED aircraft, uppercase, or null if masked/absent>",
  "icao_hex": "<6-char hex lowercase, or null>",
  "operator": "<owner/operator string, or null>",
  "aircraft_type": "<type/model, e.g. C172S, or null>",
  "altitude_ft": <integer or null>,
  "groundspeed_kts": <integer or null>,
  "masked": <true if the selected contact has no registration/callsign shown, else false>,
  "map_labels": ["<every label visible on the map, incl. 'No call sign'>"],
  "contact_count": <integer count of aircraft contacts visible, or null>,
  "status_bar_time": "<HH:MM 24h or null>",
  "status_bar_period": "<AM|PM or null>",
  "capture_date": "<YYYY-MM-DD visible in the image; null if not visible>",
  "capture_date_source": "<where the date was read, e.g. 'map date label', or null>",
  "departure_airport": "<IATA/ICAO or null>",
  "map_area": "<area/county/city visible on map or null>",
  "notes": "<flight-path shape (orbit/loop/transit), other contacts, anything forensically relevant>"
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
    void providerUsed;

    try {
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      const parsed = JSON.parse(jsonStr) as Partial<VisionExtract>;
      const reg = parsed.registration ? String(parsed.registration).toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
      const labels = Array.isArray(parsed.map_labels)
        ? parsed.map_labels.map((l) => String(l).trim()).filter(Boolean).slice(0, 40)
        : [];
      const norm: VisionExtract = {
        shot_type: parsed.shot_type ? String(parsed.shot_type).toLowerCase() : null,
        masked: parsed.masked === true || (!reg && (labels.length > 0 || parsed.aircraft_type != null || parsed.altitude_ft != null)),
        map_labels: labels,
        contact_count:
          typeof parsed.contact_count === "number"
            ? Math.max(0, Math.round(parsed.contact_count))
            : labels.length || null,
        registration: reg && reg !== "NA" ? reg : null,

        icao_hex: parsed.icao_hex ? String(parsed.icao_hex).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6) : null,
        operator: parsed.operator ?? null,
        aircraft_type: parsed.aircraft_type ?? null,
        altitude_ft: typeof parsed.altitude_ft === "number" ? Math.round(parsed.altitude_ft) : null,
        groundspeed_kts: typeof parsed.groundspeed_kts === "number" ? Math.round(parsed.groundspeed_kts) : null,
        status_bar_time: parsed.status_bar_time ?? null,
        status_bar_period: parsed.status_bar_period === "AM" || parsed.status_bar_period === "PM" ? parsed.status_bar_period : null,
        capture_date: typeof parsed.capture_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.capture_date.trim())
          ? parsed.capture_date.trim()
          : null,
        capture_date_source: parsed.capture_date_source ?? null,
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

async function exec(text: string): Promise<void> {
  const { neonExecScript } = await import("./neon.server");
  return neonExecScript(text);
}

let schemaReady: Promise<void> | null = null;
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await exec(`
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
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS masked boolean NOT NULL DEFAULT false;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS map_labels text[];
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS contact_count int;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS shot_type text;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS time_source text;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS time_confidence text;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS time_conflict boolean NOT NULL DEFAULT false;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS time_signals jsonb;
        ALTER TABLE radar_screenshots ADD COLUMN IF NOT EXISTS bind_class text;
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
  image_data: string | null;
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
  status_bar_local: string | null;
  match_method: string | null;
  masked: boolean;
  map_labels: string[] | null;
  contact_count: number | null;
  shot_type: string | null;
  time_source: string | null;
  time_confidence: string | null;
  time_conflict: boolean;
  bind_class: string | null;
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
      exif_taken_at?: string | null;
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
      status_bar_local?: string | null;
      masked?: boolean | null;
      map_labels?: string[] | null;
      contact_count?: number | null;
      shot_type?: string | null;
      time_source?: string | null;
      time_confidence?: string | null;
      time_conflict?: boolean | null;
      time_signals?: Record<string, unknown> | null;
    }) => d,
  )
  .handler(async ({ data }) => {
    await ensureSchema();
    const existing = await q<{ id: string }>(
      `SELECT id FROM radar_screenshots WHERE sha256 = $1 LIMIT 1`,
      [data.sha256],
    );
    if (existing.length) return { id: existing[0].id, duplicate: true as const };
    const rows = await q<{ id: string }>(
      `INSERT INTO radar_screenshots
        (source, filename, file_size, sha256, image_data, mime_type,
         exif_taken_at, tz_offset_min, raw_exif,
         tail, icao_hex, operator, aircraft_type,
         altitude_ft, groundspeed_kts, notes, status_bar_local,
         masked, map_labels, contact_count, shot_type,
         time_source, time_confidence, time_conflict, time_signals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23,$24,$25)
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
        data.status_bar_local ?? null,
        data.masked ?? false,
        data.map_labels ?? null,
        data.contact_count ?? null,
        data.shot_type ?? null,
        data.time_source ?? null,
        data.time_confidence ?? null,
        data.time_conflict ?? false,
        data.time_signals ? JSON.stringify(data.time_signals) : null,
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
      where = `WHERE tail ILIKE $2 OR icao_hex ILIKE $2 OR operator ILIKE $2 OR filename ILIKE $2
               OR array_to_string(COALESCE(map_labels,'{}'), ',') ILIKE $2`;
    }
    return q<RadarScreenshot>(
      `SELECT id, uploaded_at, source, filename, file_size, sha256,
              image_data, mime_type,
              exif_taken_at, tz_offset_min, tail, icao_hex, operator, aircraft_type,
              altitude_ft, groundspeed_kts, notes,
              match_count, match_window_s, best_match_delta_s, match_status,
              status_bar_local, match_method,
              masked, map_labels, contact_count, shot_type,
              time_source, time_confidence, time_conflict, bind_class
       FROM radar_screenshots
       ${where}
       ORDER BY uploaded_at DESC
       LIMIT $1`,
      params,
    );
  });


// ---------- Match against detections ----------
// Strategy:
//   1) Resolve ICAO from FAA registry if only tail is known (and vice versa).
//   2) Exact-time window match around exif_taken_at (when present).
//   3) FALLBACK: time-of-day match across the last 14 days using status_bar_local
//      (the phone's clock at capture). This rescues screenshots with bad/missing
//      EXIF — the user's most common case — and is the formula the legacy
//      visual_evidence pipeline used.
export const matchScreenshot = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; window_seconds?: number; tod_days?: number }) => d)
  .handler(async ({ data }) => {
    await ensureSchema();
    const win = Math.min(Math.max(data.window_seconds ?? 900, 30), 86400);
    const todDays = Math.min(Math.max(data.tod_days ?? 14, 1), 60);
    const shotRows = await q<{
      id: string;
      exif_taken_at: string | null;
      tail: string | null;
      icao_hex: string | null;
      status_bar_local: string | null;
      tz_offset_min: number | null;
    }>(
      `SELECT id, exif_taken_at, tail, icao_hex, status_bar_local, tz_offset_min
       FROM radar_screenshots WHERE id = $1`,
      [data.id],
    );
    if (!shotRows.length) throw new Error("Screenshot not found");
    const shot = shotRows[0];
    let tail = shot.tail?.toUpperCase() ?? null;
    let icao = shot.icao_hex?.toLowerCase() ?? null;

    // Auto-resolve ICAO <-> tail via FAA registry so the match predicate matches detections
    // that were only stored under one of the two identifiers.
    if (tail && !icao) {
      const n = tail.startsWith("N") ? tail.slice(1) : tail;
      const r = await q<{ mode_s_code_hex: string | null }>(
        `SELECT mode_s_code_hex FROM faa_master WHERE n_number = $1 LIMIT 1`,
        [n],
      );
      if (r[0]?.mode_s_code_hex) icao = r[0].mode_s_code_hex.toLowerCase();
    } else if (icao && !tail) {
      const r = await q<{ n_number: string }>(
        `SELECT n_number FROM faa_master WHERE lower(mode_s_code_hex) = $1 LIMIT 1`,
        [icao],
      );
      if (r[0]?.n_number) tail = `N${r[0].n_number}`;
    }

    if (!tail && !icao) {
      await q(
        `UPDATE radar_screenshots SET match_status='NO_AIRCRAFT', match_count=0, match_window_s=$2, match_method=NULL WHERE id=$1`,
        [shot.id, win],
      );
      return { matches: [] as DetectionMatch[], status: "NO_AIRCRAFT" as const, method: null as string | null };
    }

    // Build aircraft predicate, including resolved icao/tail
    const params: unknown[] = [];
    const preds: string[] = [];
    if (icao) { params.push(icao); preds.push(`lower(d.icao_hex) = $${params.length}`); }
    if (tail) { params.push(tail); preds.push(`upper(d.registration) = $${params.length}`); }
    const aircraftPred = `(${preds.join(" OR ")})`;

    // --- Pass 1: exact-time window around EXIF/synthesized UTC ---
    let matches: DetectionMatch[] = [];
    let method: "exact" | "time_of_day" | "time_of_day_hint" | null = null;
    if (shot.exif_taken_at) {
      const p1 = [...params, shot.exif_taken_at, win];
      matches = await q<DetectionMatch>(
        `SELECT d.id, d.captured_at, d.icao_hex, d.registration,
                d.altitude_ft, d.speed_kts AS groundspeed_kts, d.county,
                d.latitude, d.longitude,
                abs(extract(epoch from (d.captured_at - $${p1.length - 1}::timestamptz)))::int AS delta_s
         FROM detections d
         WHERE ${aircraftPred}
           AND d.captured_at BETWEEN ($${p1.length - 1}::timestamptz - ($${p1.length} || ' seconds')::interval)
                                 AND ($${p1.length - 1}::timestamptz + ($${p1.length} || ' seconds')::interval)
         ORDER BY delta_s ASC
         LIMIT 25`,
        p1,
      );
      if (matches.length) method = "exact";
    }

    // --- Pass 2: time-of-day candidates over last `todDays` days ---
    // These are HINTS only. Without an exact capture date read off the image we do not
    // claim a lock — filenames and file timestamps are not forensic evidence.
    if (!matches.length && shot.status_bar_local) {
      const tz = shot.tz_offset_min ?? -420; // default PDT
      // captured_at + tz minutes = local time. Compare time-of-day (mod 86400) with wrap.
      const p2 = [...params, shot.status_bar_local, tz, win, todDays];
      matches = await q<DetectionMatch>(
        `WITH d_local AS (
           SELECT d.id, d.captured_at, d.icao_hex, d.registration,
                  d.altitude_ft, d.speed_kts AS groundspeed_kts, d.county,
                  d.latitude, d.longitude,
                  (d.captured_at + ($${p2.length - 2} || ' minutes')::interval) AS local_ts
           FROM detections d
           WHERE ${aircraftPred}
             AND d.captured_at > now() - ($${p2.length} || ' days')::interval
         ),
         scored AS (
           SELECT *,
                  LEAST(
                    abs(extract(epoch from (local_ts::time - $${p2.length - 3}::time))),
                    86400 - abs(extract(epoch from (local_ts::time - $${p2.length - 3}::time)))
                  )::int AS delta_s
           FROM d_local
         )
         SELECT id, captured_at, icao_hex, registration, altitude_ft, groundspeed_kts,
                county, latitude, longitude, delta_s
         FROM scored
         WHERE delta_s <= $${p2.length - 1}
         ORDER BY delta_s ASC, captured_at DESC
         LIMIT 25`,
        p2,
      );
      if (matches.length) method = shot.exif_taken_at ? "time_of_day" : "time_of_day_hint";
    }

    const best = matches[0];
    const hasExactDate = Boolean(shot.exif_taken_at);
    const status = !hasExactDate
      ? "NEEDS_DATE"
      : matches.length === 0
        ? "NO_MATCH"
        : best.delta_s <= 60
          ? "LOCKED"
          : best.delta_s <= 300
            ? "STRONG"
            : "WEAK";
    await q(
      `UPDATE radar_screenshots
         SET match_status=$2, match_count=$3, match_window_s=$4,
             best_match_id=$5, best_match_delta_s=$6, match_method=$7,
             tail = COALESCE(tail, $8), icao_hex = COALESCE(icao_hex, $9)
       WHERE id=$1`,
      [shot.id, status, matches.length, win, best?.id ?? null, best?.delta_s ?? null, method, tail, icao],
    );
    return { matches, status, method };
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
      status_bar_local?: string | null;
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
         status_bar_local = COALESCE($10, status_bar_local),
         notes = COALESCE($11, notes),
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
        data.status_bar_local ?? null,
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
