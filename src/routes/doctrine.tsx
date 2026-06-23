import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { BookOpen, Upload, Trash2, FileText, Loader2, ShieldCheck, X } from "lucide-react";
import {
  listDoctrine,
  ingestDoctrine,
  getDoctrineDoc,
  deleteDoctrine,
} from "@/lib/doctrine.functions";

const search = z.object({ id: z.string().optional() });

export const Route = createFileRoute("/doctrine")({
  head: () => ({ meta: [{ title: "Doctrine Library // Watchtower" }] }),
  validateSearch: search,
  component: Doctrine,
});

const CLASSIFICATIONS = [
  { value: "POLICY", label: "Agency Policy" },
  { value: "REGULATION", label: "Regulation / Statute" },
  { value: "REPORT", label: "Watchtower Report" },
  { value: "DOCTRINE", label: "Constitutional / Doctrinal" },
  { value: "EVIDENCE", label: "Court / Evidence" },
  { value: "REFERENCE", label: "Reference / Other" },
] as const;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function extractText(file: File): Promise<{ text: string; pages?: number }> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Use bundled worker via blob URL to avoid network worker fetch
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    (pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = workerSrc;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? (it as { str: string }).str : "")).join(" ") + "\n\n";
    }
    return { text, pages: doc.numPages };
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { text: result.value };
  }

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return { text: new TextDecoder().decode(buf) };
  }

  throw new Error(`Unsupported file type: ${name}. Use PDF, DOCX, TXT, or MD.`);
}

function Doctrine() {
  const { id } = Route.useSearch();
  const nav = useNavigate({ from: "/doctrine" });
  const qc = useQueryClient();

  const ingestFn = useServerFn(ingestDoctrine);
  const deleteFn = useServerFn(deleteDoctrine);

  const docs = useQuery({ queryKey: ["doctrine"], queryFn: () => listDoctrine() });
  const selected = useQuery({
    queryKey: ["doctrine", id],
    queryFn: () => getDoctrineDoc({ data: { id: id! } }),
    enabled: !!id,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [classification, setClassification] = useState<string>("REFERENCE");

  const ingestMutation = useMutation({
    mutationFn: async (file: File) => {
      setErr(null);
      setBusy(`Reading ${file.name}…`);
      const { text, pages } = await extractText(file);
      if (!text.trim()) throw new Error("No text extracted from document");
      setBusy(`Hashing ${file.name}…`);
      const sha = await sha256Hex(new TextEncoder().encode(text).buffer);
      setBusy(`Storing ${file.name}…`);
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      return ingestFn({
        data: {
          title,
          sourceType: file.type || "application/octet-stream",
          classification,
          originalFilename: file.name,
          sha256: sha,
          byteSize: file.size,
          pageCount: pages,
          content: text,
        },
      });
    },
    onSuccess: () => {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["doctrine"] });
    },
    onError: (e: Error) => {
      setBusy(null);
      setErr(e.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => deleteFn({ data: { id: docId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["doctrine"] });
      if (id) nav({ search: {} });
    },
  });

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      for (const f of Array.from(files)) {
        try {
          await ingestMutation.mutateAsync(f);
        } catch {
          /* shown via err state */
          break;
        }
      }
    },
    [ingestMutation],
  );

  const list = docs.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl neon-text-orange flex items-center gap-3">
            <BookOpen className="size-6" /> Doctrine Library
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            Reference corpus · SHA-256 sealed · auto-fed to Josiah · {list.length} documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className="bg-secondary/30 border border-border rounded-sm text-xs px-2 py-1 uppercase tracking-widest"
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!!busy}
            className="flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-widest rounded-sm border border-accent text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
            Upload PDF / DOCX / TXT
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      </header>

      {busy && (
        <div className="panel p-3 text-xs text-accent flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> {busy}
        </div>
      )}
      {err && (
        <div className="panel p-3 text-xs border-primary text-primary flex items-center justify-between">
          <span>⚠ {err}</span>
          <button onClick={() => setErr(null)}><X className="size-3" /></button>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        className="grid grid-cols-12 gap-4"
      >
        <aside className="col-span-4 panel scanline p-0 overflow-hidden">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground p-3 border-b border-border">
            Corpus
          </div>
          {list.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <Upload className="size-6 mx-auto mb-2 opacity-40" />
              Drop a PDF / DOCX here<br />or use the upload button.
            </div>
          )}
          <ul>
            {list.map((d) => (
              <li
                key={d.id}
                className={`border-t border-border/40 px-3 py-2 cursor-pointer hover:bg-secondary/30 ${
                  id === d.id ? "bg-secondary/40" : ""
                }`}
                onClick={() => nav({ search: { id: d.id } })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate" title={d.title}>{d.title}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5 flex items-center gap-2">
                      <span className="text-accent">{d.classification}</span>
                      {d.page_count && <span>{d.page_count}p</span>}
                      <span>{Math.round((d.char_count ?? 0) / 1000)}k chars</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate" title={d.sha256}>
                      {d.sha256.slice(0, 16)}…
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove "${d.title}" from doctrine?`)) deleteMutation.mutate(d.id);
                    }}
                    className="text-muted-foreground hover:text-primary"
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="col-span-8 panel scanline p-0 overflow-hidden min-h-[60vh]">
          {!id && (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-12 text-center">
              <FileText className="size-10 mb-3 opacity-40" />
              <div className="text-xs uppercase tracking-widest">Select a document to view</div>
              <div className="text-[11px] mt-2 max-w-md">
                Uploaded documents are SHA-256 fingerprinted, stored in Neon, and
                surfaced to Josiah automatically when an investigation matches their keywords.
              </div>
            </div>
          )}
          {id && selected.isLoading && (
            <div className="p-12 text-center text-xs text-muted-foreground">Loading…</div>
          )}
          {id && selected.data && (
            <div className="flex flex-col h-full">
              <div className="border-b border-border p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg neon-text-green">{selected.data.title}</h2>
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-accent">
                    <ShieldCheck className="size-3" /> Hash sealed
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest flex flex-wrap gap-3">
                  <span>{selected.data.classification}</span>
                  {selected.data.original_filename && <span>{selected.data.original_filename}</span>}
                  {selected.data.page_count && <span>{selected.data.page_count} pages</span>}
                  <span>{Math.round((selected.data.char_count ?? 0) / 1000)}k chars</span>
                  <span>{new Date(selected.data.uploaded_at).toLocaleString()}</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground break-all">
                  sha256: {selected.data.sha256}
                </div>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-xs whitespace-pre-wrap font-mono text-foreground/90 leading-relaxed">
                {selected.data.content}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
