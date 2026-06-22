import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Hash, ShieldCheck } from "lucide-react";
import { getCaseById } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({ meta: [{ title: "Case // Watchtower" }] }),
  component: CaseDetail,
});

function CaseDetail() {
  const { caseId } = Route.useParams();
  const q = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => getCaseById({ data: { id: caseId } }),
  });

  if (q.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="p-6 text-destructive">Case not found.</div>;
  const c = q.data;

  const bh = [
    ["Strength", c.bh_strength],
    ["Consistency", c.bh_consistency],
    ["Specificity", c.bh_specificity],
    ["Temporality", c.bh_temporality],
    ["Corroboration", c.bh_corroboration],
  ] as const;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <Link to="/cases" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2">
        <ArrowLeft className="size-3" /> Back to cases
      </Link>

      <header className="panel p-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {c.case_id} · {c.case_type} · {c.severity}
        </div>
        <h1 className="mt-1 text-2xl neon-text-orange">
          {c.subject_reg || c.subject_icao || c.subject_owner || "Unidentified subject"}
        </h1>
        {c.subject_owner && (
          <div className="text-sm text-muted-foreground mt-1">{c.subject_owner}</div>
        )}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <Field k="Status" v={c.status} tone="green" />
          <Field k="WTI Tier" v={c.wti_tier ?? "—"} tone="orange" />
          <Field k="WTI Score" v={c.wti_score ?? "—"} />
          <Field k="Bradford-Hill" v={c.bradford_hill_score ?? "—"} />
          <Field k="County" v={c.primary_county ?? "—"} />
        </div>
      </header>

      {c.auto_summary && (
        <section className="panel scanline p-5">
          <div className="text-xs uppercase tracking-widest neon-text-green mb-2 flex items-center gap-2">
            <FileText className="size-4" /> ML Auto-Summary
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.auto_summary}</p>
        </section>
      )}

      {c.public_summary && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-widest neon-text-orange mb-2">Public Summary</div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.public_summary}</p>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="panel p-5">
          <div className="text-xs uppercase tracking-widest neon-text-green mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4" /> Bradford-Hill Criteria
          </div>
          <ul className="text-sm space-y-1">
            {bh.map(([label, met]) => (
              <li key={label} className="flex justify-between border-b border-border/40 py-1">
                <span className="text-muted-foreground">{label}</span>
                <span className={met ? "neon-text-green" : "text-muted-foreground"}>
                  {met ? "✔ Met" : "○ Not met"}
                </span>
              </li>
            ))}
            <li className="flex justify-between border-b border-border/40 py-1">
              <span className="text-muted-foreground">Evidence Sufficient</span>
              <span className={c.evidence_sufficient ? "neon-text-green" : "text-destructive"}>
                {c.evidence_sufficient ? "✔ Yes" : "✘ No"}
              </span>
            </li>
          </ul>
        </div>

        <div className="panel p-5">
          <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
            <Hash className="size-4" /> Evidence Chain
          </div>
          <dl className="text-xs space-y-2">
            <Row k="Merkle Block" v={c.merkle_block ?? "—"} />
            <Row k="SHA-256" v={c.sha256_hash ? c.sha256_hash.slice(0, 24) + "…" : "—"} mono />
            <Row k="Detections" v={c.detection_ids?.length ?? 0} />
            <Row k="Anomalies" v={c.anomaly_ids?.length ?? 0} />
            <Row k="Violations" v={c.violation_ids?.length ?? 0} />
            <Row k="Convergences" v={c.convergence_ids?.length ?? 0} />
            <Row k="Total Events" v={c.total_events ?? 0} />
          </dl>
        </div>
      </section>

      <section className="panel p-5 text-xs space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Reviewer</div>
        <Row k="Reviewed by" v={c.reviewed_by ?? "—"} />
        <Row k="Notes" v={c.reviewer_notes ?? "—"} />
        {c.dismissed_reason && <Row k="Dismissed reason" v={c.dismissed_reason} />}
      </section>
    </div>
  );
}

function Field({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "green" | "orange" }) {
  const cls = tone === "orange" ? "neon-text-orange" : tone === "green" ? "neon-text-green" : "";
  return (
    <div className="panel p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className={`mt-1 font-bold ${cls}`}>{v}</div>
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">{k}</span>
      <span className={mono ? "font-mono" : ""}>{v}</span>
    </div>
  );
}
