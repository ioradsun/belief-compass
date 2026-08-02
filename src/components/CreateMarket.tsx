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
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useWalletSession } from "@/hooks/useWalletSession";
import { requestConnect } from "@/lib/connect-bridge";
import { fmtUsd, usdToWei } from "@/domain/order";
import {
  MEDIA_LIMITS,
  QUESTION_MAX,
  acceptAll,
  SUPPORTED_MEDIA_HINT,
  assertAllowedBytes,
  kindForMime,
  type MediaKind,
} from "@/lib/market-create";
import {
  attachMarketLink,
  attachMarketMedia,
  createMarketDraft,
  finalizeMarketCreate,
  recordCreateFailure,
  reviewMarketQuestion,
  signMarketUpload,
} from "@/lib/market-create.functions";
import { clearDraft, getDraft, hashFile, setDraft, setProbe } from "@/lib/create-draft";
import { rewardLine } from "@/domain/market-suggestion";
import { completeSuggestion, trackSuggestion } from "@/lib/market-suggestion.functions";
import { DEFAULT_CURVE, useCreateEconomics, useCreateMarket } from "@/chain/market-create";
import {
  AmountField,
  BalanceLine,
  PrimaryAction,
  SideButton,
  useSpendableBalance,
} from "@/components/order/OrderTicket";

