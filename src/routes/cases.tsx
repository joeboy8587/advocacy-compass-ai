import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, Sparkles, Loader2, Layers, Merge } from "lucide-react";
import { useState } from "react";
import { getCases } from "@/lib/watchtower.functions";
import { getSuggestedCases, createCase, getDuplicateGroups, mergeDuplicateCases, consolidateCluster } from "@/lib/casework.functions";
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
      <DuplicatesPanel />





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

function SuggestedPanel() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const sug = useQuery({
    queryKey: ["suggested-cases"],
    queryFn: () => getSuggestedCases(),
    refetchInterval: 5 * 60_000,
  });
  const make = useMutation({
    mutationFn: (s: { icao: string; reg: string | null; owner: string | null; county: string | null }) =>
      createCase({
        data: {
          icao: s.icao,
          reg: s.reg,
          owner: s.owner,
          county: s.county,
          case_type: "AUTO_LOW_ALTITUDE",
          severity: "HIGH",
          notes: "Auto-suggested from 7-day low-altitude pattern. Investigate and verify.",
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["suggested-cases"] });
      if (r?.case_id) nav({ to: "/cases/$caseId", params: { caseId: r.case_id } });
    },
  });

  if (!sug.data?.length) return null;
  return (
    <section className="panel scanline p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <Sparkles className="size-4" /> Auto-Suggested Cases · 7d low-altitude pattern, no open case
        </div>
        <span className="text-[10px] text-muted-foreground">{sug.data.length} subjects</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {sug.data.map((s) => (
          <div key={s.icao_hex} className="border border-border/60 px-3 py-2 hover:border-accent transition flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-sm neon-text-orange truncate">
                {s.registration ?? s.icao_hex}
                {s.is_military && <span className="ml-2 text-[10px] text-primary">MIL</span>}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">{s.owner ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">
                <span className="neon-text-orange">{s.low_alt_7d}</span> low-alt · {s.detections_7d} det · {s.top_county ?? "—"}
              </div>
            </div>
            <button
              disabled={make.isPending}
              onClick={() => make.mutate({ icao: s.icao_hex, reg: s.registration, owner: s.owner, county: s.top_county })}
              className="text-[10px] uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent/10 disabled:opacity-50 shrink-0"
            >
              {make.isPending ? <Loader2 className="size-3 animate-spin" /> : "Open"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DuplicatesPanel() {
  const qc = useQueryClient();
  const dups = useQuery({
    queryKey: ["duplicate-groups"],
    queryFn: () => getDuplicateGroups(),
    refetchInterval: 5 * 60_000,
  });
  const [selection, setSelection] = useState<Record<string, string>>({}); // group_key -> primary case_id
  const [collapsed, setCollapsed] = useState(true);

  const merge = useMutation({
    mutationFn: (v: { primary_case_id: string; duplicate_case_ids: string[] }) =>
      mergeDuplicateCases({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicate-groups"] });
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });
  const consolidate = useMutation({
    mutationFn: (v: { case_ids: string[] }) => consolidateCluster({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicate-groups"] });
      qc.invalidateQueries({ queryKey: ["cases"] });
    },
  });

  if (!dups.data?.length) return null;

  return (
    <section className="panel scanline p-4 border-primary/40">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <Layers className="size-4" /> Same-Operator Groups · {dups.data.length} clusters found
        </div>
        <span className="text-[10px] text-muted-foreground">{collapsed ? "expand" : "collapse"}</span>
      </button>

      {!collapsed && (
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Pick the primary case to keep; the rest will be dismissed as duplicates with a merge note pointing to the primary.
          </p>
          {dups.data.map((g) => {
            const primary = selection[g.group_key] ?? g.cases[0].case_id;
            const dupIds = g.cases.map((c) => c.case_id).filter((id) => id !== primary);
            return (
              <div key={g.group_key} className="border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {g.group_type} match
                    </div>
                    <div className="font-bold neon-text-orange truncate">{g.label}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">
                    {g.cases.length} cases
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {g.cases.map((c) => (
                    <label
                      key={c.case_id}
                      className={`flex items-start gap-2 border p-2 cursor-pointer transition ${
                        primary === c.case_id
                          ? "border-accent bg-accent/5"
                          : "border-border/40 hover:border-accent/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`primary-${g.group_key}`}
                        checked={primary === c.case_id}
                        onChange={() =>
                          setSelection((s) => ({ ...s, [g.group_key]: c.case_id }))
                        }
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            to="/cases/$caseId"
                            params={{ caseId: c.case_id }}
                            className="font-mono text-xs neon-text-orange hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.case_id}
                          </Link>
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                            {c.status} · T{c.wti_tier ?? "—"} · {c.wti_score ?? "—"}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {c.case_type} · {c.subject_reg ?? c.subject_icao ?? "—"} · {c.primary_county ?? "—"} · {c.total_events ?? 0} events
                        </div>
                        {c.auto_summary && (
                          <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1">
                            {c.auto_summary}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground">
                    Will dismiss {dupIds.length} case{dupIds.length === 1 ? "" : "s"}
                  </span>
                  <button
                    disabled={merge.isPending || dupIds.length === 0}
                    onClick={() =>
                      merge.mutate({ primary_case_id: primary, duplicate_case_ids: dupIds })
                    }
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest border border-accent text-accent px-2 py-1 hover:bg-accent/10 disabled:opacity-50"
                  >
                    {merge.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Merge className="size-3" />
                    )}
                    Merge into {primary}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}


