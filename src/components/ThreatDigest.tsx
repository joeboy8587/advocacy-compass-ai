import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Loader2 } from "lucide-react";
import { getThreatDigest } from "@/lib/patterns.functions";

const TONE: Record<string, string> = {
  CRITICAL: "border-primary text-primary",
  HIGH: "border-primary/50 neon-text-orange",
  MEDIUM: "border-accent/40 text-accent",
};

export function ThreatDigest() {
  const q = useQuery({
    queryKey: ["threat-digest"],
    queryFn: () => getThreatDigest({ data: { limit: 10 } }),
    refetchInterval: 300_000,
  });

  if (q.isLoading) {
    return (
      <div className="panel p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Loading threat digest…
      </div>
    );
  }
  if (q.isError || !q.data) return null;
  const { threats, patterns } = q.data;
  if (!threats.length && !patterns.length) return null;

  return (
    <section className="panel scanline p-4 space-y-3">
      <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
        <ShieldAlert className="size-4" /> Threat Digest · written for humans
      </div>

      {patterns.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Standing patterns</div>
          {patterns.slice(0, 3).map((p) => (
            <div key={p.id} className={`border-l-2 pl-3 py-1 ${TONE[p.severity ?? ""] ?? "border-border text-muted-foreground"}`}>
              <div className="text-xs">{p.pattern_name}</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{p.description}</p>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
                {p.evidence_count ?? 0} supporting records · logged {p.created_at.slice(0, 10)}
              </div>
            </div>
          ))}
        </div>
      )}

      {threats.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Assessed events</div>
          <div className="divide-y divide-border max-h-[300px] overflow-auto">
            {threats.map((t) => (
              <div key={t.id} className="py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className={`px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border ${TONE[t.severity ?? ""] ?? "border-border"}`}>
                    {t.severity ?? "—"}
                  </span>
                  <span className="font-bold neon-text-green truncate flex-1">
                    {t.registration || t.icao_hex || "UNKNOWN"}
                    {t.altitude_ft != null && (
                      <span className="text-muted-foreground font-normal ml-2">@ {t.altitude_ft.toLocaleString()}ft</span>
                    )}
                    {t.county && <span className="text-muted-foreground font-normal ml-2">· {t.county}</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t.created_at.slice(0, 10)}</span>
                </div>
                <p className="text-muted-foreground mt-1">{t.description || t.anomaly_type || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
