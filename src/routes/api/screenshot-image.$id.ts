import { createFileRoute } from "@tanstack/react-router";

// Serves one stored screenshot image so the list doesn't ship every image at once.
export const Route = createFileRoute("/api/screenshot-image/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.id)) return new Response("Not found", { status: 404 });
        const { neonQuery } = await import("@/lib/neon.server");
        const rows = await neonQuery<{ image_data: string | null }>(
          `SELECT image_data FROM radar_screenshots WHERE id = $1`,
          [params.id],
        );
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
