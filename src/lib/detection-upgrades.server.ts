// Research-derived detectors over the live `detections` feed.
// Methods:
//  - Orbit detector: BuzzFeed/FBI surveillance-aircraft study (turn rate "steer" is the
//    top feature, then bounding-box area, then speed/altitude).
//  - Impossible movement: Kujur/Khanafseh/Pervan (IIT, ICG 2022) — position must agree
//    with reported velocity; Kenaudekar et al. (LiU) — kinematic consistency over time.
//  - Identity swap: FBI research note on alternate ICAO addresses + signal-quality (NIC/NACv) drops.
import { neonQuery } from "./neon.server";

export const METHOD_SOURCES = {
  orbit: "Method: FBI surveillance-aircraft research (BuzzFeed News random-forest study — turn rate and small circling area are the strongest signs).",
  kinematic: "Method: Kujur, Khanafseh & Pervan, Illinois Tech (UN ICG 2022) and Kenaudekar et al., Linköping University — a real position must agree with the aircraft's own reported speed and direction.",
  idswap: "Method: FBI surveillance-aircraft research on temporary/alternate ICAO codes used to hide registrations.",
} as const;

export type OrbitRow = {
  icao_hex: string; registration: string | null; day: string; pings: number;
  minutes: number; orbits: number; steer_per_min: number; area_km2: number;
  alt_ft: number | null; speed_kts: number | null; lat: number; lon: number;
  county: string | null; last_seen: string; score: number;
};
export type KinRow = { icao_hex: string; registration: string | null; jumps: number; worst_km: number; heading_mismatch: number; last_seen: string };
export type SwapRow = { old_hex: string; new_hex: string; old_reg: string | null; new_reg: string | null; gap_s: number; km: number; at: string };

const ORBIT_SQL = (filter: string) => `
WITH anchor AS (SELECT max(captured_at) AS t FROM detections),
p AS (
  SELECT lower(d.icao_hex) icao_hex, d.registration, d.captured_at, d.latitude, d.longitude,
         d.altitude_ft, d.speed_kts, d.heading, d.county,
         lag(d.heading) OVER w AS ph, lag(d.captured_at) OVER w AS pt
    FROM detections d, anchor
   WHERE d.captured_at > anchor.t - ($2::int * interval '1 hour')
     AND coalesce(d.on_ground,false) = false AND d.heading IS NOT NULL AND d.latitude IS NOT NULL
     AND ${filter}
  WINDOW w AS (PARTITION BY lower(d.icao_hex) ORDER BY d.captured_at)
), s AS (
  SELECT *, CASE WHEN ph IS NULL OR extract(epoch FROM captured_at-pt) > 300 THEN NULL
                 ELSE ((heading - ph + 540)::numeric % 360) - 180 END AS steer
    FROM p
), g AS (
  SELECT icao_hex, max(registration) registration, (captured_at AT TIME ZONE 'America/Los_Angeles')::date::text AS day,
         count(*)::int pings,
         extract(epoch FROM max(captured_at)-min(captured_at))/60.0 AS minutes,
         abs(coalesce(sum(steer),0))/360.0 AS orbits,
         coalesce(sum(abs(steer)),0) AS turn,
         (max(latitude)-min(latitude))*111.0 * (max(longitude)-min(longitude))*111.0*cos(radians(avg(latitude))) AS area_km2,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY altitude_ft) alt_ft,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY speed_kts) speed_kts,
         avg(latitude) lat, avg(longitude) lon, mode() WITHIN GROUP (ORDER BY county) county,
         max(captured_at)::text last_seen
    FROM s GROUP BY 1,3 HAVING count(*) >= 30
)
SELECT icao_hex, registration, day, pings, round(minutes::numeric,0)::float minutes,
       round(orbits::numeric,1)::float orbits,
       round((turn/greatest(minutes,1))::numeric,1)::float steer_per_min,
       round(area_km2::numeric,2)::float area_km2, alt_ft::float, speed_kts::float,
       lat::float, lon::float, county, last_seen,
       round((least(turn/greatest(minutes,1)/30.0,1)*0.45
            + (CASE WHEN area_km2 < 25 THEN 1 WHEN area_km2 < 100 THEN 0.5 ELSE 0 END)*0.3
            + (CASE WHEN speed_kts BETWEEN 60 AND 160 THEN 1 ELSE 0.3 END)*0.1
            + (CASE WHEN alt_ft BETWEEN 500 AND 6000 THEN 1 ELSE 0.3 END)*0.1
            + least(orbits/5.0,1)*0.05)::numeric, 2)::float AS score
  FROM g
 WHERE orbits >= 2 AND minutes >= 10
 ORDER BY score DESC, orbits DESC
 LIMIT $3`;

