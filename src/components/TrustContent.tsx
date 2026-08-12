/**
 * TRANSPARENCY & TRUST — the page a new investor reads before they risk a dollar.
 *
 * The copy here is authored and approved verbatim. Only the addresses and links
 * are computed, so the page can never drift from the contracts it points at.
 *
 * Shared by the /trust route and the in-app centre panel, so both read the same.
 */
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import meta from "@/chain/abi.meta.json" with { type: "json" };
import { CONVICTION_TAG_TEXT } from "@/chain/attribution";

const IMPL_ADDRESS = meta.impl_address as `0x${string}`;
const BASESCAN = "https://basescan.org";
const PROXY_URL = `${BASESCAN}/address/${PROXY_ADDRESS}`;
const IMPL_URL = `${BASESCAN}/address/${IMPL_ADDRESS}#code`;
const TXNS_URL = `${PROXY_URL}#internaltx`;
const ACTIVITY_URL = `${BASESCAN}/address/${PROXY_ADDRESS}`;
const POV_URL = "https://pov.co";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--hairline)" }}
    >
      <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</div>
      <div className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{body}</div>
    </div>
  );
}

export function TrustContent() {
  return (
    <div className="pb-16">
      <p className="text-[15px] leading-relaxed text-[var(--text)]">
        Conviction Company runs on public blockchain technology.
      </p>
      <P>
        Your trades, the market rules, and the fees happen onchain — where they can be independently
        verified instead of taken on our word.
      </P>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Ext href={PROXY_URL}>See the contract</Ext>
        <span className="text-[var(--text-muted)]">·</span>
        <Ext href={ACTIVITY_URL}>See live activity</Ext>
      </div>

      <Section
        title="Your money stays yours."
        lede="There is no Conviction account holding your money."
      >
        <P>You connect your own wallet and approve every transaction yourself.</P>
        <ul className="mt-4 space-y-2.5 text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
          <li>
            <span className="text-[var(--text)]">You control your wallet.</span> Nothing moves from
            it unless you approve a transaction.
          </li>
          <li>
            <span className="text-[var(--text)]">We can&apos;t spend from your wallet.</span>{" "}
            Conviction does not have a key that can access your funds.
          </li>
          <li>
            <span className="text-[var(--text)]">We will never ask for your recovery phrase.</span>{" "}
            There is no legitimate reason for us — or anyone claiming to be us — to need it.
          </li>
        </ul>
        <P>That&apos;s the first rule of Conviction:</P>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed text-[var(--text)]">
          Your wallet. Your approval. Your money.
        </p>
      </Section>

      <Section
        title="What happens when you make a trade?"
        lede="Conviction is built on POV's market technology."
      >
        <P>You choose YES or NO and decide how much you want to put behind your call.</P>
        <P>From there, the smart contract handles the transaction.</P>
        <P>
          Conviction doesn&apos;t manually set the price, match your trade, or decide what your
          position is worth.
        </P>
        <P>The contract follows its programmed rules.</P>
        <div className="mt-4">
          <Ext href={POV_URL}>Learn about POV</Ext>
        </div>
      </Section>

      <Section
        title="The price comes from a curve, not a person."
        lede="POV markets use a bonding curve."
      >
        <P>Forget the technical name. The important part is simple:</P>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[
            ["More buying", "price goes up.", "var(--yes)"],
            ["More selling", "price goes down.", "var(--no)"],
            ["The price", "is calculated automatically.", "var(--text-secondary)"],
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
          That also means you don&apos;t need to wait around for another person to take the opposite
          side of your trade. The curve can quote a price continuously.
        </P>
      </Section>

      <Section title="Why being early can matter">
        <ul className="mt-4 space-y-2.5 text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
          <li>Suppose you buy YES while the price is low.</li>
          <li>More people become convinced and buy YES after you.</li>
          <li>The price moves higher on the curve.</li>
          <li>You entered earlier at a lower price.</li>
        </ul>
        <P>
          <span className="text-[var(--text)]">But conviction can move the other way too.</span> If
          people sell your side, its value can fall.
        </P>
        <P>Being early can create opportunity. It never guarantees a profit.</P>
      </Section>

      <Section title="Where does the 5% go?" lede="Every trade currently carries a total 5% fee.">
        <div
          className="mt-4 overflow-hidden rounded-xl"
          style={{ border: "1px solid var(--hairline)" }}
        >
          {[
            ["4% → POV protocol", "Paid through the underlying market contract."],
            ["1% → Market creator", "Paid to whoever created the market."],
            [
              "0% → Conviction Company",
              "Conviction currently takes no portion of the trading fee.",
            ],
          ].map(([label, note]) => (
            <div
              key={label}
              className="border-b p-4 last:border-b-0"
              style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
            >
              <div className="text-[13.5px] font-semibold text-[var(--text)]">{label}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {note}
              </div>
            </div>
          ))}
        </div>
        <P>
          So on a $100 buy, $5 is charged in fees and $95 goes toward the position, subject to the
          exact contract mechanics and transaction details shown before approval.
        </P>
        <P>
          If Conviction ever introduces its own trading fee, we&apos;ll show it here and before you
          confirm a transaction.
        </P>
        <p className="mt-3 text-[14.5px] font-semibold leading-relaxed text-[var(--text)]">
          No hidden Conviction trading fee.
        </p>
      </Section>

      <Section
        title="Who can actually control what?"
        lede="This is where the distinction matters."
      >
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Card title="You control your wallet." body="" />
          <Card
            title="Conviction"
            body="Controls the experience around the markets — discovery, people, challenges and your history."
          />
          <Card title="POV" body="Operates the underlying market contract." />
        </div>
        <P>
          POV&apos;s contract is upgradeable and has an owner. That means its operator can update
          contract logic or certain settings.
        </P>
        <P>Conviction does not hold those administrative keys.</P>
        <P>
          That&apos;s an important risk to understand: public code doesn&apos;t mean code can never
          change.
        </P>
        <div className="mt-4">
          <Ext href={PROXY_URL}>Inspect the contract and its permissions</Ext>
        </div>
      </Section>

      <Section title="Can I lose money?" lede="Yes.">
        <P>These are speculative markets.</P>
        <P>Prices can move against you. You can get back less than you put in.</P>
        <P>Fees and network costs also affect what you ultimately receive.</P>
        <P>
          And smart contracts introduce technical risk. The contracts are public and verified, but
          according to the information currently available to us, they have not been independently
          audited.
        </P>
        <P>Public does not mean risk-free.</P>
        <p className="mt-3 text-[14.5px] font-semibold leading-relaxed text-[var(--text)]">
          Don&apos;t put in money you cannot afford to lose.
        </p>
      </Section>

      <Section title="Not ready for real money?" lede="You don't need it.">
        <p className="mt-3 text-[14.5px] font-semibold leading-relaxed text-[var(--text)]">
          Enter Simulation Mode
        </p>
        <P>Play with 1,000 CC. No real money.</P>
        <P>
          Use the same experience to understand positions and price movement before deciding whether
          you want to participate with real assets.
        </P>
      </Section>

      <Section
        title="Don't trust us. Verify us."
        lede="The point of putting financial activity onchain is that you shouldn't have to rely only on what a company tells you."
      >
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Ext href={PROXY_URL}>Market contract</Ext>
          <Ext href={IMPL_URL}>Contract code</Ext>
          <Ext href={TXNS_URL}>Onchain activity</Ext>
          <Ext href={POV_URL}>POV technology</Ext>
        </div>
        <P>
          Conviction-routed transactions include the plain-text tag{" "}
          <span className="num text-[var(--text)]">{CONVICTION_TAG_TEXT}</span>, allowing our
          activity to be identified from public blockchain data.
        </P>
        <P>
          Contract:{" "}
          <Ext href={PROXY_URL}>
            <span className="num">{short(PROXY_ADDRESS)}</span>
          </Ext>{" "}
          on Base (chain {CHAIN_ID})
          <br />
          Implementation:{" "}
          <Ext href={IMPL_URL}>
            <span className="num">{short(IMPL_ADDRESS)}</span>
          </Ext>
        </P>
        <P>
          If something about how your money works on Conviction isn&apos;t clear, we haven&apos;t
          explained it well enough.
        </P>
      </Section>
    </div>
  );
}
