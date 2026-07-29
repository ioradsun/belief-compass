## What I verified on-chain first

Read directly from the live contract (`0xd4f4…A3eB`, Base 8453) and the committed ABI in `src/chain/abi.json` — no invention:

- `createMarket(questionId, _yesAgent, _noAgent, curve, yes)` and the full `MarketCreated` event are already in our committed ABI.
- `minSeedEth` = 0.001 ETH (read live, never hardcoded).
- `feeBps` = 1000 (10% trade fee), `CREATOR_FEE_SHARE` = 4500 / `FEE_DENOMINATOR` 10000 → creator earns 45% of the 10% fee = **4.5%**. So the "earn 4.5%" badge is computed from chain reads, not a constant.
- **Curve POV uses:** every sampled market (ids 1, 2, 50, 2660–2693) uses `ConstantProductBondingCurve 0x06A6…5228`. Linear is whitelisted too but unused. We'll default to the CPMM and still validate with `whitelistedCurves()` before submit.
- **Agent strings:** POV passes UUIDs (its AI agent ids), a different pair per market — there is no single "POV value" to mirror. We'll pin one existing, real POV agent-id pair as Conviction defaults (constants in `src/chain/`), stored in metadata so it can change later without a code change downstream.
- `questionId` on POV = its market UUID. Ours will be a Conviction-namespaced slug+ULID, checked with `questionIdToMarketId()` before submit.

## Media: what's actually possible here

There is **no Mux (or Cloudinary) connector available** in this workspace — only Perplexity, GitHub and Firecrawl. Our server runtime is a serverless Worker: `sharp`/`ffmpeg` cannot run there, so server-side transcode, EXIF stripping and poster generation as written in §5 are not buildable today.

Proposed V1 that keeps the security intent:
- Images: re-encoded **in the browser** via canvas to WEBP/JPEG (this strips EXIF/GPS by construction) and capped at 4096px longest edge.
- Video/audio: uploaded as-is with duration read in the browser and re-checked against caps; poster = a first-frame grab captured client-side.
- Server function verifies **magic bytes**, MIME, and size on the uploaded object before flipping the row to published — SVG/HTML/archives rejected outright.
- Caps as specified: image ≤10MB, audio ≤20MB / 5min, video ≤50MB / 60s.
- Link: server-side Open Graph fetch, no third-party iframes.

If you later want true transcoding + automated visual moderation, that's a Mux/Cloudflare Stream integration — I'll flag it as a follow-up rather than fake it.

## Build

**1. Chain layer** (`src/chain/market-create.ts`, new)
Curve + agent constants, `useCreateMarketPreflight()` reading `minSeedEth`, `whitelistedCurves`, `questionIdToMarketId`, `feeBps`/`CREATOR_FEE_SHARE`, and wallet balance in parallel; `simulateContract` before the single `writeContract`; decode `MarketCreated` from the receipt for the real `marketId`, `yesToken`, `noToken`. Opening-share number comes from the curve's own `basePrice` and is labelled "estimated" until the receipt lands, then replaced by the decoded `seedTokens`.

**2. Data** (migration)
`public.conviction_markets` holding the §6 metadata (questionId, marketId, format, question, description, ai category + source, creator_fee_bps, stake amounts, pov.boost default false, media json, creator wallet, chain/tx, status enum, moderation status, flags). Private storage bucket `market-media` with signed playback URLs; RLS keyed to the verified wallet-session path we already use. Writes go through server fns that call `assertWalletOwnership` (existing HMAC wallet session), plus a per-wallet rate limit on uploads and creations.

**3. Server functions** (`src/lib/market-create.functions.ts`)
`startDraft`, `attachMedia` (magic-byte + size + duration verification, OG fetch for links), `finalizeCreate` (persist marketId/tokens/tx/status), `validateQuestion` (AI yes/no gate + silent POV-taxonomy classification via `src/domain/categories.ts` + polish rewrite) and `findDuplicates` (normalized-title + embedding similarity over `markets`, plus exact `questionIdToMarketId`). AI uses the Lovable AI gateway with the existing `LOVABLE_API_KEY`.

**4. UI**
- `LandingPanel`: collapsed rail loses "Powered by POV / $DEGEN", gains a square `[+]` with a "Create a market" tooltip; expanded state gets the full-width 40–44px "Create a market" button above the live feed.
- New `src/components/CreateMarket.tsx` rendered **in the center column** (a `?create` search param, same pattern as `?m`/`?p`/`?dna`), side rails untouched; full-screen sheet on mobile.
- Flow exactly as §3/§8: Text | Media switch → inline media step (picker, drag/drop, paste, URL) → question with the constraint as placeholder + "AI-checked · Polish" → plain Yes/No → USD stake with live ETH equivalent and `minSeedEth` floor → inline insufficient-balance guard → CTA "Create & back yes · earn 4.5%". No category picker, no DEGEN boost, no modals.
- Duplicate matches render in the **right rail over the live feed** with "Join this market"; never blocking.
- On success: open the new market in the center and emit a live-feed event.

**5. Disclaimers, reporting, admin**
Six disclaimer blocks placed per §7 (financial + UGC near the CTA, opinion-market note near the question, the rest on a new `/terms` page). A "Report" action on every market writing to a `market_reports` table. New `/admin` route gated by a **shared password** stored as a server-only secret and checked in a server function with a timing-safe compare + encrypted session — it lists flagged markets/media with take-down (hide) actions. Shared password = a gate, not per-user auth; happy to swap it for real accounts later.

## Failure handling
Every stage has a distinct persisted status (`draft`/`uploading`/`awaiting_signature`/`confirming`/`active`/`failed`); retry resumes from the stored draft and never re-uploads media. Signature rejection is caught with our existing `isUserRejection` so the form never wedges.

## Notes / call-outs
- The "4.5%" is derived from live chain reads, so if POV changes `feeBps` the button follows.
- Conviction-created markets will be indexed by our own poller off `MarketCreated` — POV may or may not surface them, since POV's own metadata (question text) lives in POV's DB and ours in Conviction's. On-chain economics are shared regardless.
- Media transcoding/automated visual moderation is deliberately out of V1 (no Mux, no ffmpeg in the runtime); AI text moderation on the question runs, images rely on report + admin takedown.