export async function orbitsFor(icaos: string[], hours = 24 * 7, limit = 10) {
  return neonQuery<OrbitRow>(ORBIT_SQL(`lower(d.icao_hex) = ANY($1::text[])`), [icaos, hours, limit], { timeoutMs: 18_000 }).catch(() => []);
}
export async function orbitsKern(hours = 24, limit = 25) {
  return neonQuery<OrbitRow>(ORBIT_SQL(`d.county = $1`), ["KERN", hours, limit], { timeoutMs: 18_000 });
}

export async function kinematicsFor(icaos: string[], hours = 24 * 7) {
  return neonQuery<KinRow>(`
WITH anchor AS (SELECT max(captured_at) t FROM detections),
p AS (
  SELECT lower(icao_hex) icao_hex, registration, captured_at, latitude, longitude, speed_kts, heading,
         lag(latitude) OVER w plat, lag(longitude) OVER w plon, lag(captured_at) OVER w pt
    FROM detections, anchor
   WHERE lower(icao_hex) = ANY($1::text[]) AND captured_at > anchor.t - ($2::int * interval '1 hour')
     AND latitude IS NOT NULL AND coalesce(on_ground,false) = false
  WINDOW w AS (PARTITION BY lower(icao_hex) ORDER BY captured_at)
), k AS (
  SELECT *, extract(epoch FROM captured_at-pt) dt,
         2*6371*asin(sqrt(power(sin(radians(latitude-plat)/2),2)+cos(radians(plat))*cos(radians(latitude))*power(sin(radians(longitude-plon)/2),2))) km,
         degrees(atan2(sin(radians(longitude-plon))*cos(radians(latitude)),
           cos(radians(plat))*sin(radians(latitude))-sin(radians(plat))*cos(radians(latitude))*cos(radians(longitude-plon)))) brg
    FROM p WHERE pt IS NOT NULL
)
SELECT icao_hex, max(registration) registration,
       count(*) FILTER (WHERE dt BETWEEN 1 AND 120 AND km > (coalesce(speed_kts,0)*1.852*dt/3600.0)*1.5 + 0.5)::int jumps,
       round(coalesce(max(km) FILTER (WHERE dt BETWEEN 1 AND 120),0)::numeric,2)::float worst_km,
       count(*) FILTER (WHERE dt BETWEEN 1 AND 60 AND speed_kts > 60 AND km > 0.2
            AND abs(((heading - brg + 540)::numeric % 360) - 180) > 60)::int heading_mismatch,
       max(captured_at)::text last_seen
  FROM k GROUP BY 1`, [icaos, hours], { timeoutMs: 18_000 }).catch(() => []);
}

export async function idSwapsFor(icaos: string[], hours = 24 * 7) {
  return neonQuery<SwapRow>(`
WITH anchor AS (SELECT max(captured_at) t FROM detections),
spans AS (
  SELECT lower(icao_hex) hex, max(registration) reg, min(captured_at) first_t, max(captured_at) last_t,
         (array_agg(latitude ORDER BY captured_at))[1] f_lat, (array_agg(longitude ORDER BY captured_at))[1] f_lon,
         (array_agg(latitude ORDER BY captured_at DESC))[1] l_lat, (array_agg(longitude ORDER BY captured_at DESC))[1] l_lon
    FROM detections, anchor
   WHERE captured_at > anchor.t - ($2::int * interval '1 hour') AND county = 'KERN'
     AND latitude IS NOT NULL AND coalesce(on_ground,false) = false
   GROUP BY 1
)
SELECT a.hex old_hex, b.hex new_hex, a.reg old_reg, b.reg new_reg,
       extract(epoch FROM b.first_t - a.last_t)::int gap_s,
       round((111.0*sqrt(power(b.f_lat-a.l_lat,2)+power((b.f_lon-a.l_lon)*cos(radians(a.l_lat)),2)))::numeric,2)::float km,
       b.first_t::text at
  FROM spans a JOIN spans b ON a.hex <> b.hex
   AND b.first_t BETWEEN a.last_t AND a.last_t + interval '120 seconds'
   AND abs(b.f_lat-a.l_lat) < 0.03 AND abs(b.f_lon-a.l_lon) < 0.035
 WHERE a.hex = ANY($1::text[]) OR b.hex = ANY($1::text[])
 LIMIT 10`, [icaos, hours], { timeoutMs: 18_000 }).catch(() => []);
}

