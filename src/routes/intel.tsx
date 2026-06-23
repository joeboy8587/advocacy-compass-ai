import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Brain, Send, Loader2, Sparkles, FileText } from "lucide-react";
import { askInvestigator, draftCaseBrief } from "@/lib/ai.functions";

export const Route = createFileRoute("/intel")({
  head: () => ({ meta: [{ title: "AI Investigator // Watchtower" }] }),
  component: Intel,
});

type Msg = { role: "user" | "assistant"; content: string };

const QUICK_PROMPTS = [
  "What patterns are most concerning in the last 7 days?",
  "Which registered owner has the most §91.119 low-altitude violations?",
  "Summarize all active cases in plain language.",
  "Identify any military aircraft loitering over residential counties this week.",
  "What are the top 3 advocacy talking points based on this corpus?",
];

const AUDIENCES = [
  { id: "PUBLIC", label: "Public Report" },
  { id: "LEGAL", label: "Legal Exhibit" },
  { id: "LEGISLATIVE", label: "Legislative Brief" },
  { id: "JOURNALIST", label: "Journalist Response" },
  { id: "COMMUNITY", label: "Community Alert" },
] as const;

function Intel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [caseId, setCaseId] = useState("");

  const ask = useMutation({
    mutationFn: (q: string) => askInvestigator({ data: { question: q, caseId: caseId || undefined } }),
    onSuccess: (r) => {
      setMessages((m) => [...m, { role: "assistant", content: r.ok ? r.text : `⚠ ${r.error}` }]);
    },
  });

  const draft = useMutation({
    mutationFn: (audience: (typeof AUDIENCES)[number]["id"]) =>
      draftCaseBrief({ data: { caseId, audience } }),
    onSuccess: (r, audience) => {
      setMessages((m) => [
        ...m,
        { role: "user", content: `Draft ${audience} brief for case ${caseId}` },
        { role: "assistant", content: r.ok ? r.text : `⚠ ${r.error}` },
      ]);
    },
  });

  const send = (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    ask.mutate(q);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl neon-text-orange flex items-center gap-3">
          <Brain className="size-6" /> AI Investigator
        </h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          Plain-English interrogation over 88M rows of public ADS-B + FAA data
        </p>
      </header>

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
              className="px-3 py-1.5 text-[11px] uppercase tracking-widest border border-border rounded-sm hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {a.label}
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
              <Sparkles className="size-10 mx-auto neon-text-green" />
              <div className="text-xs text-muted-foreground uppercase tracking-widest">
                Ask anything — quick starts:
              </div>
              <div className="flex flex-col gap-2 max-w-xl mx-auto">
                {QUICK_PROMPTS.map((p) => (
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
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] p-3 rounded-sm text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent/15 border border-accent/40"
                    : "panel font-mono text-xs"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {ask.isPending && (
            <div className="flex justify-start">
              <div className="panel p-3 text-xs flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Investigating corpus…
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
            placeholder="Ask the corpus a question…"
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
        AI drafts are advisory and must be human-approved before publication. All data is from public sources.
      </p>
    </div>
  );
}
