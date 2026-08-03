/**
 * Create a Conviction market — three questions, one signature.
 *
 * The whole screen only ever asks: what do you believe, YES or NO, how much.
 * Everything else (the contract minimum, the ETH conversion, the creator's cut,
 * the media pipeline) is inferred or tucked behind a disclosure. The order
 * controls are the SAME atoms the market page's decision dock uses — this screen
 * adds only the conviction question, an optional attachment, the earnings line
 * and the createMarket submission.
 *
 * Order of operations still matters: the off-chain draft (and its immutable
 * questionId) is reserved first, media is verified server-side before we ask for
 * money, and the wallet is only prompted once every precondition has passed a
 * simulation. A failed send leaves a resumable draft, never a half-created market.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useWalletSession } from "@/hooks/useWalletSession";
import { requestConnect } from "@/lib/connect-bridge";
import { fmtUsd, usdToWei } from "@/domain/order";
import { QUESTION_MAX, kindForMime } from "@/lib/market-create";
import {
  EMBED_HINT,
  PLATFORM_LABEL,
  instantThumbnail,
  parseEmbed,
  type EmbedMedia,
} from "@/lib/embed";
import { MediaEmbed, preconnectEmbed } from "@/components/MediaEmbed";
import { attachMarketEmbed, resolveEmbed } from "@/lib/embed.functions";
import {
  createMarketDraft,
  finalizeMarketCreate,
  recordCreateFailure,
  reviewMarketQuestion,
} from "@/lib/market-create.functions";
import { clearDraft, getDraft, setDraft, setProbe } from "@/lib/create-draft";
import { rewardLine } from "@/domain/market-suggestion";
import { completeSuggestion, trackSuggestion } from "@/lib/market-suggestion.functions";
import { DEFAULT_CURVE, useCreateEconomics, useCreateMarket } from "@/chain/market-create";
import {
  AmountField,
  
  PrimaryAction,
  SideButton,
  useSpendableBalance,
} from "@/components/order/OrderTicket";

/**
 * A market carries exactly one piece of evidence, and it is always a link to a
 * post that lives on its own platform. Direct uploads are intentionally
 * disabled (the signed-upload pipeline is still on the server, unused) —
 * Conviction hosts the market, not the media.
 */
type Attachment = { kind: "embed"; media: EmbedMedia };

const MIN_QUESTION = 8;


