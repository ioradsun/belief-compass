/**
 * Create a Conviction market — one screen, one signature.
 *
 * Order of operations matters: the off-chain draft (and its immutable
 * questionId) is reserved first, media is verified server-side before we ask
 * for money, and the wallet is only prompted once every precondition has
 * already passed a simulation. A failed send leaves a resumable draft, never a
 * half-created market.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useWalletSession } from "@/hooks/useWalletSession";
import { requestConnect } from "@/lib/connect-bridge";
import { fmtUsd, usdToWei } from "@/domain/order";
import {
  DISCLAIMERS,
  MEDIA_LIMITS,
  QUESTION_MAX,
  accept,
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
import {
  DEFAULT_CURVE,
  useCreateEconomics,
  useCreateMarket,
  useEthBalance,
} from "@/chain/market-create";

type Attachment =
  | { kind: Exclude<MediaKind, "link">; file: File; previewUrl: string; durationSeconds: number | null }
  | { kind: "link"; url: string };

export function CreateMarket({
  ethUsd,
  onCreated,
  onCancel,
}: {
  ethUsd: number;
  onCreated: (marketId: number) => void;
  onCancel: () => void;
}) {
  const { isConnected } = useAccount();
  const { ensureSession, address } = useWalletSession();
  const econ = useCreateEconomics();
  const balance = useEthBalance();
  const { create, phase, error: chainError } = useCreateMarket();

  const [question, setQuestion] = useState("");
  const [description] = useState("");
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState<number>(0);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [type, setType] = useState<"text" | "media">("text");
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickKind, setPickKind] = useState<Exclude<MediaKind, "link">>("image");

  const minSeedEth = econ.minSeedWei != null ? Number(econ.minSeedWei) / 1e18 : null;
  const minUsd = minSeedEth != null && ethUsd > 0 ? minSeedEth * ethUsd : null;

  // Seed defaults to the contract minimum the moment we know it — never a
  // number we invented.
  useEffect(() => {
    if (amount === 0 && minUsd) setAmount(Math.max(1, Math.ceil(minUsd * 100) / 100));
  }, [amount, minUsd]);

  const seedWei = usdToWei(amount, ethUsd);
  const belowMin = econ.minSeedWei != null && seedWei < econ.minSeedWei;
  const overBalance = balance.wei != null && seedWei > balance.wei;

  // Debounced AI review + duplicate search. Advisory only: it never blocks the
  // button unless the content is hard-blocked server-side.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(question.trim()), 700);
    return () => clearTimeout(t);
  }, [question]);
  const { data: review } = useQuery({
    queryKey: ["question-review", debounced],
    queryFn: () => reviewMarketQuestion({ data: { question: debounced } }),
    enabled: debounced.length >= 8,
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
      setAttachment({ kind, file, previewUrl, durationSeconds });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "That file can't be used.");
    }
  }, []);

  const submit = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Connect a wallet first.");
      const token = await ensureSession();
      const { questionId } = await createMarketDraft({
        data: {
          wallet: address,
          token,
          question,
          description: description || null,
          format: attachment ? "media" : "text",
          side,
        },
      });

      try {
        if (attachment?.kind === "link") {
          await attachMarketLink({ data: { wallet: address, token, questionId, url: attachment.url } });
        } else if (attachment) {
          const ext = attachment.file.name.split(".").pop() ?? "bin";
          const signed = await signMarketUpload({ data: { wallet: address, token, questionId, ext } });
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
        return result.marketId;
      } catch (e) {
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
    onSuccess: (marketId) => onCreated(marketId),
  });

  const busy = submit.isPending || phase === "checking" || phase === "signing" || phase === "confirming";
  const canSubmit =
    isConnected && question.trim().length >= 8 && agreed && !belowMin && !overBalance && !busy;

  const phaseLabel = useMemo(() => {
    if (phase === "checking") return "Checking the contract…";
    if (phase === "signing") return "Confirm in your wallet…";
    if (phase === "confirming") return "Waiting for Base…";
    if (submit.isPending) return "Preparing…";
    return null;
  }, [phase, submit.isPending]);

  const errorText =
    localError ??
    chainError ??
    (submit.error instanceof Error ? submit.error.message.split("\n")[0] : null);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[var(--text)]">New Conviction market</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
      </div>

      {/* The claim */}
      <label className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        The claim
      </label>
      <textarea
        value={question}
        maxLength={QUESTION_MAX}
        rows={2}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Say the thing people will argue about."
        className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[16px] leading-snug text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>{review?.review.category ? `Reads as ${review.review.category}` : "One sharp claim"}</span>
        <span className="num">
          {question.length}/{QUESTION_MAX}
        </span>
      </div>

      {review && !review.review.ok && review.review.reason && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px] text-[var(--text-secondary)]">
          {review.review.reason}
          {review.review.suggestion && (
            <button
              type="button"
              onClick={() => setQuestion(review.review.suggestion!)}
              className="mt-2 block text-left text-[12px] text-[var(--text)] underline"
            >
              Use: “{review.review.suggestion}”
            </button>
          )}
        </div>
      )}

      {!!review?.duplicates?.length && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Already asked?
          </div>
          <ul className="mt-1.5 space-y-1">
            {review.duplicates.map((d) => (
              <li key={`${d.questionId ?? d.onchainId}`} className="truncate text-[12px] text-[var(--text-secondary)]">
                {d.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={description}
        maxLength={500}
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Context (optional)"
        className="mt-3 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
      />

      {/* Media */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={[accept("image"), accept("audio"), accept("video")].join(",")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-full border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--text)]"
        >
          + Image, audio or video
        </button>
        <input
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          onBlur={() => {
            const v = linkDraft.trim();
            if (v.startsWith("https://")) setAttachment({ kind: "link", url: v });
          }}
          placeholder="or paste an https link"
          className="min-w-[180px] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
      {attachment && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              {attachment.kind}
            </span>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-[12px] text-[var(--text-muted)]"
            >
              Remove
            </button>
          </div>
          <div className="mt-2">
            {attachment.kind === "image" && (
              <img
                src={attachment.previewUrl}
                alt={question || "Market media"}
                className="max-h-[220px] w-full rounded-md object-cover"
              />
            )}
            {attachment.kind === "video" && (
              <video src={attachment.previewUrl} controls className="max-h-[220px] w-full rounded-md" />
            )}
            {attachment.kind === "audio" && <audio src={attachment.previewUrl} controls className="w-full" />}
            {attachment.kind === "link" && (
              <span className="break-all text-[12px] text-[var(--text-secondary)]">{attachment.url}</span>
            )}
          </div>
        </div>
      )}

      {/* Your side + seed */}
      <div className="mt-6 grid grid-cols-2 gap-2">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-colors ${
              side === s
                ? s === "YES"
                  ? "border-[var(--yes)] text-[var(--yes)]"
                  : "border-[var(--no)] text-[var(--no)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between text-[12px] text-[var(--text-muted)]">
          <span>Seed</span>
          <span className="num">
            {balance.wei != null && ethUsd > 0
              ? `Avail ${fmtUsd((Number(balance.wei) / 1e18) * ethUsd)}`
              : "Avail —"}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[18px] text-[var(--text-muted)]">$</span>
          <input
            inputMode="decimal"
            value={amount ? String(amount) : ""}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              setAmount(v ? Math.round(Number(v) * 100) / 100 : 0);
            }}
            className="w-full bg-transparent text-[22px] font-semibold text-[var(--text)] outline-none num"
            placeholder="0"
          />
          <span className="num shrink-0 text-[12px] text-[var(--text-muted)]">
            {(Number(seedWei) / 1e18).toFixed(4)} ETH
          </span>
        </div>
        <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {minUsd != null && (
            <div>
              Contract minimum {minSeedEth} ETH{ethUsd > 0 ? ` (≈ ${fmtUsd(minUsd)})` : ""}. Your seed
              buys your opening {side} position.
            </div>
          )}
          {econ.creatorFeeBps != null && (
            <div>
              You earn {(econ.creatorFeeBps / 100).toFixed(2)}% of every trade in this market, forever.
            </div>
          )}
        </div>
      </div>

      {/* Risk */}
      <label className="mt-5 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--text)]"
        />
        <span className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          {DISCLAIMERS.financial} {DISCLAIMERS.ugc}{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline">
            Terms &amp; risk
          </a>
        </span>
      </label>

      {belowMin && amount > 0 && (
        <p className="mt-2 text-[12px] text-[var(--no)]">Seed is below the contract minimum.</p>
      )}
      {overBalance && <p className="mt-2 text-[12px] text-[var(--no)]">That's more than your balance.</p>}
      {errorText && <p className="mt-2 text-[12px] text-[var(--no)]">{errorText}</p>}

      <button
        type="button"
        disabled={!canSubmit && isConnected}
        onClick={() => (isConnected ? submit.mutate() : requestConnect())}
        className="mt-4 w-full rounded-full bg-[var(--text)] px-4 py-3 text-[14px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {!isConnected
          ? "Connect wallet"
          : (phaseLabel ?? `Create market · ${side} · ${fmtUsd(amount)}`)}
      </button>
      <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
        {DISCLAIMERS.notPov}
      </p>
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
