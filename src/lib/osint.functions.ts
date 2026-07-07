import { createServerFn } from "@tanstack/react-start";

// ============================================================
// OSINT ENRICHMENT
// Free sources (auto): OpenSky, OpenStreetMap Overpass, Nominatim,
// OpenCorporates public search, OpenSanctions, Wayback Machine.
// Paid/rate-limited (manual): ADS-B via RapidAPI (RAPIDAPI_ADSB_KEY).
// All results are hashed, timestamped, and attached to a case.
// ============================================================

async function q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const { neonQuery } = await import("./neon.server");
  return neonQuery<T>(text, params);
}

async function sha256(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}


async function safeFetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<{
  ok: boolean;
  status: number;
  json: unknown;
  text?: string;
}> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Watchtower-OSINT/1.0 (public accountability research)",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

// ============================================================
// TABLES — created on first call, idempotent
// ============================================================
let tablesEnsured = false;
async function ensureTables() {
  if (tablesEnsured) return;
  await q(`
    CREATE TABLE IF NOT EXISTS osint_findings (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id       text NOT NULL,
      source        text NOT NULL,
      subject       text NOT NULL,
      title         text,
      summary       text,
      red_flag      boolean NOT NULL DEFAULT false,
      payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_url    text,
      wayback_url   text,
      sha256        text NOT NULL,
      retrieved_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS osint_findings_case_idx ON osint_findings(case_id, retrieved_at DESC);
    CREATE INDEX IF NOT EXISTS osint_findings_dedupe_idx
      ON osint_findings(case_id, source, subject, sha256);

    CREATE TABLE IF NOT EXISTS osint_adsb_pulls (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id       text NOT NULL,
      icao_hex      text NOT NULL,
      registration  text,
      endpoint      text NOT NULL,
      status_code   int,
      payload       jsonb,
      sha256        text NOT NULL,
      retrieved_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS osint_adsb_pulls_case_idx ON osint_adsb_pulls(case_id, retrieved_at DESC);
  `);
  tablesEnsured = true;
}

async function insertFinding(row: {
  caseId: string;
  source: string;
  subject: string;
  title?: string;
  summary?: string;
  redFlag?: boolean;
  payload: unknown;
  sourceUrl?: string;
}) {
  const payloadJson = JSON.stringify(row.payload ?? {});
  const sha = sha256(`${row.source}|${row.subject}|${payloadJson}`);
  // dedupe by (case, source, subject, sha) — same finding same day = no-op
  const existing = await q<{ id: string }>(
    `SELECT id::text FROM osint_findings
      WHERE case_id=$1 AND source=$2 AND subject=$3 AND sha256=$4
        AND retrieved_at > now() - interval '24 hours' LIMIT 1`,
    [row.caseId, row.source, row.subject, sha],
  );
  if (existing[0]) return existing[0].id;
  const ins = await q<{ id: string }>(
    `INSERT INTO osint_findings
      (case_id, source, subject, title, summary, red_flag, payload, source_url, sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id::text`,
    [
      row.caseId, row.source, row.subject,
      row.title ?? null, row.summary ?? null,
      row.redFlag ?? false, payloadJson,
      row.sourceUrl ?? null, sha,
    ],
  );
  return ins[0].id;
}

// ============================================================
// SOURCE: OpenSky Network flights for aircraft (free)
// ============================================================
async function enrichOpenSky(caseId: string, hex: string) {
  const end = Math.floor(Date.now() / 1000);
  const begin = end - 60 * 60 * 24 * 30; // 30 days
  const url = `https://opensky-network.org/api/flights/aircraft?icao24=${encodeURIComponent(hex.toLowerCase())}&begin=${begin}&end=${end}`;
  const r = await safeFetchJson(url, undefined, 10_000);
  if (!r.ok || !Array.isArray(r.json)) {
    return { ok: false, error: `OpenSky ${r.status}`, flights: 0 };
  }
  const flights = r.json as Array<Record<string, unknown>>;
  const count = flights.length;
  const airports = new Set<string>();
  for (const f of flights) {
    if (typeof f.estDepartureAirport === "string") airports.add(f.estDepartureAirport);
    if (typeof f.estArrivalAirport === "string") airports.add(f.estArrivalAirport);
  }
  await insertFinding({
    caseId, source: "OPENSKY", subject: hex,
    title: `OpenSky: ${count} flights in last 30 days`,
    summary: count
      ? `${count} flights across ${airports.size} airports: ${[...airports].slice(0, 6).join(", ") || "no ICAO codes"}.`
      : `No OpenSky flights recorded for ${hex} in last 30 days.`,
    redFlag: count === 0,
    payload: { flights: flights.slice(0, 200), airports: [...airports] },
    sourceUrl: url,
  });
  return { ok: true, flights: count, airports: airports.size };
}

