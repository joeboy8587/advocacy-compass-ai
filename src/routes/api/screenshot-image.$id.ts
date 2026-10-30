import { createFileRoute } from "@tanstack/react-router";

// Serves one stored screenshot image so the list doesn't ship every image at once.
export const Route = createFileRoute("/api/screenshot-image/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response("Not found", { status: 404 });
        const { neonQuery } = await import("@/lib/neon.server");
        // Images are multi-MB base64 rows; a busy database can push the fetch past
        // the default 20s deadline, so allow longer and retry once before giving up.
        let rows: { image_data: string | null }[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            rows = await neonQuery<{ image_data: string | null }>(
              `SELECT image_data FROM radar_screenshots WHERE id = $1`,
              [params.id],
              { timeoutMs: 60_000 },
            );
            break;
          } catch (err) {
            if (attempt === 1) {
              console.error("screenshot-image fetch failed", params.id, err);
              return new Response("Image temporarily unavailable — try again", { status: 504 });
            }
          }
        }
        const m = rows[0]?.image_data?.match(/^data:([^;]+);base64,(.*)$/s);
        if (!m) return new Response("Not found", { status: 404 });
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: { "content-type": m[1], "cache-control": "private, max-age=86400" },
        });
      },
    },
  },
});
