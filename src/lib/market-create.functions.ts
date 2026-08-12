/**
 * Market creation — server functions.
 *
 * Every write is gated by `assertWalletOwnership`: the caller must hold a
 * signed wallet session for the wallet the row is keyed by. The database row is
 * off-chain metadata only — the market itself lives on the contract, so a row
 * is never trusted until a real MarketCreated receipt is finalised here.
 */
import { createServerFn } from "@tanstack/react-start";
import { QUESTION_MAX, makeQuestionId, type MarketFormat } from "@/lib/market-create";

const CONTRACT = "0xd4f4619bb4590598c778178690b77c589b93a3eb";
const CHAIN_ID = 8453;
/** Anti-spam: a wallet may open this many drafts per hour. */
const DRAFTS_PER_HOUR = 10;

function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Pre-flight the question text: AI quality review only.
 *
 * IT NO LONGER SEARCHES FOR DUPLICATES. It used to return a `duplicates` array
 * from `findSimilarMarkets` — a 4,000-row scan on every debounced keystroke —
 * which no component ever read. The rail that DOES show neighbours runs its own
 * bounded query (`suggestExistingMarkets`), so the scan was pure cost.
 */
export const reviewMarketQuestion = createServerFn({ method: "POST" })
  .inputValidator((data: { question: string }) => ({
    question: clean(data.question, QUESTION_MAX),
  }))
  .handler(async ({ data }) => {
    if (data.question.length < 8) {
      return {
        review: {
          ok: false,
          reason: "Say a bit more.",
          suggestion: null,
          category: "other" as const,
          blocked: false,
        },
      };
    }
    const { reviewQuestion } = await import("@/lib/market-create.server");
    return { review: await reviewQuestion(data.question) };
  });

/**
 * Alternate phrasings for the right rail — 2–3 distinct rewrites of the draft.
 *
 * Separate from the review so the form can drop AI feedback entirely (no inline
 * "Polish", no jump): this is asked for by the rail, on the same debounced probe
 * the neighbour search already runs on, and the writer adopts one with a tap.
 */
export const suggestAlternateQuestions = createServerFn({ method: "POST" })
  .inputValidator((data: { question: string }) => ({
    question: clean(data.question, QUESTION_MAX),
  }))
  .handler(async ({ data }) => {
    if (data.question.length < 8) return { alternates: [] as string[] };
    const { alternateQuestions } = await import("@/lib/market-create.server");
    return { alternates: await alternateQuestions(data.question) };
  });

/**
 * Four contested questions on a topic — the left rail's spark for writers with
 * no personalised House idea yet. Read-only and advisory; nothing is reserved.
 */
export const suggestTopicIdeas = createServerFn({ method: "POST" })
  .inputValidator((data: { topic: string }) => ({ topic: clean(data.topic, 60) }))
  .handler(async ({ data }) => {
    if (!data.topic) return { ideas: [] as string[] };
    const { topicIdeas } = await import("@/lib/market-create.server");
    return { ideas: await topicIdeas(data.topic) };
  });


/**
 * Ranked "you might rather back this" suggestions for the right rail.
 * Advisory only — creation stays permissionless, so this never gates anything.
 */
export const suggestExistingMarkets = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { question: string; sha256?: string | null; linkUrl?: string | null }) => ({
      question: clean(data.question, QUESTION_MAX),
      sha256: data.sha256 ? clean(data.sha256, 80) : null,
      linkUrl: data.linkUrl ? clean(data.linkUrl, 500) : null,
    }),
  )
  .handler(async ({ data }) => {
    const { findMarketSuggestions } = await import("@/lib/market-create.server");
    return findMarketSuggestions(data, 3);
  });

