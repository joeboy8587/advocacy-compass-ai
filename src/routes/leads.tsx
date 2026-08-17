import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Brain, Loader2, Check, FolderPlus } from "lucide-react";
import { getMlLeadQueue, reviewMlLead } from "@/lib/profiler.functions";
import { LoadErrorPanel } from "@/components/LoadErrorPanel";

export const Route = createFileRoute("/leads")({
  head: () => ({
    meta: [
      { title: "ML Lead Queue // Watchtower" },
      { name: "description", content: "Aircraft the behaviour model flagged that the rule engine missed — worked one lead at a time." },
      { property: "og:title", content: "ML Lead Queue // Watchtower" },
      { property: "og:description", content: "Unworked behavioural leads from the Watchtower profiler, ranked by abnormality." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LeadsPage,
  errorComponent: ({ error, reset }) => (
    <LoadErrorPanel error={error} reset={reset} title="Lead queue didn't load" />
  ),
});

const FILTERS = [
  { key: "missed,new_signal", label: "Unworked leads" },
  { key: "missed", label: "Rules missed" },
  { key: "new_signal", label: "New signals" },
  { key: "agree", label: "Rules + model agree" },
] as const;

function LeadsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("missed,new_signal");
  const [includeReviewed, setIncludeReviewed] = useState(false);

  const q = useQuery({
    queryKey: ["ml-leads", status, includeReviewed],
    queryFn: () => getMlLeadQueue({ data: { status, includeReviewed, limit: 150 } }),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; reviewed: boolean; notes?: string }) => reviewMlLead({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ml-leads"] }),
  });

  const counts = q.data?.counts ?? [];

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <header>
        <h1 className="text-2xl neon-text-green flex items-center gap-2">
          <Brain className="size-6" /> ML Lead Queue
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
          Every aircraft here was flagged by the behaviour model but never picked up by the rule engine. Work the list
          top-down: the highest number is the aircraft flying least like everything else in the sky.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {counts.map((c) => (
          <div key={c.match_status} className="panel p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.match_status.replace("_", " ")}</div>
            <div className="text-xl neon-text-orange">{c.open.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">open of {c.n.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={`px-3 py-1.5 text-[10px] uppercase tracking-widest border rounded-sm ${
              status === f.key ? "border-accent text-accent" : "border-border text-muted-foreground hover:border-accent"
            }`}
          >
            {f.label}
          </button>
        ))}
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2 ml-2">
          <input type="checkbox" checked={includeReviewed} onChange={(e) => setIncludeReviewed(e.target.checked)} />
          Show already worked
        </label>
      </div>

      {q.isLoading && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Loading leads…
        </div>
      )}
      {q.isError && <div className="text-xs text-destructive">{(q.error as Error)?.message}</div>}
      {q.data?.leads.length === 0 && (
        <div className="panel p-6 text-sm text-muted-foreground">Nothing left in this queue — every lead has been worked.</div>
      )}

      <div className="space-y-2">
        {q.data?.leads.map((l) => (
          <div key={l.id} className="panel p-4 flex flex-col md:flex-row md:items-start gap-3 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm neon-text-orange">{l.registration ?? l.icao_hex}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{l.icao_hex}</span>
                <span className="text-[10px] uppercase tracking-widest border border-border px-2 py-0.5">{l.match_status.replace("_", " ")}</span>
                {l.reviewed && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">worked</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{l.owner ?? "Owner unknown"}</div>
              <p className="text-sm mt-1">{l.reason}</p>
              <div className="text-[11px] text-muted-foreground mt-1">
                {l.detections ? `${l.detections.toLocaleString()} detections on record · ` : ""}
                {l.evaluated_at ? `evaluated ${new Date(l.evaluated_at).toLocaleDateString()}` : ""}
                {l.notes ? ` · note: ${l.notes}` : ""}
              </div>
            </div>
            <div className="shrink-0 flex md:flex-col gap-2">
              <div className="text-2xl font-mono neon-text-green text-right">{l.profile_score ?? "—"}</div>
              {l.case_id ? (
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: l.case_id }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm"
                >
                  <FolderPlus className="size-3" /> Open case
                </Link>
              ) : (
                <Link
                  to="/cases/new"
                  search={{ icao: l.icao_hex } as never}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm"
                >
                  <FolderPlus className="size-3" /> Start case
                </Link>
              )}
              <button
                onClick={() => review.mutate({ id: l.id, reviewed: !l.reviewed, notes: l.reviewed ? undefined : "Dismissed as noise from lead queue" })}
                disabled={review.isPending}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-border rounded-sm hover:border-primary disabled:opacity-40"
              >
                <Check className="size-3" /> {l.reviewed ? "Reopen" : "Dismiss"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
