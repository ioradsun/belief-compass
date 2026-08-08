# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

## Internal surfaces

| Route | What it is |
| --- | --- |
| `/testingscene` | The scene lab. One `World` of facts, rendered by the **real** Challenge components against a private seeded cache, from every point of view at once — plus an oracle that computes whether the sides agree. Dev-only, `noindex`. Drive it with `npm run check:scene` (needs `vite dev` running). |
| `/dev/rail` | Right-rail layout fixture for `npm run check:rail`. |
| `/dev/transitions` | Market-to-market transition fixture. |

The lab exists so scenarios are reproducible and shareable: its whole state is in
the URL. It renders shipped components rather than copies of them, so it can never
be a mockup of what the product might do.
