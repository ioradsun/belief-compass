import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isAbortError } from "./lib/error-capture";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// NOTE: no Supabase bearer middleware here on purpose. This app authenticates
// writes with wallet signatures (see src/lib/wallet-session.ts) and no server
// function uses `requireSupabaseAuth`, so attaching a Supabase session would
// only drag the whole supabase-js client (auth + realtime + storage + postgrest)
// into the first-paint bundle for nothing.

// A client that navigates away or reloads mid-render aborts the socket, which
// surfaces here as `Error: aborted` from node:_http_server. That is not an app
// error: there is nobody left to send a response to, so don't log it and don't
// render the error page (which would be reported as a blank-screen runtime error).

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  // Internal /lovable/* routes authenticate themselves; never wrap or gate them.
  if (request && new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (isAbortError(error) || request?.signal?.aborted) {
      return new Response(null, { status: 499 });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.handlerType === "serverFn" &&
    !new URL(ctx.request.url).pathname.startsWith("/lovable/"),
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
