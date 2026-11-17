/** Offset-bearing EXIF timestamps are instants, not naive camera-local clocks. */
export function exifCapture(raw: Record<string, unknown> | null) {
  const value = raw?.DateTimeOriginal;
  const offset = String(raw?.OffsetTimeOriginal ?? "");
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m || !value) return null;
  const offsetMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const iso = value instanceof Date ? value.toISOString() : String(value);
  const naive = /^(\d{4}):?(?:-|:)(\d{2})(?:-|:)(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(iso);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offsetMin * 60_000).toISOString();
    return { utc, offsetMin, date: `${y}-${mo}-${d}`, time: `${h}:${mi}:${s}` };
  }
  const instant = new Date(iso);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(iso) || Number.isNaN(instant.getTime())) return null;
  const local = new Date(instant.getTime() + offsetMin * 60_000).toISOString();
  return { utc: instant.toISOString(), offsetMin, date: local.slice(0, 10), time: local.slice(11, 19) };
}

export function screenshotMatchStatus(hasDate: boolean, method: string | null, count: number, delta: number | undefined) {
  if (!hasDate) return "NEEDS_DATE";
  if (!count) return "UNEXPLAINED";
  if (method !== "exact") return "TIME_HINT";
  return (delta ?? Infinity) <= 300 ? "CONFIRMED_NAMED" : "PRESENCE_CORRELATED";
}