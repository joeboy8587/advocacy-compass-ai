import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Newspaper, RefreshCw, Sparkles, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import {
  ensureTodayNarrative,
  getRecentNarratives,
  regenerateNarrative,
  type NarrativeRow,
} from "@/lib/narrative.functions";

export const Route = createFileRoute("/narrative")({
  head: () => ({
    meta: [
      { title: "Daily Narrative // Watchtower" },
      { name: "description", content: "Auto-generated daily interpretation of Watchtower detections, anomalies, offenders, and legal hooks." },
    ],
  }),
  component: NarrativePage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8">
        <div className="panel scanline p-6 max-w-xl">
          <div className="text-sm neon-text-orange uppercase tracking-widest mb-2">Narrative failed to load</div>
          <div className="text-xs text-muted-foreground mb-4">{error.message}</div>
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="text-xs uppercase tracking-wider px-3 py-2 rounded-sm border border-accent/40 text-accent hover:bg-accent/10"
          >Try again</button>
        </div>
      </div>
    );
  },
});

// ---- markdown -> tokens (tiny, no deps) ----
type Block =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

function parseMd(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let ul: string[] | null = null;
  const flushPara = () => { if (para.length) { out.push({ type: "p", text: para.join(" ").trim() }); para = []; } };
  const flushUl = () => { if (ul && ul.length) { out.push({ type: "ul", items: ul }); ul = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushUl(); continue; }
    if (line.startsWith("## ")) { flushPara(); flushUl(); out.push({ type: "h2", text: line.slice(3).trim() }); continue; }
    if (line.startsWith("### ")) { flushPara(); flushUl(); out.push({ type: "h3", text: line.slice(4).trim() }); continue; }
    if (/^\s*[-*]\s+/.test(line)) { flushPara(); if (!ul) ul = []; ul.push(line.replace(/^\s*[-*]\s+/, "")); continue; }
    flushUl();
    para.push(line);
  }
  flushPara(); flushUl();
  return out;
}

function renderInline(text: string) {
  // **bold** and `code`
  const parts: Array<{ t: string; k: "text" | "b" | "c" }> = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), k: "text" });
    const tok = m[0];
    if (tok.startsWith("**")) parts.push({ t: tok.slice(2, -2), k: "b" });
    else parts.push({ t: tok.slice(1, -1), k: "c" });
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), k: "text" });
  return parts.map((p, i) => {
    if (p.k === "b") return <strong key={i} className="text-accent">{p.t}</strong>;
    if (p.k === "c") return <code key={i} className="px-1 py-0.5 rounded bg-sidebar-accent text-[11px] neon-text-green">{p.t}</code>;
    return <span key={i}>{p.t}</span>;
  });
}

function MarkdownNarrative({ md }: { md: string }) {
  const blocks = useMemo(() => parseMd(md), [md]);
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "h2") {
          return (
            <h2 key={i} className="mt-6 first:mt-0 text-[11px] uppercase tracking-[0.2em] neon-text-orange border-b border-border pb-1">
              {b.text}
            </h2>
          );
        }
        if (b.type === "h3") return <h3 key={i} className="text-xs uppercase tracking-wider text-accent">{b.text}</h3>;
        if (b.type === "ul") {
          return (
            <ul key={i} className="space-y-1 pl-4">
              {b.items.map((it, j) => (
                <li key={j} className="text-sm text-foreground/90 list-disc marker:text-accent/60">
                  {renderInline(it)}
                </li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="text-sm leading-relaxed text-foreground/90">{renderInline(b.text)}</p>;
      })}
    </div>
  );
}

function fmtDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border border-border hover:border-accent/60 hover:text-accent"
    >
      {ok ? <Check className="size-3" /> : <Copy className="size-3" />}
      {ok ? "Copied" : "Copy"}
    </button>
  );
}

function NarrativeCard({ row, defaultOpen }: { row: NarrativeRow; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="panel scanline">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-sidebar-accent/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown className="size-4 text-accent shrink-0" /> : <ChevronRight className="size-4 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{fmtDate(row.narrative_date)}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {row.narrative_date} · {row.provider} · {timeAgo(row.generated_at)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
            sha256:{row.sha256.slice(0, 10)}…
          </span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-5 pt-1 border-t border-border">
          <div className="flex items-center justify-end mb-3">
            <CopyButton text={row.narrative_md} />
          </div>
          <MarkdownNarrative md={row.narrative_md} />
        </div>
      )}
    </article>
  );
}

function NarrativePage() {
  const qc = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["narratives", 14],
    queryFn: () => getRecentNarratives({ data: { days: 14 } }),
    refetchInterval: 5 * 60_000,
  });

  const ensure = useMutation({
    mutationFn: () => ensureTodayNarrative(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["narratives", 14] }),
  });
  const regen = useMutation({
    mutationFn: () => regenerateNarrative({ data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["narratives", 14] }),
  });

  // Auto-generate today's narrative on first visit each UTC day (idempotent)
  useEffect(() => {
    if (!listQuery.data) return;
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = listQuery.data.some((r) => r.narrative_date === today);
    if (!hasToday && !ensure.isPending) ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data]);

  const rows = listQuery.data ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayRow = rows.find((r) => r.narrative_date === todayIso);
  const generating = ensure.isPending || regen.isPending;
  const errorMsg =
    (ensure.data && !ensure.data.ok ? ensure.data.error : null) ??
    (regen.data && !regen.data.ok ? regen.data.error : null);

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Newspaper className="size-5 text-accent" />
            <h1 className="text-xl font-bold neon-text-orange">Daily Narrative</h1>
          </div>
          <p className="text-xs text-muted-foreground max-w-xl">
            Auto-generated once per UTC day. Interprets raw detections, anomalies, repeat offenders,
            and CFR hooks into analyst-tone prose. Stored in Neon with SHA-256 fingerprint. Rolling 14-day view.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={generating}
            onClick={() => regen.mutate()}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-wider px-3 py-2 rounded-sm border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {generating ? "Generating…" : todayRow ? "Regenerate today" : "Generate today"}
          </button>
        </div>
      </header>

      {errorMsg && (
        <div className="panel p-3 text-xs text-destructive border-destructive/40">
          {errorMsg}
        </div>
      )}

      {listQuery.isLoading && (
        <div className="panel p-6 text-xs text-muted-foreground uppercase tracking-widest">Loading narratives…</div>
      )}

      {!listQuery.isLoading && rows.length === 0 && !generating && (
        <div className="panel p-6 text-sm text-muted-foreground">
          No narratives yet. Click <span className="text-accent">Generate today</span> above to build the first one.
        </div>
      )}

      {generating && !todayRow && (
        <div className="panel scanline p-6 flex items-center gap-3">
          <RefreshCw className="size-4 text-accent animate-spin" />
          <div className="text-sm text-muted-foreground">
            Pulling today's snapshot from Neon and asking Josiah to interpret it. Usually 10-20 seconds.
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r, i) => (
          <NarrativeCard key={r.id} row={r} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}