export function orbitStrength(score: number, orbits: number): "STRONG" | "MODERATE" | "WEAK" {
  if (score >= 0.7 && orbits >= 4) return "STRONG";
  if (score >= 0.5) return "MODERATE";
  return "WEAK";
}

export function describeOrbit(o: OrbitRow): string {
  const where = o.county ? `${o.county[0]}${o.county.slice(1).toLowerCase()} County` : "one spot";
  const alt = o.alt_ft != null ? `${Math.round(o.alt_ft).toLocaleString()} ft` : "unknown height";
  const spd = o.speed_kts != null ? `${Math.round(o.speed_kts)} kts` : "unknown speed";
  return `On ${o.day} it circled about ${o.orbits} times over a ${o.area_km2} km² area in ${where} for ${o.minutes} minutes, at around ${alt} and ${spd}, turning ${o.steer_per_min}°/minute on average.`;
}

// Signal-layer check (Kenaudekar et al., LiU — third pillar). We have no raw I/Q,
// but FIRST_PARTY_RTL_SDR rows are our own antenna: an independent witness to
// compare against third-party feed positions, plus PHY ghost-injection flags.
export type SignalRow = {
  icao_hex: string; sdr_pings: number; feed_pings: number; pairs: number;
  disagree: number; worst_km: number; ghost_flags: number; last_seen: string | null;
};
export const SIGNAL_SOURCE =
  "Method: Kenaudekar et al., Linköping University — signal-level plausibility, checked against Watchtower's own RTL-SDR receiver as an independent witness.";

export async function signalFor(icaos: string[], hours = 24 * 30) {
  return neonQuery<SignalRow>(`
WITH anchor AS (SELECT max(captured_at) t FROM detections),
d AS (
  SELECT lower(icao_hex) hex, captured_at, latitude, longitude, source_type = 'FIRST_PARTY_RTL_SDR' sdr, source_type
    FROM detections, anchor
   WHERE lower(icao_hex) = ANY($1::text[]) AND captured_at > anchor.t - ($2::int * interval '1 hour')
     AND latitude IS NOT NULL
), sb AS (
  SELECT hex, floor(extract(epoch FROM captured_at)/5)::bigint b, avg(latitude) la, avg(longitude) lo FROM d WHERE sdr GROUP BY 1,2
), fb AS (
  SELECT hex, floor(extract(epoch FROM captured_at)/5)::bigint b, avg(latitude) la, avg(longitude) lo
    FROM d WHERE source_type = 'adsb_icao' AND hex IN (SELECT DISTINCT hex FROM sb) GROUP BY 1,2
), pr AS (
  SELECT sb.hex, 111.0*sqrt(power(sb.la-fb.la,2)+power((sb.lo-fb.lo)*cos(radians(sb.la)),2)) km
    FROM sb JOIN fb ON fb.hex=sb.hex AND fb.b=sb.b
), g AS (
  SELECT hex, count(*) FILTER (WHERE sdr)::int sdr_pings, count(*) FILTER (WHERE NOT sdr)::int feed_pings,
         max(captured_at)::text last_seen FROM d GROUP BY 1
), ph AS (
  SELECT lower(ltrim(raw_hex,'~')) hex, count(*) FILTER (WHERE is_ghost_injection)::int ghost_flags
    FROM soda_phy_fingerprints WHERE lower(ltrim(raw_hex,'~')) = ANY($1::text[]) GROUP BY 1
)
SELECT h.hex icao_hex, coalesce(g.sdr_pings,0) sdr_pings, coalesce(g.feed_pings,0) feed_pings,
       (SELECT count(*)::int FROM pr WHERE pr.hex=h.hex) pairs,
       (SELECT count(*)::int FROM pr WHERE pr.hex=h.hex AND km > 5) disagree,
       (SELECT round(coalesce(max(km),0)::numeric,2)::float FROM pr WHERE pr.hex=h.hex) worst_km,
       coalesce(ph.ghost_flags,0) ghost_flags, g.last_seen
  FROM unnest($1::text[]) h(hex) LEFT JOIN g ON g.hex=h.hex LEFT JOIN ph ON ph.hex=h.hex`,
    [icaos, hours], { timeoutMs: 18_000 }).catch(() => []);
}
