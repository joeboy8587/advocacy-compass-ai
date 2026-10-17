export function normalizeRegistration(value: string): string {
  return value.trim().toUpperCase().replace(/^N/, "");
}

export function sameEntity(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
  return Boolean(a.trim() && b.trim()) && normalize(a) === normalize(b);
}