import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Library, Loader2 } from "lucide-react";
import { getInvestigationReferences } from "@/lib/investigation-references.functions";
import { LoadErrorPanel } from "./LoadErrorPanel";

export function InvestigationReferences({ caseId, catalog = false, owner }: { caseId?: string; catalog?: boolean; owner?: string }) {
  const read = useServerFn(getInvestigationReferences);
  const q = useQuery({ queryKey: ["investigation-references", caseId, catalog, owner], queryFn: () => read({ data: { caseId, catalog, owner } }), staleTime: 300_000, retry: false });
  if (q.isPending) return <div className="p-4 text-xs text-muted-foreground flex gap-2"><Loader2 className="size-4 animate-spin" /> Reading investigation references…</div>;
  if (q.error) return <LoadErrorPanel title="Reference records unavailable" error={q.error} reset={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  const companies = catalog ? d.catalog : d.companyMatches;
  return <section className="py-4 space-y-3 border-y border-border">
    <h2 className="text-sm text-accent flex gap-2 items-center"><Library className="size-4" /> {catalog ? "FBI & agency company references" : "Consent-decree & company references"}</h2>
    <p className="text-xs text-muted-foreground">Historical references and records awaiting verification · not confirmed violations</p>
    {companies.length === 0 ? <p className="text-xs text-muted-foreground">{catalog ? "No company references match this search." : "No exact FAA title-owner match in the company reference list. This does not clear the aircraft."}</p> : <div className="grid md:grid-cols-2 gap-2">{companies.map(c => <article key={c.id} className="border border-border rounded-sm p-3 text-xs space-y-1"><h3 className="font-medium">{c.entity_name}</h3><p>{c.agency ?? "Agency not recorded"} · {c.source ?? "Source not recorded"}</p><p className="text-muted-foreground">{catalog ? "Historical company reference" : "Match: exact FAA title-owner name"} · no current mission attribution</p></article>)}</div>}
    {!catalog && <>
      <div className="text-xs">Aircraft checked: {d.registrations.join(" · ") || "No registration resolved"}</div>
      <h3 className="text-sm">{d.monitoringTotal.toLocaleString()} monitoring records · {d.allegations.length} aircraft-linked allegations</h3>
      {d.firstSeen && <p className="text-xs text-muted-foreground">Recorded window: {d.firstSeen.slice(0, 10)} → {d.lastSeen?.slice(0, 10)} · latest 25 shown</p>}
      <p className="text-xs text-muted-foreground">Source: sentinel_violations. Observations do not independently prove a decree breach. Heights have no verified ground datum here.</p>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="text-muted-foreground"><tr><th className="text-left p-2">Aircraft</th><th className="text-left p-2">Observed</th><th className="text-left p-2">Reported altitude</th><th className="text-left p-2">Fingerprint</th></tr></thead><tbody>{d.monitoring.map(r => <tr key={r.id} className="border-t border-border"><td className="p-2">{r.aircraft_registration}</td><td className="p-2 whitespace-nowrap">{new Date(r.observed_at).toLocaleString()}</td><td className="p-2">{r.altitude == null ? "Unknown" : `${r.altitude} ft · datum unverified`}</td><td className="p-2"><details><summary className="cursor-pointer text-accent">SHA-256</summary><code className="break-all">{r.sha256_hash ?? "Not recorded"}</code></details></td></tr>)}</tbody></table></div>
      {d.allegations.map(a => <article key={a.id} className="border border-border rounded-sm p-3 space-y-1 text-xs"><h4>{a.provision?.replace(/_/g, " ") ?? "Provision not recorded"} · {a.violation_date ?? "Date unknown"}</h4><p className="text-muted-foreground">Stored allegation · matched by aircraft mention, not a verified decree link</p><details><summary className="cursor-pointer text-accent">Original record & fingerprint</summary><p className="whitespace-pre-wrap mt-2">{a.description}</p><code className="break-all">{a.sha256_hash ?? "Fingerprint not recorded"}</code></details></article>)}
    </>}
  </section>;
}