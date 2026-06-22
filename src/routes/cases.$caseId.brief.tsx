import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { getCaseById, getCaseEvidence } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/cases/$caseId/brief")({
  head: () => ({ meta: [{ title: "Legal Brief // Watchtower" }] }),
  component: BriefView,
});

function BriefView() {
  const { caseId } = Route.useParams();
  const caseQ = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => getCaseById({ data: { id: caseId } }),
  });
  const evQ = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: () => getCaseEvidence({ data: { id: caseId } }),
  });

  useEffect(() => {
    // inject print stylesheet to hide app shell
    const style = document.createElement("style");
    style.id = "brief-print-css";
    style.innerHTML = `
      @media print {
        aside, header.h-12, .print\\:hidden { display: none !important; }
        body, html, main, .min-h-screen { background: white !important; color: black !important; }
        .panel, .brief-card { background: white !important; border-color: #999 !important; box-shadow: none !important; }
        .neon-text-orange { color: #b45309 !important; text-shadow: none !important; }
        .neon-text-green { color: #047857 !important; text-shadow: none !important; }
        .text-muted-foreground { color: #555 !important; }
        .text-accent, .text-destructive { color: black !important; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("brief-print-css")?.remove();
    };
  }, []);

  if (caseQ.isLoading) return <div className="p-6">Loading brief…</div>;
  if (!caseQ.data) return <div className="p-6 text-destructive">Case not found.</div>;
  const c = caseQ.data;

  const bh = [
    ["Strength of association", c.bh_strength],
    ["Consistency across observations", c.bh_consistency],
    ["Specificity", c.bh_specificity],
    ["Temporality", c.bh_temporality],
    ["Independent corroboration", c.bh_corroboration],
  ] as const;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 brief-card">
      <div className="flex items-center justify-between print:hidden">
        <Link
          to="/cases/$caseId"
          params={{ caseId }}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2"
        >
          <ArrowLeft className="size-3" /> Back to case
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm"
        >
          <Printer className="size-3" /> Print / Save PDF
        </button>
      </div>

      <header className="border-b-2 border-border pb-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Watchtower Project · Evidence Brief · advocacywatch.live
        </div>
        <h1 className="mt-2 text-3xl font-bold neon-text-orange">
          Case {c.case_id}
        </h1>
        <div className="text-sm mt-1 text-muted-foreground">
          {c.case_type} · Severity {c.severity} · Opened{" "}
          {new Date(c.opened_at).toLocaleString()}
        </div>
      </header>

      <section>
        <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
          Subject
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Item k="Registration" v={c.subject_reg ?? "—"} />
          <Item k="ICAO Hex" v={c.subject_icao ?? "—"} mono />
          <Item k="Owner" v={c.subject_owner ?? "—"} />
          <Item k="Primary County" v={c.primary_county ?? "—"} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
          Watchtower Threat Index (WTI)
        </h2>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Item k="Score" v={c.wti_score ?? "—"} />
          <Item k="Tier" v={c.wti_tier ?? "—"} />
          <Item k="Total Events" v={c.total_events ?? 0} />
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
          Bradford-Hill Causal Analysis
        </h2>
        <div className="text-sm">
          Composite score:{" "}
          <span className="font-bold">{c.bradford_hill_score ?? "—"}</span> ·
          Evidence sufficient:{" "}
          <span className="font-bold">{c.evidence_sufficient ? "Yes" : "No"}</span>
        </div>
        <ul className="mt-2 text-sm space-y-1">
          {bh.map(([label, met]) => (
            <li key={label} className="flex justify-between border-b border-border/40 py-1">
              <span>{label}</span>
              <span className="font-bold">{met ? "Met" : "Not met"}</span>
            </li>
          ))}
        </ul>
      </section>

      {c.auto_summary && (
        <section>
          <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
            ML Auto-Summary
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.auto_summary}</p>
        </section>
      )}

      {c.public_summary && (
        <section>
          <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
            Public Summary
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.public_summary}</p>
        </section>
      )}

      {c.reviewer_notes && (
        <section>
          <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
            Reviewer Notes
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.reviewer_notes}</p>
          <div className="text-[10px] mt-1 text-muted-foreground">
            Reviewed by {c.reviewed_by ?? "—"}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
          Evidence Chain
        </h2>
        <div className="text-xs font-mono space-y-1">
          <div>Merkle Block: {c.merkle_block ?? "—"}</div>
          <div className="break-all">SHA-256: {c.sha256_hash ?? "—"}</div>
          <div>
            Linked: {c.detection_ids?.length ?? 0} detections ·{" "}
            {c.anomaly_ids?.length ?? 0} anomalies ·{" "}
            {c.violation_ids?.length ?? 0} violations ·{" "}
            {c.convergence_ids?.length ?? 0} convergences
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-widest neon-text-green mb-2">
          Detection Log ({evQ.data?.detections.length ?? 0})
        </h2>
        {evQ.isLoading ? (
          <div className="text-xs">Loading…</div>
        ) : !evQ.data?.detections.length ? (
          <div className="text-xs text-muted-foreground">No detections linked.</div>
        ) : (
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left p-1">Timestamp (UTC)</th>
                <th className="text-left p-1">ICAO</th>
                <th className="text-left p-1">Reg</th>
                <th className="text-right p-1">Alt (ft)</th>
                <th className="text-left p-1">Lat,Lon</th>
                <th className="text-left p-1">County</th>
                <th className="text-left p-1">Flags</th>
              </tr>
            </thead>
            <tbody>
              {evQ.data.detections.map((d) => (
                <tr key={d.id} className="border-b border-border/40">
                  <td className="p-1">{new Date(d.captured_at).toISOString()}</td>
                  <td className="p-1">{d.icao_hex}</td>
                  <td className="p-1">{d.registration ?? "—"}</td>
                  <td className="p-1 text-right">{d.altitude_ft ?? "—"}</td>
                  <td className="p-1">
                    {d.latitude && d.longitude
                      ? `${Number(d.latitude).toFixed(4)},${Number(d.longitude).toFixed(4)}`
                      : "—"}
                  </td>
                  <td className="p-1">{d.county ?? "—"}</td>
                  <td className="p-1">
                    {[
                      d.is_91_227_violator && "91.227",
                      d.is_military && "MIL",
                      d.emergency && d.emergency !== "none" && "EMG",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="border-t-2 border-border pt-4 text-[10px] text-muted-foreground">
        Generated {new Date().toLocaleString()} by Watchtower Command. All evidence
        timestamps recorded in UTC. Hash chain anchored to Merkle block{" "}
        {c.merkle_block ?? "n/a"}. This brief is derived from non-classified,
        public ADS-B observations curated by the Watchtower civilian advocacy
        project.
      </footer>
    </div>
  );
}

function Item({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className={`mt-0.5 ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}