/** Reserve an off-chain draft + its immutable questionId. */
export const createMarketDraft = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      wallet: string;
      token: string;
      question: string;
      description?: string | null;
      format: MarketFormat;
      side: "YES" | "NO";
      category?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const question = clean(data.question, QUESTION_MAX);
    if (question.length < 8) throw new Error("Your question is too short.");

    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await db
      .from("conviction_markets")
      .select("question_id", { count: "exact", head: true })
      .eq("creator_wallet", wallet)
      .gte("created_at", since);
    if ((count ?? 0) >= DRAFTS_PER_HOUR) {
      throw new Error("You've started a lot of markets this hour. Try again shortly.");
    }

    const { reviewQuestion } = await import("@/lib/market-create.server");
    const review = await reviewQuestion(question);
    if (review.blocked) throw new Error("That question can't be published here.");

    // The creator's pick wins, but only if it names something the rest of the
    // system reads. `normalizeCategory` is the one door — a client sending an
    // unknown string falls back to the reviewer's answer rather than writing a
    // category no reader can resolve, which is exactly how the vocabularies
    // drifted apart in the first place.
    const { normalizeCategory } = await import("@/domain/categories");
    const chosen = normalizeCategory(data.category);
    const category = chosen ?? review.category;

    const questionId = makeQuestionId(question);
    const { error } = await db.from("conviction_markets").insert({
      question_id: questionId,
      question,
      description: clean(data.description, 500) || null,
      format: data.format === "media" ? "media" : "text",
      side: data.side === "NO" ? "NO" : "YES",
      category,
      category_source: chosen ? "creator" : "ai",
      creator_wallet: wallet,
      contract_address: CONTRACT,
      chain_id: CHAIN_ID,
      status: "draft",
    });
    if (error) throw new Error(error.message);
    return { questionId, category };
  });

/** A one-shot signed upload URL for the private market-media bucket. */
export const signMarketUpload = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { wallet: string; token: string; questionId: string; ext: string }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const ext =
      clean(data.ext, 5)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "bin";
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();
    const { data: row } = await db
      .from("conviction_markets")
      .select("creator_wallet")
      .eq("question_id", data.questionId)
      .maybeSingle();
    if (!row || String(row.creator_wallet).toLowerCase() !== wallet) {
      throw new Error("That draft isn't yours.");
    }
    const path = `market/${data.questionId}/${crypto.randomUUID()}.${ext}`;
    const { data: signed, error } = await db.storage
      .from("market-media")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Could not start the upload.");
    return { path, signedUrl: signed.signedUrl, token: signed.token };
  });

/** Verify the uploaded bytes and attach the media to the draft. */
export const attachMarketMedia = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      wallet: string;
      token: string;
      questionId: string;
      path: string;
      durationSeconds?: number | null;
      width?: number | null;
      height?: number | null;
      alt?: string | null;
      sha256?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const { verifyStoredMedia, signMediaUrl } = await import("@/lib/market-create.server");
    const { MEDIA_LIMITS } = await import("@/lib/market-create");
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();

    const { data: row } = await db
      .from("conviction_markets")
      .select("creator_wallet")
      .eq("question_id", data.questionId)
      .maybeSingle();
    if (!row || String(row.creator_wallet).toLowerCase() !== wallet) {
      throw new Error("That draft isn't yours.");
    }

    const verified = await verifyStoredMedia(data.path);
    const maxSeconds = MEDIA_LIMITS[verified.kind].seconds;
    if (maxSeconds && data.durationSeconds && data.durationSeconds > maxSeconds + 1) {
      await db.storage.from("market-media").remove([data.path]);
      throw new Error(`${verified.kind} must be under ${maxSeconds / 60} minutes.`);
    }

    const media = {
      kind: verified.kind,
      path: data.path,
      mime: verified.mime,
      bytes: verified.size,
      durationSeconds: data.durationSeconds ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      alt: clean(data.alt, 200) || null,
      // Bytes fingerprint: lets the next person uploading the same file be
      // pointed at this market instead of forking the conversation.
      sha256: data.sha256 ? clean(data.sha256, 80) : null,
    };
    const { error } = await db
      .from("conviction_markets")
      .update({ media, format: "media" })
      .eq("question_id", data.questionId);
    if (error) throw new Error(error.message);
    return { media, url: await signMediaUrl(data.path) };
  });

