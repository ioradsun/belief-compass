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
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Pre-flight the question text: AI quality review + near-duplicate search. */
export const reviewMarketQuestion = createServerFn({ method: "POST" })
  .inputValidator((data: { question: string }) => ({ question: clean(data.question, QUESTION_MAX) }))
  .handler(async ({ data }) => {
    if (data.question.length < 8) {
      return {
        review: { ok: false, reason: "Say a bit more.", suggestion: null, category: "Other", blocked: false },
        duplicates: [],
      };
    }
    const { reviewQuestion, findSimilarMarkets } = await import("@/lib/market-create.server");
    const [review, duplicates] = await Promise.all([
      reviewQuestion(data.question),
      findSimilarMarkets(data.question),
    ]);
    return { review, duplicates };
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

    const questionId = makeQuestionId(question);
    const { error } = await db.from("conviction_markets").insert({
      question_id: questionId,
      question,
      description: clean(data.description, 500) || null,
      format: data.format === "media" ? "media" : "text",
      side: data.side === "NO" ? "NO" : "YES",
      category: data.category || review.category,
      category_source: data.category ? "creator" : "ai",
      creator_wallet: wallet,
      contract_address: CONTRACT,
      chain_id: CHAIN_ID,
      status: "draft",
    });
    if (error) throw new Error(error.message);
    return { questionId, category: data.category || review.category };
  });

/** A one-shot signed upload URL for the private market-media bucket. */
export const signMarketUpload = createServerFn({ method: "POST" })
  .inputValidator((data: { wallet: string; token: string; questionId: string; ext: string }) => data)
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.token);
    const ext = clean(data.ext, 5).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
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
  .inputValidator((data: { wallet: string; token: string; questionId: string; url: string }) => data)
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
    const { error } = await db
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
      .eq("creator_wallet", wallet);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Remember a failed attempt so the draft can be resumed instead of re-typed. */
export const recordCreateFailure = createServerFn({ method: "POST" })
  .inputValidator((data: { wallet: string; token: string; questionId: string; message: string }) => data)
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
    const { data: row } = await db
      .from("conviction_markets")
      .select("question_id, question, description, category, media, creator_wallet, hidden, moderation_status, status")
      .eq("onchain_id", data.onchainId)
      .maybeSingle();
    if (!row || row.status !== "active" || row.hidden || row.moderation_status === "blocked") {
      return { market: null };
    }
    const media = row.media as { kind?: string; path?: string } | null;
    let url: string | null = null;
    if (media?.path) {
      const { signMediaUrl } = await import("@/lib/market-create.server");
      url = await signMediaUrl(media.path);
    }
    return { market: { ...row, mediaUrl: url } };
  });

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
    const { error } = await serviceClient().from("market_reports").insert({
      onchain_id: data.onchainId ?? null,
      question_id: data.questionId ?? null,
      reason,
      details: clean(data.details, 500) || null,
      reporter_wallet: data.wallet ? String(data.wallet).toLowerCase() : null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
