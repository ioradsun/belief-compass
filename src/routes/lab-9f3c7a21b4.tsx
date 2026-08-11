/**
 * /lab-9f3c7a21b4 — a camera pointed at the real product under controlled light.
 *
 * NOT A MOCKUP. There is no demo card and no demo copy anywhere on this page. The
 * scenario is written into a React Query cache and the REAL components mount
 * against it, so what renders here is literally what ships. The moment somebody
 * changes a sentence in `YourTable` or a gate in `ChallengeRail`, this page changes
 * with it — which is the only property that makes a lab worth keeping. A mockup
 * would keep looking right after the product stopped agreeing with it.
 *
 * SCENARIO = FACTS. ROLE = POINT OF VIEW. One `World` says what happened; the role
 * decides whose eyes you are behind. Sarah putting Bitcoin on the table and Mike
 * receiving it are not two fixtures — they are one event seen twice, which is what
 * lets the page answer the question that actually matters:
 *
 *     DOES EVERY SIDE OF THE STORY AGREE?
 *
 * And that question is COMPUTED, not eyeballed. `checkWorld` derives what each
 * participant is told and asserts the invariants across those derivations, so a
 * disagreement arrives as a named failing check rather than as something a
 * reviewer might notice if they happened to compare the right two panels.
 *
 * A PRIVATE, OFFLINE CACHE. The scenario is seeded into a QueryClient created for
 * this page alone, whose default fetcher REFUSES. Two consequences, both wanted:
 * the lab can never issue a real request or disturb the app's caches, and a surface
 * asking for something the scenario did not supply fails loudly instead of
 * rendering a calm empty state — this codebase's signature bug is a blocked read
 * destructured as `{ data }` becoming "nothing happened", and the lab must not be
 * the one place where that looks fine.
 *
 * THE WHOLE STATE IS IN THE URL, so a broken state is a link rather than a
 * screenshot with a paragraph of instructions attached.
 *
 * DEV ONLY. It seeds caches and fabricates people; it has no business rendering in
 * production, so it refuses to.
 */
import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SCENES,
  SCENE_KEYS,
  ROLES,
  checkWorld,
  challengerView,
  challengedView,
  tableRowsFor,
  challengesFor,
  type Role,
  type World,
  type Participant,
} from "@/domain/scene";
import { RELATIONSHIP_MIN_SHARED } from "@/domain/dna/config";
import { convictionMatch } from "@/domain/relationship";
import { ChallengeRail } from "@/components/ChallengeRail";
import { AudienceGroups } from "@/components/AudiencePreview";
import { PostActionScreen } from "@/components/PostActionScreen";
import { ChallengeChainView } from "@/components/ChallengeChainView";
import type { ChallengeChainProjection } from "@/domain/challenge-chain";
import { resolvePostAction, type PostActionInput } from "@/domain/post-action";
import {
  audienceGroupFor,
  groupAudience,
  type AudienceMember,
  type AudienceProvenance,
  type CallRelationAtTime,
} from "@/domain/audience";
import { railSideKey, tableKey } from "@/components/YourTable";
import { historyKey } from "@/components/ChallengeHistory";
import { networkQO } from "@/lib/network-query";
import type { NetworkResponse } from "@/lib/dna.functions";