// ============================================================
// SOURCE: OpenCorporates search for owner name (free public search)
// ============================================================
async function enrichOpenCorporates(caseId: string, owner: string) {
  const clean = owner.replace(/,?\s+(LLC|INC|CORP|LTD|LP|LLP|CO)\.?$/i, "").trim();
  const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(clean)}&per_page=5&order=score`;
  const r = await safeFetchJson(url, undefined, 8_000);
  if (!r.ok) return { ok: false, error: `OpenCorporates ${r.status}` };
  const companies = ((r.json as Record<string, unknown>)?.results as Record<string, unknown>)?.companies as
    | Array<{ company: Record<string, unknown> }>
    | undefined;
  const list = companies?.map((c) => c.company) ?? [];
  const top = list[0];
  if (!top) {
    await insertFinding({
      caseId, source: "OPENCORPORATES", subject: owner,
      title: `OpenCorporates: no company match for "${owner}"`,
      summary: `Owner name "${owner}" does not resolve on OpenCorporates public search — possible shell, alias, or unregistered entity.`,
      redFlag: true, payload: { query: clean, results: [] }, sourceUrl: url,
    });
    return { ok: true, matches: 0 };
  }
  const inc = top.incorporation_date as string | null | undefined;
  const ageMonths = inc ? Math.floor((Date.now() - new Date(inc).getTime()) / (1000 * 60 * 60 * 24 * 30)) : null;
  const youngShell = ageMonths !== null && ageMonths < 12;
  const flags: string[] = [];
  if (youngShell) flags.push(`Company incorporated ${ageMonths} months ago — potential shell.`);
  if (top.inactive) flags.push(`Company marked INACTIVE on OpenCorporates.`);
  await insertFinding({
    caseId, source: "OPENCORPORATES", subject: owner,
    title: `OpenCorporates: ${top.name ?? owner} (${top.jurisdiction_code ?? "?"})`,
    summary: [
      `Top match: ${top.name} — jurisdiction ${top.jurisdiction_code}, incorporated ${inc ?? "unknown"}.`,
      ...flags,
    ].join(" "),
    redFlag: flags.length > 0,
    payload: { query: clean, top, all: list },
    sourceUrl: url,
  });
  return { ok: true, matches: list.length };
}

// ============================================================
// SOURCE: OpenSanctions screening
// ============================================================
async function enrichOpenSanctions(caseId: string, name: string) {
  const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(name)}&limit=5`;
  const r = await safeFetchJson(url, undefined, 8_000);
  if (!r.ok) return { ok: false, error: `OpenSanctions ${r.status}` };
  const results = ((r.json as Record<string, unknown>)?.results as Array<Record<string, unknown>>) ?? [];
  const hits = results.filter((x) => {
    const score = typeof x.score === "number" ? x.score : 0;
    return score > 0.7;
  });
  await insertFinding({
    caseId, source: "OPENSANCTIONS", subject: name,
    title: hits.length
      ? `OpenSanctions: ${hits.length} watchlist hit(s) for "${name}"`
      : `OpenSanctions: clean — no watchlist hits for "${name}"`,
    summary: hits.length
      ? hits.slice(0, 3).map((h) => `${h.caption} (${(h.datasets as string[] | undefined)?.join(", ")})`).join(" · ")
      : "Screened against PEPs, sanctions, and enforcement lists — no matches above 0.7 score.",
    redFlag: hits.length > 0,
    payload: { hits, all: results },
    sourceUrl: url,
  });
  return { ok: true, hits: hits.length };
}

