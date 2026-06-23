import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Upload, Trash2, Link2, CheckCircle2, AlertTriangle, Loader2, Search, Pencil, Save, X } from "lucide-react";
import { Fragment, useState } from "react";
// exifr is dynamically imported inside handleFiles to avoid SSR/hydration issues
import {
  uploadScreenshot,
  listScreenshots,
  matchScreenshot,
  updateScreenshot,
  deleteScreenshot,
  type DetectionMatch,
} from "@/lib/screenshots.functions";

export const Route = createFileRoute("/screenshots")({
  head: () => ({ meta: [{ title: "Radar Screenshots // Watchtower" }] }),
  component: ScreenshotsPage,
});

type ParsedFile = {
  file: File;
  sha256: string;
  dataUrl: string;
  exifNaiveLocal: string | null; // "YYYY-MM-DD HH:MM:SS" as written by camera, no TZ
  exifTakenAt: string | null; // UTC ISO derived from naive + tzOffsetMin
  rawExif: Record<string, unknown> | null;
  tail: string;
  icaoHex: string;
  operator: string;
  aircraftType: string;
  altitude: string;
  groundspeed: string;
  tzOffsetMin: number; // minutes east of UTC; PDT = -420
  notes: string;
};

// Build a UTC ISO from a naive local "YYYY-MM-DD HH:MM:SS" string + a tz offset
// in minutes (PDT = -420 → UTC = local + 420 min). This bypasses the browser TZ
// entirely so the same screenshot resolves to the same UTC no matter where it's processed.
function naiveLocalToUtcIso(naive: string | null, tzOffsetMin: number): string | null {
  if (!naive) return null;
  const m = naive.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss) - tzOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

