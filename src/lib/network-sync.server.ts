import { neonQuery } from "./neon.server";

// Continuous auto-discovery for the Network Graph. Finds aircraft whose FAA
// title owner exactly matches a shell-company node (or a federal covert-entity
// reference) and that our radar saw recently, then adds them as UNREVIEWED.
const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type SyncResult = { scannedAt: string; newAircraft: number; newCompanies: number; added: { aircraft: string; company: string }[] };

export async function syncShellNetwork(days = 7): Promise<SyncResult> {
  const scannedAt = new Date().toISOString();
  const [companies, covert] = await Promise.all([
    neonQuery<{ node_id: string; display_name: string }>(`SELECT node_id, display_name FROM shell_network_nodes WHERE node_type = 'COMPANY'`),
    neonQuery<{ entity_name: string; agency: string | null }>(`SELECT entity_name, agency FROM federal_covert_entities LIMIT 500`).catch(() => []),
  ]);
  const byKey = new Map<string, { node: string; label: string; existing: boolean; agency?: string | null }>();
  for (const c of covert) byKey.set(key(c.entity_name), { node: key(c.entity_name).slice(0, 60), label: c.entity_name, existing: false, agency: c.agency });
  for (const c of companies) byKey.set(key(c.display_name), { node: c.node_id, label: c.display_name, existing: true });
  const keys = [...byKey.keys()].filter(Boolean);
  if (!keys.length) return { scannedAt, newAircraft: 0, newCompanies: 0, added: [] };

  const regs = await neonQuery<{ n_number: string; hex: string | null; name: string; serial_number: string | null; year_mfr: string | null; street: string | null; city: string | null; state: string | null; last_action_date: string | null }>(
    `SELECT n_number, upper(trim(mode_s_code_hex)) AS hex, name, serial_number, year_mfr::text, street, city, state, last_action_date::text
       FROM faa_master WHERE regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ANY($1::text[]) LIMIT 3000`, [keys]);
  const existing = new Set((await neonQuery<{ node_id: string }>(`SELECT node_id FROM shell_network_nodes WHERE node_type = 'AIRCRAFT'`)).map(r => r.node_id.toUpperCase()));
  const cand = regs.filter(r => r.hex && !existing.has(`N${r.n_number.toUpperCase().replace(/^N/, "")}`));
  if (!cand.length) return { scannedAt, newAircraft: 0, newCompanies: 0, added: [] };

  const seen = await neonQuery<{ hex: string; n: string; last_seen: string }>(
    `SELECT upper(icao_hex) AS hex, count(*)::text AS n, to_json(max(captured_at))::text AS last_seen FROM detections
      WHERE upper(icao_hex) = ANY($1::text[]) AND captured_at > now() - ($2 || ' days')::interval GROUP BY 1`,
    [cand.map(c => c.hex), String(days)]);
  const seenMap = new Map(seen.map(s => [s.hex, s]));
  const hits = cand.filter(c => seenMap.has(c.hex!)).slice(0, 100);
  if (!hits.length) return { scannedAt, newAircraft: 0, newCompanies: 0, added: [] };

  const added: SyncResult["added"] = [];
  const newCos = new Set<string>();
  for (const h of hits) {
    const co = byKey.get(key(h.name))!;
    const tail = `N${h.n_number.toUpperCase().replace(/^N/, "")}`;
    const s = seenMap.get(h.hex!)!;
    const auto = { added_by: "auto-sync", review_status: "UNREVIEWED", source: "faa_master_auto", synced_at: scannedAt };
    if (!co.existing && !newCos.has(co.node)) {
      newCos.add(co.node);
      await neonQuery(`INSERT INTO shell_network_nodes (node_id, node_type, display_name, metadata, created_at) VALUES ($1,'COMPANY',$2,$3::jsonb,now()) ON CONFLICT (node_id) DO NOTHING`,
        [co.node, co.label, JSON.stringify({ ...auto, source: "federal_covert_entities", agency: co.agency ?? null, note: "Historical reference match; not a confirmed current mission" })]);
    }
    await neonQuery(`INSERT INTO shell_network_nodes (node_id, node_type, display_name, metadata, created_at) VALUES ($1,'AIRCRAFT',$1,$2::jsonb,now()) ON CONFLICT (node_id) DO NOTHING`,
      [tail, JSON.stringify({ ...auto, icao_hex: h.hex, registrant: h.name, serial: h.serial_number, year: h.year_mfr, registrant_address: [h.street, h.city, h.state].filter(Boolean).join(", "), detections_window: s.n, last_seen: JSON.parse(s.last_seen) })]);
    await neonQuery(`INSERT INTO shell_network_edges (source_node, target_node, edge_type, weight, metadata, created_at) VALUES ($1,$2,'OWNER_OF',1.0,$3::jsonb,now()) ON CONFLICT DO NOTHING`,
      [co.node, tail, JSON.stringify({ ...auto, last_action_date: h.last_action_date })]);
    added.push({ aircraft: tail, company: co.label });
  }
  return { scannedAt, newAircraft: added.length, newCompanies: newCos.size, added };
}
