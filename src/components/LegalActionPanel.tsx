import { Scale, Gavel, Quote, FileCheck2, ShieldAlert, BookMarked } from "lucide-react";
import type {
  CaseLegalAction,
  CaseAdmission,
  CaseAttachedDocument,
} from "@/lib/watchtower.functions";

const PUBLIC_SOURCE_LINE =
  "All data referenced here is drawn from public sources — FAA ADS-B broadcasts, public corporate filings, published regulations, and published journalism — and is independently verifiable by any member of the public.";

function statusTone(status: string): string {
  const s = status.toUpperCase();
  if (s.startsWith("FILED")) return "border-accent/60 text-accent";
  if (s.startsWith("DRAFT")) return "border-primary/50 text-primary";
  if (s.startsWith("FRAMEWORK")) return "border-muted-foreground/40 text-muted-foreground";
  return "border-destructive/40 text-destructive";
}

function shortHash(h: string | null | undefined) {
  return h ? `${h.slice(0, 12)}…` : null;
}

export function LegalActionPanel({
  actions,
  admissions,
  attached,
}: {
  actions?: CaseLegalAction[] | null;
  admissions?: CaseAdmission[] | null;
  attached?: CaseAttachedDocument[] | null;
}) {
  const hasActions = (actions?.length ?? 0) > 0;
  const hasAdmissions = (admissions?.length ?? 0) > 0;
  if (!hasActions && !hasAdmissions) return null;

  const exhibits = (attached ?? []).filter((d) => d.block === "EVIDENCE_BLOCK_4");

  return (
    <section className="panel p-5 space-y-6">
      <header className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
          <Scale className="size-3" /> Legal actions &amp; on-record admissions
        </div>
        <p className="text-xs text-muted-foreground">
          Every route to accountability for this case, and every statement the operator
          has made on the public record that supports it.
        </p>
      </header>

      {hasAdmissions && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-accent inline-flex items-center gap-2">
            <Quote className="size-3" /> What they said on the record
          </div>
          <ul className="space-y-3">
            {admissions!.map((a, i) => (
              <li key={i} className="border-l-2 border-accent/50 pl-3">
                <blockquote className="text-sm italic">“{a.quote}”</blockquote>
                <div className="text-[11px] text-muted-foreground mt-1">{a.speaker}</div>
                <div className="text-xs mt-1.5 flex gap-2">
                  <ShieldAlert className="size-3.5 shrink-0 mt-0.5 text-primary" />
                  <span>{a.effect}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasActions && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-accent inline-flex items-center gap-2">
            <Gavel className="size-3" /> Accountability package ({actions!.length} routes)
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {actions!
              .slice()
              .sort((a, b) => a.seq - b.seq)
              .map((a) => (
                <article
                  key={a.seq}
                  className="border border-border/60 p-3 space-y-2 bg-background/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm leading-snug">
                      {a.seq}. {a.title}
                    </h4>
                    <span
                      className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 border shrink-0 ${statusTone(a.status)}`}
                    >
                      {a.status.split(" —")[0]}
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    <div>
                      <span className="uppercase tracking-widest text-[9px]">Where it goes:</span>{" "}
                      {a.forum}
                    </div>
                    <div className="mt-0.5">
                      <span className="uppercase tracking-widest text-[9px]">Legal authority:</span>{" "}
                      <span className="font-mono">{a.authority}</span>
                    </div>
                  </div>

                  <ul className="text-xs space-y-1">
                    {a.asks.map((ask, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-accent">›</span>
                        <span>{ask}</span>
                      </li>
                    ))}
                  </ul>

                  {(a.precedent?.length ?? 0) > 0 && (
                    <div className="text-[11px] pt-1 border-t border-border/40">
                      <div className="uppercase tracking-widest text-[9px] text-muted-foreground inline-flex items-center gap-1">
                        <BookMarked className="size-3" /> Controlling precedent
                      </div>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {a.precedent!.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {a.independent && (
                    <div className="text-[10px] text-accent">
                      Independent path — does not depend on the Attorney General, the Monitor,
                      or the Grand Jury.
                    </div>
                  )}

                  {a.sha256 && (
                    <div className="text-[10px] font-mono text-muted-foreground">
                      fingerprint {shortHash(a.sha256)}
                    </div>
                  )}
                </article>
              ))}
          </div>
        </div>
      )}

      {exhibits.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-accent inline-flex items-center gap-2">
            <FileCheck2 className="size-3" /> Sealed exhibits ({exhibits.length})
          </div>
          <ul className="text-[11px] space-y-1">
            {exhibits.map((d) => (
              <li key={d.sha256} className="flex justify-between gap-3 border-b border-border/30 pb-1">
                <span>{d.title ?? d.file_path}</span>
                <span className="font-mono text-muted-foreground shrink-0">
                  {shortHash(d.sha256)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-3">
        {PUBLIC_SOURCE_LINE}
      </p>
    </section>
  );
}