export function CreateMarket({
  ethUsd,
  onCreated,
  onCancel: _onCancel,
  onOpenTerms,
}: {
  ethUsd: number;
  onCreated: (marketId: number) => void;
  onCancel: () => void;
  onOpenTerms?: () => void;
}) {
  const { isConnected } = useAccount();
  const { ensureSession, address } = useWalletSession();
  const econ = useCreateEconomics();
  const balance = useSpendableBalance();
  const { create, phase, error: chainError } = useCreateMarket();

  // Hydrated from the session draft so leaving to read a market (or the terms)
  // never costs the user what they typed.
  const saved = getDraft();
  const source = saved.source;
  const [question, setQuestion] = useState(saved.question);
  const [side, setSide] = useState<"YES" | "NO">(saved.side);
  const [amount, setAmount] = useState<number>(saved.amount);
  const [attachment, setAttachment] = useState<Attachment | null>(() => {
    const a = saved.attachment as { embed?: EmbedMedia } | null;
    return a?.embed ? { kind: "embed", media: a.embed } : null;
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);



  const minSeedEth = econ.minSeedWei != null ? Number(econ.minSeedWei) / 1e18 : null;
  const minUsd = minSeedEth != null && ethUsd > 0 ? minSeedEth * ethUsd : null;

  // Seed defaults to the contract minimum the moment we know it — never invented.
  useEffect(() => {
    if (amount === 0 && minUsd) setAmount(Math.max(1, Math.ceil(minUsd * 100) / 100));
  }, [amount, minUsd]);

  const seedWei = usdToWei(amount, ethUsd);
  const belowMin = econ.minSeedWei != null && seedWei < econ.minSeedWei;
  const overBalance = balance.wei != null && seedWei > balance.wei;
  const availUsd = balance.eth != null && ethUsd > 0 ? balance.eth * ethUsd : null;




  // Debounced AI review + duplicate search. Advisory only — never blocks the button.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(question.trim()), 500);
    return () => clearTimeout(t);
  }, [question]);
  // Keep the session draft in sync, and publish the (debounced) probe the right
  // rail searches on. `type` is derived — there is no Text/Media toggle anymore.
  useEffect(() => {
    setDraft({
      question,
      side,
      amount,
      type: attachment ? "media" : "text",
      attachment: attachment
        ? { kind: "link", url: attachment.media.url, embed: attachment.media }
        : null,
    });
  }, [question, side, amount, attachment]);
  useEffect(() => {
    setProbe({
      question: debounced,
      sha256: null,
      linkUrl: attachment?.media.url ?? null,
    });
  }, [debounced, attachment]);
  useEffect(() => () => setProbe(null), []);

  const { data: review } = useQuery({
    queryKey: ["question-review", debounced],
    queryFn: () => reviewMarketQuestion({ data: { question: debounced } }),
    enabled: debounced.length >= MIN_QUESTION,
    staleTime: 5 * 60_000,
  });



  const submit = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Connect a wallet first.");
      const token = await ensureSession();
      const note = (t: "suggestion_publish_started" | "suggestion_publish_failed") => {
        if (!source) return;
        void trackSuggestion({
          data: { wallet: address, session: token, id: source.suggestionId, type: t },
        }).catch(() => undefined);
      };
      note("suggestion_publish_started");

      const { questionId } = await createMarketDraft({
        data: {
          wallet: address,
          token,
          question,
          description: null,
          format: attachment ? "media" : "text",
          side,
        },
      });

      try {
        if (attachment) {
          await attachMarketEmbed({
            data: { wallet: address, token, questionId, url: attachment.media.url },
          });
        }


        const result = await create({ questionId, yes: side === "YES", seedWei });
        await finalizeMarketCreate({
          data: {
            wallet: address,
            token,
            questionId,
            marketId: result.marketId,
            txHash: result.txHash,
            yesToken: result.yesToken,
            noToken: result.noToken,
            curve: DEFAULT_CURVE,
            seedEthWei: seedWei.toString(),
            stakeUsd: amount,
            usdPerEth: ethUsd || null,
            creatorFeeBps: econ.creatorFeeBps,
          },
        });
        if (source) {
          await completeSuggestion({
            data: {
              wallet: address,
              session: token,
              id: source.suggestionId,
              marketId: result.marketId,
              finalQuestion: question.trim(),
            },
          }).catch(() => undefined);
        }
        return result.marketId;
      } catch (e) {
        note("suggestion_publish_failed");
        await recordCreateFailure({
          data: {
            wallet: address,
            token,
            questionId,
            message: e instanceof Error ? e.message : "unknown",
          },
        }).catch(() => undefined);
        throw e;
      }
    },
    onSuccess: (marketId) => {
      clearDraft();
      onCreated(marketId);
    },
  });

  const busy =
    submit.isPending || phase === "checking" || phase === "signing" || phase === "confirming";
  const failed = phase === "error" || submit.isError;
  const inputsOk = question.trim().length >= MIN_QUESTION && !belowMin && !overBalance;

  // One button, four transitions — never a page-level loading state.
  const ctaLabel = !isConnected
    ? "Connect wallet"
    : submit.isSuccess
      ? "Market created"
      : phase === "checking" || phase === "signing"
        ? "Confirm in wallet"
        : phase === "confirming" || submit.isPending
          ? "Creating market…"
          : failed
            ? "Try again"
            : "Publish Market";

  const errorText =
    localError ??
    chainError ??
    (submit.error instanceof Error ? submit.error.message.split("\n")[0] : null);

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[600px] flex-col">

      {/* 1 · Compact header — pinned. Title carries the earn promise; the
          provenance tag sits inline, top-right. */}
      <div className="flex shrink-0 items-start gap-2">
        <h2 className="flex-1 text-[15px] font-semibold leading-snug text-[var(--text)]">
          Create a Market. Earn 4.5% on Every Trade.
        </h2>
      </div>






      {/* Scrolls only on short (mobile) viewports; on desktop the whole form fits. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-3">
        {source && (
          <p className="text-[11px] text-[var(--text-muted)]">
            <span aria-hidden>🏠</span> The House found this question — edit anything before it goes
            live.
          </p>
        )}

        {/* 2 · The conviction statement. */}
        <div>
          <StepLabel>State your conviction</StepLabel>
          <div
            className="rounded-[14px] border bg-[var(--surface)] transition-colors focus-within:border-[var(--border-strong)]"
            style={{ borderColor: "var(--border)" }}
          >
            {attachment && !linkOpen && (
              <MediaChip attachment={attachment} onRemove={() => setAttachment(null)} />
            )}
            <textarea
              id="conviction"
              value={question}
              maxLength={QUESTION_MAX}
              rows={3}
              autoFocus
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={"Write a statement people can answer Yes or No."}
              className="w-full resize-none bg-transparent px-3 pt-2.5 text-[16px] leading-snug text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {/* Inside the field: Add media on the left (only until one is
              attached — a market holds a single media object; the chip's Remove
              is then the control), counter on the right. */}
            <div className="flex items-center justify-between px-3 pb-2">
              {attachment && !linkOpen ? (
                <span />
              ) : (
                <AddMedia onPick={() => setLinkOpen((v) => !v)} active={linkOpen} />
              )}
              <span className="num text-[11px] text-[var(--text-muted)]">
                {question.length}/{QUESTION_MAX}
              </span>
            </div>
          </div>
          {linkOpen && (
            <EmbedPicker
              initialUrl={attachment?.media.url ?? ""}
              onClose={() => {
                setAttachment(null);
                setLinkOpen(false);
              }}
              onChange={(media) => {
                setAttachment(media ? { kind: "embed", media } : null);
                setLocalError(null);
              }}
            />
          )}

          {/* AI check / polish — subtle, advisory. */}
          {review && (
            <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
              {review.review.ok && <span className="text-[var(--yes)]">✓ AI-checked</span>}
              {review.review.suggestion && (
                <>
                  {review.review.ok && <span className="text-[var(--text-muted)]">·</span>}
                  <button
                    type="button"
                    onClick={() => setQuestion(review.review.suggestion!)}
                    className="text-[var(--text)] underline"
                  >
                    Polish
                  </button>
                </>
              )}
              {!review.review.ok && !review.review.suggestion && review.review.reason && (
                <span className="text-[var(--text-muted)]">{review.review.reason}</span>
              )}
            </div>
          )}
        </div>

        {/* 3 · Position + amount — grouped by spacing, not by extra chrome. */}
        <div className="space-y-4 rounded-[16px] p-4" style={{ border: "1px solid var(--border)" }}>
          <div>
            <StepLabel>Your position</StepLabel>
            <div className="flex gap-2">
              <SideButton
                label="Yes"
                tone="yes"
                selected={side === "YES"}
                onClick={() => setSide("YES")}
              />
              <SideButton
                label="No"
                tone="no"
                selected={side === "NO"}
                onClick={() => setSide("NO")}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <AmountField amount={amount} setAmount={setAmount} ariaLabel="Seed amount in dollars" />
            {/* One line, one job. The bounds aren't rules to memorise — the field
                stays quiet at "what you can spend" and only speaks up (in the
                error tone) at the moment an entry actually breaks a bound. */}
            <p
              className={`num text-right text-[11px] ${
                belowMin && amount > 0
                  ? "text-[var(--no)]"
                  : overBalance
                    ? "text-[var(--no)]"
                    : "text-[var(--text-muted)]"
              }`}
              aria-live="polite"
            >
              {belowMin && amount > 0
                ? `Minimum ${minUsd != null ? fmtUsd(minUsd) : "—"}`
                : overBalance
                  ? `Over your balance${availUsd != null ? ` · ${fmtUsd(availUsd)} available` : ""}`
                  : availUsd != null
                    ? `${fmtUsd(availUsd)} available`
                    : " "}
            </p>
          </div>
        </div>


        {errorText && !belowMin && !overBalance && (
          <p className="text-[12px] text-[var(--no)]">{errorText}</p>
        )}
      </div>

      {/* 5 · Primary action + disclosure — pinned; stays put while the form scrolls. */}
      <div className="shrink-0 space-y-2 pt-3">
        <PrimaryAction
          disabled={busy || (isConnected && !failed && !inputsOk)}
          onClick={() => (isConnected ? submit.mutate() : requestConnect())}
        >
          {ctaLabel}
        </PrimaryAction>

        {/* 6 · Disclosure — one compact line. */}
        <p className="text-center text-[11px] text-[var(--text-muted)]">
          Conviction Company Exclusive. Not available on pov.co yet.{" "}
          <button
            type="button"
            onClick={() => (onOpenTerms ? onOpenTerms() : window.open("/terms", "_blank"))}
            className="underline"
          >
            Terms
          </button>
        </p>

      </div>

      {/* Direct uploads are intentionally disabled in this version — a market's
          evidence is always a link to a post that lives on its own platform. */}

    </div>
  );
}

