import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql) => { try { const r = await pool.query(sql); return r.rows; } catch (e) { return [{ error: e.message }]; } };

const out = {};
out.vc_by_capture = await q(`SELECT date_trunc('day', captured_at) d, count(*)::int n FROM violation_classifications GROUP BY 1 ORDER BY d DESC LIMIT 15`);
out.vc_total = await q(`SELECT count(*)::int n, min(captured_at) min_c, max(captured_at) max_c FROM violation_classifications`);
out.vc_7d = await q(`SELECT count(*)::int FROM violation_classifications WHERE captured_at > now() - interval '7 days'`);
out.vc_30d = await q(`SELECT count(*)::int FROM violation_classifications WHERE captured_at > now() - interval '30 days'`);
out.incursion_7d = await q(`SELECT count(*)::int FROM incursion_events WHERE event_timestamp > now() - interval '7 days'`);
out.incursion_30d = await q(`SELECT count(*)::int FROM incursion_events WHERE event_timestamp > now() - interval '30 days'`);
out.incursion_max = await q(`SELECT max(event_timestamp), min(event_timestamp), count(*)::int FROM incursion_events`);
out.anomaly_max = await q(`SELECT date_trunc('day', detected_at) d, count(*)::int FROM ml_anomaly_detections GROUP BY 1 ORDER BY d DESC LIMIT 10`);
out.anomaly_events_max = await q(`SELECT max(detected_at), count(*)::int FROM anomaly_events`);
console.log(JSON.stringify(out, null, 2));
await pool.end();
