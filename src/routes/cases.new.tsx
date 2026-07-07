import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, FolderPlus, Loader2, Radar, Plane, ShieldAlert } from "lucide-react";
import { createCase, getFleetInvestigation, promoteFleetToCase } from "@/lib/casework.functions";

export const Route = createFileRoute("/cases/new")({
  head: () => ({ meta: [{ title: "New Case // Watchtower" }] }),
  component: NewCase,
});

function NewCase() {
  return (
    <div className="p-6 max-w-5xl space-y-4">
      <Link to="/cases" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2">
        <ArrowLeft className="size-3" /> Back to cases
      </Link>
      <FleetInvestigator />
      <SingleSubject />
    </div>
  );
}

// ---------- FLEET INVESTIGATOR ----------
function FleetInvestigator() {
  const nav = useNavigate();
  const [owner, setOwner] = useState("AIR METHODS");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [severity, setSeverity] = useState("HIGH");
  const [notes, setNotes] = useState("");

  const investigation = useQuery({
    queryKey: ["fleet-investigation", submitted],
    queryFn: () => getFleetInvestigation({ data: { owner: submitted! } }),
    enabled: !!submitted,
  });

  const promote = useMutation({
    mutationFn: () =>
      promoteFleetToCase({
        data: {
          owner: submitted ?? owner,
          icao_hexes: Array.from(selected),
          severity,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (r) => {
      if (r?.case_id) nav({ to: "/cases/$caseId", params: { caseId: r.case_id } });
    },
  });

  const runQuery = () => {
    if (!owner.trim()) return;
    setSelected(new Set());
    setSubmitted(owner.trim());
  };

  const toggle = (hex: string) => {
    const next = new Set(selected);
    if (next.has(hex)) next.delete(hex);
    else next.add(hex);
    setSelected(next);
  };

  const selectAllActive = () => {
    const list = investigation.data?.aircraft ?? [];
    setSelected(new Set(list.filter((a) => a.detections_30d > 0 && !a.has_open_case).map((a) => a.icao_hex)));
  };

  const data = investigation.data;

  return (
    <section className="panel p-5 space-y-4">
      <header>
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <Radar className="size-4" /> Fleet Cover Investigator
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Search an operator or cover-LLC (e.g. <span className="font-mono">AIR METHODS</span>, <span className="font-mono">ALF IX LLC</span>, <span className="font-mono">WINGSLEASING</span>).
          Review every registered tail, then promote the whole fleet to a single case with all recent detections attached.
        </p>
      </header>

      <div className="flex gap-2">
        <input
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runQuery()}
          placeholder="Operator / registered owner name"
          className="flex-1 bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none"
        />
        <button
          onClick={runQuery}
          disabled={investigation.isFetching}
          className="px-4 py-1.5 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm disabled:opacity-50 inline-flex items-center gap-2"
        >
          {investigation.isFetching ? <Loader2 className="size-3 animate-spin" /> : <Radar className="size-3" />}
          Investigate
        </button>
      </div>

      {investigation.isError && (
        <div className="text-xs text-destructive">{(investigation.error as Error)?.message}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <Stat label="Aircraft" value={data.totals.aircraft_count} />
            <Stat label="Detections 30d" value={data.totals.detections_30d} />
            <Stat label="Low-Alt 30d" value={data.totals.low_alt_30d} tone="orange" />
            <Stat label="Anomalies 30d" value={data.totals.anomalies_30d} tone="orange" />
            <Stat label="Counties" value={data.totals.counties.slice(0, 3).join(", ") || "—"} />
          </div>

          {data.matched_owner_labels.length > 0 && (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Matched owner labels: <span className="text-accent">{data.matched_owner_labels.join(" · ")}</span>
            </div>
          )}

          {data.aircraft.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No aircraft matched. Try a shorter or alternate spelling.</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {selected.size} selected · {data.aircraft.filter((a) => a.has_open_case).length} already in an open case
                </div>
                <div className="flex gap-2">
                  <button onClick={selectAllActive} className="text-[10px] uppercase tracking-widest px-2 py-1 border border-border rounded-sm hover:border-accent">
                    Select active (no case)
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-[10px] uppercase tracking-widest px-2 py-1 border border-border rounded-sm hover:border-accent">
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-96 overflow-auto border border-border rounded-sm">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40 sticky top-0">
                    <tr>
                      <th className="text-left py-2 px-3 w-8"></th>
                      <th className="text-left py-2 px-3">Reg</th>
                      <th className="text-left py-2 px-3">ICAO</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-right py-2 px-3">Det 30d</th>
                      <th className="text-right py-2 px-3">Low-Alt</th>
                      <th className="text-right py-2 px-3">Anom</th>
                      <th className="text-left py-2 px-3">Top County</th>
                      <th className="text-left py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.aircraft.map((a) => (
                      <tr key={a.icao_hex} className="border-t border-border/40 hover:bg-secondary/30">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={selected.has(a.icao_hex)}
                            onChange={() => toggle(a.icao_hex)}
                            disabled={a.has_open_case}
                          />
                        </td>
                        <td className="py-2 px-3 font-mono">{a.registration ?? "—"}</td>
                        <td className="py-2 px-3 font-mono neon-text-green">{a.icao_hex}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          {[a.aircraft_mfr, a.aircraft_model].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{a.detections_30d.toLocaleString()}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${a.low_alt_30d > 0 ? "text-primary" : "text-muted-foreground"}`}>{a.low_alt_30d}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${a.anomalies_30d > 0 ? "text-primary" : "text-muted-foreground"}`}>{a.anomalies_30d}</td>
                        <td className="py-2 px-3 text-muted-foreground">{a.top_county ?? "—"}</td>
                        <td className="py-2 px-3">
                          {a.has_open_case ? (
                            <Link to="/cases/$caseId" params={{ caseId: a.open_case_id! }} className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 border border-accent text-accent rounded-sm">
                              {a.open_case_id}
                            </Link>
                          ) : (
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">available</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid md:grid-cols-3 gap-3 pt-2 border-t border-border/40">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                    className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm mt-1"
                  >
                    {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Fleet Case Notes</label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Why is this fleet being promoted? (e.g. persistent 91.119 violations across N224AM/N528AM)"
                    className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm mt-1"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  disabled={promote.isPending || selected.size === 0}
                  onClick={() => promote.mutate()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/80 rounded-sm disabled:opacity-50"
                >
                  {promote.isPending ? <Loader2 className="size-3 animate-spin" /> : <ShieldAlert className="size-3" />}
                  Promote {selected.size} aircraft → Fleet Case
                </button>
                {promote.isError && <span className="text-xs text-destructive">{(promote.error as Error)?.message}</span>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "orange" }) {
  return (
    <div className="border border-border rounded-sm p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg tabular-nums ${tone === "orange" ? "neon-text-orange" : ""}`}>{value}</div>
    </div>
  );
}

// ---------- SINGLE-SUBJECT (original manual create) ----------
function SingleSubject() {
  const nav = useNavigate();
  const [icao, setIcao] = useState("");
  const [reg, setReg] = useState("");
  const [owner, setOwner] = useState("");
  const [county, setCounty] = useState("");
  const [caseType, setCaseType] = useState("LOW_ALTITUDE");
  const [severity, setSeverity] = useState("MEDIUM");
  const [notes, setNotes] = useState("");

  const m = useMutation({
    mutationFn: () =>
      createCase({
        data: {
          icao: icao.trim().toLowerCase() || null,
          reg: reg.trim().toUpperCase() || null,
          owner: owner.trim() || null,
          county: county.trim() || null,
          case_type: caseType,
          severity,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (r) => {
      if (r?.case_id) nav({ to: "/cases/$caseId", params: { caseId: r.case_id } });
    },
  });

  return (
    <section className="panel p-5 space-y-4">
      <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
        <Plane className="size-4" /> Single-Subject Case
      </div>
      <p className="text-xs text-muted-foreground">
        Provide either an ICAO hex or N-number. Case will start in DRAFT — investigate and verify before promoting.
      </p>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="ICAO Hex" value={icao} onChange={setIcao} placeholder="ae1234" mono />
        <Field label="N-Number / Registration" value={reg} onChange={setReg} placeholder="N913KC" mono />
        <Field label="Registered Owner" value={owner} onChange={setOwner} placeholder="(optional)" />
        <Field label="Primary County" value={county} onChange={setCounty} placeholder="(optional)" />
        <Select
          label="Case Type"
          value={caseType}
          onChange={setCaseType}
          options={["LOW_ALTITUDE", "SPOOFING", "COORDINATION", "INCURSION", "REPEAT_OFFENDER", "MANUAL"]}
        />
        <Select label="Severity" value={severity} onChange={setSeverity} options={["LOW", "MEDIUM", "HIGH", "CRITICAL"]} />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Initial Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm font-mono focus:border-accent outline-none mt-1"
          placeholder="Why are we opening this? What triggered it?"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          disabled={m.isPending || (!icao && !reg)}
          onClick={() => m.mutate()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm disabled:opacity-50"
        >
          {m.isPending ? <Loader2 className="size-3 animate-spin" /> : <FolderPlus className="size-3" />}
          Open Case
        </button>
        {m.isError && <span className="text-xs text-destructive">{(m.error as Error)?.message}</span>}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none mt-1 ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input/50 border border-border rounded-sm px-2 py-1.5 text-sm focus:border-accent outline-none mt-1"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
