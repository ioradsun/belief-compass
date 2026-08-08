import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { shouldRevalidateOnReturn } from "./lib/focus-policy";

export const getRouter = () => {
  // One cache policy for the whole app, so no panel has to opt in to "don't
  // blank on refetch". Per-query staleTime/refetchInterval still win.
  //  • staleTime > 0        → a remount (route change, tab switch) reuses the
  //                           cached value instead of firing a fresh request.
  //  • long gcTime          → returning to a screen paints its last state.
  //  • retry with backoff   → a transient failure never erases visible data
  //                           (React Query keeps `data` through errors).
  //  • refetchOnReconnect   → coming back online resumes silently.
  //  • refetchOnWindowFocus → ON, but gated: on mobile, flipping between chat
  //                           and preview re-focuses the tab every few seconds,
  //                           and refetching every stale query each time is what
  //                           makes the preview crawl. shouldRevalidateOnReturn
  //                           lets a genuine absence through and drops glances.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 30 * 60_000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000),
        refetchOnWindowFocus: () => shouldRevalidateOnReturn(),
        refetchOnReconnect: true,
      },
    },
  });



  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
