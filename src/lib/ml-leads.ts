// Pure helpers that keep the ML Lead Queue honest about precision,
// saturation, rule/model disagreement and TIS-B ghost twins.
export const SATURATION = 99.95;

export function roundScore(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10; // float32 source: 1 decimal is the honest resolution
}

export function baseHex(hex: string): string {
  return hex.replace(/^~/, "").trim().toUpperCase();
}

export type LeadFlags = { saturated: boolean; disagreement: boolean; ghost: boolean; ghost_twin: boolean };

export function leadFlags(score: number | null, ruleScore: number | null, hex: string): Omit<LeadFlags, "ghost_twin"> {
  return {
    saturated: score != null && score >= SATURATION,
    disagreement: score != null && score >= 65 && (ruleScore == null || ruleScore <= 0),
    ghost: hex.trim().startsWith("~"),
  };
}

export function cleanRegistration(reg: string | null, hex: string): string | null {
  if (!reg) return null;
  const r = reg.trim();
  if (!r || baseHex(r) === baseHex(hex)) return null;
  return r;
}

// Collapse "~29B4A7" (ghost) and "29B4A7" into one lead; keep the identified row.
export function mergeGhostTwins<T extends { icao_hex: string; detections: number | null }>(
  rows: T[],
): Array<T & { ghost_twin: boolean; twin_detections: number | null }> {
  const byBase = new Map<string, T[]>();
  for (const r of rows) {
    const k = baseHex(r.icao_hex);
    byBase.set(k, [...(byBase.get(k) ?? []), r]);
  }
  const out: Array<T & { ghost_twin: boolean; twin_detections: number | null }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = baseHex(r.icao_hex);
    if (seen.has(k)) continue;
    seen.add(k);
    const group = byBase.get(k)!;
    const primary = group.find((g) => !g.icao_hex.startsWith("~")) ?? group[0];
    const others = group.filter((g) => g !== primary);
    out.push({
      ...primary,
      ghost_twin: others.length > 0,
      twin_detections: others.length ? others.reduce((s, o) => s + (o.detections ?? 0), 0) : null,
    });
  }
  return out;
}
