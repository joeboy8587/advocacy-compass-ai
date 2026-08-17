import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Brain, Loader2, GitCompareArrows } from "lucide-react";
import { getDeepProfile, findBehavioralTwins } from "@/lib/profiler.functions";

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 85) return "text-destructive";
  if (score >= 65) return "neon-text-orange";
  if (score >= 40) return "neon-text-orange";
  return "neon-text-green";
}

export function BehaviorProfile({ icao }: { icao: string | null }) {
  const prof = useQuery({
    queryKey: ["deep-profile", icao],
    queryFn: () => getDeepProfile({ data: { icao: icao! } }),
    enabled: !!icao,
  });
  const twins = useQuery({
    queryKey: ["twins", icao],
    queryFn: () => findBehavioralTwins({ data: { icao: icao!, limit: 8 } }),
    enabled: !!icao,
  });

  if (!icao) return null;

  return (
    <div className="space-y-4">
      <section className="panel p-5 space-y-3">
        <div className="text-xs uppercase tracking-widest neon-text-green flex items-center gap-2">
          <Brain className="size-4" /> Behaviour Profile (ML)
        </div>

        {prof.isLoading && (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" /> Reading the behaviour model…
          </div>
        )}
        {prof.isError && <div className="text-xs text-destructive">{(prof.error as Error)?.message}</div>}
        {prof.data === null && !prof.isLoading && (
          <p className="text-xs text-muted-foreground italic">
            This airframe has no behaviour profile yet — the model has not scored it in the current window.
          </p>
        )}

        {prof.data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Box label="How abnormal">
                <span className={`text-2xl ${scoreTone(prof.data.profile_score)}`}>
                  {prof.data.profile_score ?? "—"}
                </span>
                <span className="text-muted-foreground text-[11px]">/100</span>
              </Box>
              <Box label="Compared to all aircraft">
                <span className="text-sm">
                  {prof.data.percentile == null ? "—" : `More unusual than ${prof.data.percentile}% of the fleet`}
                </span>
              </Box>
              <Box label="Is it changing?">
                <span className="text-sm">{prof.data.drift_label}</span>
              </Box>
              <Box label="Behaviour group">
                <span className="text-sm">
                  Cluster {prof.data.behavioral_cluster ?? "—"}
                  {prof.data.cluster_size ? ` · ${prof.data.cluster_size.toLocaleString()} aircraft fly this way` : ""}
                </span>
              </Box>
            </div>

            <p className={`text-sm ${scoreTone(prof.data.profile_score)}`}>{prof.data.score_label}.</p>

            {prof.data.explanation && (
              <p className="text-sm leading-relaxed border-l-2 border-accent/50 pl-3 text-muted-foreground">
                {prof.data.explanation}
              </p>
            )}

            {prof.data.reasons.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  What the model actually saw
                </div>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  {prof.data.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}

            {prof.data.top_dimensions.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  Strongest abnormal signals
                </div>
                <div className="space-y-1">
                  {prof.data.top_dimensions.map((t) => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-[11px] w-44 shrink-0 capitalize text-muted-foreground">{t.name}</span>
                      <div className="h-1.5 flex-1 bg-border/40 rounded-sm overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round(t.weight * 100))}%` }} />
                      </div>
                      <span className="text-[11px] font-mono w-10 text-right">{Math.min(100, Math.round(t.weight * 100))}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
              Model {prof.data.model_version ?? "—"}
              {prof.data.updated_at ? ` · scored ${new Date(prof.data.updated_at).toLocaleString()}` : ""}
            </div>
          </>
        )}
      </section>

      <section className="panel p-5 space-y-3">
        <div className="text-xs uppercase tracking-widest neon-text-orange flex items-center gap-2">
          <GitCompareArrows className="size-4" /> Aircraft That Fly Like This One
        </div>
        <p className="text-xs text-muted-foreground">
          Matched on flight behaviour alone — altitude, night activity, loitering, masking — not on tail number or
          owner. Fleet partners and handoff aircraft usually show up here even when their paperwork looks unrelated.
        </p>
        {twins.isLoading && (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" /> Comparing fingerprints…
          </div>
        )}
        {twins.isError && <div className="text-xs text-destructive">{(twins.error as Error)?.message}</div>}
        {twins.data?.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No comparable aircraft found.</div>
        )}
        {twins.data && twins.data.length > 0 && (
          <div className="space-y-1">
            {twins.data.map((t) => (
              <div key={t.icao_hex} className="flex items-center justify-between gap-3 border border-border rounded-sm p-2 text-xs">
                <div className="min-w-0">
                  <div className="font-mono text-sm">
                    {t.registration ?? t.icao_hex}
                    <span className="text-muted-foreground"> · {t.icao_hex}</span>
                  </div>
                  <div className="text-muted-foreground truncate">{t.owner ?? "Owner unknown"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.match_label} · abnormality {t.profile_score ?? "—"}/100
                    {t.detections ? ` · ${t.detections.toLocaleString()} detections` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right space-y-1">
                  <div className="font-mono neon-text-green">{Math.round(t.similarity * 100)}%</div>
                  {t.case_id && (
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: t.case_id }}
                      className="text-[10px] uppercase tracking-widest text-accent hover:underline block"
                    >
                      {t.case_id}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}
