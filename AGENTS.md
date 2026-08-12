<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

<!-- FORGE:BEGIN -->
## Conviction Forge

Forge is the admin-only engineering control center at `/admin/forge`. Its
engineering rules — the Conviction Prime Directive, model roles, execution
modes, verification profiles, job lifecycle and git policy — live in
[docs/FORGE.md](docs/FORGE.md). Read that before changing anything under
`src/lib/forge/`, `src/lib/forge.functions.ts`, `src/components/forge/` or
`src/routes/admin_.forge.tsx`.
<!-- FORGE:END -->
