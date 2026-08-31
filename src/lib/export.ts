// Client-side export helpers: turn any page's loaded rows into a CSV file,
// or hand the page to the browser's print dialog (which can "Save as PDF").

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) v = v.join(" | ");
  if (typeof v === "object") v = JSON.stringify(v);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
}

/** Build a CSV from an array of flat objects and trigger a download. */
export function downloadCsv(baseName: string, rows: Array<Record<string, unknown>>) {
  if (typeof window === "undefined" || !rows?.length) return;
  const cols = Array.from(rows.reduce<Set<string>>((set, r) => {
    Object.keys(r).forEach((k) => set.add(k));
    return set;
  }, new Set()));
  const lines = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")),
  ];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `watchtower-${baseName}-${stamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open the browser print dialog; the user picks "Save as PDF" to keep a copy. */
export function printPage() {
  if (typeof window !== "undefined") window.print();
}
