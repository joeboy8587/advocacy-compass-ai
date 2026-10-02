import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Archive, CheckCircle2, CircleDashed } from "lucide-react";
import { recallVault } from "@/lib/vault.functions";

export function InvestigationMemory({ identifiers, caseId, compact }: { identifiers: string[]; caseId?: string; compact?: boolean }) {
  const fn = useServerFn(recallVault);
  const ids = [...new Set(identifiers.map((s) => s.trim()).filter(Boolean))];
  const q = useQuery({
    queryKey: ["vault-recall", ids.join(","), caseId ?? ""],
    queryFn: () => fn({ data: { identifiers: ids, caseId } }),
    enabled: ids.length > 0 || !!caseId,
    staleTime: 60_000,
  });
  const hits = q.data ?? [];

  return (
    <section className="panel p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary">
          <Archive className="size-4" /> Investigation memory
        </h3>
        <Link to="/vault" className="text-[11px] uppercase tracking-widest text-accent hover:underline">Open vault</Link>
      </header>
      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Checking what we already know…</p>
      ) : q.isError ? (
        <p className="text-xs text-destructive">Couldn't check the vault: {(q.error as Error).message}</p>
      ) : hits.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleDashed className="size-4" /> Not researched yet — no filed research, analysis or screenshots mention this.
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-xs text-accent">
            <CheckCircle2 className="size-4" /> Already researched — {hits.length} filed item{hits.length === 1 ? "" : "s"}. Read these before starting new work.
          </p>
          <ul className="space-y-2">
            {hits.slice(0, compact ? 4 : 10).map((h) => (
              <li key={h.id} className="border border-border rounded-sm p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">{h.title}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
                    {h.kind.replace("_", " ")} · {h.created_at.slice(0, 10)}
                  </span>
                </div>
                {h.conclusion && <p className="text-xs text-primary mt-1">Bottom line: {h.conclusion}</p>}
                {!compact && h.summary && <p className="text-xs text-muted-foreground mt-1">{h.summary}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
