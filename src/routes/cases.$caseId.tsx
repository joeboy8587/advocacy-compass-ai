import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Hash,
  ShieldCheck,
  Save,
  CheckCircle2,
  XCircle,
  Send,
  FileDown,
  Loader2,
} from "lucide-react";
import { getCaseById, updateCase, getCaseEvidence } from "@/lib/watchtower.functions";

export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({ meta: [{ title: "Case // Watchtower" }] }),
  component: CaseDetail,
});

const STATUSES = ["DRAFT", "REVIEW", "CONFIRMED", "PUBLISHED", "DISMISSED"] as const;
type Status = (typeof STATUSES)[number];

function CaseDetail() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();

  const caseQ = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => getCaseById({ data: { id: caseId } }),
  });
  const evQ = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: () => getCaseEvidence({ data: { id: caseId } }),
  });

  const [notes, setNotes] = useState("");
  const [publicSummary, setPublicSummary] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [reviewer, setReviewer] = useState("admin");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!caseQ.data) return;
    setNotes(caseQ.data.reviewer_notes ?? "");
    setPublicSummary(caseQ.data.public_summary ?? "");
    setDismissReason(caseQ.data.dismissed_reason ?? "");
    setReviewer(caseQ.data.reviewed_by ?? "admin");
  }, [caseQ.data?.id]);

  const mutate = useMutation({
    mutationFn: (vars: Parameters<typeof updateCase>[0]["data"]) =>
      updateCase({ data: vars }),
    onSuccess: () => {
      setSavedAt(new Date().toLocaleTimeString());
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });

  if (caseQ.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!caseQ.data) return <div className="p-6 text-destructive">Case not found.</div>;
  const c = caseQ.data;

  const saveAll = () =>
    mutate.mutate({
      id: caseId,
      reviewer_notes: notes,
      public_summary: publicSummary,
      dismissed_reason: dismissReason || null,
      reviewed_by: reviewer,
    });

  const setStatus = (status: Status) =>
    mutate.mutate({
      id: caseId,
      status,
      reviewer_notes: notes,
      reviewed_by: reviewer,
      ...(status === "DISMISSED" ? { dismissed_reason: dismissReason || "Not actionable" } : {}),
      ...(status === "PUBLISHED" ? { is_published: true, public_summary: publicSummary } : {}),
    });

  const bh = [
    ["Strength", c.bh_strength],
    ["Consistency", c.bh_consistency],
    ["Specificity", c.bh_specificity],
    ["Temporality", c.bh_temporality],
    ["Corroboration", c.bh_corroboration],
  ] as const;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between print:hidden">
        <Link
          to="/cases"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2"
        >
          <ArrowLeft className="size-3" /> Back to cases
        </Link>
        <Link
          to="/cases/$caseId/brief"
          params={{ caseId }}
          className="text-xs uppercase tracking-widest text-accent hover:underline inline-flex items-center gap-2"
        >
          <FileDown className="size-3" /> Legal Brief / Export PDF
        </Link>
      </div>

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

      {/* PHASE 2: Triage / Status Workflow */}
      <section className="panel p-5 space-y-4 print:hidden">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest neon-text-orange">
            Triage Workflow
          </div>
          <div className="text-[10px] text-muted-foreground">
            {savedAt ? `Saved ${savedAt}` : "Unsaved changes auto-included with status moves"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const active = c.status === s;
            return (
              <button
                key={s}
                disabled={mutate.isPending}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm transition-all ${
                  active
                    ? "bg-accent/20 border-accent text-accent"
                    : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                }`}
              >
                {s === "CONFIRMED" && <CheckCircle2 className="inline size-3 mr-1" />}
                {s === "DISMISSED" && <XCircle className="inline size-3 mr-1" />}
                {s === "PUBLISHED" && <Send className="inline size-3 mr-1" />}
                {s}
              </button>
            );
          })}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Reviewer
            </label>
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
              className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none"
            />
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Reviewer Notes (internal)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="What did you verify? Patterns, witnesses, follow-ups…"
              className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Public Summary (shown when published)
            </label>
            <textarea
              value={publicSummary}
              onChange={(e) => setPublicSummary(e.target.value)}
              rows={4}
              placeholder="Plain-language summary for advocacywatch.live readers."
              className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none"
            />
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Dismissal Reason (if applicable)
            </label>
            <input
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Why was this dismissed?"
              className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button
            onClick={saveAll}
            disabled={mutate.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm disabled:opacity-50"
          >
            {mutate.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Save className="size-3" />
            )}
            Save Notes
          </button>
          {mutate.isError && (
            <span className="text-xs text-destructive">
              {(mutate.error as Error)?.message ?? "Save failed"}
            </span>
          )}
        </div>
      </section>

      {c.auto_summary && (
        <section className="panel scanline p-5">
          <div className="text-xs uppercase tracking-widest neon-text-green mb-2 flex items-center gap-2">
            <FileText className="size-4" /> ML Auto-Summary
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.auto_summary}</p>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="panel p-5">
          <div className="text-xs uppercase tracking-widest neon-text-green mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4" /> Bradford-Hill Criteria
          </div>
          <ul className="text-sm space-y-1">
            {bh.map(([label, met]) => (
              <li
                key={label}
                className="flex justify-between border-b border-border/40 py-1"
              >
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
            <Row
              k="SHA-256"
              v={c.sha256_hash ? c.sha256_hash.slice(0, 24) + "…" : "—"}
              mono
            />
            <Row k="Detections" v={c.detection_ids?.length ?? 0} />
            <Row k="Anomalies" v={c.anomaly_ids?.length ?? 0} />
            <Row k="Violations" v={c.violation_ids?.length ?? 0} />
            <Row k="Convergences" v={c.convergence_ids?.length ?? 0} />
            <Row k="Total Events" v={c.total_events ?? 0} />
          </dl>
        </div>
      </section>

      {/* Attached evidence list */}
      <section className="panel p-5">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3">
          Attached Detections ({evQ.data?.detections.length ?? 0})
        </div>
        {evQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading evidence…</div>
        ) : !evQ.data?.detections.length ? (
          <div className="text-xs text-muted-foreground">No detections linked.</div>
        ) : (
          <div className="overflow-auto max-h-80">
            <table className="w-full text-xs font-mono">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-1">Time</th>
                  <th className="text-left p-1">ICAO</th>
                  <th className="text-left p-1">Reg</th>
                  <th className="text-right p-1">Alt</th>
                  <th className="text-left p-1">County</th>
                  <th className="text-left p-1">Flags</th>
                </tr>
              </thead>
              <tbody>
                {evQ.data.detections.map((d) => (
                  <tr key={d.id} className="border-b border-border/30">
                    <td className="p-1">{new Date(d.captured_at).toLocaleString()}</td>
                    <td className="p-1 neon-text-orange">{d.icao_hex}</td>
                    <td className="p-1">{d.registration ?? "—"}</td>
                    <td className="p-1 text-right">
                      <span
                        className={
                          d.is_91_227_violator ? "text-destructive" : ""
                        }
                      >
                        {d.altitude_ft ?? "—"}
                      </span>
                    </td>
                    <td className="p-1">{d.county ?? "—"}</td>
                    <td className="p-1">
                      {d.is_91_227_violator && (
                        <span className="text-destructive mr-1">91.227</span>
                      )}
                      {d.is_military && <span className="neon-text-orange">MIL</span>}
                      {d.emergency && d.emergency !== "none" && (
                        <span className="text-destructive">EMG</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel p-5 text-xs space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Reviewer Log
        </div>
        <Row k="Reviewed by" v={c.reviewed_by ?? "—"} />
        <Row k="Notes" v={c.reviewer_notes ?? "—"} />
        {c.dismissed_reason && <Row k="Dismissed reason" v={c.dismissed_reason} />}
        {c.is_published && <Row k="Published" v="✔ Public on advocacywatch.live" />}
      </section>
    </div>
  );
}

function Field({
  k,
  v,
  tone,
}: {
  k: string;
  v: React.ReactNode;
  tone?: "green" | "orange";
}) {
  const cls =
    tone === "orange" ? "neon-text-orange" : tone === "green" ? "neon-text-green" : "";
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
