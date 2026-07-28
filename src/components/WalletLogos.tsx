/**
 * Wallet brand marks for the connect picker.
 *
 * EIP-6963 connectors ship their own `icon` (a data URI) — we prefer that. For the
 * lazily-loaded wallets (Coinbase, WalletConnect) there is no connector object until
 * the SDK loads, so we draw the brand inline: no network request, no layout shift.
 */

function Coinbase() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#0052FF" />
      <rect x="11" y="11" width="10" height="10" rx="2" fill="#fff" />
    </svg>
  );
}

function WalletConnectMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#3B99FC" />
      <path
        d="M9.6 13.2a9 9 0 0 1 12.8 0l.4.4a.44.44 0 0 1 0 .63l-1.45 1.42a.23.23 0 0 1-.32 0l-.6-.58a6.3 6.3 0 0 0-8.86 0l-.64.63a.23.23 0 0 1-.32 0L9.17 14.3a.44.44 0 0 1 0-.63Zm15.8 3l1.29 1.26a.44.44 0 0 1 0 .63l-5.82 5.7a.46.46 0 0 1-.64 0l-4.13-4.05a.12.12 0 0 0-.16 0l-4.13 4.05a.46.46 0 0 1-.64 0l-5.83-5.7a.44.44 0 0 1 0-.63l1.29-1.27a.46.46 0 0 1 .64 0l4.13 4.05a.12.12 0 0 0 .16 0l4.13-4.05a.46.46 0 0 1 .64 0l4.13 4.05a.12.12 0 0 0 .16 0l4.14-4.05a.46.46 0 0 1 .64 0Z"
        fill="#fff"
      />
    </svg>
  );
}

function MetaMask() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#F6851B" />
      <path d="M23.5 8.5 17.4 13l1.1-2.7 5-1.8Z" fill="#fff" />
      <path d="M8.5 8.5 14.5 13l-1.1-2.7-4.9-1.8Z" fill="#fff" />
      <path d="M20.8 19.4 19.2 22l3.5 1 1-3.5-2.9-.1Zm-11.5.1 1 3.5 3.5-1-1.6-2.6-2.9.1Z" fill="#fff" />
    </svg>
  );
}

function Generic() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <rect width="32" height="32" rx="10" className="fill-muted" />
      <rect x="7" y="10" width="18" height="12" rx="3" className="fill-muted-foreground" />
      <circle cx="21" cy="16" r="1.6" className="fill-card" />
    </svg>
  );
}

export type WalletBrand = "coinbase" | "walletConnect" | "metamask" | "generic";

export function brandFor(name: string, id = ""): WalletBrand {
  const v = `${id} ${name}`.toLowerCase();
  if (v.includes("coinbase")) return "coinbase";
  if (v.includes("walletconnect")) return "walletConnect";
  if (v.includes("meta")) return "metamask";
  return "generic";
}

/** Prefers the connector's own icon, falls back to the inline brand mark. */
export function WalletLogo({
  brand,
  icon,
  alt,
}: {
  brand: WalletBrand;
  icon?: string;
  alt: string;
}) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
      {icon ? (
        <img src={icon} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : brand === "coinbase" ? (
        <Coinbase />
      ) : brand === "walletConnect" ? (
        <WalletConnectMark />
      ) : brand === "metamask" ? (
        <MetaMask />
      ) : (
        <Generic />
      )}
    </span>
  );
}