/** Attach an https link with its OpenGraph preview. */
export const attachMarketLink = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { wallet: string; token: string; questionId: string; url: string }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const { fetchLinkPreview } = await import("@/lib/market-create.server");
    const preview = await fetchLinkPreview(clean(data.url, 500));
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();
    const { error } = await db
      .from("conviction_markets")
      .update({ media: { kind: "link", ...preview }, format: "media" })
      .eq("question_id", data.questionId)
      .eq("creator_wallet", wallet);
    if (error) throw new Error(error.message);
    return { media: { kind: "link" as const, ...preview } };
  });

/** Record the confirmed on-chain result against the draft. */
export const finalizeMarketCreate = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      wallet: string;
      token: string;
      questionId: string;
      marketId: number;
      txHash: string;
      yesToken: string;
      noToken: string;
      curve: string;
      seedEthWei: string;
      stakeUsd?: number | null;
      usdPerEth?: number | null;
      creatorFeeBps?: number | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();
    const { data: row, error } = await db
      .from("conviction_markets")
      .update({
        onchain_id: data.marketId,
        transaction_hash: data.txHash,
        yes_token: data.yesToken,
        no_token: data.noToken,
        curve_address: data.curve,
        seed_eth_wei: data.seedEthWei,
        stake_amount_usd: data.stakeUsd ?? null,
        usd_per_eth_at_creation: data.usdPerEth ?? null,
        creator_fee_bps: data.creatorFeeBps ?? null,
        status: "active",
        last_error: null,
      })
      .eq("question_id", data.questionId)
      .eq("creator_wallet", wallet)
      .select("question, category, category_source, side")
      .maybeSingle();
    if (error) throw new Error(error.message);

    // The chain indexer creates a bare `markets` row with no title — POV owns
    // titles, and this market was never born on POV. Publish ours, or the feed
    // and every deck render it untitled (which reads as "missing").
    const openedAt = new Date().toISOString();
    await db
      .from("markets")
      .upsert(
        {
          onchain_id: data.marketId,
          title: row?.question ?? null,
          category: row?.category ?? null,
          category_source: row?.category_source ?? "conviction",
          author_wallet: wallet,
          source: "conviction",
          created_at: openedAt,
        },
        { onConflict: "onchain_id" },
      )
      .then(() => undefined);

    // THE OPENING EVENT. Markets born on POV get exactly one `market_created`
    // event from the poller; markets born here got none, so every Insider
    // surface that reads the canonical event stream (the tape, "ON THE TABLE",
    // the fresh-market stories) never saw them open. Same deterministic
    // source_key, so this can never double up with a later POV sighting.
    const { marketCreatedSourceKey } = await import("@/lib/events");
    await db
      .from("events")
      .upsert(
        {
          source_key: marketCreatedSourceKey(data.marketId),
          source: "conviction",
          kind: "market_created",
          market_id: String(data.marketId),
          wallet,
          occurred_at: openedAt,
          payload: { created_at_source: "conviction" },
        },
        { onConflict: "source_key", ignoreDuplicates: true },
      )
      .then(() => undefined);


    // THE SEED IS A TRADE. It lives in the creation tx itself, so ingest that
    // receipt now instead of waiting a poller tick — otherwise the creator
    // lands on their brand-new market and sees $0 staked.
    try {
      const { ingestCreationTx } = await import("@/lib/market-create-ingest.server");
      await ingestCreationTx(db, data.txHash, data.marketId);
    } catch {
      // Non-fatal: the poller will pick the same events up (same source_key).
    }

    // Creating a market also buys its opening side. Close the Insider round
    // from that same mined transaction so the creator sees the reveal rather
    // than being asked to make the move they have already made.
    try {
      const { finalizeHouseBet } = await import("@/lib/house.server");
      await finalizeHouseBet(wallet, data.marketId, row?.side === "NO" ? "NO" : "YES", data.txHash);
    } catch {
      // The position remains authoritative; a later reconciliation can repair
      // this optional read without holding the market creation flow open.
    }

    // Build the read-model row now rather than waiting behind the refresh
    // queue: the creator is about to land on this market.
    try {
      const { refreshMarket } = await import("@/lib/market-state/refresh-market.server");
      const { data: eth } = await db.rpc("eth_usd_calibration");
      const refreshed = await refreshMarket(db, data.marketId, Number(eth ?? 0) || 0);
      if (!refreshed.ok) throw new Error(refreshed.error ?? "Market refresh failed");
    } catch {
      // The durable queue below retries this after the creation request returns.
    }

    // Always schedule one background reconciliation. The receipt can be visible
    // before the position write is, and refreshMarket reports failures as a
    // result rather than throwing. Without this durable pass, either race leaves
    // a correctly indexed seed trade behind a stale $0 market_state row.
    await Promise.all([
      db.rpc("enqueue_market_refresh", {
        p_market_ids: [data.marketId],
        p_kind: "activity",
      }),
      db.rpc("enqueue_market_refresh", {
        p_market_ids: [data.marketId],
        // Always request the position-owned pass. If receipt ingestion failed
        // after persisting the event, an activity-only retry would preserve the
        // stale zero forever. The queue coalesces duplicate work cheaply.
        p_kind: "positions",
      }),
    ]).then(() => undefined);

    return { ok: true as const };
  });

