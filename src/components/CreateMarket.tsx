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
import { Lightbulb } from "lucide-react";
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
  attachMarketMedia,
  createMarketDraft,
  finalizeMarketCreate,
  recordCreateFailure,
  reviewMarketQuestion,
  signMarketUpload,
} from "@/lib/market-create.functions";
import { clearDraft, getDraft, hashFile, setDraft, setProbe, useAdoptedQuestion } from "@/lib/create-draft";

import {
  CATEGORY_LABEL,
  CREATOR_CATEGORIES,
  normalizeCategory,
  type CategorySlug,
} from "@/domain/categories";
import { rewardLine } from "@/domain/market-suggestion";
import { completeSuggestion, trackSuggestion } from "@/lib/market-suggestion.functions";
import { DEFAULT_CURVE, useCreateEconomics, useCreateMarket } from "@/chain/market-create";
import { weiToEth } from "@/domain/money";
import {
  AmountField,
  PrimaryAction,
  SideButton,
  useSpendableBalance,
} from "@/components/order/OrderTicket";

/**
 * A market carries exactly one piece of evidence: either a link to a post that
 * lives on its own platform, or an image dropped straight onto the form. The
 * dropped file stays local until publish — the signed-upload pipeline needs a
 * draft to own the bytes, so we upload once the draft exists and never before.
 */
type Attachment =
  | { kind: "embed"; media: EmbedMedia }
  | { kind: "file"; file: File; previewUrl: string; sha256?: string | null };


const MIN_QUESTION = 8;

