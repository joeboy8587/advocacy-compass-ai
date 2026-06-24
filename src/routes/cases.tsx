import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Sparkles, Loader2 } from "lucide-react";
import { getCases } from "@/lib/watchtower.functions";
import { getSuggestedCases, createCase } from "@/lib/casework.functions";
import { z } from "zod";


const search = z.object({
  status: z.enum(["ALL", "DRAFT", "REVIEW", "PUBLISHED", "DISMISSED"]).optional().default("ALL"),
});

export const Route = createFileRoute("/cases")({
  head: () => ({ meta: [{ title: "Cases // Watchtower" }] }),
  validateSearch: search,
  component: CasesLayout,
});

function CasesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // If we're at a child route, just render outlet
  if (pathname !== "/cases") return <Outlet />;
  return <CasesIndex />;
}

function CasesIndex() {
  const { status } = Route.useSearch();
  const nav = useNavigate({ from: "/cases" });
  const q = useQuery({
    queryKey: ["cases", status],
    queryFn: () => getCases({ data: { status, limit: 200 } }),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl neon-text-green flex items-center gap-3">
            <FolderOpen className="size-6" /> Case Files
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            {q.data?.length ?? 0} cases · WTI-ranked
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/cases/new"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-accent text-accent rounded-sm hover:bg-accent/10">
            <Plus className="size-3" /> New Case
          </Link>
          {(["ALL", "DRAFT", "REVIEW", "PUBLISHED", "DISMISSED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => nav({ search: { status: s } })}
              className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-sm border ${
                status === s
                  ? "bg-accent text-accent-foreground border-accent"
                  : "border-border text-muted-foreground hover:border-accent"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <SuggestedPanel />



      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {q.isLoading && <div className="text-muted-foreground text-xs">Loading…</div>}
        {q.data?.map((c) => (
          <Link
            key={c.id}
            to="/cases/$caseId"
            params={{ caseId: c.case_id || c.id }}
            className="panel scanline p-4 block hover:border-accent transition group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {c.case_id || c.id.slice(0, 8)} · {c.case_type}
                </div>
                <div className="mt-1 font-bold neon-text-orange truncate">
                  {c.subject_reg || c.subject_icao || c.subject_owner || "Unidentified subject"}
                </div>
                {c.subject_owner && c.subject_reg && (
                  <div className="text-xs text-muted-foreground truncate">{c.subject_owner}</div>
                )}
                {c.auto_summary && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{c.auto_summary}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm border inline-block ${
                  c.status === "PUBLISHED" ? "border-accent text-accent" :
                  c.status === "REVIEW" ? "border-primary text-primary" :
                  c.status === "DISMISSED" ? "border-destructive text-destructive" :
                  "border-muted-foreground text-muted-foreground"
                }`}>{c.status}</div>
                <div className="mt-2 text-3xl font-bold neon-text-orange tabular-nums">
                  {c.wti_tier ?? "—"}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">WTI Tier</div>
                {c.wti_score && (
                  <div className="text-[10px] text-muted-foreground mt-1">score {c.wti_score}</div>
                )}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{c.primary_county || "—"}</span>
              <span>{c.total_events ?? 0} events</span>
              <span>{new Date(c.opened_at).toLocaleDateString()}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
