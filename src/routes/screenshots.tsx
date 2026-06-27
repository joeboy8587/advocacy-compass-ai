import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera, Upload, Trash2, Link2, CheckCircle2, AlertTriangle, Loader2, Search,
  Pencil, Save, X, ZoomIn, Plane, MapPin, Clock, Calendar, Hash, Check,
  XCircle, Shield, ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";
import { Fragment, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  uploadScreenshot,
  listScreenshots,
  matchScreenshot,
  updateScreenshot,
  deleteScreenshot,
  analyzeScreenshot,
  type DetectionMatch,
} from "@/lib/screenshots.functions";

export const Route = createFileRoute("/screenshots")({
  head: () => ({ meta: [{ title: "Radar Screenshots // Watchtower" }] }),
  component: ScreenshotsPage,
});

/* ============================================================
   TYPES
   ============================================================ */

type ParsedFile = {
  file: File;
  sha256: string;
  dataUrl: string;
  exifNaiveLocal: string | null;
  exifTakenAt: string | null;
  rawExif: Record<string, unknown> | null;
  tail: string;
  icaoHex: string;
  operator: string;
  aircraftType: string;
  altitude: string;
  groundspeed: string;
  tzOffsetMin: number;
  notes: string;
  scanning: boolean;
  visionApplied: boolean;
  visionError: string | null;
  committing: boolean;
  commitError: string | null;
};

/* ============================================================
   UTILITIES
   ============================================================ */

