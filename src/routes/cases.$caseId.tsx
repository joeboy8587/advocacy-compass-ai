import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft, FileText, Hash, ShieldCheck, Save, CheckCircle2, XCircle, Send,
  FileDown, Loader2, User, Clock, Users, Camera, Search, Sparkles, AlertTriangle,
} from "lucide-react";
import { getCaseById, updateCase, getCaseEvidence } from "@/lib/watchtower.functions";
import {
  getSubjectDossier, getSubjectTimeline, getCoFliers, getSubjectScreenshots,
  registryCrossCheck, corroborateCase, attachDetectionsToCase, autoBuildCase,
} from "@/lib/casework.functions";

export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({ meta: [{ title: "Case // Watchtower" }] }),
  component: CaseDetail,
});

const STATUSES = ["DRAFT", "REVIEW", "CONFIRMED", "PUBLISHED", "DISMISSED"] as const;
type Status = (typeof STATUSES)[number];
type Tab = "overview" | "investigate" | "verify" | "triage";

function CaseDetail() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const caseQ = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => getCaseById({ data: { id: caseId } }),
  });

  if (caseQ.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!caseQ.data) return <div className="p-6 text-destructive">Case not found.</div>;
  const c = caseQ.data;

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/cases" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2">
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

      <nav className="flex gap-1 border-b border-border print:hidden">
        {(["overview", "investigate", "verify", "triage"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[11px] uppercase tracking-widest border-b-2 -mb-px transition ${
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-accent"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab c={c} caseId={caseId} />}
      {tab === "investigate" && <InvestigateTab c={c} caseId={caseId} />}
      {tab === "verify" && <VerifyTab caseId={caseId} />}
      {tab === "triage" && (
        <TriageTab
          c={c}
          caseId={caseId}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["case", caseId] });
            qc.invalidateQueries({ queryKey: ["cases"] });
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// OVERVIEW (existing BH, chain, evidence list)
// ============================================================
function OverviewTab({ c, caseId }: { c: ReturnType<typeof getCaseSafe>; caseId: string }) {
  const evQ = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: () => getCaseEvidence({ data: { id: caseId } }),
  });

  const bh = [
    ["Strength", c.bh_strength],
    ["Consistency", c.bh_consistency],
    ["Specificity", c.bh_specificity],
    ["Temporality", c.bh_temporality],
    ["Corroboration", c.bh_corroboration],
  ] as const;

  return (
    <div className="space-y-4">
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

      <section className="panel p-5">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3">
          Attached Detections ({evQ.data?.detections.length ?? 0})
        </div>
        {evQ.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading evidence…</div>
        ) : !evQ.data?.detections.length ? (
          <div className="text-xs text-muted-foreground">No detections linked. Use Investigate tab to attach.</div>
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
                      <span className={d.is_91_227_violator ? "text-destructive" : ""}>
                        {d.altitude_ft ?? "—"}
                      </span>
                    </td>
                    <td className="p-1">{d.county ?? "—"}</td>
                    <td className="p-1">
                      {d.is_91_227_violator && <span className="text-destructive mr-1">91.227</span>}
                      {d.is_military && <span className="neon-text-orange">MIL</span>}
                      {d.emergency && d.emergency !== "none" && <span className="text-destructive">EMG</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================
// INVESTIGATE: Dossier + Timeline + Co-fliers + Screenshots
// ============================================================
function InvestigateTab({ c, caseId }: { c: { subject_icao: string | null; subject_reg: string | null }; caseId: string }) {
  const icao = c.subject_icao ?? null;
  const reg = c.subject_reg ?? null;
  const qc = useQueryClient();

  const dossier = useQuery({
    queryKey: ["dossier", icao, reg],
    queryFn: () => getSubjectDossier({ data: { icao: icao ?? undefined, reg: reg ?? undefined } }),
    enabled: !!(icao || reg),
  });

  const [hours, setHours] = useState(24);
  const timeline = useQuery({
    queryKey: ["timeline", icao, hours],
    queryFn: () => getSubjectTimeline({ data: { icao: icao!, hours } }),
    enabled: !!icao,
  });

  const [radius, setRadius] = useState(5);
  const [winSec, setWinSec] = useState(120);
  const cofliers = useQuery({
    queryKey: ["cofliers", icao, hours, radius, winSec],
    queryFn: () => getCoFliers({ data: { icao: icao!, hours, radiusKm: radius, windowSec: winSec } }),
    enabled: !!icao,
  });

  const shots = useQuery({
    queryKey: ["shots-subj", icao, reg],
    queryFn: () => getSubjectScreenshots({ data: { icao, reg } }),
    enabled: !!(icao || reg),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const attach = useMutation({
    mutationFn: () =>
      attachDetectionsToCase({ data: { caseId, detectionIds: [...selected] } }),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["case-evidence", caseId] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
  });

  if (!icao && !reg) {
    return <div className="panel p-5 text-xs text-muted-foreground">Set a subject ICAO or registration on this case to enable investigation tools.</div>;
  }

  const d = dossier.data;

  return (
    <div className="space-y-4">
      {/* DOSSIER */}
      <section className="panel scanline p-5">
        <div className="text-xs uppercase tracking-widest neon-text-orange mb-3 flex items-center gap-2">
          <User className="size-4" /> Subject Dossier
        </div>
        {dossier.isLoading ? <div className="text-xs text-muted-foreground">Loading…</div> : !d ? (
          <div className="text-xs text-muted-foreground">No data for this subject.</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 text-xs">
            <dl className="space-y-1">
              <Row k="ICAO" v={<span className="font-mono neon-text-green">{d.icao_hex ?? "—"}</span>} />
              <Row k="Registration" v={<span className="font-mono">{d.registration ?? "—"}</span>} />
              <Row k="Owner (FAA)" v={d.owner ?? "—"} />
              <Row k="Location" v={`${d.owner_city ?? "?"}, ${d.owner_state ?? "?"}`} />
              <Row k="Registrant Type" v={d.type_registrant ?? "—"} />
              <Row k="Year MFR" v={d.year_mfr ?? "—"} />
              <Row k="FAA Status" v={d.status_code ?? "—"} />
              <Row k="Flags" v={
                <span className="space-x-1">
                  {d.is_military && <span className="px-1 border border-primary text-primary text-[10px]">MIL</span>}
                  {d.is_kcso && <span className="px-1 border border-primary text-primary text-[10px]">KCSO</span>}
                  {d.is_med && <span className="px-1 border border-accent text-accent text-[10px]">MED</span>}
                  {!d.is_military && !d.is_kcso && !d.is_med && "—"}
                </span>
              } />
            </dl>
            <dl className="space-y-1">
              <Row k="Detections (lifetime)" v={d.detections_total.toLocaleString()} />
              <Row k="Detections (30d)" v={d.detections_30d.toLocaleString()} />
              <Row k="Low-Alt Events (lifetime)" v={<span className="neon-text-orange">{d.low_alt_total.toLocaleString()}</span>} />
              <Row k="Low-Alt Events (30d)" v={<span className="neon-text-orange">{d.low_alt_30d.toLocaleString()}</span>} />
              <Row k="FAA Violations Classified" v={d.violations_total.toLocaleString()} />
              <Row k="First Seen" v={d.first_seen ? new Date(d.first_seen).toLocaleDateString() : "—"} />
              <Row k="Last Seen" v={d.last_seen ? new Date(d.last_seen).toLocaleString() : "—"} />
              <Row k="Top Counties" v={<span className="text-right">{d.top_counties ?? "—"}</span>} />
            </dl>
          </div>
        )}
        {d?.prior_cases && d.prior_cases.length > 1 && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Prior / Related Cases</div>
            <div className="flex flex-wrap gap-2">
              {d.prior_cases.map((p) => (
                <Link key={p.case_id} to="/cases/$caseId" params={{ caseId: p.case_id }}
                  className="text-[11px] font-mono border border-border px-2 py-0.5 hover:border-accent">
                  {p.case_id} · {p.status} · T{p.wti_tier ?? "?"}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* TIMELINE */}
      {icao && (
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
              <Clock className="size-4" /> Timeline Reconstructor
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground uppercase text-[10px] tracking-widest">Window:</span>
              {[6, 24, 72, 168, 720].map((h) => (
                <button key={h} onClick={() => setHours(h)}
                  className={`px-2 py-0.5 text-[10px] uppercase border ${hours === h ? "border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"}`}>
                  {h < 24 ? `${h}h` : `${h / 24}d`}
                </button>
              ))}
            </div>
          </div>
          {selected.size > 0 && (
            <div className="mb-3 flex items-center justify-between bg-accent/10 border border-accent/40 px-3 py-2 rounded-sm">
              <span className="text-xs">{selected.size} detection(s) selected</span>
              <div className="flex gap-2">
                <button onClick={() => setSelected(new Set())}
                  className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent">Clear</button>
                <button disabled={attach.isPending} onClick={() => attach.mutate()}
                  className="text-[10px] uppercase tracking-widest bg-accent text-accent-foreground px-3 py-1 rounded-sm">
                  {attach.isPending ? "Attaching…" : "Attach to Case"}
                </button>
              </div>
            </div>
          )}
          {timeline.isLoading ? <div className="text-xs text-muted-foreground">Loading…</div> : (
            <div className="overflow-auto max-h-[28rem]">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border sticky top-0 bg-background">
                  <tr>
                    <th className="text-left p-1 w-6"></th>
                    <th className="text-left p-1">Time</th>
                    <th className="text-left p-1">Kind</th>
                    <th className="text-left p-1">Label</th>
                    <th className="text-right p-1">Alt</th>
                    <th className="text-left p-1">County</th>
                    <th className="text-left p-1">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.data?.map((e, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-secondary/30">
                      <td className="p-1">
                        {e.kind === "DETECTION" && e.detection_id && (
                          <input
                            type="checkbox"
                            checked={selected.has(e.detection_id)}
                            onChange={(ev) => {
                              const s = new Set(selected);
                              if (ev.target.checked) s.add(e.detection_id!); else s.delete(e.detection_id!);
                              setSelected(s);
                            }}
                          />
                        )}
                      </td>
                      <td className="p-1 font-mono">{new Date(e.ts).toLocaleString()}</td>
                      <td className="p-1">
                        <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 border ${
                          e.kind === "VIOLATION" ? "border-destructive text-destructive" :
                          e.kind === "ANOMALY" ? "border-primary text-primary" :
                          e.kind === "ALERT" ? "border-accent text-accent" :
                          "border-border text-muted-foreground"
                        }`}>{e.kind}</span>
                      </td>
                      <td className="p-1 font-mono">{e.label ?? "—"}</td>
                      <td className="p-1 text-right tabular-nums">{e.altitude_ft ?? "—"}</td>
                      <td className="p-1">{e.county ?? "—"}</td>
                      <td className="p-1 text-muted-foreground">{e.severity ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!timeline.data?.length && <div className="text-xs text-muted-foreground py-4 text-center">No events in window.</div>}
            </div>
          )}
        </section>
      )}

      {/* CO-FLIERS */}
      {icao && (
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
              <Users className="size-4" /> Convergence / Co-flier Finder
            </div>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
              <label className="flex items-center gap-1">
                Radius
                <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}
                  className="bg-input/50 border border-border px-1 py-0.5">
                  {[1, 2, 5, 10, 20].map((r) => <option key={r} value={r}>{r}km</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                Window
                <select value={winSec} onChange={(e) => setWinSec(Number(e.target.value))}
                  className="bg-input/50 border border-border px-1 py-0.5">
                  {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>±{s}s</option>)}
                </select>
              </label>
            </div>
          </div>
          {cofliers.isLoading ? <div className="text-xs text-muted-foreground">Searching for co-fliers…</div> : (
            <div className="overflow-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left p-1">ICAO</th>
                    <th className="text-left p-1">Reg</th>
                    <th className="text-left p-1">Owner</th>
                    <th className="text-right p-1">Encounters</th>
                    <th className="text-right p-1">Min dist</th>
                    <th className="text-right p-1">Min Δt</th>
                    <th className="text-left p-1">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {cofliers.data?.map((c2) => (
                    <tr key={c2.icao_hex} className="border-b border-border/30 hover:bg-secondary/30">
                      <td className="p-1 neon-text-orange">{c2.icao_hex}</td>
                      <td className="p-1">{c2.registration ?? "—"}</td>
                      <td className="p-1 text-muted-foreground truncate max-w-[220px]">{c2.owner ?? "—"} {c2.is_military && <span className="text-primary">MIL</span>}</td>
                      <td className="p-1 text-right">{c2.encounter_count}</td>
                      <td className="p-1 text-right tabular-nums">{c2.min_dist_km?.toFixed(2)}km</td>
                      <td className="p-1 text-right tabular-nums">{c2.min_dt_sec}s</td>
                      <td className="p-1 text-muted-foreground text-[10px]">
                        {new Date(c2.first_at).toLocaleDateString()} → {new Date(c2.last_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cofliers.data?.length && <div className="text-xs text-muted-foreground py-4 text-center">No co-fliers within radius/window.</div>}
            </div>
          )}
        </section>
      )}

      {/* SCREENSHOTS */}
      <section className="panel p-5">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3 flex items-center gap-2">
          <Camera className="size-4" /> Linked Screenshots ({shots.data?.length ?? 0})
        </div>
        {shots.isLoading ? <div className="text-xs text-muted-foreground">Loading…</div> : !shots.data?.length ? (
          <div className="text-xs text-muted-foreground">No screenshots match this subject. Upload at <Link to="/screenshots" className="text-accent">/screenshots</Link>.</div>
        ) : (
          <ul className="text-xs space-y-2">
            {shots.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between border border-border/40 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="font-mono truncate">{s.filename}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{s.sha256.slice(0, 24)}…</div>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <div><span className={`px-1 border ${
                    s.match_status === "LOCKED" ? "border-accent text-accent" :
                    s.match_status === "STRONG" ? "border-accent/60 text-accent" :
                    s.match_status === "NO_MATCH" ? "border-destructive text-destructive" :
                    "border-border"
                  }`}>{s.match_status}</span></div>
                  <div>{s.exif_taken_at ? new Date(s.exif_taken_at).toLocaleString() : "no EXIF"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ============================================================
// VERIFY: Registry cross-check + AI corroboration + sign-off log
// ============================================================
function VerifyTab({ caseId }: { caseId: string }) {
  const reg = useQuery({
    queryKey: ["regcheck", caseId],
    queryFn: () => registryCrossCheck({ data: { caseId } }),
  });

  const ai = useMutation({
    mutationFn: () => corroborateCase({ data: { caseId } }),
  });

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="text-xs uppercase tracking-widest neon-text-green mb-3 flex items-center gap-2">
          <Search className="size-4" /> FAA Registry Cross-Check
        </div>
        {reg.isLoading ? <div className="text-xs text-muted-foreground">Checking registry…</div> : reg.data && (
          <div className="text-xs space-y-2">
            <Row k="Case Registration" v={<span className="font-mono">{reg.data.registration ?? "—"}</span>} />
            <Row k="Case Owner" v={reg.data.case_owner ?? "—"} />
            <Row k="FAA Owner (faa_master)" v={reg.data.faa_owner ?? <span className="text-destructive">not in registry</span>} />
            <Row k="FAA Location" v={`${reg.data.faa_city ?? "?"}, ${reg.data.faa_state ?? "?"}`} />
            <Row k="FAA Status" v={reg.data.faa_status === "V" ? <span className="neon-text-green">V (Valid)</span> : reg.data.faa_status ?? "—"} />
            {reg.data.mismatches.length > 0 ? (
              <div className="mt-3 border border-destructive/40 bg-destructive/10 p-3 rounded-sm">
                <div className="flex items-center gap-2 text-destructive uppercase tracking-widest text-[10px] mb-1">
                  <AlertTriangle className="size-3" /> Mismatches detected
                </div>
                <ul className="text-xs list-disc list-inside space-y-1">
                  {reg.data.mismatches.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            ) : (
              <div className="mt-3 text-xs neon-text-green">✔ Case subject matches FAA registry of record.</div>
            )}
          </div>
        )}
      </section>

      <section className="panel scanline p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
            <Sparkles className="size-4" /> Josiah Corroboration
          </div>
          <button disabled={ai.isPending} onClick={() => ai.mutate()}
            className="text-[10px] uppercase tracking-widest bg-accent text-accent-foreground px-3 py-1 rounded-sm disabled:opacity-50">
            {ai.isPending ? <Loader2 className="size-3 animate-spin inline mr-1" /> : null}
            Run Corroboration
          </button>
        </div>
        {ai.data && "error" in ai.data && (
          <div className="text-xs text-destructive">{ai.data.error}</div>
        )}
        {ai.data && "parsed" in ai.data && ai.data.parsed && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border ${
                ai.data.parsed.verdict === "CORROBORATED" ? "border-accent text-accent" :
                ai.data.parsed.verdict === "CONTRADICTED" ? "border-destructive text-destructive" :
                "border-primary text-primary"
              }`}>{ai.data.parsed.verdict}</span>
              <span className="text-muted-foreground">Confidence: <span className="neon-text-green">{ai.data.parsed.confidence}%</span></span>
              <span className="text-muted-foreground">Recommend: <span className="font-mono">{ai.data.parsed.recommended_status}</span></span>
            </div>
            <p className="italic text-muted-foreground">{ai.data.parsed.one_line_summary}</p>
            <CritList title="Strengths" items={ai.data.parsed.strengths} tone="green" />
            <CritList title="Weaknesses" items={ai.data.parsed.weaknesses} tone="orange" />
            <CritList title="Missing Evidence" items={ai.data.parsed.missing_evidence} tone="orange" />
          </div>
        )}
        {ai.data && "raw" in ai.data && !ai.data.parsed && (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap">{ai.data.raw}</pre>
        )}
        {!ai.data && !ai.isPending && (
          <p className="text-xs text-muted-foreground">Run Josiah's verification subroutine to re-read this case and grade the evidence as CORROBORATED, WEAK, or CONTRADICTED.</p>
        )}
      </section>
    </div>
  );
}

function CritList({ title, items, tone }: { title: string; items?: string[]; tone: "green" | "orange" }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest mb-1 ${tone === "green" ? "neon-text-green" : "neon-text-orange"}`}>{title}</div>
      <ul className="list-disc list-inside space-y-0.5 text-xs">
        {items.map((i, n) => <li key={n}>{i}</li>)}
      </ul>
    </div>
  );
}

// ============================================================
// TRIAGE — status workflow + reviewer sign-off
// ============================================================
function TriageTab({
  c, caseId, onSaved,
}: {
  c: ReturnType<typeof getCaseSafe>;
  caseId: string;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(c.reviewer_notes ?? "");
  const [publicSummary, setPublicSummary] = useState(c.public_summary ?? "");
  const [dismissReason, setDismissReason] = useState(c.dismissed_reason ?? "");
  const [reviewer, setReviewer] = useState(c.reviewed_by ?? "admin");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setNotes(c.reviewer_notes ?? "");
    setPublicSummary(c.public_summary ?? "");
    setDismissReason(c.dismissed_reason ?? "");
    setReviewer(c.reviewed_by ?? "admin");
  }, [c.id]);

  const mutate = useMutation({
    mutationFn: (vars: Parameters<typeof updateCase>[0]["data"]) => updateCase({ data: vars }),
    onSuccess: () => {
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    },
  });

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

  return (
    <section className="panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest neon-text-orange">Triage Workflow</div>
        <div className="text-[10px] text-muted-foreground">
          {savedAt ? `Saved ${savedAt}` : "Status moves auto-include your notes"}
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
                active ? "bg-accent/20 border-accent text-accent" : "border-border text-muted-foreground hover:border-accent hover:text-accent"
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
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Reviewer</label>
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)}
            className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none" />
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Reviewer Notes (internal)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
            placeholder="What did you verify? Patterns, witnesses, follow-ups…"
            className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none" />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Public Summary (shown when published)</label>
          <textarea value={publicSummary} onChange={(e) => setPublicSummary(e.target.value)} rows={5}
            placeholder="Plain-language summary for advocacywatch.live readers."
            className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none" />
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Dismissal Reason (if applicable)</label>
          <input value={dismissReason} onChange={(e) => setDismissReason(e.target.value)}
            placeholder="Why was this dismissed?"
            className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none" />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button onClick={saveAll} disabled={mutate.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm disabled:opacity-50">
          {mutate.isPending ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
          Save Notes
        </button>
        {mutate.isError && <span className="text-xs text-destructive">{(mutate.error as Error)?.message ?? "Save failed"}</span>}
      </div>

      <div className="pt-3 border-t border-border text-xs space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Reviewer Log</div>
        <Row k="Reviewed by" v={c.reviewed_by ?? "—"} />
        <Row k="Reviewer notes" v={c.reviewer_notes ?? "—"} />
        {c.dismissed_reason && <Row k="Dismissed reason" v={c.dismissed_reason} />}
        {c.is_published && <Row k="Published" v="✔ Public on advocacywatch.live" />}
      </div>
    </section>
  );
}

// ============================================================
// helpers
// ============================================================
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
// helper purely to widen the inferred shape; never invoked
declare function getCaseSafe(): NonNullable<Awaited<ReturnType<typeof getCaseById>>>;
