import { createServerFn } from "@tanstack/react-start";

export type PodcastEpisode = {
  id: string;
  narrative_id: number;
  narrative_date: string;
  script: { speaker: "A" | "B"; text: string }[];
  sha256: string;
  script_provider: string | null;
  voice_provider: string | null;
  created_at: string;
  hosts: { A: string; B: string };
};

export const listPodcasts = createServerFn({ method: "GET" }).handler(async (): Promise<PodcastEpisode[]> => {
  const { ensurePodcastTable, neonQuery, HOST_NAMES } = await import("./podcast.server");
  await ensurePodcastTable();
  const rows = await neonQuery<Omit<PodcastEpisode, "hosts">>(
    `SELECT DISTINCT ON (narrative_id) id::text, narrative_id, narrative_date, script, sha256,
            script_provider, voice_provider, created_at::text
       FROM narrative_podcasts ORDER BY narrative_id, created_at DESC`,
  );
  return rows.map((r) => ({ ...r, hosts: HOST_NAMES }));
});

export const generatePodcast = createServerFn({ method: "POST" })
  .inputValidator((d: { narrativeId: number }) => {
    if (!Number.isFinite(Number(d?.narrativeId))) throw new Error("narrativeId required");
    return { narrativeId: Number(d.narrativeId) };
  })
  .handler(async ({ data }) => {
    try {
      const m = await import("./podcast.server");
      await m.ensurePodcastTable();
      const n = await m.neonQuery<{ narrative_date: string; narrative_md: string }>(
        `SELECT narrative_date::text, narrative_md FROM daily_narratives WHERE id = $1`,
        [data.narrativeId],
      );
      if (!n[0]) return { ok: false as const, error: "That narrative could not be found." };
      const { lines, provider } = await m.writeScript(n[0].narrative_date, n[0].narrative_md);
      const audio = await m.voiceScript(lines);
      const sha = await m.sha256Hex(audio);
      const ins = await m.neonQuery<{ id: string }>(
        `INSERT INTO narrative_podcasts (narrative_id, narrative_date, script, audio_b64, sha256, script_provider, voice_provider)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'openai') RETURNING id::text`,
        [data.narrativeId, n[0].narrative_date, JSON.stringify(lines), m.toB64(audio), sha, provider],
      );
      return { ok: true as const, id: ins[0].id };
    } catch (e) {
      console.error("[podcast]", e);
      return { ok: false as const, error: (e as Error).message ?? "Podcast generation failed" };
    }
  });