/** Remember a failed attempt so the draft can be resumed instead of re-typed. */
export const recordCreateFailure = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { wallet: string; token: string; questionId: string; message: string }) => data,
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const { serviceClient } = await import("@/lib/supabase-clients");
    await serviceClient()
      .from("conviction_markets")
      .update({ status: "failed", last_error: clean(data.message, 300) })
      .eq("question_id", data.questionId)
      .eq("creator_wallet", wallet);
    return { ok: true as const };
  });

/** Conviction-native metadata (media, creator) for a market in the deck. */
export const getConvictionMarket = createServerFn({ method: "GET" })
  .inputValidator((data: { onchainId: number }) => data)
  .handler(async ({ data }) => {
    const { serviceClient } = await import("@/lib/supabase-clients");
    const db = serviceClient();

    // Every market has an author and a birthday — POV-sourced ones live in
    // `markets`. Resolve that first so the byline/age never goes blank on a
    // market we didn't create ourselves.
    const povIdentity = async (): Promise<{
      creator: MarketCreatorIdentity | null;
      createdAt: string | null;
    }> => {
      const { data: m } = await db
        .from("markets")
        .select("author_wallet, author_name, author_pfp, created_at, first_seen")
        .eq("onchain_id", data.onchainId)
        .maybeSingle();
      if (!m) return { creator: null, createdAt: null };
      const createdAt = (m.created_at as string | null) ?? (m.first_seen as string | null) ?? null;
      const w = m.author_wallet ? String(m.author_wallet).toLowerCase() : null;
      if (!w) return { creator: null, createdAt };
      const { resolveProfiles } = await import("@/lib/profiles.server");
      const { aliasFor } = await import("@/lib/wallet-identity");
      const prof = (await resolveProfiles([w], 4)).get(w);
      return {
        creator: {
          wallet: w,
          name: prof?.displayName ?? (m.author_name as string | null) ?? aliasFor(w),
          avatarUrl: prof?.pfpUrl ?? (m.author_pfp as string | null) ?? null,
          createdAt,
        },
        createdAt,
      };
    };

    const { data: row } = await db
      .from("conviction_markets")
      .select(
        "question_id, question, description, category, media, creator_wallet, created_at, hidden, moderation_status, status",
      )
      .eq("onchain_id", data.onchainId)
      .maybeSingle();
    if (!row || row.status !== "active" || row.hidden || row.moderation_status === "blocked") {
      const pov = await povIdentity();
      return { market: null, creator: pov.creator, createdAt: pov.createdAt };
    }
    const media = row.media as { kind?: string; path?: string } | null;
    let url: string | null = null;
    if (media?.path) {
      const { signMediaUrl } = await import("@/lib/market-create.server");
      url = await signMediaUrl(media.path);
    }

    // Resolve the creator's real identity in the SAME request (one bounded
    // profile lookup), so the byline can render an avatar + name instead of a
    // shortened wallet. Falls back to the deterministic alias, then the wallet.
    let creator: MarketCreatorIdentity | null = null;
    const createdAt = (row.created_at as string | null) ?? null;
    const cw = row.creator_wallet ? String(row.creator_wallet).toLowerCase() : null;
    if (cw) {
      const { resolveProfiles } = await import("@/lib/profiles.server");
      const { aliasFor } = await import("@/lib/wallet-identity");
      const prof = (await resolveProfiles([cw], 4)).get(cw);
      creator = {
        wallet: cw,
        name: prof?.displayName ?? aliasFor(cw),
        avatarUrl: prof?.pfpUrl ?? null,
        createdAt,
      };
    }
    return { market: { ...row, mediaUrl: url }, creator, createdAt };
  });

