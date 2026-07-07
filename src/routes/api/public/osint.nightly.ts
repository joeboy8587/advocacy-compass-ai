import { createFileRoute } from "@tanstack/react-router";
import { runNightlyOsint } from "@/lib/osint.functions";

export const Route = createFileRoute("/api/public/osint/nightly")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.OSINT_CRON_SECRET;
        const provided =
          request.headers.get("x-cron-secret") ??
          new URL(request.url).searchParams.get("secret");
        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await runNightlyOsint();
          return new Response(JSON.stringify(result), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error).message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
