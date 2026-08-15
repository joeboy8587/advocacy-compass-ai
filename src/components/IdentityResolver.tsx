import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Loader2, Check, HelpCircle } from "lucide-react";
import { resolveSubjectIdentity, applySubjectIdentity } from "@/lib/casework.functions";

function tone(conf: number) {
  if (conf >= 85) return "neon-text-green";
  if (conf >= 65) return "neon-text-orange";
  return "text-muted-foreground";
}
function strength(conf: number) {
  if (conf >= 85) return "STRONG";
  if (conf >= 65) return "PROBABLE";
  return "WEAK";
}

export function IdentityResolver({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const res = useQuery({
    queryKey: ["identity", caseId],
    queryFn: () => resolveSubjectIdentity({ data: { caseId } }),
  });

  const apply = useMutation({
    mutationFn: (v: { registration?: string | null; owner?: string | null; icao_hex?: string | null; source?: string | null; unidentified?: boolean }) =>
      applySubjectIdentity({ data: { caseId, ...v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["identity", caseId] });
      qc.invalidateQueries({ queryKey: ["unknown-subjects"] });
    },
  });

  const d = res.data;

  return (
    <section className="panel p-5 space-y-3">
      <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
        <Fingerprint className="size-4" /> Resolve Subject Identity
      </div>
      <p className="text-xs text-muted-foreground">
        Cross-checks the FAA registry, the tail this airframe actually broadcast, its repeated callsigns,
        operator profiles and hashed radar screenshots — then lets you lock one answer onto the case.
      </p>

      {res.isLoading && <div className="text-xs text-muted-foreground inline-flex items-center gap-2"><Loader2 className="size-3 animate-spin" /> Checking every identity source…</div>}
      {res.isError && (
        <div className="text-xs text-destructive">
          {(res.error as Error)?.message}
          <button onClick={() => res.refetch()} className="ml-3 px-2 py-1 border border-border rounded-sm hover:border-accent uppercase tracking-widest text-[10px]">Retry</button>
        </div>
      )}

      {d && (
        <>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Cell label="ICAO hex" value={d.current.icao_hex ?? "—"} />
            <Cell label="Tail on case" value={d.current.registration ?? "UNKNOWN"} />
            <Cell label="Owner on case" value={d.current.owner ?? "UNKNOWN"} />
          </div>

          {d.flags.length > 0 && (
            <ul className="text-xs list-disc list-inside space-y-1 text-muted-foreground border border-border rounded-sm p-3">
              {d.flags.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}

          {d.candidates.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No identity evidence found in any source for this airframe.</div>
          ) : (
            <div className="space-y-2">
              {d.candidates.map((c, i) => (
                <div key={i} className="border border-border rounded-sm p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {c.source} · <span className={tone(c.confidence)}>{strength(c.confidence)} ({Math.round(c.confidence)}%)</span>
                    </div>
                    <div className="text-sm font-mono mt-1">
                      {c.registration ?? "—"} <span className="text-muted-foreground">·</span> {c.owner ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{c.detail}</div>
                  </div>
                  <button
                    disabled={apply.isPending || (!c.registration && !c.owner)}
                    onClick={() => apply.mutate({ registration: c.registration, owner: c.owner, icao_hex: c.icao_hex, source: c.source })}
                    className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm hover:bg-accent/80 disabled:opacity-40"
                  >
                    <Check className="size-3" /> Use this
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-border/40">
            <button
              disabled={apply.isPending}
              onClick={() => apply.mutate({ unidentified: true })}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border border-border rounded-sm hover:border-primary disabled:opacity-40"
            >
              <HelpCircle className="size-3" /> Mark genuinely unidentified
            </button>
            {apply.isPending && <Loader2 className="size-3 animate-spin" />}
            {apply.isSuccess && <span className="text-xs neon-text-green">Applied: {apply.data?.applied}</span>}
            {apply.isError && <span className="text-xs text-destructive">{(apply.error as Error)?.message}</span>}
          </div>
        </>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-sm p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono text-sm truncate">{value}</div>
    </div>
  );
}