// ============================================================
// SOURCE: OSM Overpass — what is under the aircraft at a low-alt point
// ============================================================
async function enrichOverpass(caseId: string, lat: number, lon: number, altFt: number, capturedAt: string) {
  const radius = 500; // meters
  const query = `[out:json][timeout:15];
(
  node(around:${radius},${lat},${lon})[amenity~"^(school|hospital|kindergarten|university|college|clinic|prison|place_of_worship)$"];
  way(around:${radius},${lat},${lon})[amenity~"^(school|hospital|kindergarten|university|college|clinic|prison)$"];
  way(around:${radius},${lat},${lon})[landuse~"^(residential|education)$"];
);
out center 20;`;
  const url = "https://overpass-api.de/api/interpreter";
  const r = await safeFetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query,
  }, 20_000);
  if (!r.ok) return { ok: false, error: `Overpass ${r.status}` };
  const elements = ((r.json as Record<string, unknown>)?.elements as Array<Record<string, unknown>>) ?? [];
  if (!elements.length) return { ok: true, matches: 0 };
  const summary = elements.slice(0, 4).map((e) => {
    const tags = (e.tags ?? {}) as Record<string, string>;
    return tags.name ?? tags.amenity ?? tags.landuse ?? "unnamed feature";
  }).join(", ");
  const subject = `${lat.toFixed(4)},${lon.toFixed(4)}@${capturedAt}`;
  await insertFinding({
    caseId, source: "OSM_OVERPASS", subject,
    title: `Ground-truth: ${altFt} ft over ${summary}`,
    summary: `${elements.length} sensitive ground feature(s) within 500m: ${summary}. Aircraft altitude ${altFt} ft — 14 CFR §91.119(b) requires 1,000 ft above populated areas.`,
    redFlag: altFt < 1000,
    payload: { lat, lon, altFt, capturedAt, elements: elements.slice(0, 20) },
    sourceUrl: url,
  });
  return { ok: true, matches: elements.length };
}

// ============================================================
// SOURCE: Wayback archive
// ============================================================
export const archiveUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; url: string; findingId?: string }) => {
    if (!d.caseId || !d.url) throw new Error("caseId and url required");
    return d;
  })
  .handler(async ({ data }) => {
    await ensureTables();
    const save = `https://web.archive.org/save/${data.url}`;
    // Wayback save returns 200/302 with location header; we treat any 2xx/3xx as success
    let waybackUrl = `https://web.archive.org/web/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}*/${data.url}`;
    try {
      const res = await fetch(save, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Watchtower-OSINT/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok || res.status === 302) {
        const loc = res.headers.get("content-location") || res.url;
        if (loc) waybackUrl = loc.startsWith("http") ? loc : `https://web.archive.org${loc}`;
      }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
    if (data.findingId) {
      await q(`UPDATE osint_findings SET wayback_url=$1 WHERE id=$2::uuid`, [waybackUrl, data.findingId]);
    } else {
      await insertFinding({
        caseId: data.caseId, source: "WAYBACK", subject: data.url,
        title: `Wayback archive of ${data.url}`,
        summary: `Immutable snapshot preserved for chain-of-custody.`,
        payload: { original: data.url, archive: waybackUrl },
        sourceUrl: data.url,
      });
      await q(`UPDATE osint_findings SET wayback_url=$1 WHERE case_id=$2 AND source='WAYBACK' AND subject=$3`,
        [waybackUrl, data.caseId, data.url]);
    }
    return { ok: true as const, waybackUrl };
  });

// ============================================================
// SOURCE: ADS-B RapidAPI deep pull (manual, uses your key)
// Default provider: adsbexchange-com1.p.rapidapi.com /v2/hex/{hex}/
// ============================================================
export const deepAdsbPull = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; hex: string }) => {
    if (!d.caseId || !d.hex) throw new Error("caseId and hex required");
    return d;
  })
  .handler(async ({ data }) => {
    await ensureTables();
    const key = process.env.RAPIDAPI_ADSB_KEY;
    if (!key) return { ok: false as const, error: "RAPIDAPI_ADSB_KEY not configured" };
    const host = "adsbexchange-com1.p.rapidapi.com";
    const endpoint = `https://${host}/v2/hex/${encodeURIComponent(data.hex.toLowerCase())}/`;
    const r = await safeFetchJson(endpoint, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host,
      },
    }, 15_000);
    const payloadJson = JSON.stringify(r.json ?? { error: r.text });
    const sha = sha256(`${endpoint}|${payloadJson}`);
    const reg = ((r.json as Record<string, unknown>)?.ac as Array<Record<string, unknown>> | undefined)?.[0]?.r as string | undefined;
    const ins = await q<{ id: string }>(
      `INSERT INTO osint_adsb_pulls (case_id, icao_hex, registration, endpoint, status_code, payload, sha256)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id::text`,
      [data.caseId, data.hex, reg ?? null, endpoint, r.status, payloadJson, sha],
    );
    await insertFinding({
      caseId: data.caseId, source: "RAPIDAPI_ADSB", subject: data.hex,
      title: `Deep ADS-B pull for ${reg ?? data.hex}`,
      summary: r.ok
        ? `RapidAPI ADS-B snapshot retrieved (status ${r.status}). Registration on-record: ${reg ?? "not returned"}.`
        : `RapidAPI ADS-B call failed with status ${r.status}. Check RAPIDAPI_ADSB_KEY.`,
      redFlag: !r.ok,
      payload: { pull_id: ins[0].id, endpoint, status: r.status, registration: reg },
      sourceUrl: endpoint,
    });
    return { ok: r.ok, status: r.status, pullId: ins[0].id, registration: reg ?? null };
  });

