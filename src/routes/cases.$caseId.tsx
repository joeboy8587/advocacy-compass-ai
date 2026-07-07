import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  ArrowLeft, FileText, Hash, ShieldCheck, Save, CheckCircle2, XCircle, Send,
  FileDown, Loader2, User, Clock, Users, Camera, Search, Sparkles, AlertTriangle,
  Paperclip, Upload, Trash2, X, Globe, Archive, ExternalLink, Radar,
} from "lucide-react";
import { getCaseById, updateCase, getCaseEvidence } from "@/lib/watchtower.functions";
import {
  getSubjectDossier, getSubjectTimeline, getCoFliers, getSubjectScreenshots,
  registryCrossCheck, corroborateCase, attachDetectionsToCase, autoBuildCase,
  getConvergenceWindow, getWeaknessReport, applyWeaknessRemediation,
  attachAircraftToCase,
} from "@/lib/casework.functions";
import {
  listCaseDoctrine, ingestDoctrine, unlinkDoctrineFromCase,
} from "@/lib/doctrine.functions";
import { getCaseOsint, enrichCase, deepAdsbPull, archiveUrl } from "@/lib/osint.functions";
import { sha256Hex, extractText } from "@/lib/file-extract";


export const Route = createFileRoute("/cases/$caseId")({
  head: () => ({ meta: [{ title: "Case // Watchtower" }] }),
  component: CaseDetail,
});