/**
 * Quiet navigational step label — identical weight, colour and spacing across
 * all three steps so they read as wayfinding, not section headings.
 */
function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-medium leading-none text-[var(--text-muted)]">{children}</p>
  );
}

/** Opens the link composer. Uploads are disabled — evidence is always a link. */
function AddMedia({ onPick, active }: { onPick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={EMBED_HINT}
      className={`flex items-center gap-1 text-[11px] font-medium transition-colors hover:text-[var(--text)] ${
        active ? "text-[var(--text)]" : "text-[var(--text-muted)]"
      }`}
    >
      <span aria-hidden>＋</span> Add media
    </button>
  );
}

/**
 * Paste a link → the platform is recognised locally (instantly, with a poster
 * thumbnail and a warmed connection), metadata is filled in from the server a
 * moment later, and OK confirms it. No platform selector, no upload controls.
 */
function EmbedPicker({
  onConfirm,
  onCancel,
}: {
  onConfirm: (media: EmbedMedia) => void;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [media, setMedia] = useState<EmbedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  // Local parse is synchronous: the frame + poster can render on the keystroke
  // that completes the URL, long before oEmbed answers.
  useEffect(() => {
    const value = raw.trim();
    const id = ++seq.current;
    if (!value) {
      setMedia(null);
      setError(null);
      setPending(false);
      return;
    }
    const parsed = parseEmbed(value);
    if (parsed) {
      preconnectEmbed(parsed.platform);
      setMedia({ kind: "embed", ...parsed, title: null, author: null, thumbnail: instantThumbnail(parsed) });
      setError(null);
    }
    setPending(true);
    const t = setTimeout(async () => {
      try {
        const res = await resolveEmbed({ data: { url: value } });
        if (seq.current !== id) return;
        if (res.media) {
          setMedia(res.media);
          setError(null);
        } else if (!parsed) {
          setMedia(null);
          setError(res.error);
        }
      } catch {
        if (seq.current === id && !parsed) setError("Couldn't read that link.");
      } finally {
        if (seq.current === id) setPending(false);
      }
    }, parsed ? 250 : 500);
    return () => clearTimeout(t);
  }, [raw]);

  return (
    <div className="mt-2 space-y-2 rounded-[14px] p-3" style={{ border: "1px solid var(--border)" }}>
      <input
        value={raw}
        autoFocus
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Paste a YouTube, Instagram, TikTok, X or Spotify link"
        className="w-full rounded-[10px] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
        style={{ border: "1px solid var(--border)" }}
      />
      {media && <MediaEmbed media={media} />}
      {error && <p className="text-[12px] text-[var(--no)]">{error}</p>}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)]">
          {media ? PLATFORM_LABEL[media.platform] : pending ? "Checking link…" : EMBED_HINT}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!media}
            onClick={() => media && onConfirm(media)}
            className="rounded-[8px] px-3 py-1 text-[12px] font-semibold text-[var(--text)] disabled:opacity-40"
            style={{ border: "1px solid var(--border-strong)" }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

/** The confirmed embed, shown compactly above the conviction statement. */
function MediaChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const m = attachment.media;
  return (
    <div className="border-b px-2.5 py-2.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[8px] text-[14px]"
          style={{ border: "1px solid var(--border)" }}
        >
          {m.thumbnail ? (
            <img src={m.thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden>🔗</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[var(--text)]">
            {m.title ?? m.url.replace(/^https?:\/\//, "")}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            {PLATFORM_LABEL[m.platform]}
            {m.author ? ` · ${m.author}` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          Remove
        </button>
      </div>
    </div>
  );
}


export { kindForMime };
