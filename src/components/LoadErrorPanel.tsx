import { AlertTriangle, RefreshCw, Home, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";

function friendlyMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (!raw) return "Something went wrong on our end.";
  if (/Invalid server function/i.test(raw))
    return "Command bundle is out of date — a quick refresh will re-sync it.";
  if (/Unauthorized|401/i.test(raw))
    return "Your session expired. Sign in again to continue.";
  if (/timeout|ETIMEDOUT|statement timeout/i.test(raw))
    return "The database took too long to answer. Retry usually clears it.";
  if (/fetch failed|NetworkError|Failed to fetch/i.test(raw))
    return "Network hiccup reaching the Watchtower servers.";
  if (/500|Internal server/i.test(raw))
    return "A server-side glitch interrupted the load.";
  return raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
}

export function LoadErrorPanel({
  error,
  reset,
  title = "This page didn't load",
  autoRetry = true,
}: {
  error: unknown;
  reset?: () => void;
  title?: string;
  autoRetry?: boolean;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [countdown, setCountdown] = useState(autoRetry ? 5 : 0);

  const doRetry = async () => {
    setRetrying(true);
    try {
      await router.invalidate();
      reset?.();
    } finally {
      setTimeout(() => setRetrying(false), 400);
    }
  };

  useEffect(() => {
    if (!autoRetry) return;
    if (countdown <= 0) {
      void doRetry();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, autoRetry]);

  const msg = friendlyMessage(error);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="panel max-w-md w-full p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-sm border border-primary/40 bg-primary/10">
          <AlertTriangle className="size-6 text-primary" />
        </div>
        <h1 className="text-sm uppercase tracking-widest neon-text-orange">{title}</h1>
        <p className="mt-3 text-sm text-foreground/90 font-mono leading-relaxed">{msg}</p>
        {autoRetry && countdown > 0 && !retrying && (
          <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            auto-retry in {countdown}s
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={doRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 rounded-sm border border-accent/50 bg-accent/10 px-4 py-2 text-xs uppercase tracking-widest text-accent hover:bg-accent/20 disabled:opacity-60"
          >
            {retrying ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Retrying…
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5" /> Retry now
              </>
            )}
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-sm border border-border/70 px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            <Home className="size-3.5" /> Command center
          </a>
        </div>
        {error instanceof Error && error.stack && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
              Technical detail
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-sm bg-background/60 p-2 text-[10px] font-mono text-muted-foreground">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
