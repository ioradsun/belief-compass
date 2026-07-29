import { createFileRoute } from "@tanstack/react-router";

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

type Section = { heading: string; points: string[] };

/**
 * Written to be read, not skimmed past. Every line is one idea, short sentences,
 * no defined terms, no cross-references.
 */
const SECTIONS: Section[] = [
  {
    heading: "What Conviction is",
    points: [
      "Conviction is a website for opinion markets. You back what you believe with real money.",
      "The markets run on a public smart contract on the Base blockchain. We did not build the chain and we cannot change what it records.",
      "Conviction is not POV.co. Markets you create here, and any media you upload here, live on conviction.company. POV and other apps can read the public on-chain data, but they do not host your media or your wording.",
    ],
  },
  {
    heading: "Money and risk",
    points: [
      "You spend real ETH. Nothing here is play money.",
      "Transactions cannot be undone, reversed, or refunded. Not by us, not by anyone.",
      "The smart contract is not audited. It may have bugs. You could lose everything you put in.",
      "Prices can go to zero. There is no promised return.",
      "Markets are opinions. There is no official outcome, no judge, and no payout for being right about the real world.",
      "We are not your broker, your bank, or your advisor. Nothing on this site is financial or legal advice.",
      "You are responsible for your own taxes and for the laws where you live. If opinion markets are not legal where you are, do not use Conviction.",
    ],
  },
  {
    heading: "Who can create markets",
    points: [
      "Anyone with a wallet. We do not approve, vet, or endorse markets.",
      "A market existing on Conviction is not a statement that we agree with it or think it is true.",
      "You need a wallet to trade. You are responsible for keeping your wallet and its keys safe. If you lose access, we cannot recover it for you.",
    ],
  },
  {
    heading: "Your content and uploads",
    points: [
      "You can attach an image, video, audio clip, or link to a market you create.",
      "You keep ownership of what you upload. You give us permission to store it and show it on Conviction.",
      "By uploading you confirm: it is yours or you have the right to use it, it does not infringe anyone's copyright, trademark, or privacy, and it is not illegal.",
      "Not allowed: sexual content, content involving minors, harassment or targeted abuse, threats, doxxing, hate speech, malware, scams, and anything illegal.",
      "We can remove any media, any wording, or any market from this site at any time, with or without a reason.",
      "We may scan uploads automatically and reject files that look unsafe.",
    ],
  },
  {
    heading: "Reporting and takedowns",
    points: [
      "Every market has a Report button. Anyone can use it, wallet or no wallet.",
      "If you own a copyright and your work is here without permission, report it and tell us what it is and where. We will review and remove it if it checks out.",
      "Hiding a market removes it from conviction.company only. The on-chain market and its tokens still exist and nobody can delete them — not us, not you.",
    ],
  },
  {
    heading: "What is permanent",
    points: [
      "The on-chain part of a market is forever. Its ID, its creator address, and every trade are public and permanent.",
      "You can edit or delete the question wording and media we host. You cannot edit or delete the chain.",
      "Anyone can see your wallet address and your trading history. Do not use Conviction if you need those to be private.",
    ],
  },
  {
    heading: "The boring but necessary part",
    points: [
      "Conviction is provided as-is. We do not promise it will be available, correct, or bug-free.",
      "To the fullest extent the law allows, we are not liable for any losses you suffer from using Conviction, including lost funds, failed transactions, chain outages, or content posted by other people.",
      "We can change these terms. If we do, the version on this page is the one that applies.",
      "If you keep using Conviction, you accept these terms.",
    ],
  },
];

function Terms() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-[720px] bg-[var(--bg)] px-6 py-16 text-[var(--text)]">
      <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Terms &amp; risk</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-secondary)]">
        In one line: you are spending real money on an unaudited public contract, anyone can create
        a market, everything you trade is public forever, and we can remove content from this site
        but never from the chain.
      </p>
      <div className="mt-10 space-y-9">
        {SECTIONS.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[15px] font-semibold">{s.heading}</h2>
            <ul className="mt-3 space-y-2">
              {s.points.map((p) => (
                <li
                  key={p}
                  className="flex gap-2.5 text-[14px] leading-relaxed text-[var(--text-secondary)]"
                >
                  <span aria-hidden className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-[var(--text-muted)]" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <a href="/" className="mt-12 inline-block text-[13px] text-[var(--text-muted)] underline">
        Back to Conviction
      </a>
    </main>
  );
}
