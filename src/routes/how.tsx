/**
 * conviction.company/how — "How Conviction Company Works".
 *
 * A guided product story, not technical documentation. Its single most important
 * job: make unmistakable that Conviction Company is NOT a separate market
 * protocol. It is a conviction + discovery layer built directly on POV — one
 * market system, a new way to experience it. Everything here is written to match
 * how the product actually works (belief markets, bonding curves, YES/NO tokens,
 * conviction DNA, sharing, fees, agents, boosts) in a friendly, transparent tone.
 *
 * Same visual language as the rest of the app (dark surface, warm-white type,
 * hairline borders, green YES / red NO), so the relationship feels immediate.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/how")({
  head: () => ({
    meta: [
      { title: "How Conviction Company Works" },
      {
        name: "description",
        content:
          "A simple, friendly guide to Conviction Company — the conviction and discovery layer built directly on POV. State what you believe, back it with money, and find the people who believe it too.",
      },
      { property: "og:title", content: "How Conviction Company Works" },
      {
        property: "og:description",
        content:
          "One market system. A new way to experience it. A plain-language guide to belief markets, POV, and how everything fits together.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HowItWorks,
});

/** The table of contents — every section a reader can jump to. */
const NAV: { id: string; label: string }[] = [
  { id: "what", label: "What it is" },
  { id: "built-on-pov", label: "Built on POV" },
  { id: "availability", label: "Markets across platforms" },
  { id: "belief", label: "Belief markets" },
  { id: "underneath", label: "The market underneath" },
  { id: "people", label: "The people layer" },
  { id: "create", label: "Create & earn" },
  { id: "share", label: "Share your conviction" },
  { id: "details", label: "Fees, agents & boosts" },
  { id: "ownership", label: "Ownership & safety" },
];