export function CreateMarket({
  ethUsd,
  onCreated,
  onCancel: _onCancel,
  cancelLabel = "Cancel",
}: {
  ethUsd: number;
  onCreated: (marketId: number) => void;
  onCancel: () => void;
  /** "Pass" when this same screen is reached from a Market Idea in the feed. */
  cancelLabel?: string;
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
    const a = saved.attachment as {
      kind?: string;
      embed?: EmbedMedia;
      file?: File;
      previewUrl?: string;
      sha256?: string | null;
    } | null;
    if (a?.embed) return { kind: "embed", media: a.embed };
    if (a?.file && a.previewUrl) {
      return { kind: "file", file: a.file, previewUrl: a.previewUrl, sha256: a.sha256 ?? null };
    }
    return null;
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  /** Null until the creator picks. The AI's read is shown, never silently kept. */
  const [category, setCategory] = useState<CategorySlug | null>(saved.category);
  /** Chips hidden until asked for. A creator who already chose stays expanded, so
   *  a deliberate choice is never buried behind a tap they already made. */
  const [catOpen, setCatOpen] = useState(saved.category != null);

  // AN ALTERNATE ADOPTED FROM THE RIGHT RAIL replaces the question in place —
  // this is where the AI's help lands now that it has left the form. The ref
  // guards against re-applying on remount: only a nonce newer than the one this
  // mount started with is a real request (see create-draft#adoptQuestion), so
  // reopening the form never overwrites an edit made after adopting.
  const adopted = useAdoptedQuestion();
  const adoptedNonce = adopted?.nonce ?? 0;
  const seenAdopt = useRef(adoptedNonce);
  useEffect(() => {
    if (adoptedNonce === seenAdopt.current) return;
    seenAdopt.current = adoptedNonce;
    if (adopted) setQuestion(adopted.text);
  }, [adoptedNonce, adopted]);

  const minSeedEth = econ.minSeedWei == null ? null : weiToEth(econ.minSeedWei);
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
      category,
      type: attachment ? "media" : "text",
      attachment:
        attachment == null
          ? null
          : attachment.kind === "embed"
            ? { kind: "link", url: attachment.media.url, embed: attachment.media }
            : {
                kind: "image",
                file: attachment.file,
                previewUrl: attachment.previewUrl,
                sha256: attachment.sha256 ?? null,
              },
    });
  }, [question, side, amount, attachment, category]);
  useEffect(() => {
    setProbe({
      question: debounced,
      sha256: attachment?.kind === "file" ? (attachment.sha256 ?? null) : null,
      linkUrl: attachment?.kind === "embed" ? attachment.media.url : null,
    });
  }, [debounced, attachment]);

  useEffect(() => () => setProbe(null), []);

  const { data: review } = useQuery({
    queryKey: ["question-review", debounced],
    queryFn: () => reviewMarketQuestion({ data: { question: debounced } }),
    enabled: debounced.length >= MIN_QUESTION,
    staleTime: 5 * 60_000,
  });

  /**
   * The AI's read of the question, shown as the pre-selected chip.
   *
   * It is DISPLAYED, not adopted. `category` stays null until a chip is
   * clicked, and only a non-null value is sent — otherwise the server would
   * stamp `category_source: "creator"` on an answer no human ever looked at,
   * and we would lose the only signal that says which categories are trusted.
   */
  const suggestedCategory = normalizeCategory(review?.review.category);
  const activeCategory = category ?? suggestedCategory;

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
          category,
        },
      });

      try {
        if (attachment?.kind === "embed") {
          await attachMarketEmbed({
            data: { wallet: address, token, questionId, url: attachment.media.url },
          });
        } else if (attachment?.kind === "file") {
          // The draft now exists and owns the bytes: sign, PUT, verify, attach.
          const file = attachment.file;
          const ext = (file.name.split(".").pop() ?? "").slice(0, 5) || "bin";
          const up = await signMarketUpload({ data: { wallet: address, token, questionId, ext } });
          const put = await fetch(up.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!put.ok) throw new Error("That image didn't upload — try again.");
          const dims = await imageDimensions(attachment.previewUrl);
          await attachMarketMedia({
            data: {
              wallet: address,
              token,
              questionId,
              path: up.path,
              width: dims?.width ?? null,
              height: dims?.height ?? null,
              sha256: attachment.sha256 ?? null,
            },
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
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[600px] flex-col justify-center">
      {/* 1 · THE TITLE NAMES THE ACT, AND STOPS SELLING.
          It read "Create a Market. Earn 4.5% on Every Trade." — a revenue pitch
          in the most valuable line on the surface, addressed to somebody who has
          already decided to create. The earn promise is not deleted; it MOVED to
          `LaunchRail`, where it lands the moment the market is live and reads as
          a reward for something done rather than an inducement to do it. */}
      <div className="flex shrink-0 items-start gap-2">
        <h2 className="flex-1 text-[15px] font-semibold leading-snug text-[var(--text)]">
          New Market — Earn 4.5% on all the trading activity
        </h2>
      </div>

      {/* Scrolls only on short (mobile) viewports; on desktop the whole form fits. */}
      <div className="flex min-h-0 flex-initial flex-col gap-4 overflow-y-auto pt-3">
        {source && (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--rel,#9b87f5)]">
            <Lightbulb size={12} aria-hidden /> Market Idea
          </p>
        )}

        {/* 2 · The conviction statement. */}
        <div>
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

          {/* NO AI FEEDBACK RENDERS IN THE FORM. The old inline "Polish" rewrite
              and the rejection reason both appeared a beat after typing paused and
              pushed every field below them down — the AI's opinion arriving as a
              layout shift. That help now lives entirely in the right rail
              (AlternatesRail), which offers 2–3 rewrites to adopt without ever
              moving a field here. The `review` query stays only to pre-fill the
              category guess below, in a height-reserved slot that cannot jump. */}
        </div>

        {/* 2b · WHERE THIS BELONGS — collapsed, because the creator does not care.
            Somebody writing "Do I love UFC and Dana White?" is expressing a
            conviction, not filling in a CMS form, and they have no opinion about
            whether the system files that under Entertainment or Culture. Eight
            chips across the primary flow was the most visually expensive element
            on the surface and the least load-bearing decision on it.

            SO WHY IS IT STILL HERE AT ALL, rather than deleted? Because a CLICK is
            the only thing that stamps `category_source: "creator"`, and that stamp
            is the single signal separating a category a human confirmed from one
            the AI guessed and nobody read. Delete the chips and the classifier
            permanently loses its ground truth — so this is demoted, not removed.
            One line at rest, the full set one tap away, and the guess is already
            correct almost always. */}
        {/* HEIGHT-RESERVED so the AI's category guess can fill this slot without
            shifting the fields below it. At rest the slot is one line tall whether
            or not a guess has arrived yet; expanding to the full chip set is a
            deliberate tap, so growing then is fine. */}
        <div className="min-h-[20px]">
          {catOpen ? (
            <>
              <StepLabel>
                {category ? "Category" : suggestedCategory ? "Category · our guess" : "Category"}
              </StepLabel>
              <div className="flex flex-wrap gap-1.5">
                {CREATOR_CATEGORIES.map((slug) => {
                  const on = activeCategory === slug;
                  const guessed = on && !category;
                  return (
                    <button
                      key={slug}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCategory(slug)}
                      className="rounded-full border px-2.5 py-1 text-[12px] leading-none transition-colors"
                      style={{
                        // A guess reads as an outline, a choice reads as a fill —
                        // the creator can tell at a glance whether anyone decided.
                        borderColor: on ? "var(--text)" : "var(--border)",
                        background: guessed ? "transparent" : on ? "var(--text)" : "transparent",
                        color: guessed ? "var(--text)" : on ? "var(--bg)" : "var(--text-muted)",
                      }}
                    >
                      {CATEGORY_LABEL[slug]}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            /* AT REST. Names the answer rather than asking the question — and
               says nothing at all until the reviewer has one, so an untouched
               form carries no category row whatsoever. */
            activeCategory && (
              <button
                type="button"
                onClick={() => setCatOpen(true)}
                className="text-[11.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                {CATEGORY_LABEL[activeCategory]}
                {category ? "" : " · our guess"}
                <span className="ml-1 opacity-60">change</span>
              </button>
            )
          )}
        </div>

        {/* 3 · Position + amount — grouped by spacing, not by extra chrome. */}
        <div className="space-y-4 rounded-[16px] bg-[var(--surface)] p-4">
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
                  ? "text-[var(--loss)]"
                  : overBalance
                    ? "text-[var(--loss)]"
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
          <p className="text-[12px] text-[var(--loss)]">{errorText}</p>
        )}
      </div>

      {/* 5 · Primary action + disclosure — pinned; stays put while the form scrolls. */}
      <div className="shrink-0 space-y-2 pt-3">
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={_onCancel}
            disabled={busy}
            className="shrink-0 rounded-[14px] border px-4 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            {cancelLabel}
          </button>
          <div className="min-w-0 flex-1">
            <PrimaryAction
              disabled={busy || (isConnected && !failed && !inputsOk)}
              onClick={() => (isConnected ? submit.mutate() : requestConnect())}
            >
              {ctaLabel}
            </PrimaryAction>
          </div>
        </div>
        {/* The Terms link that used to sit under the primary action is gone: it
            put a legal detour directly beneath the one control a reader is
            committing on. Terms remain reachable from the app menu; the act of
            creating no longer asks the writer to step out of it. */}
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
      <span aria-hidden>🔗</span> Embed a link
    </button>
  );
}

/**
 * Paste a link → the platform is recognised locally (instantly, with a poster
 * thumbnail and a warmed connection), metadata fills in from the server a
 * moment later, and the preview IS the confirmation — no OK button. The X
 * closes the composer and drops the media.
 */
function EmbedPicker({
  initialUrl,
  onChange,
  onClose,
}: {
  initialUrl: string;
  onChange: (media: EmbedMedia | null) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(initialUrl);
  const [media, setMedia] = useState<EmbedMedia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Live: every resolved (or cleared) media is published upward immediately.
  const emit = useRef(onChange);
  emit.current = onChange;
  useEffect(() => {
    emit.current(media);
  }, [media]);

  // Local parse is synchronous: the frame + poster can render on the keystroke
  // that completes the URL, long before oEmbed answers.
  useEffect(() => {
    const value = raw.trim();
    const id = ++seq.current;
    if (!value) {
      setMedia(null);
      setError(null);
      return;
    }
    const parsed = parseEmbed(value);
    if (parsed) {
      preconnectEmbed(parsed.platform);
      setMedia({
        kind: "embed",
        ...parsed,
        title: null,
        author: null,
        thumbnail: instantThumbnail(parsed),
      });
      setError(null);
    }
    const t = setTimeout(
      async () => {
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
        }
      },
      parsed ? 250 : 500,
    );
    return () => clearTimeout(t);
  }, [raw]);

  return (
    <div className="relative mt-2 space-y-2 rounded-[14px] bg-[var(--surface)] p-3">
      <div className="flex items-center gap-2">
        <input
          value={raw}
          autoFocus
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            const value = e.target.value;
            // Pasted embed code collapses to the media URL in place, so the
            // field never shows a wall of markup.
            if (/<[a-z]/i.test(value)) {
              const stripped = parseEmbed(value);
              setRaw(stripped ? stripped.url : value);
              return;
            }
            setRaw(value);
          }}
          placeholder="Paste a link or embed code — YouTube, X or Spotify"
          className="min-w-0 flex-1 rounded-[10px] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          style={{ border: "1px solid var(--border)" }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          style={{ border: "1px solid var(--border)" }}
        >
          ✕
        </button>
      </div>
      {media && <MediaEmbed media={media} />}
      {error && <p className="text-[12px] text-[var(--loss)]">{error}</p>}
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
