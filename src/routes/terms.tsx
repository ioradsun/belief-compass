import { createFileRoute } from "@tanstack/react-router";
import { TermsContent } from "@/components/TermsContent";

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
    <main className="mx-auto min-h-[100dvh] max-w-[720px] bg-[var(--bg)] px-6 py-16 text-[var(--text)]">
      <h1 className="mb-3 text-[32px] font-semibold tracking-[-0.02em]">Terms &amp; risk</h1>
      <TermsContent />
      <a href="/" className="mt-12 inline-block text-[13px] text-[var(--text-muted)] underline">
        Back to Conviction
      </a>
    </main>
  );
}