/** Resolved creator identity for the market byline (one request, profile-aware). */
export interface MarketCreatorIdentity {
  wallet: string;
  /** display name, else deterministic alias — never a raw 0x address. */
  name: string;
  avatarUrl: string | null;
  createdAt: string | null;
}

/** Anyone can report a market — no wallet required, so nothing is un-reportable. */
export const reportMarket = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      onchainId?: number | null;
      questionId?: string | null;
      reason: string;
      details?: string | null;
      wallet?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const reason = clean(data.reason, 60);
    if (!reason) throw new Error("Pick a reason.");
    const { serviceClient } = await import("@/lib/supabase-clients");
    const { error } = await serviceClient()
      .from("market_reports")
      .insert({
        onchain_id: data.onchainId ?? null,
        question_id: data.questionId ?? null,
        reason,
        details: clean(data.details, 500) || null,
        reporter_wallet: data.wallet ? String(data.wallet).toLowerCase() : null,
      });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * THE ONE EVENT CONSOLIDATION HAS NEVER EMITTED.
 *
 * The duplicate panel has existed for a long time and recorded nothing, so
 * whether it ever diverted anybody has never been knowable — the feature could
 * have been working perfectly or doing nothing at all and both look identical
 * from outside. That is the failure this closes.
 *
 * `user_events` is the discovery-only interaction log the schema has always
 * had, with an anon INSERT policy and no writer anywhere in the codebase. It is
 * the right home and it needs no migration: reusing a table that already exists
 * beats minting one to hold a single event type.
 *
 * IT LIVES HERE, beside `suggestExistingMarkets`, because that is the server
 * function feeding the panel this event measures. It used to sit in
 * `launch.functions.ts` for no better reason than that the invitation work
 * happened to build it — and when invitations were deleted it would have gone
 * with them, silently taking consolidation's only metric along.
 *
 * DELIBERATELY NARROW. One type, emitted from one place, meaning one thing: a
 * reader who was writing a question chose an existing market instead. It is
 * never an attribution claim — see check-challenge for what this can and cannot
 * tell anyone.
 */
export const recordSimilarJoin = createServerFn({ method: "POST" })
  // Validated the way the rest of this file does — a plain function and
  // `clean` — rather than dragging zod in for one call site.
  .inputValidator((data: { wallet?: string | null; marketId: number }) => ({
    wallet: data.wallet ? clean(data.wallet, 80) : null,
    marketId: Number.isFinite(data.marketId) ? Math.max(0, Math.floor(data.marketId)) : 0,
  }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    // Unsigned and fire-and-forget: it is a usage fact about a public click,
    // it grants nothing, and a failed metric must never cost a navigation.
    try {
      const { serviceClient } = await import("@/lib/supabase-clients");
      await serviceClient()
        .from("user_events")
        .insert({
          wallet: data.wallet ? data.wallet.toLowerCase() : null,
          onchain_id: data.marketId,
          type: "similar_market_join",
        });
    } catch {
      /* the click is the product; the measurement is not worth breaking it */
    }
    return { ok: true };
  });
