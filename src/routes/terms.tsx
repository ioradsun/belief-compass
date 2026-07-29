import { createFileRoute } from "@tanstack/react-router";
import { DISCLAIMERS } from "@/lib/market-create";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & risk — Conviction" },
      {
        name: "description",
        content:
          "How Conviction markets work: permissionless creation, unaudited contracts, irreversible transactions, content rules and takedowns.",
      },
      { property: "og:title", content: "Terms & risk — Conviction" },
      {
        property: "og:description",
        content: "Permissionless markets, real ETH, unaudited contracts. Read before you create.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Terms,
});

const SECTIONS: { heading: string; body: string }[] = [
  { heading: "Financial risk", body: DISCLAIMERS.financial },
  { heading: "Permissionless creation", body: DISCLAIMERS.permissionless },
  { heading: "Opinion markets", body: DISCLAIMERS.opinion },
  { heading: "Conviction is not POV", body: DISCLAIMERS.notPov },
  { heading: "Your content", body: DISCLAIMERS.ugc },
  { heading: "Permanence", body: DISCLAIMERS.immutable },
];

function Terms() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-[720px] bg-[var(--bg)] px-6 py-16 text-[var(--text)]">
      <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Terms &amp; risk</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">
        Conviction is a front end for a public, permissionless smart contract on Base. Read this
        before you create or back a market.
      </p>
      <div className="mt-10 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[15px] font-semibold">{s.heading}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">{s.body}</p>
          </section>
        ))}
        <section>
          <h2 className="text-[15px] font-semibold">Reporting</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">
            Every market carries a Report control. Reported markets are reviewed and may be hidden
            from Conviction. Hiding removes a market from this site only — the on-chain market and
            its tokens continue to exist and cannot be deleted by anyone.
          </p>
        </section>
      </div>
      <a href="/" className="mt-12 inline-block text-[13px] text-[var(--text-muted)] underline">
        Back to Conviction
      </a>
    </main>
  );
}