const STATUSES = ["DRAFT", "REVIEW", "CONFIRMED", "PUBLISHED", "DISMISSED"] as const;
type Status = (typeof STATUSES)[number];
type Tab = "overview" | "investigate" | "osint" | "verify" | "triage";

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
        {(["overview", "investigate", "osint", "verify", "triage"] as const).map((t) => (
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
      {tab === "osint" && <OsintTab c={c} caseId={caseId} />}
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
  const qc = useQueryClient();
  const evQ = useQuery({
    queryKey: ["case-evidence", caseId],
    queryFn: () => getCaseEvidence({ data: { id: caseId } }),
  });

  const build = useMutation({
    mutationFn: () => autoBuildCase({ data: { caseId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["case-evidence", caseId] });
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
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
      <section className="panel scanline p-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
            <Sparkles className="size-4" /> Auto-Build Evidence
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Scoop every detection, anomaly, violation, and convergence for this subject,
            attach them to the case, and re-score Bradford-Hill + WTI.
          </p>
          {build.data && (
            <div className="mt-2 text-[11px] font-mono grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5">
              <span>Detections: <span className="neon-text-green">{build.data.detections}</span></span>
              <span>Anomalies: <span className="neon-text-orange">{build.data.anomalies}</span></span>
              <span>Violations: <span className="text-destructive">{build.data.violations}</span></span>
              <span>Convergences: <span className="neon-text-orange">{build.data.convergences}</span></span>
              <span>Co-fliers: {build.data.co_fliers}</span>
              <span>Counties: {build.data.counties}</span>
              <span>Span: {build.data.span_days}d</span>
              <span>WTI: T{build.data.wti_tier} · {build.data.wti_score}</span>
            </div>
          )}
          {build.isError && (
            <div className="mt-2 text-xs text-destructive">
              {(build.error as Error)?.message ?? "Auto-build failed"}
            </div>
          )}
        </div>
        <button
          onClick={() => build.mutate()}
          disabled={build.isPending}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm disabled:opacity-50"
        >
          {build.isPending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {build.isPending ? "Building…" : "Auto-Build"}
        </button>
      </section>

      <ConvergenceWindowPanel
        subjectReg={c.subject_reg ?? null}
        subjectIcao={c.subject_icao ?? null}
      />

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

      <RelatedAircraftPanel caseId={caseId} />

      <CaseFilesPanel caseId={caseId} />


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
  const qc = useQueryClient();
  const reg = useQuery({
    queryKey: ["regcheck", caseId],
    queryFn: () => registryCrossCheck({ data: { caseId } }),
  });

  const ai = useMutation({
    mutationFn: () => corroborateCase({ data: { caseId } }),
    onSuccess: () => {
      // convergence_ids may have been backfilled — refresh case row & evidence
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["case-evidence", caseId] });
    },
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
        {ai.data && "enriched" in ai.data && ai.data.enriched && ai.data.enriched.convergences_added > 0 && (
          <div className="mb-3 text-xs border border-accent/40 bg-accent/10 rounded-sm p-2 neon-text-green">
            ✔ Backfilled {ai.data.enriched.convergences_added} convergence lock ID(s) onto this case.
            Overview now shows {ai.data.enriched.convergence_ids_now} convergence(s).
          </div>
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
            <MissionList items={ai.data.parsed.mission_type_estimates} />
            <CritList title="Strengths" items={ai.data.parsed.strengths} tone="green" />
            <CritList title="Weaknesses" items={ai.data.parsed.weaknesses} tone="orange" />
            <CritList title="Missing Evidence" items={ai.data.parsed.missing_evidence} tone="orange" />
          </div>
        )}
        {ai.data && "raw" in ai.data && !ai.data.parsed && (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap">{ai.data.raw}</pre>
        )}
        {!ai.data && !ai.isPending && (
          <p className="text-xs text-muted-foreground">Run Josiah's verification subroutine to re-read this case, backfill any missing convergence IDs, classify mission types (surveillance / pursuit / SAR / transit / training), and grade the evidence as CORROBORATED, WEAK, or CONTRADICTED.</p>
        )}
      </section>

      <WeaknessRemediationPanel caseId={caseId} />
    </div>
  );
}

// ============================================================
// WEAKNESS REMEDIATION — turns Josiah's "missing evidence" and
// "weakness" bullets into one-click fixes: refresh primary_county
// from actual detection distribution, and pin a real ML anomaly
// score into the reviewer notes so the "ML score = 0" gap closes.
// ============================================================
function WeaknessRemediationPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const rep = useQuery({
    queryKey: ["weakness-report", caseId],
    queryFn: () => getWeaknessReport({ data: { caseId } }),
  });

  const apply = useMutation({
    mutationFn: (vars: { newPrimaryCounty?: string | null; mlScoreNote?: string | null }) =>
      applyWeaknessRemediation({ data: { caseId, ...vars } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["weakness-report", caseId] });
    },
  });

  const r = rep.data;

  return (
    <section className="panel scanline p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <AlertTriangle className="size-4" /> Weakness &amp; Missing-Evidence Remediation
        </div>
        <button
          onClick={() => rep.refetch()}
          disabled={rep.isFetching}
          className="text-[10px] uppercase tracking-widest border border-border px-2 py-1 hover:border-accent disabled:opacity-50"
        >
          {rep.isFetching ? <Loader2 className="size-3 animate-spin inline" /> : "Recompute"}
        </button>
      </div>

      {rep.isLoading && <div className="text-xs text-muted-foreground">Scanning detections and anomalies…</div>}
      {rep.isError && <div className="text-xs text-destructive">{(rep.error as Error).message}</div>}

      {r && (
        <div className="space-y-4 text-xs">
          {/* Missing evidence #1: primary_county stale */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              County distribution · last {r.window_days}d · {r.detections_used.toLocaleString()} detections
            </div>
            {r.county_breakdown.length === 0 ? (
              <div className="text-muted-foreground italic">No county data on file for this subject.</div>
            ) : (
              <div className="border border-border/40">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
                    <tr>
                      <th className="text-left py-1 px-2">County</th>
                      <th className="text-right py-1 px-2">Detections</th>
                      <th className="text-right py-1 px-2">Low-Alt</th>
                      <th className="text-right py-1 px-2">%</th>
                      <th className="text-left py-1 px-2">Header</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.county_breakdown.map((b) => {
                      const isCurrent = b.county.toUpperCase() === (r.primary_county ?? "").toUpperCase();
                      return (
                        <tr key={b.county} className="border-t border-border/40">
                          <td className="py-1 px-2 font-mono">{b.county}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{b.n.toLocaleString()}</td>
                          <td className="py-1 px-2 text-right tabular-nums text-destructive">{b.low_alt.toLocaleString()}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{b.pct}%</td>
                          <td className="py-1 px-2">
                            {isCurrent ? (
                              <span className="text-[10px] neon-text-green">PRIMARY</span>
                            ) : (
                              <button
                                disabled={apply.isPending}
                                onClick={() => apply.mutate({ newPrimaryCounty: b.county })}
                                className="text-[10px] uppercase tracking-widest border border-accent text-accent px-2 py-0.5 hover:bg-accent/10 disabled:opacity-50"
                              >
                                Set primary
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {r.primary_county_stale && r.suggested_primary_county && (
              <div className="mt-2 border border-primary/40 bg-primary/5 p-2 rounded-sm text-[11px]">
                Case header lists <span className="font-mono neon-text-orange">{r.primary_county ?? "—"}</span> as the
                primary county, but the top-activity county over the last {r.window_days} days is{" "}
                <span className="font-mono neon-text-green">{r.suggested_primary_county}</span>
                {r.additional_counties.length > 0 && (
                  <> · significant additional activity in <span className="font-mono">{r.additional_counties.join(", ")}</span></>
                )}
                .
              </div>
            )}
          </div>

          {/* Weakness #1: ML pipeline score = 0 */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              ML anomaly rollup · last {r.window_days}d
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Anomaly events" value={r.anomaly_total.toLocaleString()} tone="orange" />
              <Stat label="Avg anomaly score" value={r.anomaly_score_avg.toFixed(3)} tone="orange" />
              <Stat label="Max anomaly score" value={r.anomaly_score_max.toFixed(3)} tone="orange" />
              <Stat label="Anomaly types" value={r.anomaly_breakdown.length} />
            </div>
            {r.anomaly_breakdown.length > 0 && (
              <div className="mt-2 border border-border/40">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
                    <tr>
                      <th className="text-left py-1 px-2">Anomaly Type</th>
                      <th className="text-right py-1 px-2">Events</th>
                      <th className="text-right py-1 px-2">Avg Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.anomaly_breakdown.map((a) => (
                      <tr key={a.anomaly_type} className="border-t border-border/40">
                        <td className="py-1 px-2 font-mono">{a.anomaly_type}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{a.n.toLocaleString()}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{a.avg_score.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.anomaly_total > 0 && (
              <button
                disabled={apply.isPending}
                onClick={() =>
                  apply.mutate({
                    mlScoreNote: `${r.anomaly_total} anomaly events (avg ${r.anomaly_score_avg.toFixed(3)}, max ${r.anomaly_score_max.toFixed(3)}) across ${r.anomaly_breakdown.length} type(s) — closes "ML score = 0" weakness.`,
                  })
                }
                className="mt-2 text-[10px] uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent/10 disabled:opacity-50"
              >
                Pin ML rollup into reviewer notes
              </button>
            )}
          </div>

          {apply.isError && (
            <div className="text-xs text-destructive">{(apply.error as Error).message}</div>
          )}
          {apply.isSuccess && (
            <div className="text-xs neon-text-green">✔ Case updated.</div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "orange" }) {
  return (
    <div className="border border-border/40 p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg tabular-nums font-bold ${tone === "orange" ? "neon-text-orange" : "neon-text-green"}`}>{value}</div>
    </div>
  );
}

function MissionList({ items }: { items?: Array<{ type: string; confidence: number; rationale: string }> }) {
  if (!items?.length) return null;
  const tone = (t: string) =>
    t === "SURVEILLANCE" || t === "PURSUIT" ? "border-destructive/50 text-destructive"
    : t === "SEARCH_RESCUE" || t === "MEDEVAC" ? "border-accent/60 text-accent"
    : t === "TRAINING" || t === "TRANSIT" ? "border-primary/50 text-primary"
    : "border-muted-foreground/40 text-muted-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest mb-1 neon-text-orange">Mission Type Estimates</div>
      <ul className="space-y-1">
        {items.map((m, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border rounded-sm shrink-0 ${tone(m.type)}`}>
              {m.type.replace("_", " ")}
            </span>
            <span className="text-muted-foreground shrink-0">{m.confidence}%</span>
            <span className="text-foreground/80">{m.rationale}</span>
          </li>
        ))}
      </ul>
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

// ============================================================
// CONVERGENCE WINDOW — subject vs specific proxies within ±N min
// ============================================================
function ConvergenceWindowPanel({
  subjectReg,
  subjectIcao,
}: {
  subjectReg: string | null;
  subjectIcao: string | null;
}) {
  const [proxiesRaw, setProxiesRaw] = useState("N528AM, N229AM, N916HT, N74FF");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [windowMin, setWindowMin] = useState(5);
  const [ran, setRan] = useState(0);

  const proxies = proxiesRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  const q = useQuery({
    queryKey: ["convergence-window", subjectReg, subjectIcao, date, proxies.join(","), windowMin, ran],
    queryFn: () =>
      getConvergenceWindow({
        data: {
          subjectReg,
          subjectIcao,
          date: date || null,
          proxies,
          windowMin,
        },
      }),
    enabled: ran > 0,
  });

  return (
    <section className="panel scanline p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="size-4 neon-text-orange" />
        <div className="text-xs uppercase tracking-widest neon-text-orange">
          Convergence Window
        </div>
        <span className="text-[10px] text-muted-foreground">
          subject {subjectReg ?? subjectIcao ?? "—"} vs proxies · ±{windowMin} min
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_100px_auto] gap-2 mb-3">
        <input
          value={proxiesRaw}
          onChange={(e) => setProxiesRaw(e.target.value)}
          placeholder="Proxy registrations (comma-separated) e.g. N528AM, N229AM"
          className="bg-secondary/40 border border-border px-2 py-1.5 text-xs font-mono"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-secondary/40 border border-border px-2 py-1.5 text-xs"
        />
        <input
          type="number"
          min={1}
          max={60}
          value={windowMin}
          onChange={(e) => setWindowMin(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
          className="bg-secondary/40 border border-border px-2 py-1.5 text-xs tabular-nums"
        />
        <button
          onClick={() => setRan((n) => n + 1)}
          disabled={q.isFetching || proxies.length === 0 || (!subjectReg && !subjectIcao)}
          className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm disabled:opacity-50 inline-flex items-center gap-2"
        >
          {q.isFetching ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
          Run
        </button>
      </div>

      {q.isError && (
        <div className="text-xs text-destructive">{(q.error as Error)?.message}</div>
      )}

      {q.data && (
        <div className="overflow-x-auto border border-border/40">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
              <tr>
                <th className="text-left py-2 px-3">Local Time</th>
                <th className="text-left py-2 px-3">Subject</th>
                <th className="text-right py-2 px-3">Alt (ft)</th>
                <th className="text-left py-2 px-3">Proxy</th>
                <th className="text-right py-2 px-3">Alt (ft)</th>
                <th className="text-right py-2 px-3">Δt (s)</th>
                <th className="text-right py-2 px-3">Dist (km)</th>
                <th className="text-left py-2 px-3">Proxy Anomaly</th>
                <th className="text-left py-2 px-3">County</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r, i) => (
                <tr key={i} className="border-t border-border/40 hover:bg-secondary/30">
                  <td className="py-2 px-3 tabular-nums whitespace-nowrap text-muted-foreground">
                    {new Date(r.local_time).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono neon-text-orange">{r.subject_reg ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.subject_altitude_ft?.toLocaleString() ?? "—"}</td>
                  <td className="py-2 px-3 font-mono neon-text-green">{r.proxy_reg ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.proxy_altitude_ft?.toLocaleString() ?? "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.dt_sec}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.dist_km?.toFixed(2) ?? "—"}</td>
                  <td className="py-2 px-3 text-destructive">{r.proxy_anomaly ?? "—"}</td>
                  <td className="py-2 px-3 text-muted-foreground">{r.county ?? "—"}</td>
                </tr>
              ))}
              {q.data.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">No convergences in this window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!q.data && !q.isFetching && (
        <div className="text-[11px] text-muted-foreground">
          Enter proxy registrations and click <span className="neon-text-orange">Run</span> to find every moment the subject and a proxy were airborne within ±{windowMin} minutes.
        </div>
      )}
    </section>
  );
}

// ============================================================
// CASE FILES — attach PDFs/DOCX/TXT as evidence documents
// (ingests into doctrine library + links to this case)
// ============================================================
const CASE_CLASSIFICATIONS = [
  { value: "EVIDENCE", label: "Evidence" },
  { value: "REPORT", label: "Watchtower Report" },
  { value: "POLICY", label: "Agency Policy" },
  { value: "REGULATION", label: "Regulation / Statute" },
  { value: "DOCTRINE", label: "Constitutional" },
  { value: "REFERENCE", label: "Reference" },
] as const;

function RelatedAircraftPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [days, setDays] = useState(30);
  const attach = useMutation({
    mutationFn: () =>
      attachAircraftToCase({
        data: {
          caseId,
          days,
          identifiers: input
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["case-evidence", caseId] });
    },
  });

  return (
    <section className="panel scanline p-5">
      <div className="text-xs uppercase tracking-widest neon-text-orange mb-2 flex items-center gap-2">
        <Users className="size-4" /> Add Related Aircraft to Case
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Attach detections from other tails in this operator's fleet (e.g. <code>N912KC, N597E</code>).
        Accepts registrations (with or without N) or 6-char ICAO hex, comma/space separated.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="N912KC, N597E, aca2b4"
          className="flex-1 min-w-64 bg-secondary/40 border border-border rounded-sm px-3 py-2 text-sm font-mono"
        />
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          Days
          <input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 30)}
            className="w-16 bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs"
          />
        </label>
        <button
          onClick={() => attach.mutate()}
          disabled={attach.isPending || !input.trim()}
          className="inline-flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm disabled:opacity-50"
        >
          {attach.isPending ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
          Attach
        </button>
      </div>
      {attach.data && attach.data.ok && (
        <div className="mt-3 text-xs neon-text-green">
          ✔ Attached {attach.data.attached} detections across {attach.data.aircraft} aircraft
          (case total: {attach.data.total}).
          {attach.data.unresolved.length > 0 && (
            <div className="text-destructive mt-1">
              Could not resolve: {attach.data.unresolved.join(", ")}
            </div>
          )}
        </div>
      )}
      {attach.data && !attach.data.ok && (
        <div className="mt-3 text-xs text-destructive">
          {attach.data.error}
          {attach.data.unresolved?.length > 0 && ` · unresolved: ${attach.data.unresolved.join(", ")}`}
        </div>
      )}
      {attach.isError && (
        <div className="mt-3 text-xs text-destructive">{(attach.error as Error).message}</div>
      )}
    </section>
  );
}

function CaseFilesPanel({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const ingestFn = useServerFn(ingestDoctrine);
  const unlinkFn = useServerFn(unlinkDoctrineFromCase);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [classification, setClassification] = useState<string>("EVIDENCE");

  const docsQ = useQuery({
    queryKey: ["case-doctrine", caseId],
    queryFn: () => listCaseDoctrine({ data: { caseId } }),
  });

  const ingestMutation = useMutation({
    mutationFn: async (file: File) => {
      setErr(null);
      setBusy(`Reading ${file.name}…`);
      const { text, pages } = await extractText(file);
      if (!text.trim()) throw new Error("No text extracted from document");
      setBusy(`Hashing ${file.name}…`);
      const sha = await sha256Hex(new TextEncoder().encode(text).buffer);
      setBusy(`Attaching ${file.name}…`);
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      return ingestFn({
        data: {
          title,
          sourceType: file.type || "application/octet-stream",
          classification,
          originalFilename: file.name,
          sha256: sha,
          byteSize: file.size,
          pageCount: pages,
          content: text,
          linkCaseId: caseId,
        },
      });
    },
    onSuccess: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["case-doctrine", caseId] });
      qc.invalidateQueries({ queryKey: ["doctrine"] });
    },
    onError: (e: Error) => {
      setBusy(null);
      setErr(e.message);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (doctrineId: string) =>
      unlinkFn({ data: { caseId, doctrineId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case-doctrine", caseId] }),
  });

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      for (const f of Array.from(files)) {
        try {
          await ingestMutation.mutateAsync(f);
        } catch {
          break;
        }
      }
    },
    [ingestMutation],
  );

  const list = docsQ.data ?? [];

  return (
    <section
      className="panel p-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
            <Paperclip className="size-4" /> Case Files ({list.length})
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Drop PDFs, DOCX, or TXT here to attach as evidence. Files are SHA-256 sealed and
            fed to Josiah as context for this case.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className="bg-secondary/30 border border-border rounded-sm text-[11px] px-2 py-1 uppercase tracking-widest"
          >
            {CASE_CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-widest rounded-sm border border-accent text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
            Attach File
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      </div>

      {busy && (
        <div className="text-[11px] text-accent flex items-center gap-2 mb-2">
          <Loader2 className="size-3 animate-spin" /> {busy}
        </div>
      )}
      {err && (
        <div className="text-[11px] border border-primary text-primary rounded-sm px-2 py-1 mb-2 flex items-center justify-between">
          <span>⚠ {err}</span>
          <button onClick={() => setErr(null)}><X className="size-3" /></button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="border border-dashed border-border/50 rounded-sm p-6 text-center text-[11px] text-muted-foreground">
          <Upload className="size-5 mx-auto mb-2 opacity-40" />
          Drop evidence files here (PDF, DOCX, TXT) or click Attach File above.
        </div>
      ) : (
        <ul className="space-y-1">
          {list.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to="/doctrine"
                  search={{ id: d.id }}
                  className="font-medium truncate hover:text-accent block"
                  title={d.title}
                >
                  {d.title}
                </Link>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 flex items-center gap-2">
                  <span className="text-accent">{d.classification}</span>
                  {d.page_count && <span>{d.page_count}p</span>}
                  <span>{Math.round((d.char_count ?? 0) / 1000)}k chars</span>
                  <span className="font-mono normal-case tracking-normal">
                    {d.sha256.slice(0, 10)}…
                  </span>
                  <span>{new Date(d.linked_at).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Unlink "${d.title}" from this case?`)) unlinkMutation.mutate(d.id);
                }}
                disabled={unlinkMutation.isPending}
                className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                title="Unlink from case"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// OSINT TAB — open-source intelligence enrichment
// ============================================================
const SOURCE_LABELS: Record<string, { label: string; icon: typeof Globe; tone: string }> = {
  OPENSKY: { label: "Flight History (OpenSky)", icon: Radar, tone: "text-accent" },
  OPENCORPORATES: { label: "Ownership (OpenCorporates)", icon: User, tone: "neon-text-orange" },
  OPENSANCTIONS: { label: "Watchlist (OpenSanctions)", icon: ShieldCheck, tone: "text-destructive" },
  OSM_OVERPASS: { label: "Ground-Truth (OpenStreetMap)", icon: Globe, tone: "neon-text-green" },
  RAPIDAPI_ADSB: { label: "Deep ADS-B (RapidAPI)", icon: Radar, tone: "text-accent" },
  WAYBACK: { label: "Wayback Archives", icon: Archive, tone: "text-muted-foreground" },
};

function OsintTab({
  c,
  caseId,
}: {
  c: { subject_icao: string | null; subject_reg: string | null; subject_owner: string | null };
  caseId: string;
}) {
  const qc = useQueryClient();
  const osintQ = useQuery({
    queryKey: ["osint", caseId],
    queryFn: () => getCaseOsint({ data: { caseId } }),
  });

  const enrich = useMutation({
    mutationFn: () => enrichCase({ data: { caseId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["osint", caseId] }),
  });

  const deep = useMutation({
    mutationFn: (hex: string) => deepAdsbPull({ data: { caseId, hex } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["osint", caseId] }),
  });

  const archive = useMutation({
    mutationFn: (vars: { url: string; findingId?: string }) =>
      archiveUrl({ data: { caseId, ...vars } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["osint", caseId] }),
  });

  const findings = osintQ.data?.findings ?? [];
  const counts = osintQ.data?.counts ?? [];
  const grouped = findings.reduce<Record<string, typeof findings>>((acc, f) => {
    (acc[f.source] ||= []).push(f);
    return acc;
  }, {});
  const totalFlags = counts.reduce((s, c2) => s + (c2.flags ?? 0), 0);

  return (
    <div className="space-y-4">
      <section className="panel scanline p-5 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
            <Globe className="size-4" /> OSINT Enrichment
          </div>
          <p className="text-xs text-muted-foreground">
            Pulls open-source intelligence for this case: OpenSky flight history, OpenCorporates
            ownership, OpenSanctions watchlist screening, and OpenStreetMap ground-truth for the
            lowest-altitude passes. Every result is SHA-256 sealed, timestamped, and available to
            Josiah as legal-grade context.
          </p>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            {counts.length === 0 && !osintQ.isLoading && (
              <span className="text-muted-foreground">No OSINT run yet.</span>
            )}
            {counts.map((cc) => (
              <span
                key={cc.source}
                className={`px-2 py-0.5 border ${cc.flags > 0 ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}
              >
                {SOURCE_LABELS[cc.source]?.label ?? cc.source}: {cc.n}
                {cc.flags > 0 && ` · ${cc.flags} flag`}
              </span>
            ))}
            {totalFlags > 0 && (
              <span className="px-2 py-0.5 border border-destructive text-destructive font-bold">
                {totalFlags} RED FLAG{totalFlags === 1 ? "" : "S"}
              </span>
            )}
          </div>
          {enrich.data && enrich.data.errors.length > 0 && (
            <div className="text-[11px] text-destructive">
              Errors: {enrich.data.errors.join(" · ")}
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col gap-2">
          <button
            onClick={() => enrich.mutate()}
            disabled={enrich.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm disabled:opacity-50"
          >
            {enrich.isPending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            {enrich.isPending ? "Enriching…" : "Run Free Enrichers"}
          </button>
          {c.subject_icao && (
            <button
              onClick={() => deep.mutate(c.subject_icao!)}
              disabled={deep.isPending}
              className="inline-flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest border border-accent text-accent hover:bg-accent/10 rounded-sm disabled:opacity-50"
              title="Uses your RapidAPI key"
            >
              {deep.isPending ? <Loader2 className="size-3 animate-spin" /> : <Radar className="size-3" />}
              Deep ADS-B Pull
            </button>
          )}
        </div>
      </section>

      {osintQ.isLoading && (
        <div className="panel p-5 text-xs text-muted-foreground">Loading OSINT findings…</div>
      )}

      {!osintQ.isLoading && findings.length === 0 && (
        <div className="panel p-8 text-center text-xs text-muted-foreground">
          <Globe className="size-8 mx-auto mb-3 opacity-40" />
          No OSINT findings yet for this case. Click <span className="neon-text-orange">Run Free Enrichers</span> above to
          pull OpenSky, OpenCorporates, OpenSanctions, and ground-truth data.
          {!c.subject_icao && !c.subject_owner && (
            <div className="mt-2 text-destructive">Case needs a subject ICAO or owner to enrich.</div>
          )}
        </div>
      )}

      {Object.entries(grouped).map(([source, items]) => {
        const meta = SOURCE_LABELS[source] ?? { label: source, icon: Globe, tone: "" };
        const Icon = meta.icon;
        return (
          <section key={source} className="panel p-5">
            <div className={`text-xs uppercase tracking-widest mb-3 flex items-center gap-2 ${meta.tone}`}>
              <Icon className="size-4" /> {meta.label} ({items.length})
            </div>
            <ul className="space-y-3">
              {items.map((f) => (
                <li
                  key={f.id}
                  className={`border rounded-sm p-3 text-xs space-y-1 ${
                    f.red_flag ? "border-destructive/50 bg-destructive/5" : "border-border/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {f.red_flag && (
                          <span className="text-[9px] uppercase tracking-widest px-1 border border-destructive text-destructive">
                            RED FLAG
                          </span>
                        )}
                        <span className="truncate">{f.title ?? f.subject}</span>
                      </div>
                      <p className="text-muted-foreground mt-1">{f.summary}</p>
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 flex flex-wrap gap-x-3">
                        <span>subject: {f.subject}</span>
                        <span>sha: {f.sha256.slice(0, 12)}…</span>
                        <span>{new Date(f.retrieved_at).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {f.source_url && (
                        <a
                          href={f.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] uppercase tracking-widest text-accent hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="size-3" /> Source
                        </a>
                      )}
                      {f.wayback_url ? (
                        <a
                          href={f.wayback_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] uppercase tracking-widest neon-text-green hover:underline inline-flex items-center gap-1"
                        >
                          <Archive className="size-3" /> Archived
                        </a>
                      ) : f.source_url ? (
                        <button
                          onClick={() =>
                            archive.mutate({ url: f.source_url!, findingId: f.id })
                          }
                          disabled={archive.isPending}
                          className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          {archive.isPending ? <Loader2 className="size-3 animate-spin" /> : <Archive className="size-3" />}
                          Archive to Wayback
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}


