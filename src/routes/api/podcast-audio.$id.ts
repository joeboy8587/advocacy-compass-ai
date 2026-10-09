import { createFileRoute } from "@tanstack/react-router";

// Streams one stored podcast episode as MP3.
export const Route = createFileRoute("/api/podcast-audio/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response("Not found", { status: 404 });
        const { neonQuery } = await import("@/lib/neon.server");
        const rows = await neonQuery<{ audio_b64: string; narrative_date: string }>(
          `SELECT audio_b64, narrative_date FROM narrative_podcasts WHERE id = $1`,
          [params.id],
        );
        if (!rows[0]) return new Response("Not found", { status: 404 });
        const bytes = Uint8Array.from(atob(rows[0].audio_b64), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "content-type": "audio/mpeg",
            "content-disposition": `inline; filename="watchtower-briefing-${rows[0].narrative_date}.mp3"`,
            "cache-control": "private, max-age=86400",
          },
        });
      },
    },
  },
});