type Attachment =
  | {
      kind: Exclude<MediaKind, "link">;
      file: File;
      previewUrl: string;
      durationSeconds: number | null;
      sha256: string | null;
    }
  | { kind: "link"; url: string };

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
  const [attachment, setAttachment] = useState<Attachment | null>(
    (saved.attachment as Attachment | null) ?? null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const minSeedEth = econ.minSeedWei != null ? Number(econ.minSeedWei) / 1e18 : null;
  const minUsd = minSeedEth != null && ethUsd > 0 ? minSeedEth * ethUsd : null;

  // Seed defaults to the contract minimum the moment we know it — never invented.
  useEffect(() => {
    if (amount === 0 && minUsd) setAmount(Math.max(1, Math.ceil(minUsd * 100) / 100));
  }, [amount, minUsd]);

  const seedWei = usdToWei(amount, ethUsd);
  const belowMin = econ.minSeedWei != null && seedWei < econ.minSeedWei;
  const overBalance = balance.wei != null && seedWei > balance.wei;




  // Debounced AI review + duplicate search. Advisory only — never blocks the button.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(question.trim()), 500);
    return () => clearTimeout(t);
  }, [question]);
  // Keep the session draft in sync, and publish the (debounced) probe the right
  // rail searches on. `type` is derived — there is no Text/Media toggle anymore.
  useEffect(() => {
    setDraft({ question, side, amount, type: attachment ? "media" : "text", attachment });
  }, [question, side, amount, attachment]);
  useEffect(() => {
    setProbe({
      question: debounced,
      sha256: attachment && attachment.kind !== "link" ? (attachment.sha256 ?? null) : null,
      linkUrl: attachment?.kind === "link" ? attachment.url : null,
    });
  }, [debounced, attachment]);
  useEffect(() => () => setProbe(null), []);

  const { data: review } = useQuery({
    queryKey: ["question-review", debounced],
    queryFn: () => reviewMarketQuestion({ data: { question: debounced } }),
    enabled: debounced.length >= MIN_QUESTION,
    staleTime: 5 * 60_000,
  });

  const pickFile = useCallback(async (file: File) => {
    setLocalError(null);
    try {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const { kind } = assertAllowedBytes(head, file.size);
      const previewUrl = URL.createObjectURL(file);
      let durationSeconds: number | null = null;
      if (kind !== "image") {
        durationSeconds = await probeDuration(previewUrl, kind);
        const max = MEDIA_LIMITS[kind].seconds;
        if (max && durationSeconds && durationSeconds > max + 1) {
          URL.revokeObjectURL(previewUrl);
          throw new Error(
            `${kind === "video" ? "Video" : "Audio"} must be under ${max / 60 >= 1 ? `${max / 60} min` : `${max}s`}.`,
          );
        }
      }
      const sha256 = await hashFile(file);
      setAttachment({ kind, file, previewUrl, durationSeconds, sha256 });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "That file can't be used.");
    }
  }, []);

  const openPicker = () => {
    requestAnimationFrame(() => fileRef.current?.click());
  };

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
        if (attachment?.kind === "link") {
          await attachMarketLink({
            data: { wallet: address, token, questionId, url: attachment.url },
          });
        } else if (attachment) {
          const ext = attachment.file.name.split(".").pop() ?? "bin";
          const signed = await signMarketUpload({
            data: { wallet: address, token, questionId, ext },
          });
          const put = await fetch(signed.signedUrl, {
            method: "PUT",
            headers: { "Content-Type": attachment.file.type || "application/octet-stream" },
            body: attachment.file,
          });
          if (!put.ok) throw new Error("Upload failed.");
          await attachMarketMedia({
            data: {
              wallet: address,
              token,
              questionId,
              path: signed.path,
              durationSeconds: attachment.durationSeconds,
              sha256: attachment.sha256,
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
    <div
      className="relative mx-auto flex h-full min-h-0 w-full max-w-[600px] flex-col"
      onPaste={(e) => {
        const f = e.clipboardData.files?.[0];
        if (f) return void pickFile(f);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void pickFile(f);
      }}
    >
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
            {attachment && (
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
              {attachment ? (
                <span />
              ) : (
                <AddMedia onPick={openPicker} />
              )}
              <span className="num text-[11px] text-[var(--text-muted)]">
                {question.length}/{QUESTION_MAX}
              </span>
            </div>
          </div>
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

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={acceptAll()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickFile(f);
          e.target.value = "";
        }}
      />

      {/* Drag reveal — only while a file is over the composer. */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[16px] border-2 border-dashed border-[var(--border-strong)] bg-[var(--bg)]/85 text-[13px] font-medium text-[var(--text-secondary)]">
          Drop image, video, or audio to attach
        </div>
      )}
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

/**
 * Media affordance: one picker for every supported file (the OS dialog does the
 * filtering). No type menu — it was unusable on mobile and the type list is now
 * just a tooltip.
 */
function AddMedia({ onPick }: { onPick: () => void }) {
  const [hint, setHint] = useState(false);

  return (
    <div className="relative flex items-center gap-3">
      <button
        type="button"
        onClick={onPick}
        title={SUPPORTED_MEDIA_HINT}
        className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        <span aria-hidden>＋</span> Add media
      </button>

      <button
        type="button"
        aria-label="Supported file types"
        onClick={() => setHint((v) => !v)}
        onBlur={() => setHint(false)}
        className="grid size-4 place-items-center rounded-full border text-[9px] text-[var(--text-muted)]"
        style={{ borderColor: "var(--border)" }}
      >
        ?
      </button>
      {hint && (
        <div
          className="absolute bottom-6 left-0 z-20 w-[min(280px,calc(100vw-64px))] rounded-[10px] bg-[var(--surface)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg"
          style={{ border: "1px solid var(--border)" }}
        >
          {SUPPORTED_MEDIA_HINT}
        </div>
      )}
    </div>
  );
}

/**
 * A compact attachment chip that stays out of the way. Images show a real
 * thumbnail; everything else shows a glyph. Clicking expands a constrained
 * preview so the media never dominates the composer.
 */
function MediaChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const glyph =
    attachment.kind === "image"
      ? "🖼"
      : attachment.kind === "video"
        ? "🎬"
        : attachment.kind === "audio"
          ? "🎧"
          : "🔗";
  const label =
    attachment.kind === "link" ? attachment.url.replace(/^https?:\/\//, "") : attachment.file.name;

  return (
    <div className="border-b px-2.5 pt-2.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => attachment.kind !== "link" && setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[8px] text-[14px]"
            style={{ border: "1px solid var(--border)" }}
          >
            {attachment.kind === "image" ? (
              <img src={attachment.previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden>{glyph}</span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium text-[var(--text)]">
              {label}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {attachment.kind}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          Remove
        </button>
      </div>
      {open && attachment.kind !== "link" && (
        <div className="pb-2 pt-2">
          {attachment.kind === "image" && (
            <img
              src={attachment.previewUrl}
              alt=""
              className="max-h-[160px] w-full rounded-[8px] object-contain"
            />
          )}
          {attachment.kind === "video" && (
            <video
              src={attachment.previewUrl}
              controls
              className="max-h-[160px] w-full rounded-[8px]"
            />
          )}
          {attachment.kind === "audio" && (
            <audio src={attachment.previewUrl} controls className="w-full" />
          )}
        </div>
      )}
    </div>
  );
}




/** Read a clip's duration from the browser before we ever upload it. */
function probeDuration(url: string, kind: "audio" | "video"): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => resolve(null);
    el.src = url;
  });
}

export { kindForMime };
