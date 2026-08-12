/**
 * TRANSPARENCY & TRUST — the page a new investor reads before they risk a dollar.
 *
 * Two rules govern every word here:
 *
 * 1. NO JARGON WITHOUT CONSEQUENCE. "Non-custodial" means nothing to someone who
 *    has never held a private key. So we never say it; we say what it means for
 *    them ("we cannot move your money, because moving it requires your signature").
 * 2. NOTHING WE CANNOT SHOW. Every number on this page is either read live from
 *    the contract on Base, or is a link to the place you can check it yourself.
 *    Where we don't have a definitive answer, we say so instead of rounding it
 *    into a reassurance.
 *
 * Shared by the /trust route and the in-app centre panel, so both read the same.
 */
import { parseAbi } from "viem";
import { useReadContract } from "wagmi";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import meta from "@/chain/abi.meta.json" with { type: "json" };
import { CONVICTION_TAG_TEXT } from "@/chain/attribution";

const IMPL_ADDRESS = meta.impl_address as `0x${string}`;
const BASESCAN = "https://basescan.org";
const PROXY_URL = `${BASESCAN}/address/${PROXY_ADDRESS}`;
const IMPL_URL = `${BASESCAN}/address/${IMPL_ADDRESS}#code`;
const TXNS_URL = `${PROXY_URL}#internaltx`;
const ACTIVITY_URL = `${BASESCAN}/address/${PROXY_ADDRESS}`;

const FEE_ABI = parseAbi([
  "function feeBps() view returns (uint256)",
  "function CREATOR_FEE_SHARE() view returns (uint256)",
  "function FEE_DENOMINATOR() view returns (uint256)",
]);

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * The fee split, read from the contract rather than typed into this file, so the
 * page cannot drift from the chain. If the read hasn't landed (SSR, no RPC), we
 * show the documented figures and say they're the documented figures.
 */
function useLiveFees() {
  const c = { address: PROXY_ADDRESS, abi: FEE_ABI, chainId: CHAIN_ID } as const;
  const fee = useReadContract({ ...c, functionName: "feeBps" });
  const share = useReadContract({ ...c, functionName: "CREATOR_FEE_SHARE" });
  const denom = useReadContract({ ...c, functionName: "FEE_DENOMINATOR" });

  const feeBps = fee.data != null ? Number(fee.data as bigint) : null;
  const shareN = share.data != null ? Number(share.data as bigint) : null;
  const denomN = denom.data != null ? Number(denom.data as bigint) : null;

  if (feeBps == null || shareN == null || !denomN) {
    return { live: false, total: 5, creator: 1, protocol: 4 };
  }
  const total = feeBps / 100;
  const creator = (feeBps * shareN) / denomN / 100;
  return { live: true, total, creator, protocol: Math.max(0, total - creator) };
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-medium text-[var(--yes)] underline-offset-4 hover:underline"
    >
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mt-10 border-t pt-8" style={{ borderColor: "var(--hairline)" }}>
      <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-[var(--text)] sm:text-[21px]">
        {title}
      </h2>
      {lede && <p className="mt-2 text-[15px] leading-relaxed text-[var(--text)]">{lede}</p>}
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--text-secondary)]">{children}</p>
  );
}

function Who({ who, can, cannot }: { who: string; can: string; cannot?: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text)]">{who}</div>
      <div className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{can}</div>
      {cannot && (
        <div className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--no)" }}>
          {cannot}
        </div>
      )}
    </div>
  );
}

