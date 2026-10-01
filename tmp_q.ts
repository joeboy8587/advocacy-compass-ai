import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.NEON_DATABASE_URL!);
const r = (s:string)=>sql.query(s);
console.log(await r(`SELECT behavioral_cluster c, count(*)::int n, count(profile_score)::int scored, round(avg(profile_score)::numeric,1) avg, count(*) FILTER (WHERE profile_score>=100)::int at100, max(updated_at)::text upd, max(model_version) mv FROM aircraft_deep_profiles GROUP BY 1 ORDER BY 2 DESC LIMIT 20`));
console.log(await r(`SELECT width_bucket(profile_score,0,100.0001,10) b, count(*)::int FROM aircraft_deep_profiles GROUP BY 1 ORDER BY 1`));
console.log(await r(`SELECT date_trunc('day',updated_at)::date d, model_version, count(*)::int, round(avg(profile_score)::numeric,1) a, count(*) FILTER (WHERE profile_score>=100)::int at100, count(behavioral_cluster)::int clustered FROM aircraft_deep_profiles GROUP BY 1,2 ORDER BY 1 DESC LIMIT 12`));