export const Route = createFileRoute("/lab-9f3c7a21b4")({
  // The scenario lives in a client-side cache, so a server render would paint a
  // shell the client immediately replaces. And it is not for search engines.
  ssr: false,
  head: () => ({
    meta: [{ title: "Scene lab — Conviction" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    scene: typeof s.scene === "string" && s.scene in SCENES ? s.scene : "traction",
    role: ROLES.includes(s.role as Role) ? (s.role as Role) : "challenger",
    who: typeof s.who === "string" ? s.who : undefined,
  }),
  component: TestingScene,
});

/**
 * The wallets every seeded query is keyed on. Never real addresses — and the
 * bystander is a real test rather than set dressing: a Challenge that reached
 * three people must be invisible to the fourth, and the only way to see that is
 * to mount the same rail for somebody it never touched.
 */
/**
 * A SYNTHETIC AUDIENCE THAT EXERCISES EVERY BRANCH AT ONCE.
 *
 * One Twin beside two Tribe members (so the heading has to say "Your Twin +
 * Tribe"), enough Rivals to overflow the face cap, and three Still Forming
 * people arriving through all three provenances. Nothing here touches the
 * server; it is the presentation under load.
 */
const labPerson = (
  name: string,
  relationAtCall: CallRelationAtTime,
  provenance: AudienceProvenance,
): AudienceMember => ({
  wallet: `0x${name.toLowerCase().padEnd(8, "0")}`,
  relationAtCall,
  group: audienceGroupFor(relationAtCall),
  provenance,
  sharedBeliefs: null,
  sameSideBeliefs: null,
  displayName: name,
  avatarUrl: null,
});

const LAB_AUDIENCE: AudienceMember[] = [
  labPerson("Sarah", "twin", "strong_dna"),
  labPerson("Mike", "tribe", "strong_dna"),
  labPerson("Dana", "tribe", "strong_dna"),
  ...["Alex", "Rae", "Kim", "Jo", "Sam", "Tess", "Ben"].map((n) =>
    labPerson(n, "opp", "strong_dna"),
  ),
  labPerson("Nia", "neutral", "neutral_dna"),
  labPerson("Owen", "insufficient", "closest_match"),
  labPerson("Priya", "insufficient", "answered_challenge"),
];

/**
 * THE CLOSING SCREEN, EVERY SHAPE AT ONCE.
 *
 * `resolvePostAction` is pure and `PostActionScreen` takes only its output, so
 * the whole matrix renders here with no wallet, no trade and no network. These
 * are the rows most likely to be wrong in a way types cannot catch: two blocks
 * where there should be one, a headline that wraps into the buttons, a module
 * heading orphaned above no faces.
 */
/**
 * THE CHAIN, IN THE FOUR SHAPES THAT MATTER.
 *
 * A proved route, a truncated one, a viewer with no branch, and a cold chain
 * that has not travelled. Pure props — the point is to see that a truncated
 * chain reads as an ellipsis rather than a root, and that the opportunities line
 * stays visually secondary to the two lines that are about humans.
 */
const chainPerson = (name: string) => ({
  wallet: `0x${name.toLowerCase()}`,
  name,
  avatarUrl: null,
});

const LAB_CHAINS: { label: string; chain: ChallengeChainProjection }[] = [
  {
    label: "Proved route · full branch",
    chain: {
      marketId: 1,
      question: "Will AI replace most software engineers?",
      upstream: {
        path: [
          { person: chainPerson("Maya"), side: "YES" },
          { person: chainPerson("Sundeep"), side: "NO" },
        ],
        depth: 3,
        truncated: false,
      },
      viewerBranch: {
        reached: 9,
        showedUp: 2,
        passed: 0,
        waiting: 7,
        responders: [
          { ...chainPerson("Casey"), side: "NO" as const, atMs: 2 },
          { ...chainPerson("Nia"), side: "YES" as const, atMs: 1 },
        ],
        relayers: [chainPerson("Casey")],
      },
      wholeChain: {
        uniqueResponders: 18,
        uniqueRelayers: 5,
        recipientOpportunities: 42,
        partial: false,
      },
    },
  },
  {
    label: "TRUNCATED · earlier links unprovable",
    chain: {
      marketId: 2,
      question: "Will Bitcoin hit $200K before 2027?",
      upstream: {
        path: [
          { person: chainPerson("Maya"), side: null },
          { person: chainPerson("Sundeep"), side: "YES" },
        ],
        depth: 3,
        truncated: true,
      },
      viewerBranch: {
        reached: 4,
        showedUp: 1,
        passed: 1,
        waiting: 2,
        responders: [{ ...chainPerson("Alex"), side: "YES" as const, atMs: 1 }],
        relayers: [],
      },
      wholeChain: {
        uniqueResponders: 6,
        uniqueRelayers: 1,
        recipientOpportunities: 17,
        partial: true,
      },
    },
  },
  {
    label: "Brought in, never relayed",
    chain: {
      marketId: 3,
      question: "Will the Fed cut rates twice this year?",
      upstream: {
        path: [{ person: chainPerson("Maya"), side: "YES" }],
        depth: 2,
        truncated: false,
      },
      viewerBranch: null,
      wholeChain: {
        uniqueResponders: 3,
        uniqueRelayers: 0,
        recipientOpportunities: 11,
        partial: false,
      },
    },
  },
  {
    label: "A root of their own · nothing travelled yet",
    chain: {
      marketId: 4,
      question: "Will fusion power a grid before 2035?",
      upstream: { path: [], depth: 0, truncated: false },
      viewerBranch: {
        reached: 6,
        showedUp: 0,
        passed: 0,
        waiting: 6,
        responders: [],
        relayers: [],
      },
      wholeChain: {
        uniqueResponders: 0,
        uniqueRelayers: 0,
        recipientOpportunities: 6,
        partial: false,
      },
    },
  },
];

const LAB_AUDIENCE_FACTS = {
  status: "available" as const,
  total: 13,
  singleRecipientName: null,
  formingOnly: false,
};

const LAB_POST_ACTIONS: { label: string; input: PostActionInput }[] = [
  {
    label: "Buy · answered one person",
    input: {
      action: "first_buy",
      role: "believer",
      side: "YES",
      after: { yes: 1, no: 0 },
      firstBeliever: false,
      flipped: false,
      answered: { count: 1, primaryCallerName: "Maya" },
      nextIncoming: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Buy · first believer, organic",
    input: {
      action: "first_buy",
      role: "believer",
      side: "NO",
      after: { yes: 0, no: 1 },
      firstBeliever: true,
      flipped: false,
      answered: null,
      nextIncoming: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Buy · branch already live",
    input: {
      action: "buy_more",
      role: "believer",
      side: "YES",
      after: { yes: 1, no: 0 },
      firstBeliever: false,
      flipped: false,
      answered: null,
      nextIncoming: { name: "John" },
      outgoing: "live",
      outgoingProgress: { shown: 3, reached: 11 },
      capacity: { active: 1, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Buy · table full",
    input: {
      action: "first_buy",
      role: "believer",
      side: "YES",
      after: { yes: 1, no: 0 },
      firstBeliever: false,
      flipped: false,
      answered: null,
      nextIncoming: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 3, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Buy · still forming only",
    input: {
      action: "first_buy",
      role: "believer",
      side: "YES",
      after: { yes: 1, no: 0 },
      firstBeliever: false,
      flipped: false,
      answered: null,
      nextIncoming: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: { ...LAB_AUDIENCE_FACTS, total: 6, formingOnly: true },
    },
  },
  {
    label: "Sell · side exit, still holds the other",
    input: {
      action: "side_exit",
      role: "believer",
      side: "YES",
      after: { yes: 0, no: 1 },
      realizedGainUsd: null,
      proceedsUsd: null,
      remainingValueUsd: 24.1,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: { ...LAB_AUDIENCE_FACTS, status: "none", total: 0 },
    },
  },
  {
    label: "Sell · believer is out",
    input: {
      action: "market_exit",
      role: "believer",
      side: "YES",
      after: { yes: 0, no: 0 },
      realizedGainUsd: null,
      proceedsUsd: 18.42,
      remainingValueUsd: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Sell · Market Maker exited, question alive",
    input: {
      action: "market_exit",
      role: "market_maker_and_believer",
      side: "YES",
      after: { yes: 0, no: 0 },
      realizedGainUsd: null,
      proceedsUsd: 18.42,
      remainingValueUsd: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: { ...LAB_AUDIENCE_FACTS, total: 11 },
    },
  },
  {
    label: "Sell · balance unknown",
    input: {
      action: "partial_sell",
      role: "believer",
      side: "YES",
      after: null,
      realizedGainUsd: null,
      proceedsUsd: null,
      remainingValueUsd: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Create · with an audience",
    input: {
      action: "create_market",
      role: "market_maker_and_believer",
      side: "YES",
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: LAB_AUDIENCE_FACTS,
    },
  },
  {
    label: "Create · no audience",
    input: {
      action: "create_market",
      role: "market_maker",
      side: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: { ...LAB_AUDIENCE_FACTS, status: "none", total: 0 },
    },
  },
  {
    label: "Create · audience read FAILED",
    input: {
      action: "create_market",
      role: "market_maker",
      side: null,
      outgoing: "none",
      outgoingProgress: null,
      capacity: { active: 0, total: 3 },
      audience: { ...LAB_AUDIENCE_FACTS, status: "failed", total: 0 },
    },
  },
];

const ME = "0xscene000000000000000000000000000000000001";
const BYSTANDER = "0xscene000000000000000000000000000000000002";

/** Enough of a network for `challengeLock` to open. Twelve decisions clears five. */
const UNLOCKED: NetworkResponse = {
  summary: {
    expressedBeliefs: 12,
    twinCount: 0,
    tribeCount: 3,
    oppCount: 1,
    inverseCount: 1,
  },
  freshness: { status: "fresh" },
  people: [],
};

/**
 * THE LENS. Writing the scenario into a cache is what lets the real components
 * render it — no props threaded through, no demo variants, no `isPreview` branch
 * leaking into production code. The components ask for their data exactly as they
 * do in the app, and get this instead.
 *
 * ONE CACHE PER POINT OF VIEW. The rail remembers which side it is showing IN THE
 * CACHE — that is how "See yours" crosses from a sibling component. Sharing one
 * client across the three panels would therefore make them move together, and
 * three panels that cannot disagree cannot catch a disagreement.
 */
function seed(world: World, side: "challenged" | "yours"): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // NOTHING LEAVES THIS PAGE. A surface reaching for data the scenario did
        // not supply is a finding, so it errors rather than resolving to nothing.
        queryFn: async ({ queryKey }) => {
          throw new Error(`scene lab: no fixture for ${JSON.stringify(queryKey)}`);
        },
      },
    },
  });

  const now = Date.now();
  qc.setQueryData(tableKey(ME), tableRowsFor(world, now));
  qc.setQueryData(["challenges", ME], challengesFor(world, now));
  qc.setQueryData(networkQO(ME).queryKey, UNLOCKED);
  qc.setQueryData(railSideKey, side);
  /**
   * "SEE ALL" OPENS ON NOTHING HERE, ON PURPOSE.
   *
   * A `World` is ONE question between one challenger and their audience. It holds
   * no prior interactions between any pair, so it cannot prove a single historical
   * row — and a fixture that invented forty would be exactly the thing this page
   * exists to catch everywhere else. Seeded empty rather than left unseeded so the
   * sheet renders its real empty state instead of the lab's "no fixture" error,
   * which would read as a bug in the sheet rather than a fact about the scenario.
   */
  qc.setQueryData(historyKey(ME), { entries: [], people: {}, truncated: false });

  // The fourth person. Unlocked, connected, and reached by none of it.
  qc.setQueryData(tableKey(BYSTANDER), []);
  qc.setQueryData(["challenges", BYSTANDER], []);
  qc.setQueryData(networkQO(BYSTANDER).queryKey, UNLOCKED);
  qc.setQueryData(historyKey(BYSTANDER), { entries: [], people: {}, truncated: false });

  return qc;
}

function TestingScene() {
  const { scene, role, who } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [tweak, setTweak] = useState<Partial<World>>({});

  const world: World = useMemo(() => ({ ...SCENES[scene].world, ...tweak }), [scene, tweak]);
  /**
   * A FRESH CACHE PER WORLD PER POINT OF VIEW, and the subtree remounts with it.
   * That is not a performance detail: component state resets to the shipped
   * defaults, so what you see after switching scenes is what a person ARRIVING at
   * that state sees, not what it looks like after somebody clicked around.
   */
  const clients = useMemo(
    () => ({
      challenger: seed(world, "yours"),
      challenged: seed(world, "challenged"),
      bystander: seed(world, "challenged"),
    }),
    [world],
  );

  const checks = useMemo(() => checkWorld(world), [world]);
  const failed = checks.filter((c) => !c.ok);
  const subject = world.audience.find((p) => p.name === who) ?? world.audience[0] ?? null;

  // Dev: always on. Production: only when the build was published with the flag.
  const labEnabled = import.meta.env.DEV || import.meta.env["VITE_ENABLE_SCENE_LAB"] === "true";
  if (!labEnabled) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Not found.</div>;
  }

  const set = (next: Partial<{ scene: string; role: Role; who: string }>) =>
    void navigate({
      search: (s: { scene: string; role: Role; who: string | undefined }) => ({ ...s, ...next }),
      replace: true,
    });

  const mine = challengerView(world);
  const seen = subject ? challengedView(world, subject) : null;

  const panel: Record<Role, ReactNode> = {
    challenger: (
      <Panel
        title={`Challenger — what ${world.challenger.name} is told`}
        note="Aggregate only. Never a name, never a view count, never a dollar."
      >
        <Stage>
          <ChallengeRail wallet={ME} onSelect={() => undefined} insider={<Tape />} />
        </Stage>
        <Facts
          rows={[
            ["capacity line", mine.capacity ?? "(silent at zero)"],
            ["progress line", mine.progress ?? "(silent — nobody reached)"],
            ["reached", String(mine.reached)],
            ["auto-closes?", String(mine.shouldClose)],
          ]}
        />
        {/* WHO IT WOULD REACH, BEFORE IT IS SENT. Rendered from a synthetic
            audience rather than a DNA cache, because the thing worth looking at
            is the layout under pressure: a lone Twin, a crowd that overflows the
            face cap, and a Still Forming row that must never read as filler. */}
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Audience preview
        </p>
        <Stage>
          <AudienceGroups groups={groupAudience(LAB_AUDIENCE)} />
        </Stage>
        {/* THE CLOSING SCREEN, every shape. Pure props, so the whole matrix is
            visible at once — which is the only way the two-blocks-at-once and
            orphaned-heading failures are ever going to be caught. */}
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Challenge chain · four shapes
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {LAB_CHAINS.map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)]">
              <p className="border-b border-[var(--border)] px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
                {s.label}
              </p>
              <ChallengeChainView chain={s.chain} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Closing screen · every shape
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {LAB_POST_ACTIONS.map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--border)]">
              <p className="border-b border-[var(--border)] px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
                {s.label}
              </p>
              <PostActionScreen
                experience={resolvePostAction(s.input)}
                onAct={() => undefined}
                groups={groupAudience(LAB_AUDIENCE)}
              />
            </div>
          ))}
        </div>
      </Panel>
    ),
    challenged: (
      <Panel
        title={`Challenged — what ${subject?.name ?? "nobody"} is told`}
        note="The same event, from the other side of it."
      >
        <Stage>
          <ChallengeRail wallet={ME} onSelect={() => undefined} insider={<Tape />} />
        </Stage>
        {seen && subject ? (
          <Facts
            rows={[
              ["badge", seen.badge],
              ["line", seen.line ?? "(refused — no sentence, no row)"],
              [
                "conviction match",
                subject.shared >= RELATIONSHIP_MIN_SHARED
                  ? `${convictionMatch(subject.together, subject.shared)}% · ${subject.together} of ${subject.shared} together`
                  : `withheld — ${subject.shared} shared, the gate is ${RELATIONSHIP_MIN_SHARED}`,
              ],
              ["still in their queue?", String(seen.inQueue)],
            ]}
          />
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            This Challenge reached nobody, so there is no second side to it yet.
          </p>
        )}
      </Panel>
    ),
    bystander: (
      <Panel
        title="Bystander — somebody it never reached"
        note="Unlocked, connected, and outside the audience. This panel must stay empty; anything that appears here is a leak."
      >
        <Stage>
          <ChallengeRail wallet={BYSTANDER} onSelect={() => undefined} insider={<Tape />} />
        </Stage>
      </Panel>
    ),
  };

  /** The chosen point of view leads; the others stay on screen to disagree with it. */
  const order: Role[] = [role, ...ROLES.filter((r) => r !== role)];

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)]">
      <div
        className="sticky top-0 z-10 mb-4 space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3"
        style={{ backdropFilter: "blur(6px)" }}
      >
        <ControlRow label="Scene">
          {SCENE_KEYS.map((k) => (
            <Chip
              key={k}
              on={k === scene}
              onClick={() => {
                setTweak({});
                set({ scene: k });
              }}
            >
              {SCENES[k].label}
            </Chip>
          ))}
        </ControlRow>
        <ControlRow label="Role">
          {ROLES.map((r) => (
            <Chip key={r} on={r === role} onClick={() => set({ role: r })}>
              {r}
            </Chip>
          ))}
        </ControlRow>
        {world.audience.length > 0 && (
          <ControlRow label="Whose eyes">
            {world.audience.map((p) => (
              <Chip
                key={p.name}
                on={p.name === subject?.name}
                onClick={() => set({ who: p.name, role: "challenged" })}
              >
                {p.name} · {p.state}
              </Chip>
            ))}
          </ControlRow>
        )}
        <ControlRow label="On the table">
          {[0, 1, 2, 3, 4].map((n) => (
            <Chip
              key={n}
              on={world.activeChallenges === n}
              onClick={() => setTweak((t) => ({ ...t, activeChallenges: n }))}
            >
              {n === 4 ? "4 — must fail" : n}
            </Chip>
          ))}
        </ControlRow>
        <ControlRow label="Challenger holds">
          {(["YES", "NO", null] as const).map((s) => (
            <Chip
              key={String(s)}
              on={world.challenger.side === s}
              onClick={() =>
                setTweak((t) => ({ ...t, challenger: { ...world.challenger, side: s } }))
              }
            >
              {s ?? "since exited"}
            </Chip>
          ))}
        </ControlRow>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px]"
          >
            Copy scenario URL
          </button>
          <button
            type="button"
            onClick={() => setTweak({})}
            className="text-[11px] text-[var(--text-muted)] underline"
          >
            Reset tweaks
          </button>
          <span
            className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{
              background: failed.length ? "var(--loss)" : "var(--gain)",
              color: "var(--bg)",
            }}
          >
            {failed.length
              ? `${failed.length} CHECK${failed.length > 1 ? "S" : ""} FAILED`
              : "ALL SIDES AGREE"}
          </span>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-[var(--border)] p-3">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Does every side of the story agree?
        </h2>
        <ul className="space-y-1">
          {checks.map((c) => (
            <li key={c.name} className="flex gap-2 text-[12px]">
              <span style={{ color: c.ok ? "var(--gain)" : "var(--loss)" }}>
                {c.ok ? "✓" : "✕"}
              </span>
              <span
                className={
                  c.ok ? "text-[var(--text-secondary)]" : "font-semibold text-[var(--text)]"
                }
              >
                {c.name}
                <span className="ml-2 font-normal text-[var(--text-muted)]">— {c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Every panel below is the SHIPPED component, reading the seeded cache. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {order.map((r) => (
          <QueryClientProvider key={r} client={clients[r]}>
            {panel[r]}
          </QueryClientProvider>
        ))}
      </div>

      <section className="mt-4 rounded-xl border border-[var(--border)] p-3">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Everyone it reached, and what became of them
        </h2>
        <ul className="grid gap-1 md:grid-cols-2">
          {world.audience.map((p: Participant) => (
            <li key={p.name} className="flex justify-between gap-3 text-[12px]">
              <button
                type="button"
                onClick={() => set({ who: p.name, role: "challenged" })}
                className="truncate text-left underline-offset-2 hover:underline"
              >
                {p.name} · {p.relation}
              </button>
              <span className="num shrink-0 text-[var(--text-muted)]">
                {p.state} · {p.together}/{p.shared} shared
              </span>
            </li>
          ))}
          {world.audience.length === 0 && (
            <li className="text-[12px] text-[var(--text-muted)]">
              Nobody was reached — this Challenge has no second side yet.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** The rail's other tab. Stubbed because the live tape is not what is on trial. */
function Tape() {
  return (
    <p className="text-[11.5px] text-[var(--text-muted)]">(the live tape, not under test here)</p>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] p-2">{children}</div>;
}

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-32 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-2 py-0.5 text-[11px] transition-colors"
      style={{
        borderColor: on ? "var(--text)" : "var(--border)",
        background: on ? "var(--text)" : "transparent",
        color: on ? "var(--bg)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {title}
      </h2>
      {note && (
        <p className="mb-2 mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{note}</p>
      )}
      {children}
    </section>
  );
}

/** The derived strings, printed raw beside the rendered component they feed. */
function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px]">
          <dt className="w-32 shrink-0 text-[var(--text-muted)]">{k}</dt>
          <dd className="text-[var(--text-secondary)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
