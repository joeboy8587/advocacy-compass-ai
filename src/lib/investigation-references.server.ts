import { neonQuery, neonUserError } from "./reference-neon.server";
import { normalizeRegistration, sameEntity } from "./reference-matching";

type Company = { id: number; entity_name: string; agency: string | null; source: string | null; aircraft_types: string[] | null };
type Monitoring = { id: number; aircraft_registration: string; observed_at: string; altitude: string | null; violation_type: string; sha256_hash: string | null; county: string | null };
type Allegation = { id: string; provision: string | null; description: string | null; violation_date: string | null; sha256_hash: string | null; decree_id: string | null };
export type ReferenceInput = { caseId?: string; icao?: string; registrations?: string[]; owner?: string; catalog?: boolean };

export async function readInvestigationReferences(input: ReferenceInput) {
  let registrations = input.registrations ?? [];
  let icao = input.icao;
  if (input.caseId) {
    const { rows } = await neonQuery<{ subject_reg: string | null; subject_icao: string | null; related_tails: string[] | null }>(
      "SELECT subject_reg, subject_icao, related_tails FROM public.cases WHERE case_id = $1 OR id::text = $1 LIMIT 1", [input.caseId]);
    const c = rows[0];
    if (!c) throw new Error("Case not found.");
    registrations = [...registrations, ...(c.related_tails ?? []), ...(c.subject_reg ? [c.subject_reg] : [])];
    icao = c.subject_icao ?? icao;
  }
  const tails = [...new Set(registrations.map(normalizeRegistration).filter(v => /^[A-Z0-9]+$/.test(v)))].slice(0, 40);
  const [companies, registry] = await Promise.all([
    neonQuery<Company>("SELECT id, entity_name, agency, source, aircraft_types FROM public.federal_covert_entities ORDER BY entity_name LIMIT 100"),
    tails.length || icao ? neonQuery<{ name: string | null; n_number: string }>(
      "SELECT name, n_number FROM public.faa_master WHERE upper(regexp_replace(n_number, '^[Nn]', '')) = ANY($1::text[]) OR lower(mode_s_code_hex) = lower($2) LIMIT 40", [tails, icao ?? ""]) : Promise.resolve({ rows: [] }),
  ]);
  const resolvedTails = [...new Set([...tails, ...registry.rows.map(r => normalizeRegistration(r.n_number))])];
  const owners = registry.rows.map(r => r.name).filter((v): v is string => Boolean(v));
  // Supplied owner is a catalog search only; aircraft attribution uses FAA records.
  const companyMatches = companies.rows.filter(c => owners.some(o => sameEntity(o, c.entity_name)));
  const catalog = input.catalog ? companies.rows.filter(c => !input.owner || c.entity_name.toLowerCase().includes(input.owner.toLowerCase())) : [];
  const [monitoring, totals, allegations] = resolvedTails.length ? await Promise.all([
    neonQuery<Monitoring>("SELECT id, aircraft_registration, to_json(detection_timestamp) AS observed_at, altitude, violation_type, sha256_hash, county FROM public.sentinel_violations WHERE upper(regexp_replace(aircraft_registration, '^[Nn]', '')) = ANY($1::text[]) ORDER BY detection_timestamp DESC, id DESC LIMIT 25", [resolvedTails]),
    neonQuery<{ total: string; first_seen: string | null; last_seen: string | null }>("SELECT count(*) AS total, to_json(min(detection_timestamp)) AS first_seen, to_json(max(detection_timestamp)) AS last_seen FROM public.sentinel_violations WHERE upper(regexp_replace(aircraft_registration, '^[Nn]', '')) = ANY($1::text[]) LIMIT 1", [resolvedTails]),
    neonQuery<Allegation>("SELECT id, COALESCE(provision_violated, violation_code) AS provision, COALESCE(violation_description, description) AS description, violation_date, sha256_hash, decree_id FROM public.consent_decree_violations WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS t(tail) WHERE upper(COALESCE(violation_description, description, '')) ~ ('(^|[^A-Z0-9])N?' || tail || '([^A-Z0-9]|$)')) ORDER BY created_at DESC, id DESC LIMIT 25", [resolvedTails]),
  ]) : [{ rows: [] }, { rows: [] }, { rows: [] }];
  return { companyMatches, catalog, monitoring: monitoring.rows, monitoringTotal: Number(totals.rows[0]?.total ?? 0), firstSeen: totals.rows[0]?.first_seen ?? null, lastSeen: totals.rows[0]?.last_seen ?? null, allegations: allegations.rows, registrations: resolvedTails.map(t => `N${t}`), guidance: "Reference records only. Exact FAA title-owner matches identify historical company references, not current missions. Sentinel entries are monitoring observations, not adjudicated violations. Consent-decree entries are stored allegations matched by aircraft mention; no verified decree join exists. Altitude datum/ground elevation and helicopter exceptions must be checked before any legal conclusion. Do not infer intent or agency affiliation from ownership, aircraft type, or missing identity. Do not merge these counts into violation totals or investigator memory." };
}

export async function referenceContext(input: ReferenceInput): Promise<string> {
  try { return `## Attributed investigation references (not confirmed findings)\n${JSON.stringify(await readInvestigationReferences(input))}`; }
  catch (error) { console.error("Investigation references", error); return `## Investigation references unavailable\n${neonUserError(error).message} Do not interpret this as no matching records.`; }
}