import { createFileRoute } from "@tanstack/react-router";
import { TrustContent } from "@/components/TrustContent";
import { InfoPageHeader } from "@/components/InfoPageHeader";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Transparency & Trust — Conviction" },
      {
        name: "description",
        content:
          "Where your money sits, who can touch it, how the price moves, what the fees are, and what can go wrong — in plain English, with the Base contracts linked.",
      },
      { property: "og:title", content: "Transparency & Trust — Conviction" },
      {
        property: "og:description",
        content:
          "Trust shouldn't require trust. Your wallet, the contracts, the fees and the risks — all verifiable on Base.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Trust,
});

function Trust() {
  return (
    <div className="h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[var(--bg)] text-[var(--text)] [-webkit-overflow-scrolling:touch]">
      <InfoPageHeader label="Transparency & Trust" />
      <main className="mx-auto w-full max-w-[720px] px-5 py-10 sm:px-6 sm:py-14">
        <h1 className="mb-3 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">
          Trust shouldn&apos;t require trust.
        </h1>
        <TrustContent />
      </main>
    </div>
  );
}
