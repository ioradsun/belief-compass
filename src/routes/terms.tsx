import { createFileRoute } from "@tanstack/react-router";
import { TermsContent } from "@/components/TermsContent";
import { InfoPageHeader } from "@/components/InfoPageHeader";


export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & risk — Conviction" },
      {
        name: "description",
        content:
          "Plain-English terms for conviction.company: real ETH, unaudited contracts, permissionless markets, your uploads, and how takedowns work.",
      },
      { property: "og:title", content: "Terms & risk — Conviction" },
      {
        property: "og:description",
        content: "Plain-English terms: real money, public chain, your content, our takedown rules.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <div className="h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[var(--bg)] text-[var(--text)] [-webkit-overflow-scrolling:touch]">
      <InfoPageHeader label="Terms & risk" />
      <main className="mx-auto w-full max-w-[720px] px-5 py-10 sm:px-6 sm:py-14">
        <h1 className="mb-3 text-[28px] font-semibold tracking-[-0.02em] sm:text-[32px]">
          Terms &amp; risk
        </h1>
        <TermsContent />
      </main>
    </div>
  );
}

