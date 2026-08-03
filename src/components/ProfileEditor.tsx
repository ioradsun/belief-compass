/**
 * Edit your own identity — display name and picture — from inside the account
 * panel. The change is authorised by a single wallet signature, then it wins
 * over whatever we resolved from POV everywhere in the app.
 */
import { useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2 } from "lucide-react";
import { getProfileOverride, saveProfileOverride } from "@/lib/profile-edit.functions";
import { fileToAvatarDataUrl, profileEditMessage, MAX_DISPLAY_NAME } from "@/lib/profile-edit";

export function ProfileEditor({ wallet, fallbackName }: { wallet: string; fallbackName: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: current } = useQuery({
    queryKey: ["profile-override", wallet],
    queryFn: async () => await getProfileOverride({ data: { wallet } }),
    enabled: Boolean(wallet),
    staleTime: 60_000,
  });

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!current) return;
    setName(current.displayName ?? "");
    setAvatar(current.avatarUrl ?? null);
  }, [current]);

  const dirty =
    name.trim() !== (current?.displayName ?? "") || avatar !== (current?.avatarUrl ?? null);

  const save = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Connect a wallet first.");
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const signature = await signMessageAsync({
        message: profileEditMessage(wallet, nonce),
      });
      return await saveProfileOverride({
        data: {
          wallet,
          signer: address,
          nonce,
          signature,
          displayName: name.trim() || null,
          avatarUrl: avatar,
        },
      });
    },
    onSuccess: () => {
      setError(null);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["profile-override", wallet] });
      qc.invalidateQueries({ queryKey: ["person"] });
      qc.invalidateQueries({ queryKey: ["pov-user"] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Could not save."),
  });

  async function pick(file?: File) {
    if (!file) return;
    setError(null);
    try {
      setAvatar(await fileToAvatarDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image.");
    }
  }

  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Profile
      </h3>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[var(--border)]"
          aria-label="Upload a profile picture"
        >
          {avatar ? (
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center bg-[var(--surface)] text-[var(--text-muted)]">
              <Camera className="h-4 w-4" />
            </span>
          )}
          <span className="absolute inset-0 hidden place-items-center bg-black/50 text-white group-hover:grid">
            <Camera className="h-4 w-4" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_DISPLAY_NAME))}
            placeholder={fallbackName || "Display name"}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
          />
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {MAX_DISPLAY_NAME - name.length} characters left
          </p>
        </div>
      </div>

      {(avatar || name) && (
        <button
          type="button"
          onClick={() => {
            setAvatar(null);
            setName("");
          }}
          className="mt-2 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          Reset to my POV identity
        </button>
      )}

      <button
        type="button"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--text)] px-3 py-2 text-[12px] font-medium text-[var(--bg)] transition-opacity disabled:opacity-40"
      >
        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {save.isPending ? "Sign to confirm…" : saved ? "Saved" : "Save profile"}
      </button>

      {error && <p className="mt-2 text-[11px] text-[var(--danger,#f87171)]">{error}</p>}
    </section>
  );
}
