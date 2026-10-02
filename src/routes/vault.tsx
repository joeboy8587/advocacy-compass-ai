import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Archive, Upload, Search, Loader2, Trash2, RotateCw, ShieldCheck, FileText, Image as ImageIcon, X, Library, ClipboardPaste } from "lucide-react";
import {
  listVault,
  addToVault,
  searchVault,
  deleteVaultItem,
  retryVaultItem,
  getEntityFiles,
  importDoctrineToVault,
  type VaultHit,
} from "@/lib/vault.functions";
import { analyzeScreenshot } from "@/lib/screenshots.functions";
import { sha256Hex, extractText } from "@/lib/file-extract";

export const Route = createFileRoute("/vault")({
  head: () => ({
    meta: [
      { title: "Intelligence Vault — Watchtower Command Center" },
      { name: "description", content: "Every research file, court record, analysis and radar screenshot, indexed so the investigation never repeats itself." },
      { property: "og:title", content: "Intelligence Vault — Watchtower Command Center" },
      { property: "og:description", content: "Searchable memory of everything Watchtower has already researched and found." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultPage,
});

type Job = { name: string; state: "reading" | "indexing" | "done" | "duplicate" | "error"; msg?: string };

const KIND_LABEL: Record<string, string> = {
  research: "Research", case_law: "Case law", faa_lookup: "FAA lookup", court_file: "Court file", analysis: "Analysis",
  agent_output: "Agent output", log: "Log", report: "Report", screenshot: "Radar screenshot", other: "Other",
};
const TYPE_LABEL: Record<string, string> = {
  aircraft: "Aircraft", organization: "Companies & agencies", person: "Officials & parties", location: "Places", regulation: "Laws & rules", case: "Cases",
};

function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function VaultPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listVault);
  const addFn = useServerFn(addToVault);
  const searchFn = useServerFn(searchVault);
  const delFn = useServerFn(deleteVaultItem);
  const retryFn = useServerFn(retryVaultItem);
  const entityFn = useServerFn(getEntityFiles);
  const importFn = useServerFn(importDoctrineToVault);
  const visionFn = useServerFn(analyzeScreenshot);

  const data = useQuery({ queryKey: ["vault"], queryFn: () => listFn() });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [caseId, setCaseId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VaultHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [paste, setPaste] = useState({ open: false, title: "", text: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  const entity = useQuery({
    queryKey: ["vault-entity", entityId],
    queryFn: () => entityFn({ data: { entityId: entityId! } }),
    enabled: !!entityId,
  });

  const setJob = (i: number, j: Partial<Job>) => setJobs((all) => all.map((x, k) => (k === i ? { ...x, ...j } : x)));

  async function ingest(files: File[]) {
    const start = jobs.length;
    setJobs((j) => [...j, ...files.map((f) => ({ name: f.name, state: "reading" as const }))]);
    for (let n = 0; n < files.length; n++) {
      const f = files[n];
      const i = start + n;
      try {
        const buf = await f.arrayBuffer();
        const sha = await sha256Hex(buf);
        let content = "";
        let kind: string | undefined;
        if (f.type.startsWith("image/")) {
          const r = await visionFn({ data: { image_data_url: await readDataUrl(f) } });
          if (!r.ok) throw new Error(r.error);
          const e = r.extract;
          kind = "screenshot";
          content = [
            `Radar screenshot: ${f.name}`,
            e.registration && `Selected aircraft: ${e.registration}`,
            e.icao_hex && `ICAO hex: ${e.icao_hex}`,
            e.masked && "Selected contact is MASKED (no registration shown)",
            e.operator && `Operator: ${e.operator}`,
            e.aircraft_type && `Type: ${e.aircraft_type}`,
            e.altitude_ft != null && `Altitude: ${e.altitude_ft} ft`,
            e.groundspeed_kts != null && `Groundspeed: ${e.groundspeed_kts} kts`,
            e.capture_date && `Date shown: ${e.capture_date}`,
            e.status_bar_time && `Time shown: ${e.status_bar_time} ${e.status_bar_period ?? ""}`,
            e.map_area && `Area: ${e.map_area}`,
            e.contact_count != null && `Contacts visible: ${e.contact_count}`,
            e.map_labels?.length && `Map labels: ${e.map_labels.join(", ")}`,
            e.notes && `Notes: ${e.notes}`,
          ].filter(Boolean).join("\n");
        } else {
          try {
            content = (await extractText(f)).text;
          } catch {
            content = new TextDecoder().decode(buf); // logs, json, csv, etc.
          }
        }
        if (!content.trim()) throw new Error("No readable text in this file");
        setJob(i, { state: "indexing" });
        const r = await addFn({ data: { title: f.name.replace(/\.[^.]+$/, ""), content, sha256: sha, sourceFilename: f.name, byteSize: f.size, caseId: caseId || undefined, kind } });
        setJob(i, { state: r.duplicate ? "duplicate" : "done", msg: r.duplicate ? "Already in the vault — skipped" : undefined });
      } catch (e) {
        setJob(i, { state: "error", msg: (e as Error).message });
      }
      qc.invalidateQueries({ queryKey: ["vault"] });
    }
  }

  async function savePaste() {
    const text = paste.text.trim();
    if (!text) return;
    const sha = await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
    const title = paste.title.trim() || `Pasted note ${new Date().toLocaleString()}`;
    setPaste({ open: false, title: "", text: "" });
    const i = jobs.length;
    setJobs((j) => [...j, { name: title, state: "indexing" }]);
    try {
      const r = await addFn({ data: { title, content: text, sha256: sha, caseId: caseId || undefined, kind: "agent_output" } });
      setJob(i, { state: r.duplicate ? "duplicate" : "done" });
    } catch (e) {
      setJob(i, { state: "error", msg: (e as Error).message });
    }
    qc.invalidateQueries({ queryKey: ["vault"] });
  }

  async function runSearch(q = query) {
    if (!q.trim()) return;
    setSearching(true);
    setSearchErr(null);
    try {
      setResults(await searchFn({ data: { query: q } }));
    } catch (e) {
      setSearchErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function importLibrary() {
    setImporting("Starting…");
    try {
      for (let guard = 0; guard < 30; guard++) {
        const r = await importFn();
        qc.invalidateQueries({ queryKey: ["vault"] });
        setImporting(`${r.remaining} left to file…`);
        if (r.remaining === 0 || r.imported === 0) break;
      }
    } finally {
      setImporting(null);
    }
  }

  const stats = data.data?.stats;
  const grouped = new Map<string, NonNullable<typeof data.data>["entities"]>();
  for (const e of data.data?.entities ?? []) {
    const g = grouped.get(e.entity_type) ?? [];
    g.push(e);
    grouped.set(e.entity_type, g);
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold text-primary uppercase tracking-widest">
          <Archive className="size-5" /> Intelligence Vault
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Drop in anything you've collected — research, court files, FAA lookups, Josiah's answers, logs, radar screenshots. Each file is fingerprinted, read, summarised and linked to the aircraft, companies, places and laws it mentions, so you can always see what was already found.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Files filed", stats?.total],
          ["Ready to search", stats?.ready],
          ["Things linked", stats?.entities],
          ["Need attention", (stats?.errors ?? 0) + (stats?.pending ?? 0)],
        ].map(([l, v]) => (
          <div key={l as string} className="panel p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
            <div className="text-2xl font-bold text-foreground">{v ?? "—"}</div>
          </div>
        ))}
      </div>

      {/* Step 1: add files */}
      <section className="panel p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-primary">Step 1 · Add files</h2>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            ingest([...e.dataTransfer.files]);
          }}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-sm p-8 text-center cursor-pointer hover:border-accent transition-colors"
        >
          <Upload className="size-8 mx-auto text-accent" />
          <p className="mt-2 text-sm text-foreground">Drag files here, or click to choose</p>
          <p className="text-xs text-muted-foreground">PDF, Word, Markdown, text, logs, CSV/JSON, and screenshots (PNG/JPG). Duplicates are skipped automatically.</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.md,.txt,.log,.csv,.json,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              ingest([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="Optional: attach to case (e.g. WTPR-2026-0020)"
            className="bg-input border border-border rounded-sm px-3 py-2 text-xs w-72"
          />
          <button onClick={() => setPaste((p) => ({ ...p, open: !p.open }))} className="flex items-center gap-1 border border-border rounded-sm px-3 py-2 text-xs hover:border-accent">
            <ClipboardPaste className="size-4" /> Paste Josiah answer or note
          </button>
          <button onClick={importLibrary} disabled={!!importing} className="flex items-center gap-1 border border-border rounded-sm px-3 py-2 text-xs hover:border-accent disabled:opacity-50">
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Library className="size-4" />} {importing ?? "File everything from the Doctrine Library"}
          </button>
        </div>
        {paste.open && (
          <div className="space-y-2">
            <input value={paste.title} onChange={(e) => setPaste((p) => ({ ...p, title: e.target.value }))} placeholder="Title (optional)" className="w-full bg-input border border-border rounded-sm px-3 py-2 text-xs" />
            <textarea value={paste.text} onChange={(e) => setPaste((p) => ({ ...p, text: e.target.value }))} rows={6} placeholder="Paste the analysis here…" className="w-full bg-input border border-border rounded-sm px-3 py-2 text-xs" />
            <button onClick={savePaste} className="bg-primary text-primary-foreground rounded-sm px-4 py-2 text-xs uppercase tracking-widest">Save to vault</button>
          </div>
        )}
        {jobs.length > 0 && (
          <ul className="space-y-1">
            {jobs.map((j, k) => (
              <li key={k} className="flex items-center gap-2 text-xs">
                {j.state === "reading" || j.state === "indexing" ? <Loader2 className="size-3 animate-spin text-accent" /> : j.state === "error" ? <X className="size-3 text-destructive" /> : <ShieldCheck className="size-3 text-accent" />}
                <span className="truncate">{j.name}</span>
                <span className="text-muted-foreground">
                  {j.state === "reading" ? "reading…" : j.state === "indexing" ? "summarising & linking…" : j.state === "done" ? "filed" : j.msg}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Step 2: ask */}
      <section className="panel p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-primary">Step 2 · Ask what we already know</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. "N913KC", "FF22 LLC", or "night circling over Oildale"'
            className="flex-1 bg-input border border-border rounded-sm px-3 py-2 text-sm"
          />
          <button className="flex items-center gap-1 bg-primary text-primary-foreground rounded-sm px-4 text-xs uppercase tracking-widest">
            {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
          </button>
        </form>
        {searchErr && <p className="text-xs text-destructive">{searchErr}</p>}
        {results && (results.length === 0 ? <p className="text-xs text-muted-foreground">Nothing filed matches this yet — this would be new ground.</p> : <HitList hits={results} />)}
      </section>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Entity map */}
        <section className="panel p-4 space-y-3 lg:col-span-1">
          <h2 className="text-xs uppercase tracking-widest text-primary">Who & what appears in the files</h2>
          {[...grouped.entries()].map(([type, list]) => (
            <div key={type}>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{TYPE_LABEL[type] ?? type}</div>
              <div className="flex flex-wrap gap-1">
                {list.slice(0, 20).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setEntityId(e.id)}
                    className={`text-[11px] border rounded-sm px-2 py-0.5 ${entityId === e.id ? "border-accent text-accent" : "border-border hover:border-accent"}`}
                  >
                    {e.name} <span className="text-muted-foreground">{e.files}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!grouped.size && <p className="text-xs text-muted-foreground">Add files to start building the map.</p>}
        </section>

        <section className="panel p-4 space-y-3 lg:col-span-2">
          {entityId ? (
            entity.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : entity.data ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-primary">{entity.data.entity.name}</h2>
                  <button onClick={() => setEntityId(null)} className="text-xs text-muted-foreground hover:text-foreground">Show all files</button>
                </div>
                {entity.data.related.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Often appears with: {entity.data.related.slice(0, 10).map((r) => `${r.name} (${r.shared})`).join(", ")}
                  </p>
                )}
                <HitList hits={entity.data.files} />
              </>
            ) : null
          ) : (
            <>
              <h2 className="text-xs uppercase tracking-widest text-primary">All filed items</h2>
              {data.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
              {data.isError && <p className="text-xs text-destructive">{(data.error as Error).message}</p>}
              <ul className="space-y-2">
                {data.data?.items.map((it) => (
                  <li key={it.id} className="border border-border rounded-sm p-3">
                    <div className="flex items-center gap-2">
                      {it.kind === "screenshot" ? <ImageIcon className="size-4 text-accent" /> : <FileText className="size-4 text-accent" />}
                      <span className="text-sm font-semibold truncate flex-1">{it.title}</span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{KIND_LABEL[it.kind] ?? it.kind}</span>
                      {it.status === "error" && (
                        <button title="Try again" onClick={async () => { await retryFn({ data: { id: it.id } }).catch(() => undefined); qc.invalidateQueries({ queryKey: ["vault"] }); }}>
                          <RotateCw className="size-4 text-primary" />
                        </button>
                      )}
                      <button title="Remove" onClick={async () => { if (confirm(`Remove "${it.title}" from the vault?`)) { await delFn({ data: { id: it.id } }); qc.invalidateQueries({ queryKey: ["vault"] }); } }}>
                        <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                    {it.status === "error" && <p className="text-xs text-destructive mt-1">Couldn't read: {it.error}</p>}
                    {it.summary && <p className="text-xs text-muted-foreground mt-1">{it.summary}</p>}
                    {it.conclusion && <p className="text-xs text-primary mt-1">Bottom line: {it.conclusion}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                      {it.created_at.slice(0, 10)} · {it.entity_count} links{it.case_id ? ` · ${it.case_id}` : ""} · SHA-256 {it.sha256.slice(0, 16)}…
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function HitList({ hits }: { hits: VaultHit[] }) {
  return (
    <ul className="space-y-2">
      {hits.map((h) => (
        <li key={h.id} className="border border-border rounded-sm p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold truncate">{h.title}</span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
              {KIND_LABEL[h.kind] ?? h.kind} · {h.created_at.slice(0, 10)}
            </span>
          </div>
          {h.summary && <p className="text-xs text-muted-foreground mt-1">{h.summary}</p>}
          {h.key_findings && h.key_findings.length > 0 && (
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {h.key_findings.slice(0, 5).map((f, i) => (
                <li key={i} className="text-xs text-foreground">{f}</li>
              ))}
            </ul>
          )}
          {h.conclusion && <p className="text-xs text-primary mt-1">Bottom line: {h.conclusion}</p>}
          {h.entities.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">Mentions: {h.entities.slice(0, 12).map((e) => e.name).join(", ")}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