export function TrustContent() {
  const fees = useLiveFees();

  return (
    <div className="pb-16">
      {/* THE CENTREPIECE. One line, then the thing that proves it. */}
      <p className="text-[15px] leading-relaxed text-[var(--text)]">
        Conviction Company runs on public blockchain technology. That means the parts that matter —
        where your money sits, what the price does, who gets paid — don&apos;t have to be taken on
        our word. They happen on a public ledger anyone can read.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Ext href={PROXY_URL}>See the contract</Ext>
        <span className="text-[var(--text-muted)]">·</span>
        <Ext href={ACTIVITY_URL}>See live activity</Ext>
      </div>

      <Section
        title="Your money stays in your wallet."
        lede="There is no Conviction account holding your funds. You connect a wallet you already control, and it stays yours."
      >
        <ul className="mt-4 space-y-2.5 text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
          <li>
            <span className="text-[var(--text)]">You approve every transaction.</span> Nothing moves
            without your wallet asking you first and showing you the amount.
          </li>
          <li>
            <span className="text-[var(--text)]">We never see your recovery phrase.</span> We
            don&apos;t need it, we can&apos;t use it, and we will never ask for it.
          </li>
          <li>
            <span className="text-[var(--text)]">
              We hold no key that can spend from your wallet.
            </span>{" "}
            Not &quot;we promise not to&quot; — there is no such key to hold.
          </li>
        </ul>
      </Section>

      <Section
        title="So who can touch what?"
        lede="The honest version, split by who holds which power."
      >
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Who
            who="You"
            can="Control the wallet. Approve or reject every buy, sell and market you create. Withdraw at any time — the contract pays your own address."
          />
          <Who
            who="Conviction Company"
            can="Builds the interface: the questions you see, the people you're matched with, the challenges, the history of your calls. Our transactions carry a plain-text tag so our activity can be counted from public chain data."
            cannot="Cannot move, freeze, or take your funds. Cannot set the price. Cannot change the market rules. We are not an admin of the contract."
          />
          <Who
            who="POV"
            can="Owns and operates the underlying market contract. It is an upgradeable contract with an owner, which means the operator can deploy new logic and change certain settings, such as the fee rate."
            cannot="We do not hold those admin keys, so we can't promise on POV's behalf what they will or won't change. Treat that as a real risk you are accepting."
          />
          <Who
            who="The smart contract"
            can="Executes the rules automatically: prices your buy, credits your position, escrows fees, pays out on a sell. No human presses a button in between."
          />
        </div>
        <P>
          A contract that can be upgraded is a contract whose rules can change. We say that plainly
          here rather than implying nobody can ever change anything.
        </P>
        <div className="mt-4 flex flex-wrap gap-3 text-[13.5px]">
          <Ext href={IMPL_URL}>Read the contract code</Ext>
          <Ext href={PROXY_URL}>Inspect permissions on Basescan</Ext>
        </div>
      </Section>

      <Section
        title="Built on POV."
        lede="Conviction uses the POV technology stack for its opinion markets. POV markets let people buy YES or NO on a question, with the price moving as people buy and sell."
      >
        <P>
          Conviction adds the experience around those markets: making a call, finding the people who
          think like you, challenging the ones who don&apos;t, and building a public record of your
          convictions over time.
        </P>
        <div className="mt-4">
          <Ext href="https://pov.co">Learn about POV</Ext>
        </div>
      </Section>

      <Section
        title="How the price moves."
        lede="There is nobody at Conviction deciding what your YES or NO should cost. The market uses a bonding curve — a formula written into the contract."
      >
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            ["More buying", "price moves up", "var(--yes)"],
            ["More selling", "price moves down", "var(--no)"],
            ["The curve decides", "not a person", "var(--text-secondary)"],
          ].map(([a, b, color]) => (
            <div
              key={a}
              className="rounded-xl p-3.5"
              style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
            >
              <div className="text-[13px] font-semibold" style={{ color }}>
                {a}
              </div>
              <div className="mt-0.5 text-[13px] text-[var(--text-secondary)]">{b}</div>
            </div>
          ))}
        </div>
        <P>
          That has one consequence worth understanding: you never have to wait for someone to take
          the other side. In an ordinary marketplace a buyer needs a matching seller. Here the curve
          quotes a price continuously, which is what makes small and brand-new markets possible at
          all.
        </P>
        <P>
          <span className="text-[var(--text)]">Being early can matter.</span> If you buy YES while
          it&apos;s cheap and conviction moves your way, later buyers push the price up the curve
          and your earlier entry was lower. The reverse is just as true: if conviction moves away
          from your side, the value falls. Early is not a guarantee of profit. It only means you
          entered lower on the curve.
        </P>
        <div className="mt-4">
          <Ext href={IMPL_URL}>See exactly how the curve is coded</Ext>
        </div>
      </Section>

      <Section title="What we make." lede="Fees should be easy to find and easy to understand.">
        <div
          className="mt-4 overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--hairline)" }}
        >
          {[
            [
              "POV protocol fee",
              pct(fees.protocol),
              "Charged by the underlying market contract on a trade.",
            ],
            [
              "Market creator",
              pct(fees.creator),
              "Paid to whoever created the question — escrowed on the contract until they claim it.",
            ],
            [
              "Conviction Company",
              "0%",
              "We take no cut of your trade today. If that ever changes, it will be stated here and shown before you confirm.",
            ],
          ].map(([label, value, note]) => (
            <div
              key={label}
              className="flex items-start justify-between gap-4 border-b p-4 last:border-b-0"
              style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-[var(--text)]">{label}</div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {note}
                </div>
              </div>
              <div className="num shrink-0 text-[15px] font-semibold text-[var(--text)]">
                {value}
              </div>
            </div>
          ))}
        </div>
        <P>
          Total taken off a trade: <span className="num text-[var(--text)]">{pct(fees.total)}</span>
          {fees.live ? (
            <> — read live from the contract on Base just now, not typed into this page.</>
          ) : (
            <> — the documented rate. Reconnect to read it live from the contract.</>
          )}{" "}
          On a $100 buy, that is{" "}
          <span className="num text-[var(--text)]">
            ${(100 * fees.total) / 100 === 0 ? "0" : ((100 * fees.total) / 100).toFixed(2)}
          </span>{" "}
          in fees and{" "}
          <span className="num text-[var(--text)]">${(100 - fees.total).toFixed(2)}</span> into your
          position. Your wallet shows you the exact amounts before you approve.
        </P>
        <P>
          Selling returns proceeds from the curve. Fees, gas and price movement all mean the amount
          you get back can be less than you put in.
        </P>
      </Section>

      <Section title="Can I lose money?" lede="Yes.">
        <P>
          These are speculative markets. A position can go up. A position can go down. You may
          receive less than you put in, including nothing at all. The contracts are public and
          verified, but they have not been independently audited — smart contracts can contain bugs.
        </P>
        <P>
          <span className="text-[var(--text)]">
            Don&apos;t use money you cannot afford to lose.
          </span>{" "}
          Conviction is designed to make markets understandable — not to make them safe.
        </P>
      </Section>

      <Section
        title="Want to learn without risking anything?"
        lede="You don't have to start with real money."
      >
        <P>
          Simulation Mode gives you 1,000 CC to play with. No real money, no wallet spend — the same
          markets, the same prices, so you can see how positions and price movement actually behave
          before you decide whether to participate for real.
        </P>
      </Section>

      <Section
        title="What we will never ask for."
        lede="Never share your wallet recovery phrase — your seed phrase — with anyone."
      >
        <P>
          Conviction Company will never need it to let you trade, verify your account, give you
          support, release something, or fix a stuck transaction. There is no situation where we
          need it. Anyone asking you for it — in a DM, an email, a &quot;support&quot; chat, or a
          site that looks like this one — is trying to take your money, not help you.
        </P>
      </Section>

      <Section
        title="Verify. Don't just trust."
        lede="Wherever possible, don't take our word for something you can check yourself."
      >
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Ext href={PROXY_URL}>The market contract</Ext>
          <Ext href={IMPL_URL}>The code it runs</Ext>
          <Ext href={TXNS_URL}>On-chain transactions</Ext>
          <Ext href="https://pov.co">POV technology</Ext>
        </div>
        <P>
          Every transaction we route ends with the plain-text tag{" "}
          <span className="num text-[var(--text)]">{CONVICTION_TAG_TEXT}</span>, so our share of
          activity can be counted from public chain data by anyone, without asking us.
        </P>
        <P>
          Contract: <span className="num">{short(PROXY_ADDRESS)}</span> on Base (chain {CHAIN_ID}).
          Implementation: <span className="num">{short(IMPL_ADDRESS)}</span>.
        </P>
        <P>
          If something about how Conviction handles your money isn&apos;t clear, we haven&apos;t
          explained it well enough yet. Tell us and we&apos;ll fix the page.
        </P>
      </Section>
    </div>
  );
}