function HowItWorks() {
  const [active, setActive] = useState(NAV[0].id);
  const [filter, setFilter] = useState("");

  // Scroll-spy: highlight the section currently in view so the reader always
  // knows where they are in the story.
  useEffect(() => {
    const els = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const shownNav = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? NAV.filter((n) => n.label.toLowerCase().includes(q)) : NAV;
  }, [filter]);

  return (
    <div className="h-[100dvh] w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-[var(--bg)] text-[var(--text)] [-webkit-overflow-scrolling:touch] [scroll-behavior:smooth]">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <InfoPageHeader label="How it works">


        {/* Mobile jump nav — a dropdown, so ten sections cost one line, not a
            horizontal scroll the reader has to fish through. */}
        <div className="px-4 pb-2 lg:hidden">
          <details className="group relative" onClick={() => {}}>
            <summary
              className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-[var(--text)] [&::-webkit-details-marker]:hidden"
              style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
              aria-label="Jump to a section"
            >
              <span className="truncate">
                {NAV.find((n) => n.id === active)?.label ?? "Jump to a section"}
              </span>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </summary>
            <ul
              className="absolute left-0 right-0 z-40 mt-1.5 max-h-[60dvh] overflow-y-auto rounded-xl p-1 shadow-xl"
              style={{ border: "1px solid var(--border)", background: "var(--panel)" }}
            >
              {NAV.map((n) => (
                <li key={n.id}>
                  <a
                    href={`#${n.id}`}
                    onClick={(e) => {
                      (
                        e.currentTarget.closest("details") as HTMLDetailsElement | null
                      )?.removeAttribute("open");
                    }}
                    className="block rounded-lg px-3 py-2.5 text-[14px]"
                    style={
                      active === n.id
                        ? { background: "var(--surface)", color: "var(--text)" }
                        : { color: "var(--text-secondary)" }
                    }
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </InfoPageHeader>

      <div className="mx-auto w-full max-w-[1180px] px-4 lg:px-8">

        <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
          {/* ── Sticky table of contents (desktop) ──────────────────────────── */}
          <nav className="hidden lg:block">
            <div className="sticky top-[76px] py-12">
              <div className="mb-3 flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1.5">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Jump to a topic"
                  aria-label="Filter sections"
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
              <ul className="space-y-0.5">
                {shownNav.map((n) => (
                  <li key={n.id}>
                    <a
                      href={`#${n.id}`}
                      className="block rounded-lg px-3 py-1.5 text-[13px] transition-colors"
                      style={
                        active === n.id
                          ? { background: "var(--surface)", color: "var(--text)" }
                          : { color: "var(--text-secondary)" }
                      }
                    >
                      {n.label}
                    </a>
                  </li>
                ))}
                {shownNav.length === 0 && (
                  <li className="px-3 py-1.5 text-[12px] text-[var(--text-muted)]">No section.</li>
                )}
              </ul>
            </div>
          </nav>

          {/* ── The story ───────────────────────────────────────────────────── */}
          <main className="pb-24 pt-8 lg:pt-12">
            <Hero />
            <BuiltOnPov />
            <Availability />
            <BeliefMarkets />
            <Underneath />
            <PeopleLayer />
            <CreateAndEarn />
            <ShareConviction />
            <Details />
            <Ownership />
            <Closing />
          </main>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Reusable presentation
 * ────────────────────────────────────────────────────────────────────────── */

function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-[92px] border-t border-[var(--border)] pt-12 first:border-0 first:pt-0 [&+section]:mt-16"
    >
      {kicker && (
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {kicker}
        </div>
      )}
      <h2 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--text)] sm:text-[32px]">
        {title}
      </h2>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/** A colored YES/NO pill — the product's core visual vocabulary. */
function Side({ side, className = "" }: { side: "YES" | "NO"; className?: string }) {
  const c = side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${className}`}
      style={{ color: c, background: `color-mix(in oklab, ${c} 15%, transparent)` }}
    >
      {side}
    </span>
  );
}

function DownArrow() {
  return (
    <div className="flex justify-center py-2" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 text-[var(--text-muted)]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A tidy bullet list in the app's voice. */
function List({
  items,
  tone = "neutral",
}: {
  items: ReactNode[];
  tone?: "neutral" | "yes" | "no";
}) {
  const dot = tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : "var(--text-muted)";
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span
            className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: dot }}
          />
          <span className="text-[14px] text-[var(--text-secondary)]">{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** A one-line takeaway — the italic beat that closes a section. */
function Beat({ children }: { children: ReactNode }) {
  return (
    <p className="text-[15px] font-medium italic leading-relaxed text-[var(--text)]">{children}</p>
  );
}

/** A compact, non-interactive demo of a belief-market card. */
function DemoMarketCard({
  question,
  yes,
  exclusive = false,
}: {
  question: string;
  yes: number;
  exclusive?: boolean;
}) {
  const no = 100 - yes;
  const lead = yes >= no ? "YES" : "NO";
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {exclusive && (
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          <BrandMark size={11} /> Conviction Company Exclusive
        </div>
      )}
      <div className="text-[16px] font-semibold leading-snug text-[var(--text)]">{question}</div>

      {/* sentiment = capital */}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--bg)]">
        <div style={{ width: `${yes}%`, background: "var(--yes)" }} />
        <div style={{ width: `${no}%`, background: "var(--no)" }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] font-semibold">
        <span style={{ color: "var(--yes)" }}>{yes}% YES</span>
        <span style={{ color: "var(--no)" }}>{no}% NO</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div
          className="rounded-xl py-2 text-center text-[13px] font-semibold"
          style={{
            color: "var(--yes)",
            background: "color-mix(in oklab, var(--yes) 14%, transparent)",
          }}
        >
          Back YES
        </div>
        <div
          className="rounded-xl py-2 text-center text-[13px] font-semibold"
          style={{
            color: "var(--no)",
            background: "color-mix(in oklab, var(--no) 14%, transparent)",
          }}
        >
          Back NO
        </div>
      </div>
      <div className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
        {lead} is leading · tap Skip to see the next market
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Sections
 * ────────────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section id="what" className="scroll-mt-[92px]">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        How Conviction Company Works
      </div>
      <h1 className="mt-3 max-w-[16ch] text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text)] sm:text-[52px]">
        State what you believe.
      </h1>
      <div className="mt-3 space-y-1 text-[18px] leading-snug text-[var(--text-secondary)] sm:text-[22px]">
        <p>Back it with money.</p>
        <p>Find the people who believe it too.</p>
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-[1.1fr_1fr] sm:items-center">
        <div className="space-y-4">
          <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Conviction Company is a social conviction and trading experience built on top of{" "}
            <span className="text-[var(--text)]">POV</span>. POV provides the underlying market
            technology — YES and NO tokens, bonding curves, onchain trading, liquidity, prices and
            fees. Conviction Company adds a new way to discover, understand, create and share those
            markets.
          </p>
          <List
            items={[
              "State what you believe",
              "Back your conviction with real money",
              "Discover people who think like you — and people who strongly disagree",
              "Create markets for your own community, and earn from them",
            ]}
          />
          <p className="text-[13px] text-[var(--text-muted)]">
            Powered by POV belief-market technology on Base.
          </p>
        </div>
        <DemoMarketCard question="Is AI making people more creative?" yes={64} />
      </div>
    </section>
  );
}

function BuiltOnPov() {
  const layers = [
    {
      name: "Conviction Company",
      sub: "People, identity, discovery, media and sharing",
      tone: "var(--text)",
    },
    { name: "POV", sub: "Markets, tokens, bonding curves and trading", tone: "var(--text)" },
    { name: "Base", sub: "Onchain transactions and wallet ownership", tone: "var(--text)" },
  ];
  return (
    <Section id="built-on-pov" kicker="The relationship" title="Built on POV">
      <p>
        POV powers the markets. Conviction Company powers the people around them. It&rsquo;s one
        market system — a new way to experience it.
      </p>
      <div className="mt-2">
        {layers.map((l, i) => (
          <div key={l.name}>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
              <div className="text-[15px] font-semibold text-[var(--text)]">{l.name}</div>
              <div className="text-[13px] text-[var(--text-muted)]">{l.sub}</div>
            </div>
            {i < layers.length - 1 && <DownArrow />}
          </div>
        ))}
      </div>
      <Card className="!bg-[var(--bg)]">
        <p className="text-[14px] text-[var(--text-secondary)]">
          When you buy YES or NO here, you buy the <span className="text-[var(--text)]">same</span>{" "}
          POV market token, receive the same onchain position, trade against the same bonding curve
          at the same price, and can sell using the same underlying liquidity.
        </p>
        <p className="mt-3 text-[14px] text-[var(--text-secondary)]">
          Conviction Company doesn&rsquo;t create a separate version of a POV market. It presents
          the same market through a more personal, social, conviction-driven experience.
        </p>
      </Card>
      <Beat>
        One market. One price. One position — and it belongs to your wallet, not a website.
      </Beat>
    </Section>
  );
}

function Availability() {
  return (
    <Section
      id="availability"
      kicker="The one important difference"
      title="How markets move between platforms"
    >
      <p>
        This is the one rule worth understanding up front. Markets can flow from POV into Conviction
        Company. Markets created on Conviction Company are{" "}
        <span className="text-[var(--text)]">not</span> automatically published back to the POV
        website. There is no two-way sync.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Created on POV
          </div>
          <div className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]">
            POV
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-[var(--text-muted)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Conviction Company
          </div>
          <div
            className="mt-4 inline-flex rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{
              color: "var(--yes)",
              background: "color-mix(in oklab, var(--yes) 14%, transparent)",
            }}
          >
            Available on both
          </div>
        </Card>

        <Card>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Created on Conviction Company
          </div>
          <div className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]">
            <BrandMark size={16} /> Conviction Company only
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-3 py-1 text-[12px] font-semibold text-[var(--text-secondary)]">
            Conviction Company Exclusive
          </div>
        </Card>
      </div>

      <Beat>Same technology, different storefront. What changes is where the market lives.</Beat>
    </Section>
  );
}

function BeliefMarkets() {
  return (
    <Section id="belief" kicker="What you're trading" title="Belief markets">
      <p>
        A belief market measures what people believe{" "}
        <span className="text-[var(--text)]">right now</span>. Unlike a traditional prediction
        market, it never needs to predict a future event or wait for a final outcome. Every market
        asks a question you can answer <Side side="YES" /> or <Side side="NO" />.
      </p>

      <div className="grid gap-5 sm:grid-cols-[1fr_1.05fr] sm:items-start">
        <div className="space-y-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Markets never resolve
          </div>
          <p className="text-[14px]">
            Conviction markets are perpetual. They don&rsquo;t expire, settle at a deadline, need an
            official judge, or pay out on a final result. People keep buying or selling either side
            as beliefs change.
          </p>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            YES and NO are separate assets
          </div>
          <p className="text-[14px]">
            Each market has two tokens — a YES token and a NO token — with separate demand and
            separate prices. YES can rise on its own; NO can rise on its own; both sides can attract
            capital. Neither waits for the market to resolve.
          </p>
        </div>
        <div className="space-y-4">
          <DemoMarketCard question="Does pineapple belong on pizza?" yes={58} />
          <Card className="!p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Sentiment is capital
            </div>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Conviction isn&rsquo;t measured in likes or polls — it&rsquo;s measured in where money
              goes. $70k backing YES and $30k backing NO shows as{" "}
              <span style={{ color: "var(--yes)" }}>70% YES</span> ·{" "}
              <span style={{ color: "var(--no)" }}>30% NO</span>. That&rsquo;s a live reading of
              where conviction is flowing, not a claim about who&rsquo;s right.
            </p>
          </Card>
        </div>
      </div>
      <Beat>Belief moves. The market moves with it.</Beat>
    </Section>
  );
}

function Underneath() {
  return (
    <Section id="underneath" kicker="POV technology" title="The market underneath">
      <p>
        Every YES and NO token trades on its own bonding curve — a mechanism that adjusts the price
        automatically as people buy and sell. There&rsquo;s no external order book to wait on: you
        trade directly against the curve at the current price, which creates continuous onchain
        liquidity for as long as the market is active.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--yes)" }} /> When
            people buy
          </div>
          <List
            items={["Demand increases", "The token price rises", "Earlier buyers gain exposure"]}
            tone="yes"
          />
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--text)]">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--no)" }} /> When
            people sell
          </div>
          <List
            items={["Demand decreases", "The token price falls", "Capital exits that side"]}
            tone="no"
          />
        </Card>
      </div>
      <Card className="!bg-[var(--bg)]">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Why early conviction matters
        </div>
        <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
          Earlier buyers enter lower on the curve. As more people back the same side, the price can
          rise, the market draws attention, and the position can become more valuable. Conviction
          Company is built around that moment:{" "}
          <span className="text-[var(--text)]">you believed before the crowd arrived.</span>
        </p>
      </Card>
    </Section>
  );
}

function PeopleLayer() {
  return (
    <Section id="people" kicker="The conviction layer" title="The people around the market">
      <p>
        This is what Conviction Company adds that POV alone does not. Your activity becomes a living
        profile of what you actually believe — not what you say you like, but the positions you
        take. We call it your <span className="text-[var(--text)]">Conviction DNA</span>.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">Your profile</div>
          <div className="mt-2 text-[13px] text-[var(--text-secondary)]">
            The markets you backed, which side, how strongly, how long you held, and how your
            conviction changed — the topics that matter most to you.
          </div>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold" style={{ color: "var(--yes)" }}>
            Find your Tribe
          </div>
          <div className="mt-2 text-[13px] text-[var(--text-secondary)]">
            People whose positions keep aligning with yours — sometimes on everything, sometimes
            only on a topic. It answers: who believes what I believe about this?
          </div>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold" style={{ color: "var(--no)" }}>
            Meet your Rivals
          </div>
          <div className="mt-2 text-[13px] text-[var(--text-secondary)]">
            People who consistently take the other side. They surface the strongest opposing case
            and test whether your belief is really strong enough.
          </div>
        </Card>
      </div>
      <p>
        Most platforms organize markets around charts and volume. Conviction Company also organizes
        them around relationships — a market can surface because your Tribe is entering, a Rival
        took the other side, your community is divided, or your own position is becoming unusual.
      </p>
      <Beat>
        Less like searching a database, more like walking into a room where everyone has something
        at stake.
      </Beat>
    </Section>
  );
}

function CreateAndEarn() {
  const steps = [
    "State your conviction as a clear YES/NO question",
    "Add context or embedded media",
    "Create the market — it gets YES and NO tokens, bonding curves and a shareable page",
    "Share it with the people who’ll have an opinion",
    "Earn a share of the trading fees your market generates",
  ];
  return (
    <Section id="create" kicker="Create & earn" title="Turn a good question into a market">
      <p>
        Anyone can create a market inside Conviction Company. It just has to be a clear question
        that can be answered YES or NO. Good questions are specific and worth arguing about —
        &ldquo;Is remote work better for creativity?&rdquo;, &ldquo;Is Bitcoin more valuable as
        money than as an investment?&rdquo; Avoid duplicates, the unanswerable, or anything written
        to deceive.
      </p>
      <div className="grid gap-5 sm:grid-cols-[1.15fr_1fr] sm:items-start">
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--text)] text-[11px] font-bold text-[var(--bg)]">
                {i + 1}
              </span>
              <span className="text-[14px] text-[var(--text-secondary)]">{s}</span>
            </li>
          ))}
        </ol>
        <div className="space-y-4">
          <DemoMarketCard
            question="Will AI agents become more influential than creators?"
            yes={47}
            exclusive
          />
          <Card className="!p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Creators earn
            </div>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Every buy into your market generates trading fees, and a portion is allocated to you.
              More activity, more earning potential. The exact share depends on trading and the
              current fee structure shown when the market is created.
            </p>
          </Card>
        </div>
      </div>
      <Beat>Create conviction. Earn from the activity it generates.</Beat>
    </Section>
  );
}

function ShareConviction() {
  return (
    <Section id="share" kicker="Sharing" title="Share your conviction">
      <p>
        Every market is built to be shared — copy the link into a group chat, X, Discord, Telegram,
        Farcaster, or to anyone with a strong opinion. The link carries its own preview, so people
        see the stakes before they even arrive.
      </p>
      <div className="grid gap-5 sm:grid-cols-[1fr_1fr] sm:items-center">
        {/* A link-preview mock, matching the real shared card. */}
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div
            className="flex h-28 items-center justify-center gap-3"
            style={{ background: "var(--bg)" }}
          >
            <div className="h-8 w-24 rounded-full" style={{ background: "var(--yes)" }} />
            <div className="h-8 w-16 rounded-full" style={{ background: "var(--no)" }} />
          </div>
          <div className="p-4">
            <div className="text-[14px] font-semibold text-[var(--text)]">
              Is Ethereum still undervalued?
            </div>
            <div className="mt-1 text-[12px]">
              <span style={{ color: "var(--yes)" }}>61% YES</span> ·{" "}
              <span style={{ color: "var(--no)" }}>39% NO</span>{" "}
              <span className="text-[var(--text-muted)]">· YES leading · by @maria</span>
            </div>
            <div className="mt-2 text-[11px] text-[var(--text-muted)]">conviction.company</div>
          </div>
        </div>
        <div className="space-y-4">
          <List
            items={[
              "The market question and current YES / NO split",
              "The leading side and recent activity",
              "The creator, and a direct invitation to back a side",
            ]}
          />
          <Card className="!p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Embedded media
            </div>
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Markets can embed the original content they&rsquo;re about — YouTube, Instagram,
              TikTok, Spotify, X — and link back to its creator, rather than re-hosting a copy. The
              media starts the conversation; the market measures the conviction around it.
            </p>
          </Card>
        </div>
      </div>
      <Beat>The strongest markets spread because people want to know: what do you believe?</Beat>
    </Section>
  );
}

function Details() {
  return (
    <Section id="details" kicker="The details" title="Fees, agents & boosts">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">Fees</div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            A trading fee may apply when you buy. It can support the underlying protocol, market
            creators, ecosystem incentives, AI agents and referrers. The exact fee and split are
            always shown before you confirm a transaction.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">AI agents</div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            A market can include two agents — one arguing <Side side="YES" />, one arguing{" "}
            <Side side="NO" />. They explain the debate and challenge weak assumptions. They never
            decide who&rsquo;s right; they make the disagreement clearer. The final conviction is
            yours.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">Boosting</div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            Some markets can be boosted with $DEGEN to increase visibility for a limited time.
            Boosting buys attention — it doesn&rsquo;t manufacture conviction. When it ends, the
            market lives on real interest.
          </p>
        </Card>
      </div>
      <Card className="!bg-[var(--bg)]">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Currency display
        </div>
        <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
          You can show values in USD or ETH. The toggle only changes how numbers are displayed — it
          never changes the underlying asset or creates a separate price. Everything converts at the
          current rate, e.g.{" "}
          <span className="text-[var(--text)]">1&nbsp;ETH&nbsp;↔&nbsp;$2,000&nbsp;USD</span>, and
          updates prices, positions, volume and order values across the site instantly.
        </p>
      </Card>
    </Section>
  );
}

function Ownership() {
  return (
    <Section id="ownership" kicker="Ownership & safety" title="Your wallet owns your position">
      <p>
        Conviction Company never holds your positions. It&rsquo;s the interface; POV&rsquo;s
        contracts are the market; your wallet on Base owns the assets.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">Trades execute on Base</div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            Every buy and sell happens onchain through your connected wallet.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">
            POV contracts power each market
          </div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            The same tokens, curves and liquidity as the underlying POV market.
          </p>
        </Card>
        <Card>
          <div className="text-[13px] font-semibold text-[var(--text)]">
            Your wallet controls your assets
          </div>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            Your YES tokens, NO tokens and ETH — and your ability to buy or sell — are yours.
          </p>
        </Card>
      </div>
      <div
        className="rounded-2xl px-5 py-4 text-[13px]"
        style={{
          border: "1px solid var(--border-strong)",
          color: "var(--text-secondary)",
        }}
      >
        <span className="font-semibold text-[var(--text)]">A real reminder:</span> market tokens can
        rise or fall in value. Back your convictions with money you&rsquo;re comfortable putting at
        risk.
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="mt-20 rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center sm:px-12">
      <div className="mx-auto flex justify-center">
        <BrandMark size={34} className="text-[var(--text)]" />
      </div>
      <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.025em] text-[var(--text)] sm:text-[34px]">
        Conviction needs company.
      </h2>
      <p className="mx-auto mt-3 max-w-[34ch] text-[15px] text-[var(--text-secondary)]">
        Find your Tribe. Face your Rivals. Back what you believe.
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="/"
          className="rounded-full bg-[var(--text)] px-6 py-3 text-[14px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90"
        >
          Explore markets
        </a>
        <a
          href="/?create=1"
          className="rounded-full border border-[var(--border-strong)] px-6 py-3 text-[14px] font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
        >
          Create a market
        </a>
      </div>
      <p className="mt-8 text-[12px] text-[var(--text-muted)]">Powered by POV. Built on Base.</p>
    </section>
  );
}
