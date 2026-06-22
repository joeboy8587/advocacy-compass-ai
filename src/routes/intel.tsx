import { createFileRoute } from "@tanstack/react-router";
import { Brain, Sparkles } from "lucide-react";

export const Route = createFileRoute("/intel")({
  head: () => ({ meta: [{ title: "AI Investigator // Watchtower" }] }),
  component: Intel,
});

function Intel() {
  return (
    <div className="p-6 max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl neon-text-orange flex items-center gap-3">
          <Brain className="size-6" /> AI Investigator
        </h1>
        <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
          Natural-language interrogation of the surveillance corpus
        </p>
      </header>

      <div className="panel scanline p-6 text-center">
        <Sparkles className="size-10 mx-auto neon-text-green mb-3" />
        <div className="text-sm uppercase tracking-widest neon-text-green">Phase 3 — Coming next</div>
        <p className="text-xs text-muted-foreground mt-3 max-w-md mx-auto">
          Ask plain-English questions over your Neon corpus — "show me low-altitude repeat offenders in Sussex
          this week", "draft an advocacy brief from case WT-2025-014" — and the AI returns structured findings,
          chart-ready data, and publish-ready summaries. Wiring this up in the next turn.
        </p>
      </div>
    </div>
  );
}
