import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Send, Loader2, FileText, Scale, Flame } from "lucide-react";
import { askInvestigator, draftCaseBrief } from "@/lib/ai.functions";

export const Route = createFileRoute("/intel")({
  head: () => ({ meta: [{ title: "Josiah // Watchtower Investigator" }] }),
  component: Intel,
});

type Mode = "AUTO" | "LEGAL" | "SNARK";
type Msg = { role: "user" | "assistant"; content: string; mode?: string };

const QUICK_PROMPTS_SNARK = [
  "Roast the top 3 shell-company operators in the corpus.",
  "Tear apart KCSO's last 7 days of low-altitude activity.",
  "Which operator has the most §91.119 violations and why is the FAA still silent?",
  "Tactical brief on convergence locks recorded this week.",
];

const QUICK_PROMPTS_LEGAL = [
  "Draft an executive summary of all confirmed convergence locks (cite r and p).",
  "List all aircraft that committed altitude suppression events in the last 30 days.",
  "Prepare FOIA tasking for top military aircraft loitering over residential counties.",
  "Summarize active cases with CFR citations and Bradford-Hill scores.",
];

const AUDIENCES = [
  { id: "SNARK", label: "War-Room Snark", icon: Flame },
  { id: "PUBLIC", label: "Public Report", icon: FileText },
  { id: "LEGAL", label: "Legal Exhibit", icon: Scale },
  { id: "LEGISLATIVE", label: "Legislative Brief", icon: Scale },
  { id: "JOURNALIST", label: "Journalist Response", icon: FileText },
  { id: "COMMUNITY", label: "Community Alert", icon: FileText },
] as const;

function Intel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [caseId, setCaseId] = useState("");
  const [mode, setMode] = useState<Mode>("AUTO");

  const ask = useMutation({
    mutationFn: (q: string) =>
      askInvestigator({ data: { question: q, caseId: caseId || undefined, mode } }),
    onSuccess: (r) => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: r.ok ? r.text : `⚠ ${r.error}`,
          mode: r.mode,
        },
      ]);
    },
  });

  const draft = useMutation({
    mutationFn: (audience: (typeof AUDIENCES)[number]["id"]) =>
      draftCaseBrief({ data: { caseId, audience } }),
    onSuccess: (r, audience) => {
      setMessages((m) => [
        ...m,
        { role: "user", content: `Draft ${audience} brief for case ${caseId}` },
        {
          role: "assistant",
          content: r.ok ? r.text : `⚠ ${r.error}`,
          mode: r.ok ? r.mode : undefined,
        },
      ]);
    },
  });

  const send = (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    ask.mutate(q);
  };

  const prompts = mode === "LEGAL" ? QUICK_PROMPTS_LEGAL : QUICK_PROMPTS_SNARK;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl neon-text-orange flex items-center gap-3">
          <span className="font-mono">◢◤</span> JOSIAH
          <span className="text-xs text-muted-foreground tracking-widest uppercase">
            // Non-Biased ML Investigator · WTPR-NB-INV-002
          </span>
        </h1>
        <p className="text-xs text-muted-foreground">
          No biometrics. No feelings. No hedging. ADS-B telemetry, FAA registry, convergence locks, 14 CFR.
          Legal mode for the courtroom. Snark mode for the war room.
        </p>
      </header>

      {/* Mode selector */}
      <section className="panel p-3 flex items-center gap-2 text-xs">
        <span className="uppercase tracking-widest text-muted-foreground">Mode:</span>
        {(["AUTO", "SNARK", "LEGAL"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 rounded-sm border transition-all uppercase tracking-widest ${
              mode === m
                ? m === "LEGAL"
                  ? "border-primary text-primary bg-primary/10"
                  : m === "SNARK"
                    ? "border-destructive text-destructive bg-destructive/10"
                    : "border-accent text-accent bg-accent/10"
                : "border-border text-muted-foreground hover:border-accent"
            }`}
          >
            {m === "SNARK" && <Flame className="inline size-3 mr-1" />}
            {m === "LEGAL" && <Scale className="inline size-3 mr-1" />}
            {m}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Tip: prefix any prompt with <code className="text-accent">[LEGAL]</code> or{" "}
          <code className="text-destructive">[SNARK]</code> to force a mode.
        </span>
      </section>

      {/* Case binding + brief drafter */}
      <section className="panel p-4 space-y-3">
        <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
          <FileText className="size-4" /> Brief Drafter (optional case binding)
        </div>
        <input
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          placeholder="Case ID (e.g. WT-2026-001) — leave empty to ask corpus-wide"
          className="w-full bg-input/50 border border-border rounded-sm px-3 py-2 text-sm font-mono focus:border-accent outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              disabled={!caseId || draft.isPending}
              onClick={() => draft.mutate(a.id)}
              className={`px-3 py-1.5 text-[11px] uppercase tracking-widest border rounded-sm hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${
                a.id === "SNARK"
                  ? "border-destructive/50 text-destructive hover:border-destructive"
                  : "border-border hover:border-accent"
              }`}
            >
              <a.icon className="size-3" /> {a.label}
            </button>
          ))}
          {draft.isPending && <Loader2 className="size-4 animate-spin text-accent self-center" />}
        </div>
      </section>

      {/* Chat */}
      <section className="panel flex flex-col" style={{ minHeight: "50vh" }}>
        <div className="flex-1 p-4 space-y-4 overflow-auto">
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-4">
              <div className="font-mono text-3xl neon-text-orange">◢◤ JOSIAH ONLINE</div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest">
                {mode === "LEGAL"
                  ? "Legal mode active — citations, CFR, FOIA taskings"
                  : mode === "SNARK"
                    ? "Snark mode active — headline, roast, receipts, checkmate, tasking"
                    : "Auto mode — Josiah picks based on your prompt"}
              </div>
              <div className="flex flex-col gap-2 max-w-xl mx-auto">
                {prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="text-left text-xs panel p-3 hover:border-accent hover:text-accent transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] p-3 rounded-sm text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent/15 border border-accent/40"
                    : m.mode === "SNARK"
                      ? "panel border-destructive/40 font-mono text-xs"
                      : "panel font-mono text-xs"
                }`}
              >
                {m.role === "assistant" && m.mode && (
                  <div
                    className={`text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1 ${
                      m.mode === "SNARK" ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {m.mode === "SNARK" ? <Flame className="size-3" /> : <Scale className="size-3" />}
                    Josiah · {m.mode} mode
                  </div>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {ask.isPending && (
            <div className="flex justify-start">
              <div className="panel p-3 text-xs flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Josiah is working the corpus…
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-border p-3 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Josiah — try [SNARK] or [LEGAL] to force a mode…"
            className="flex-1 bg-input/50 border border-border rounded-sm px-3 py-2 text-sm focus:border-accent outline-none"
          />
          <button
            type="submit"
            disabled={ask.isPending || !input.trim()}
            className="px-4 py-2 text-xs uppercase tracking-widest bg-accent text-accent-foreground hover:bg-accent/80 rounded-sm disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Send className="size-3" /> Ask
          </button>
        </form>
      </section>

      <p className="text-[10px] text-muted-foreground text-center">
        Protocol WTPR-NB-INV-002 · No biometrics · No hedging · Convergence locks = ground truth ·
        All data from public sources (ADS-B, FAA registry, public filings, 14 CFR).
      </p>
    </div>
  );
}
