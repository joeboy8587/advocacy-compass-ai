import pg from 'pg';
const c = new pg.Client({connectionString:'postgresql://neondb_owner:npg_uKLe0gZpSdn4@ep-quiet-math-akgndx5n-pooler.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require'});
await c.connect();
const tables = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map(r=>r.table_name);
const out = {};
for (const t of tables) {
  try {
    const cols = (await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[t])).rows;
    const cnt = await c.query(`SELECT count(*)::int AS n FROM public."${t}"`);
    // find a timestamp col
    const tsCol = cols.find(x=>['timestamp with time zone','timestamp without time zone','date'].includes(x.data_type) && /at$|_time$|timestamp|_on$|seen|date/i.test(x.column_name));
    let latest = null;
    if (tsCol) {
      try {
        const r = await c.query(`SELECT max("${tsCol.column_name}")::text AS m FROM public."${t}"`);
        latest = r.rows[0].m;
      } catch {}
    }
    out[t] = { rows: cnt.rows[0].n, cols: cols.map(x=>`${x.column_name}:${x.data_type}`), latest };
  } catch(e) { out[t] = { error: e.message }; }
}
console.log(JSON.stringify(out,null,2));
await c.end();