// ============================================================
// MAIN: enrichCase — runs all free enrichers for a case
// ============================================================
export const enrichCase = createServerFn({ method: "POST" })
  .inputValidator((d: { caseId: string; force?: boolean }) => {
    if (!d.caseId) throw new Error("caseId required");
    return d;
  })
  .handler(async ({ data }) => {
    await ensureTables();

    const caseRows = await q<{
      case_id: string;
      subject_icao: string | null;
      subject_reg: string | null;
      subject_owner: string | null;
      detection_ids: string[] | null;
    }>(
      `SELECT case_id, subject_icao, subject_reg, subject_owner, detection_ids
       FROM cases WHERE case_id=$1 OR id::text=$1 LIMIT 1`,
      [data.caseId],
    );
    const c = caseRows[0];
    if (!c) throw new Error("case not found");
    const cid = c.case_id;

    const summary = {
      opensky: 0,
      opencorporates: 0,
      opensanctions: 0,
      overpass: 0,
      red_flags: 0,
      errors: [] as string[],
    };

    // 1. Flight history via OpenSky
    if (c.subject_icao) {
      const r = await enrichOpenSky(cid, c.subject_icao);
      if (r.ok) summary.opensky = r.flights ?? 0;
      else summary.errors.push(r.error ?? "opensky failed");
    }

    // 2. Owner via OpenCorporates
    if (c.subject_owner) {
      const r = await enrichOpenCorporates(cid, c.subject_owner);
      if (r.ok) summary.opencorporates = r.matches ?? 0;
      else summary.errors.push(r.error ?? "opencorporates failed");
    }

    // 3. Sanctions screening
    if (c.subject_owner) {
      const r = await enrichOpenSanctions(cid, c.subject_owner);
      if (r.ok) summary.opensanctions = r.hits ?? 0;
      else summary.errors.push(r.error ?? "opensanctions failed");
    }

    // 4. Ground-truth Overpass for up to 5 lowest-altitude detections
    if (c.subject_icao) {
      const lows = await q<{ latitude: number; longitude: number; altitude_ft: number; captured_at: string }>(
        `SELECT latitude::float AS latitude, longitude::float AS longitude,
                altitude_ft, captured_at::text AS captured_at
         FROM detections
         WHERE icao_hex=$1 AND on_ground=false
           AND altitude_ft IS NOT NULL AND altitude_ft < 1500
           AND latitude IS NOT NULL AND longitude IS NOT NULL
         ORDER BY altitude_ft ASC LIMIT 5`,
        [c.subject_icao],
      );
      for (const d of lows) {
        const r = await enrichOverpass(cid, d.latitude, d.longitude, d.altitude_ft, d.captured_at);
        if (r.ok && (r.matches ?? 0) > 0) summary.overpass += 1;
        else if (!r.ok) summary.errors.push(r.error ?? "overpass failed");
      }
    }

    const flags = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM osint_findings WHERE case_id=$1 AND red_flag=true`,
      [cid],
    );
    summary.red_flags = flags[0]?.n ?? 0;

    return { ok: true as const, caseId: cid, ...summary };
  });

// ============================================================
// READ: getCaseOsint — list all findings for a case
// ============================================================
export type OsintFinding = {
  id: string;
  source: string;
  subject: string;
  title: string | null;
  summary: string | null;
  red_flag: boolean;
  source_url: string | null;
  wayback_url: string | null;
  sha256: string;
  retrieved_at: string;
  payload: string;

};

export const getCaseOsint = createServerFn({ method: "GET" })
  .inputValidator((d: { caseId: string }) => d)
  .handler(async ({ data }) => {
    await ensureTables();
    const rows = await q<OsintFinding>(
      `SELECT id::text, source, subject, title, summary, red_flag,
              source_url, wayback_url, sha256, retrieved_at::text AS retrieved_at,
              payload::text AS payload
       FROM osint_findings
       WHERE case_id=$1
       ORDER BY retrieved_at DESC LIMIT 200`,
      [data.caseId],
    );
    const counts = await q<{ source: string; n: number; flags: number }>(
      `SELECT source, count(*)::int AS n,
              sum(CASE WHEN red_flag THEN 1 ELSE 0 END)::int AS flags
       FROM osint_findings WHERE case_id=$1 GROUP BY source`,
      [data.caseId],
    );
    return { findings: rows, counts };
  });

// ============================================================
// FOR josiah / ai.functions.ts — corpus context slice
// ============================================================
export async function fetchOsintContextForCase(caseId: string): Promise<string> {
  try {
    await ensureTables();
    const rows = await q<{ source: string; title: string; summary: string; red_flag: boolean; source_url: string | null }>(
      `SELECT source, title, summary, red_flag, source_url
       FROM osint_findings WHERE case_id=$1
       ORDER BY red_flag DESC, retrieved_at DESC LIMIT 30`,
      [caseId],
    );
    if (!rows.length) return "";
    return rows.map((r) => `- [${r.source}${r.red_flag ? " · RED FLAG" : ""}] ${r.title}: ${r.summary}${r.source_url ? ` (source: ${r.source_url})` : ""}`).join("\n");
  } catch {
    return "";
  }
}

// ============================================================
// CRON: nightly enrichment of all active cases
// ============================================================
export async function runNightlyOsint(): Promise<{ ok: true; processed: number; errors: string[] }> {
  await ensureTables();
  const { neonQuery } = await import("./neon.server");
  const rows = await neonQuery<{ case_id: string }>(
    `SELECT case_id FROM cases
     WHERE status IN ('DRAFT','REVIEW','CONFIRMED')
     ORDER BY updated_at DESC NULLS LAST LIMIT 25`,
  );
  const errors: string[] = [];
  let processed = 0;
  for (const r of rows) {
    try {
      // call the underlying handler by re-executing the same code path
      // (we can't call the server fn wrapper from the server, so inline)
      const caseRows = await neonQuery<{
        case_id: string;
        subject_icao: string | null;
        subject_reg: string | null;
        subject_owner: string | null;
      }>(`SELECT case_id, subject_icao, subject_reg, subject_owner FROM cases WHERE case_id=$1 LIMIT 1`, [r.case_id]);
      const c = caseRows[0];
      if (!c) continue;
      if (c.subject_icao) await enrichOpenSky(c.case_id, c.subject_icao);
      if (c.subject_owner) {
        await enrichOpenCorporates(c.case_id, c.subject_owner);
        await enrichOpenSanctions(c.case_id, c.subject_owner);
      }
      processed++;
    } catch (e) {
      errors.push(`${r.case_id}: ${(e as Error).message}`);
    }
  }
  return { ok: true, processed, errors };
}
