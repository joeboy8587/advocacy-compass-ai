import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { LoadErrorPanel } from "./components/LoadErrorPanel";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  return <LoadErrorPanel error={error} reset={reset} />;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Recover automatically from transient server-fn 5xx / cold-start hiccups
        retry: (failureCount, error: any) => {
          const status = error?.status ?? error?.response?.status;
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
          return failureCount < 3;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