function statusBarTo24h(time: string | null, period: "AM" | "PM" | null): string | null {
  if (!time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (period === "AM") { if (h === 12) h = 0; }
  else if (period === "PM") { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${min}:00`;
}

function dateFromFile(file: File): string {
  const d = new Date(file.lastModified || Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function naiveLocalToUtcIso(naive: string | null, tzOffsetMin: number): string | null {
  if (!naive) return null;
  const m = naive.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss) - tzOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

function naiveFromExifValue(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") {
    return v.replace(":", "-").replace(":", "-");
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }
  return null;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

function guessTail(s: string): string {
  const m = s.match(/\bN[0-9][0-9A-Z]{1,5}\b/i);
  return m ? m[0].toUpperCase() : "";
}

function formatUtcShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  } catch { return "—"; }
}

function timeAgo(ts: string): string {
  const d = new Date(ts).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

function ScreenshotsPage() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedFile[]>([]);
  const [search, setSearch] = useState("");
  const [defaultTzMin, setDefaultTzMin] = useState(-420);
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Record<string, { status: string; matches: DetectionMatch[] }>>({});
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [windowMin, setWindowMin] = useState(15);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    tail: string;
    icaoHex: string;
    operator: string;
    aircraftType: string;
    tzOffsetMin: number;
    naiveLocal: string;
  } | null>(null);

  /* -- modals -- */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  /* -- queries & mutations -- */
  const list = useQuery({
    queryKey: ["screenshots", search],
    queryFn: () => listScreenshots({ data: { limit: 200, search: search || undefined } }),
    refetchInterval: 60_000,
  });

  const upload = useMutation({
    mutationFn: uploadScreenshot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["screenshots"] }),
  });

  const del = useMutation({
    mutationFn: deleteScreenshot,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["screenshots"] });
      toast.success("Screenshot deleted");
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  });

  /* -- helpers -- */
  const updateParsed = useCallback((idx: number, patch: Partial<ParsedFile>) => {
    setParsed((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }, []);

  const removeParsed = useCallback((idx: number) => {
    setParsed((p) => p.filter((_, i) => i !== idx));
  }, []);

  /* -- file drop -- */
  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const next: ParsedFile[] = [];
    for (const file of Array.from(files)) {
      const buf = await file.arrayBuffer();
      const sha = await sha256Hex(buf);
      const dataUrl = await readDataUrl(file);
      let raw: Record<string, unknown> | null = null;
      let naiveLocal: string | null = null;
      try {
        const exifr = (await import("exifr")).default;
        raw = (await exifr.parse(file, { tiff: true, exif: true, gps: true })) ?? null;
        naiveLocal =
          naiveFromExifValue(raw?.DateTimeOriginal) ||
          naiveFromExifValue(raw?.CreateDate) ||
          naiveFromExifValue(raw?.ModifyDate);
      } catch {
        /* no exif */
      }
      const isoUtc = naiveLocalToUtcIso(naiveLocal, defaultTzMin);
      next.push({
        file,
        sha256: sha,
        dataUrl,
        exifNaiveLocal: naiveLocal,
        exifTakenAt: isoUtc,
        rawExif: raw,
        tail: guessTail(file.name),
        icaoHex: "",
        operator: "",
        aircraftType: "",
        altitude: "",
        groundspeed: "",
        tzOffsetMin: defaultTzMin,
        notes: "",
        scanning: false,
        visionApplied: false,
        visionError: null,
        committing: false,
        commitError: null,
      });
    }
    setParsed((p) => [...next, ...p]);
    setBusy(false);
    toast.success(`${next.length} screenshot${next.length === 1 ? "" : "s"} ready for review`);
    for (const item of next) void runVision(item.sha256, item.dataUrl, item.file);
  }

  /* -- vision -- */
  async function runVision(sha: string, dataUrl: string, file: File) {
    setParsed((all) => all.map((x) => (x.sha256 === sha ? { ...x, scanning: true, visionError: null } : x)));
    try {
      const r = await analyzeScreenshot({ data: { image_data_url: dataUrl } });
      if (!r.ok) {
        setParsed((all) => all.map((x) => (x.sha256 === sha ? { ...x, scanning: false, visionError: r.error } : x)));
        toast.error(`Vision failed: ${r.error}`);
        return;
      }
      const v = r.extract;
      setParsed((all) =>
        all.map((x): ParsedFile => {
          if (x.sha256 !== sha) return x;
          let naive = x.exifNaiveLocal;
          const t = statusBarTo24h(v.status_bar_time, v.status_bar_period);
          if (!naive && t) naive = `${dateFromFile(file)} ${t}`;
          const iso = naiveLocalToUtcIso(naive, x.tzOffsetMin);
          return {
            ...x,
            scanning: false,
            visionApplied: true,
            tail: x.tail || (v.registration ?? ""),
            icaoHex: x.icaoHex || (v.icao_hex ?? ""),
            operator: x.operator || (v.operator ?? ""),
            aircraftType: x.aircraftType || (v.aircraft_type ?? ""),
            altitude: x.altitude || (v.altitude_ft != null ? String(v.altitude_ft) : ""),
            groundspeed: x.groundspeed || (v.groundspeed_kts != null ? String(v.groundspeed_kts) : ""),
            notes: x.notes || (v.notes ?? ""),
            exifNaiveLocal: naive,
            exifTakenAt: iso ?? x.exifTakenAt,
          };
        }),
      );
      const foundFields = [
        v.registration && "tail",
        v.icao_hex && "ICAO",
        v.altitude_ft && "altitude",
        v.groundspeed_kts && "speed",
        v.operator && "operator",
      ].filter(Boolean).join(", ");
      toast.success(foundFields ? `Josiah found: ${foundFields}` : "Josiah scan complete — no aircraft data detected");
    } catch (e) {
      const msg = (e as Error).message ?? "Vision failed";
      setParsed((all) => all.map((x) => (x.sha256 === sha ? { ...x, scanning: false, visionError: msg } : x)));
      toast.error(`Vision error: ${msg}`);
    }
  }

  /* -- commit single -- */
  async function commit(idx: number) {
    const p = parsed[idx];
    setParsed((all) => all.map((x, i) => (i === idx ? { ...x, committing: true, commitError: null } : x)));
    try {
      const statusBarLocal = p.exifNaiveLocal?.match(/(\d{1,2}):(\d{2}):(\d{2})/)?.[0] ?? null;
      const res = await upload.mutateAsync({
        data: {
          filename: p.file.name,
          mime_type: p.file.type || "image/png",
          file_size: p.file.size,
          sha256: p.sha256,
          image_data_url: p.dataUrl.length < 4_500_000 ? p.dataUrl : null,
          exif_taken_at: p.exifTakenAt,
          tz_offset_min: p.tzOffsetMin,
          raw_exif: p.rawExif,
          tail: p.tail || null,
          icao_hex: p.icaoHex || null,
          operator: p.operator || null,
          aircraft_type: p.aircraftType || null,
          altitude_ft: p.altitude ? Number(p.altitude) : null,
          groundspeed_kts: p.groundspeed ? Number(p.groundspeed) : null,
          notes: p.notes || null,
          status_bar_local: statusBarLocal,
        },
      });

      if (res.duplicate) {
        toast.info(`Screenshot already in vault (duplicate)`);
        removeParsed(idx);
        return;
      }

      let matchInfo: { status: string; matches: DetectionMatch[] } | null = null;
      if (p.tail || p.icaoHex) {
        try {
          const m = await matchScreenshot({ data: { id: res.id, window_seconds: 900, tod_days: 14 } });
          setMatches((prev) => ({ ...prev, [res.id]: m }));
          matchInfo = m;
        } catch {
          /* silent — match is optional */
        }
      }

      removeParsed(idx);
      const tail = p.tail || p.icaoHex || "screenshot";
      if (matchInfo && matchInfo.matches.length > 0) {
        const best = matchInfo.matches[0];
        toast.success(
          `${tail} committed · ${matchInfo.matches.length} ADS-B match${matchInfo.matches.length === 1 ? "" : "es"} (best Δ${best.delta_s}s)`,
        );
      } else {
        toast.success(`${tail} committed to vault` + (p.tail || p.icaoHex ? " · no ADS-B match found" : ""));
      }
    } catch (e) {
      const msg = (e as Error).message ?? "Upload failed";
      setParsed((all) => all.map((x, i) => (i === idx ? { ...x, committing: false, commitError: msg } : x)));
      toast.error(`Commit failed: ${msg}`);
    }
  }

  /* -- commit all (process from end so indices stay valid) -- */
  async function commitAll() {
    if (!parsed.length) return;
    let success = 0;
    let failed = 0;
    // Process from the end so removing doesn't shift remaining indices
    for (let i = parsed.length - 1; i >= 0; i--) {
      try {
        await commit(i);
        success++;
      } catch {
        failed++;
      }
    }
    if (success > 0) toast.success(`${success} screenshot${success === 1 ? "" : "s"} committed`);
    if (failed > 0) toast.error(`${failed} screenshot${failed === 1 ? "" : "s"} failed to commit`);
  }

  /* -- match single vault item -- */
  async function runMatch(id: string) {
    setMatchingId(id);
    try {
      const m = await matchScreenshot({ data: { id, window_seconds: windowMin * 60, tod_days: 14 } });
      setMatches((prev) => ({ ...prev, [id]: m }));
      qc.invalidateQueries({ queryKey: ["screenshots"] });
      if (m.matches.length > 0) {
        toast.success(`${m.matches.length} ADS-B detection${m.matches.length === 1 ? "" : "s"} found (${m.status})`);
      } else {
        toast.info("No ADS-B detections found for this identity/time");
      }
    } catch (e) {
      const msg = (e as Error).message ?? "Match failed";
      toast.error(`Match failed: ${msg}`);
    } finally {
      setMatchingId(null);
    }
  }

  /* -- edit -- */
  function startEdit(s: {
    id: string;
    tail: string | null;
    icao_hex: string | null;
    operator: string | null;
    aircraft_type: string | null;
    exif_taken_at: string | null;
    tz_offset_min: number | null;
  }) {
    let naive = "";
    if (s.exif_taken_at) {
      const off = s.tz_offset_min ?? defaultTzMin;
      const local = new Date(new Date(s.exif_taken_at).getTime() + off * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      naive = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
    }
    setEditId(s.id);
    setEditDraft({
      tail: s.tail ?? "",
      icaoHex: s.icao_hex ?? "",
      operator: s.operator ?? "",
      aircraftType: s.aircraft_type ?? "",
      tzOffsetMin: s.tz_offset_min ?? defaultTzMin,
      naiveLocal: naive,
    });
  }

  async function saveEdit() {
    if (!editId || !editDraft) return;
    const isoUtc = naiveLocalToUtcIso(editDraft.naiveLocal || null, editDraft.tzOffsetMin);
    await updateScreenshot({
      data: {
        id: editId,
        tail: editDraft.tail || null,
        icao_hex: editDraft.icaoHex || null,
        operator: editDraft.operator || null,
        aircraft_type: editDraft.aircraftType || null,
        exif_taken_at: isoUtc,
        tz_offset_min: editDraft.tzOffsetMin,
      },
    });
    const id = editId;
    setEditId(null);
    setEditDraft(null);
    await qc.invalidateQueries({ queryKey: ["screenshots"] });
    toast.success("Screenshot updated");
    await runMatch(id);
  }

  /* -- delete with confirmation -- */
  function confirmDelete(id: string, name: string) {
    setDeleteTarget({ id, name });
  }

  function executeDelete() {
    if (!deleteTarget) return;
    del.mutate({ data: { id: deleteTarget.id } });
    setDeleteTarget(null);
  }

  /* -- preview -- */
  function openPreview(url: string, title: string) {
    setPreviewUrl(url);
    setPreviewTitle(title);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl neon-text-orange flex items-center gap-3">
            <Camera className="size-6" /> Radar Screenshot Vault
          </h1>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            SHA-256 fingerprint · EXIF forensic timestamp · ADS-B cross-match · four-factor lock
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest">
          <label className="text-muted-foreground">Screenshot TZ</label>
          <select
            value={defaultTzMin}
            onChange={(e) => setDefaultTzMin(Number(e.target.value))}
            className="bg-secondary/30 border border-border rounded-sm px-2 py-1"
          >
            <option value={-420}>PDT (UTC−7)</option>
            <option value={-480}>PST (UTC−8)</option>
            <option value={-360}>MDT (UTC−6)</option>
            <option value={-300}>EDT (UTC−5)</option>
            <option value={0}>UTC</option>
          </select>
        </div>
      </header>

      {/* Drop zone */}
      <label className="panel scanline flex flex-col items-center justify-center gap-2 py-10 cursor-pointer border-dashed border-2 border-accent/40 hover:border-accent transition">
        <Upload className="size-8 text-accent" />
        <div className="text-sm uppercase tracking-widest text-accent">Drop radar screenshots or click to upload</div>
        <div className="text-[11px] text-muted-foreground">
          PNG / JPG · EXIF parsed client-side · hashed before upload · screenshot time converted from selected TZ → UTC
        </div>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {busy && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Hashing & extracting EXIF…
        </div>
      )}

      {/* Pending uploads */}
      {parsed.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xs uppercase tracking-widest text-accent">
              Pending — {parsed.length} screenshot{parsed.length === 1 ? "" : "s"} to review
            </h2>
            {parsed.length > 1 && (
              <button
                onClick={commitAll}
                disabled={parsed.some((p) => p.committing) || upload.isPending}
                className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-accent text-accent-foreground rounded-sm hover:opacity-90 inline-flex items-center gap-1"
              >
                <Check className="size-3" />
                Commit All ({parsed.length})
              </button>
            )}
          </div>
          {parsed.map((p, i) => (
            <div key={p.sha256} className="panel grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 p-4">
              <div className="relative group cursor-pointer" onClick={() => openPreview(p.dataUrl, p.file.name)}>
                <img src={p.dataUrl} alt={p.file.name} className="rounded-sm border border-border max-h-48 object-contain w-full" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition rounded-sm">
                  <ZoomIn className="size-6 text-accent" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono text-accent">{p.file.name}</span>
                  <span className="text-muted-foreground">{(p.file.size / 1024).toFixed(0)} KB</span>
                  <span className="font-mono text-muted-foreground" title={p.sha256}>
                    sha256:{p.sha256.slice(0, 16)}…
                  </span>
                  {p.exifNaiveLocal ? (
                    <>
                      <span className="text-muted-foreground">camera local {p.exifNaiveLocal}</span>
                      <span className="text-accent">
                        <Clock className="size-3 inline mr-1" />
                        UTC {formatUtcShort(p.exifTakenAt)}
                      </span>
                    </>
                  ) : (
                    <span className="text-primary flex items-center gap-1">
                      <AlertTriangle className="size-3" /> No EXIF timestamp — will use time-of-day fallback for matching
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Field label="Tail">
                    <input value={p.tail} onChange={(e) => updateParsed(i, { tail: e.target.value.toUpperCase() })} placeholder="N913KC" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="ICAO Hex">
                    <input value={p.icaoHex} onChange={(e) => updateParsed(i, { icaoHex: e.target.value.toLowerCase() })} placeholder="ae12fd" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="Altitude ft">
                    <input value={p.altitude} onChange={(e) => updateParsed(i, { altitude: e.target.value })} placeholder="1575" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="GS kts">
                    <input value={p.groundspeed} onChange={(e) => updateParsed(i, { groundspeed: e.target.value })} placeholder="113" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="Operator">
                    <input value={p.operator} onChange={(e) => updateParsed(i, { operator: e.target.value })} placeholder="Kern County Sheriff" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="Aircraft">
                    <input value={p.aircraftType} onChange={(e) => updateParsed(i, { aircraftType: e.target.value })} placeholder="Airbus H125" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                  <Field label="Screenshot TZ (camera local)">
                    <select
                      value={p.tzOffsetMin}
                      onChange={(e) => {
                        const newOffset = Number(e.target.value);
                        const iso = naiveLocalToUtcIso(p.exifNaiveLocal, newOffset);
                        updateParsed(i, { tzOffsetMin: newOffset, exifTakenAt: iso });
                      }}
                      className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full"
                    >
                      <option value={-420}>PDT (UTC−7)</option>
                      <option value={-480}>PST (UTC−8)</option>
                      <option value={-360}>MDT (UTC−6)</option>
                      <option value={-300}>EDT (UTC−5)</option>
                      <option value={0}>UTC</option>
                    </select>
                  </Field>
                  <Field label="Notes">
                    <input value={p.notes} onChange={(e) => updateParsed(i, { notes: e.target.value })} placeholder="…" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                  </Field>
                </div>

                {/* Error banner */}
                {p.commitError && (
                  <div className="flex items-center gap-2 text-[11px] text-primary bg-primary/10 border border-primary/30 rounded-sm px-3 py-2">
                    <XCircle className="size-3 shrink-0" />
                    {p.commitError}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2 items-center">
                  <button
                    onClick={() => commit(i)}
                    disabled={p.committing}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-primary text-primary-foreground rounded-sm hover:opacity-90 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {p.committing ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    {p.committing ? "Committing…" : "Hash · Store · Match"}
                  </button>
                  <button
                    onClick={() => runVision(p.sha256, p.dataUrl, p.file)}
                    disabled={p.scanning}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest border border-accent/60 text-accent rounded-sm hover:bg-accent/10 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {p.scanning ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {p.scanning ? "Josiah scanning…" : p.visionApplied ? "Re-scan with Josiah" : "Scan with Josiah"}
                  </button>
                  <button
                    onClick={() => removeParsed(i)}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest border border-border rounded-sm hover:border-primary hover:text-primary inline-flex items-center gap-1"
                  >
                    <X className="size-3" /> Discard
                  </button>
                  {p.visionApplied && !p.scanning && (
                    <span className="text-[10px] uppercase tracking-widest text-accent inline-flex items-center gap-1">
                      <CheckCircle2 className="size-3" /> Vision applied
                    </span>
                  )}
                  {p.visionError && (
                    <span className="text-[10px] uppercase tracking-widest text-primary inline-flex items-center gap-1">
                      <AlertTriangle className="size-3" /> Vision error
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Vault */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xs uppercase tracking-widest text-accent flex items-center gap-2">
            <Shield className="size-3" /> Vault · {list.data?.length ?? 0} screenshot{list.data?.length === 1 ? "" : "s"}
          </h2>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Clock className="size-3" /> Match window ±
              <select
                value={windowMin}
                onChange={(e) => setWindowMin(Number(e.target.value))}
                className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs"
              >
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
                <option value={60}>1 hr</option>
                <option value={360}>6 hr</option>
                <option value={1440}>24 hr</option>
              </select>
            </label>
            <div className="flex items-center gap-1 border border-border rounded-sm bg-secondary/30 px-2">
              <Search className="size-3 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tail / ICAO / operator / filename"
                className="bg-transparent text-xs px-1 py-1 w-72 outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>
        </div>

        <div className="panel scanline overflow-x-auto">
          <table className="w-full text-xs min-w-[1200px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
              <tr>
                <th className="text-left py-2 px-3 w-16">Preview</th>
                <th className="text-left py-2 px-3">Uploaded</th>
                <th className="text-left py-2 px-3">EXIF (UTC)</th>
                <th className="text-left py-2 px-3">Tail / ICAO</th>
                <th className="text-left py-2 px-3">Operator</th>
                <th className="text-right py-2 px-3">Alt</th>
                <th className="text-left py-2 px-3">Match</th>
                <th className="text-left py-2 px-3">SHA-256</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-t border-border/40 hover:bg-secondary/30 transition-colors">
                    {/* Thumbnail */}
                    <td className="py-2 px-3">
                      {s.image_data ? (
                        <div
                          className="w-12 h-12 rounded-sm border border-border overflow-hidden cursor-pointer hover:border-accent transition"
                          onClick={() => openPreview(s.image_data!, s.filename)}
                        >
                          <img src={s.image_data} alt={s.filename} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-sm border border-border bg-secondary/30 flex items-center justify-center">
                          <Camera className="size-4 text-muted-foreground" />
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      <Calendar className="size-3 inline mr-1" />
                      {timeAgo(s.uploaded_at)}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {s.exif_taken_at ? formatUtcShort(s.exif_taken_at) : "—"}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      <div className="text-accent flex items-center gap-1">
                        <Plane className="size-3" />
                        {s.tail ?? "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Hash className="size-3" />
                        {s.icao_hex ?? "—"}
                      </div>
                    </td>
                    <td className="py-2 px-3">{s.operator ?? "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {s.altitude_ft != null ? `${s.altitude_ft.toLocaleString()} ft` : "—"}
                    </td>
                    <td className="py-2 px-3">
                      <MatchBadge status={s.match_status} count={s.match_count} deltaS={s.best_match_delta_s} />
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground" title={s.sha256}>
                      <span className="flex items-center gap-1">
                        <Shield className="size-3" />
                        {s.sha256.slice(0, 12)}…
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => runMatch(s.id)}
                          disabled={matchingId === s.id}
                          className="text-accent hover:underline text-[10px] uppercase tracking-widest inline-flex items-center gap-1 disabled:opacity-50"
                          title="Match against ADS-B detections"
                        >
                          <Link2 className="size-3" />
                          {matchingId === s.id ? "Matching…" : "Re-match"}
                        </button>
                        <button
                          onClick={() => startEdit(s)}
                          className="p-1 text-muted-foreground hover:text-accent rounded-sm"
                          title="Edit identity / timestamp"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          onClick={() => confirmDelete(s.id, s.filename)}
                          className="p-1 text-muted-foreground hover:text-primary rounded-sm"
                          title="Delete"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Edit row */}
                  {editId === s.id && editDraft ? (
                    <tr className="bg-secondary/20">
                      <td colSpan={9} className="py-3 px-3">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs items-end">
                          <Field label="Tail">
                            <input value={editDraft.tail} onChange={(e) => setEditDraft({ ...editDraft, tail: e.target.value.toUpperCase() })} placeholder="N913KC" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                          </Field>
                          <Field label="ICAO Hex">
                            <input value={editDraft.icaoHex} onChange={(e) => setEditDraft({ ...editDraft, icaoHex: e.target.value.toLowerCase() })} placeholder="aca2b4" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                          </Field>
                          <Field label="Operator">
                            <input value={editDraft.operator} onChange={(e) => setEditDraft({ ...editDraft, operator: e.target.value })} className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-accent w-full" />
                          </Field>
                          <Field label="Aircraft">
                            <input value={editDraft.aircraftType} onChange={(e) => setEditDraft({ ...editDraft, aircraftType: e.target.value })} className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-accent w-full" />
                          </Field>
                          <Field label="Camera local (YYYY-MM-DD HH:MM:SS)">
                            <input value={editDraft.naiveLocal} onChange={(e) => setEditDraft({ ...editDraft, naiveLocal: e.target.value })} placeholder="2026-06-21 01:55:00" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent w-full" />
                          </Field>
                          <Field label="Camera TZ">
                            <select
                              value={editDraft.tzOffsetMin}
                              onChange={(e) => setEditDraft({ ...editDraft, tzOffsetMin: Number(e.target.value) })}
                              className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs w-full"
                            >
                              <option value={-420}>PDT (UTC−7)</option>
                              <option value={-480}>PST (UTC−8)</option>
                              <option value={-360}>MDT (UTC−6)</option>
                              <option value={-300}>EDT (UTC−5)</option>
                              <option value={0}>UTC</option>
                            </select>
                          </Field>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-[11px]">
                          <span className="text-muted-foreground">
                            <Clock className="size-3 inline mr-1" />
                            → UTC {formatUtcShort(naiveLocalToUtcIso(editDraft.naiveLocal || null, editDraft.tzOffsetMin))}
                          </span>
                          <button onClick={saveEdit} className="ml-auto px-3 py-1 text-[11px] uppercase tracking-widest bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1 hover:opacity-90">
                            <Save className="size-3" /> Save & re-match (±{windowMin >= 60 ? `${windowMin / 60}h` : `${windowMin}m`})
                          </button>
                          <button onClick={() => { setEditId(null); setEditDraft(null); }} className="px-3 py-1 text-[11px] uppercase tracking-widest border border-border rounded-sm inline-flex items-center gap-1 hover:bg-secondary/40">
                            <X className="size-3" /> Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}

                  {/* Matches row */}
                  {matches[s.id]?.matches?.length ? (
                    <tr className="bg-secondary/10">
                      <td colSpan={9} className="py-2 px-3">
                        <button
                          onClick={() => setExpandedMatchId(expandedMatchId === s.id ? null : s.id)}
                          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-accent mb-1 hover:underline"
                        >
                          {expandedMatchId === s.id ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                          {matches[s.id].matches.length} ADS-B detection{matches[s.id].matches.length === 1 ? "" : "s"} within ±{windowMin >= 60 ? `${windowMin / 60} hr` : `${windowMin} min`} · method: {matches[s.id].status}
                        </button>
                        <div className={`grid gap-1 transition-all ${expandedMatchId === s.id ? "grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1" : "grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1"}`}>
                          {(expandedMatchId === s.id ? matches[s.id].matches : matches[s.id].matches.slice(0, 4)).map((m) => (
                            <div key={m.id} className={`flex justify-between gap-2 p-1.5 rounded-sm ${m.delta_s <= 60 ? "bg-accent/10 border border-accent/30" : "border border-transparent"}`}>
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Clock className="size-3" />
                                Δ{m.delta_s}s · {new Date(m.captured_at).toISOString().slice(11, 19)}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="flex items-center gap-1">
                                  <Plane className="size-3 text-accent" />
                                  {m.registration ?? m.icao_hex}
                                </span>
                                <span className="text-muted-foreground">
                                  {m.altitude_ft != null ? `${m.altitude_ft.toLocaleString()}ft` : "—"}
                                </span>
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <MapPin className="size-3" />
                                  {m.county ?? "—"}
                                </span>
                                {m.latitude != null && m.longitude != null && (
                                  <a
                                    href={`https://www.google.com/maps?q=${m.latitude},${m.longitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:underline flex items-center gap-0.5"
                                    title="View on map"
                                  >
                                    <MapPin className="size-3" /> map
                                  </a>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                        {!expandedMatchId && matches[s.id].matches.length > 4 && (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            +{matches[s.id].matches.length - 4} more detections — click to expand
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {list.isLoading && (
                <tr><td colSpan={9} className="py-8">
                  <div className="space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-12 bg-secondary/50 rounded-sm animate-pulse" />
                    ))}
                  </div>
                </td></tr>
              )}
              {!list.isLoading && !list.data?.length && (
                <tr><td colSpan={9} className="py-12 text-center">
                  <div className="space-y-3">
                    <Camera className="size-10 text-muted-foreground mx-auto opacity-40" />
                    <div className="text-muted-foreground uppercase tracking-widest text-xs">Vault is empty — drop a screenshot above</div>
                  </div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Image Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 size-7 rounded-full bg-card border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition z-10"
            >
              <X className="size-4" />
            </button>
            <img src={previewUrl} alt={previewTitle} className="max-w-full max-h-[85vh] rounded-md border border-border object-contain" />
            <div className="text-center text-[10px] text-muted-foreground mt-2 uppercase tracking-widest">{previewTitle}</div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="panel p-6 max-w-sm w-full mx-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-primary">
              <AlertTriangle className="size-5" />
              <h3 className="text-sm uppercase tracking-widest font-bold">Confirm Delete</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Delete <span className="text-accent font-mono">{deleteTarget.name}</span> from the vault? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-[11px] uppercase tracking-widest border border-border rounded-sm hover:bg-secondary/40"
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={del.isPending}
                className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-primary text-primary-foreground rounded-sm hover:opacity-90 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {del.isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SUB-COMPONENTS
   ============================================================ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function MatchBadge({ status, count, deltaS }: { status: string; count: number; deltaS: number | null }) {
  const tone =
    status === "LOCKED"
      ? "border-accent text-accent bg-accent/10"
      : status === "STRONG"
        ? "border-accent/60 text-accent/80"
        : status === "WEAK"
          ? "border-primary/60 text-primary/80"
          : status === "PENDING"
            ? "border-border text-muted-foreground"
            : "border-primary text-primary bg-primary/10";
  return (
    <div className="flex items-center gap-1">
      <span className={`px-1.5 py-0.5 text-[10px] uppercase rounded-sm border ${tone} inline-flex items-center gap-1`}>
        {status === "LOCKED" && <CheckCircle2 className="size-3" />}
        {status === "NO_MATCH" && <AlertTriangle className="size-3" />}
        {status === "NO_AIRCRAFT" && <XCircle className="size-3" />}
        {status}
      </span>
      {count > 0 && (
        <span className="text-[10px] text-muted-foreground">
          {count} hit{count === 1 ? "" : "s"}{deltaS !== null ? ` · Δ${deltaS}s` : ""}
        </span>
      )}
    </div>
  );
}