// Extract a "YYYY-MM-DD HH:MM:SS" naive local string from whatever exifr returned.
function naiveFromExifValue(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") {
    // EXIF spec format is "YYYY:MM:DD HH:MM:SS"
    return v.replace(":", "-").replace(":", "-");
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // exifr parsed the naive EXIF as if it were UTC. Re-extract UTC fields as the naive components.
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

// Try to pull a tail # like N123AB out of the filename or OCR-less text fields
function guessTail(s: string): string {
  const m = s.match(/\bN[0-9][0-9A-Z]{1,5}\b/i);
  return m ? m[0].toUpperCase() : "";
}

function ScreenshotsPage() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedFile[]>([]);
  const [search, setSearch] = useState("");
  const [defaultTzMin, setDefaultTzMin] = useState(-420); // PDT
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Record<string, { status: string; matches: DetectionMatch[] }>>({});
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [windowMin, setWindowMin] = useState(15); // ± minutes for re-match
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    tail: string;
    icaoHex: string;
    operator: string;
    aircraftType: string;
    tzOffsetMin: number;
    naiveLocal: string;
  } | null>(null);

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["screenshots"] }),
  });

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
      // Camera writes naive local time (no TZ). Convert with user-selected offset.
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
      });
    }
    setParsed((p) => [...next, ...p]);
    setBusy(false);
  }

  function updateParsed(idx: number, patch: Partial<ParsedFile>) {
    setParsed((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  async function commit(idx: number) {
    const p = parsed[idx];
    const res = await upload.mutateAsync({
      data: {
        filename: p.file.name,
        mime_type: p.file.type || "image/png",
        file_size: p.file.size,
        sha256: p.sha256,
        image_data_url: p.dataUrl.length < 4_500_000 ? p.dataUrl : null, // skip >~4MB
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
      },
    });
    // Auto-match if we have a timestamp + aircraft identity
    if (p.exifTakenAt && (p.tail || p.icaoHex)) {
      try {
        const m = await matchScreenshot({ data: { id: res.id, window_seconds: 900 } });
        setMatches((prev) => ({ ...prev, [res.id]: m }));
      } catch {
        /* keep silent — user can retry */
      }
    }
    setParsed((all) => all.filter((_, i) => i !== idx));
  }

  async function runMatch(id: string) {
    setMatchingId(id);
    try {
      const m = await matchScreenshot({ data: { id, window_seconds: windowMin * 60 } });
      setMatches((prev) => ({ ...prev, [id]: m }));
      qc.invalidateQueries({ queryKey: ["screenshots"] });
    } finally {
      setMatchingId(null);
    }
  }

  function startEdit(s: {
    id: string;
    tail: string | null;
    icao_hex: string | null;
    operator: string | null;
    aircraft_type: string | null;
    exif_taken_at: string | null;
    tz_offset_min: number | null;
  }) {
    // Derive naive local from current stored UTC + stored offset (best-effort).
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
    await runMatch(id);
  }

  return (
    <div className="p-6 space-y-6">
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
          <h2 className="text-xs uppercase tracking-widest text-accent">Pending — review then commit</h2>
          {parsed.map((p, i) => (
            <div key={p.sha256} className="panel grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 p-4">
              <img src={p.dataUrl} alt={p.file.name} className="rounded-sm border border-border max-h-48 object-contain" />
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
                      <span className="text-accent">→ UTC {p.exifTakenAt ? new Date(p.exifTakenAt).toISOString().replace("T", " ").slice(0, 19) : "—"}</span>
                    </>
                  ) : (
                    <span className="text-primary flex items-center gap-1">
                      <AlertTriangle className="size-3" /> No EXIF timestamp
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Field label="Tail">
                    <input value={p.tail} onChange={(e) => updateParsed(i, { tail: e.target.value.toUpperCase() })} placeholder="N913KC" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="ICAO Hex">
                    <input value={p.icaoHex} onChange={(e) => updateParsed(i, { icaoHex: e.target.value.toLowerCase() })} placeholder="ae12fd" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="Altitude ft">
                    <input value={p.altitude} onChange={(e) => updateParsed(i, { altitude: e.target.value })} placeholder="1575" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="GS kts">
                    <input value={p.groundspeed} onChange={(e) => updateParsed(i, { groundspeed: e.target.value })} placeholder="113" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="Operator">
                    <input value={p.operator} onChange={(e) => updateParsed(i, { operator: e.target.value })} placeholder="Kern County Sheriff" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="Aircraft">
                    <input value={p.aircraftType} onChange={(e) => updateParsed(i, { aircraftType: e.target.value })} placeholder="Airbus H125" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                  <Field label="Screenshot TZ (camera local)">
                    <select
                      value={p.tzOffsetMin}
                      onChange={(e) => {
                        const newOffset = Number(e.target.value);
                        const iso = naiveLocalToUtcIso(p.exifNaiveLocal, newOffset);
                        updateParsed(i, { tzOffsetMin: newOffset, exifTakenAt: iso });
                      }}
                      className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent"
                    >
                      <option value={-420}>PDT (UTC−7)</option>
                      <option value={-480}>PST (UTC−8)</option>
                      <option value={-360}>MDT (UTC−6)</option>
                      <option value={-300}>EDT (UTC−5)</option>
                      <option value={0}>UTC</option>
                    </select>
                  </Field>
                  <Field label="Notes">
                    <input value={p.notes} onChange={(e) => updateParsed(i, { notes: e.target.value })} placeholder="…" className="bg-secondary/30 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                  </Field>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => commit(i)}
                    disabled={upload.isPending}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-primary text-primary-foreground rounded-sm hover:opacity-90"
                  >
                    {upload.isPending ? "Committing…" : "Hash · Store · Match"}
                  </button>
                  <button
                    onClick={() => setParsed((all) => all.filter((_, idx) => idx !== i))}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest border border-border rounded-sm hover:border-primary hover:text-primary"
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Vault */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xs uppercase tracking-widest text-accent">Vault · {list.data?.length ?? 0} screenshots</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Match window ±
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
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground bg-secondary/40">
              <tr>
                <th className="text-left py-2 px-3">Uploaded</th>
                <th className="text-left py-2 px-3">EXIF (UTC)</th>
                <th className="text-left py-2 px-3">Tail / ICAO</th>
                <th className="text-left py-2 px-3">Operator</th>
                <th className="text-right py-2 px-3">Alt</th>
                <th className="text-left py-2 px-3">Match</th>
                <th className="text-left py-2 px-3">SHA-256</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.map((s) => (
                <Fragment key={s.id}>
                  <tr key={s.id} className="border-t border-border/40 hover:bg-secondary/30">
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {new Date(s.uploaded_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {s.exif_taken_at ? new Date(s.exif_taken_at).toISOString().replace("T", " ").slice(0, 19) : "—"}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      <div className="text-accent">{s.tail ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">{s.icao_hex ?? ""}</div>
                    </td>
                    <td className="py-2 px-3">{s.operator ?? "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{s.altitude_ft ?? "—"}</td>
                    <td className="py-2 px-3">
                      <MatchBadge status={s.match_status} count={s.match_count} deltaS={s.best_match_delta_s} />
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px] text-muted-foreground" title={s.sha256}>
                      {s.sha256.slice(0, 14)}…
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => runMatch(s.id)}
                        disabled={matchingId === s.id}
                        className="text-accent hover:underline text-[10px] uppercase tracking-widest mr-2 inline-flex items-center gap-1"
                      >
                        <Link2 className="size-3" />
                        {matchingId === s.id ? "Matching…" : "Re-match"}
                      </button>
                      <button
                        onClick={() => startEdit(s)}
                        className="text-muted-foreground hover:text-accent mr-2"
                        title="Edit identity / timestamp"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        onClick={() => del.mutate({ data: { id: s.id } })}
                        className="text-muted-foreground hover:text-primary"
                        title="Delete"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </td>
                  </tr>
                  {editId === s.id && editDraft ? (
                    <tr key={s.id + "-edit"} className="bg-secondary/20">
                      <td colSpan={8} className="py-3 px-3">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs items-end">
                          <Field label="Tail">
                            <input value={editDraft.tail} onChange={(e) => setEditDraft({ ...editDraft, tail: e.target.value.toUpperCase() })} placeholder="N913KC" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                          </Field>
                          <Field label="ICAO Hex">
                            <input value={editDraft.icaoHex} onChange={(e) => setEditDraft({ ...editDraft, icaoHex: e.target.value.toLowerCase() })} placeholder="aca2b4" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                          </Field>
                          <Field label="Operator">
                            <input value={editDraft.operator} onChange={(e) => setEditDraft({ ...editDraft, operator: e.target.value })} className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-accent" />
                          </Field>
                          <Field label="Aircraft">
                            <input value={editDraft.aircraftType} onChange={(e) => setEditDraft({ ...editDraft, aircraftType: e.target.value })} className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs outline-none focus:border-accent" />
                          </Field>
                          <Field label="Camera local (YYYY-MM-DD HH:MM:SS)">
                            <input value={editDraft.naiveLocal} onChange={(e) => setEditDraft({ ...editDraft, naiveLocal: e.target.value })} placeholder="2026-06-21 01:55:00" className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-accent" />
                          </Field>
                          <Field label="Camera TZ">
                            <select
                              value={editDraft.tzOffsetMin}
                              onChange={(e) => setEditDraft({ ...editDraft, tzOffsetMin: Number(e.target.value) })}
                              className="bg-secondary/40 border border-border rounded-sm px-2 py-1 text-xs"
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
                            → UTC {naiveLocalToUtcIso(editDraft.naiveLocal || null, editDraft.tzOffsetMin)?.replace("T", " ").slice(0, 19) ?? "—"}
                          </span>
                          <button onClick={saveEdit} className="ml-auto px-3 py-1 text-[11px] uppercase tracking-widest bg-primary text-primary-foreground rounded-sm inline-flex items-center gap-1">
                            <Save className="size-3" /> Save & re-match (±{windowMin >= 60 ? `${windowMin / 60}h` : `${windowMin}m`})
                          </button>
                          <button onClick={() => { setEditId(null); setEditDraft(null); }} className="px-3 py-1 text-[11px] uppercase tracking-widest border border-border rounded-sm inline-flex items-center gap-1">
                            <X className="size-3" /> Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {matches[s.id]?.matches?.length ? (
                    <tr key={s.id + "-matches"} className="bg-secondary/10">
                      <td colSpan={8} className="py-2 px-3">
                        <div className="text-[10px] uppercase tracking-widest text-accent mb-1">
                          {matches[s.id].matches.length} ADS-B detections within ±{windowMin >= 60 ? `${windowMin / 60} hr` : `${windowMin} min`}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px]">
                          {matches[s.id].matches.slice(0, 6).map((m) => (
                            <div key={m.id} className="flex justify-between gap-2">
                              <span className="text-muted-foreground">
                                Δ{m.delta_s}s · {new Date(m.captured_at).toISOString().slice(11, 19)}
                              </span>
                              <span>
                                {m.registration ?? m.icao_hex} · {m.altitude_ft ?? "—"}ft · {m.county ?? "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {list.isLoading && (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!list.isLoading && !list.data?.length && (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground uppercase tracking-widest">Vault is empty — drop a screenshot above</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

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
      ? "border-accent text-accent"
      : status === "STRONG"
        ? "border-accent/60 text-accent"
        : status === "WEAK"
          ? "border-primary/60 text-primary"
          : status === "PENDING"
            ? "border-border text-muted-foreground"
            : "border-primary text-primary";
  return (
    <div className="flex items-center gap-1">
      <span className={`px-1.5 py-0.5 text-[10px] uppercase rounded-sm border ${tone} inline-flex items-center gap-1`}>
        {status === "LOCKED" && <CheckCircle2 className="size-3" />}
        {status === "NO_MATCH" && <AlertTriangle className="size-3" />}
        {status}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {count} hit{count === 1 ? "" : "s"}{deltaS !== null ? ` · Δ${deltaS}s` : ""}
      </span>
    </div>
  );
}
