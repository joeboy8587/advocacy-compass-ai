import { createServerFn } from "@tanstack/react-start";

export const getKernCirclingNow = createServerFn({ method: "GET" }).handler(async () => {
  const u = await import("./detection-upgrades.server");
  const rows = await u.orbitsKern(24, 15);
  return rows.map((o) => ({
    ...o,
    strength: u.orbitStrength(o.score, o.orbits),
    summary: u.describeOrbit(o),
  }));
});
