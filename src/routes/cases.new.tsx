import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, FolderPlus, Loader2 } from "lucide-react";
import { createCase } from "@/lib/casework.functions";

export const Route = createFileRoute("/cases/new")({
  head: () => ({ meta: [{ title: "New Case // Watchtower" }] }),
  component: NewCase,
});

function NewCase() {
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
    <div className="p-6 max-w-3xl space-y-4">
      <Link to="/cases" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-2">
        <ArrowLeft className="size-3" /> Back to cases
      </Link>
      <header className="panel p-5">
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <FolderPlus className="size-4" /> Open New Case
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Provide either an ICAO hex or N-number. Case will start in DRAFT — investigate and verify before promoting.
        </p>
      </header>

      <section className="panel p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="ICAO Hex" value={icao} onChange={setIcao} placeholder="ae1234" mono />
          <Field label="N-Number / Registration" value={reg} onChange={setReg} placeholder="N913KC" mono />
          <Field label="Registered Owner" value={owner} onChange={setOwner} placeholder="(optional, autofill on dossier)" />
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
            rows={4}
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
    </div>
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
