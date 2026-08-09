/**
 * NAMING THE PEOPLE IN A FEED ROW — one rule, one place.
 *
 * Three sites in the tape each turned a wallet into a face: the actor of a row,
 * the crowd behind a burst, and the believers a market signal is about. All
 * three wrote the same four fields by hand, which is three chances for the same
 * person to be named one way here and another way there.
 *
 * VIEWER-RELATIVE, AND SO WORTH ISOLATING. The relationship tag is the whole
 * reason a row reads differently for two readers, and it is the field most
 * likely to leak if a decorated row is ever shared. Keeping it in one pure
 * function means the guarantee — that a person is tagged only from the map
 * belonging to the reader being served — is asserted once instead of trusted
 * three times.
 *
 * Generic over the label, so this module never learns the relationship
 * vocabulary — the caller's narrow union passes straight through.
 *
 * Pure: no client, no mutation of anything passed in, a fresh array every call.
 */

/** The minimum a profile lookup must offer. Structural, so callers keep their own shape. */
export interface ProfileLike {
  displayName?: string | null;
  pfpUrl?: string | null;
}

export interface NamedPerson<L extends string = string> {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  /** What this person is to the READER being served — never to anyone else. */
  relationship: L | null;
}

/**
 * A wallet, as a person. Falls back to the alias the caller supplies rather than
 * importing identity here, so this stays free of anything that reads the chain.
 */
export function namePerson<L extends string>(
  wallet: string,
  profiles: Map<string, ProfileLike>,
  labelByWallet: Map<string, L>,
  aliasFor: (w: string) => string,
): NamedPerson<L> {
  const prof = profiles.get(wallet);
  return {
    wallet,
    name: prof?.displayName ?? aliasFor(wallet),
    avatarUrl: prof?.pfpUrl ?? null,
    relationship: labelByWallet.get(wallet) ?? null,
  };
}

/**
 * People the reader knows lead; everyone else keeps the order they arrived in.
 *
 * A STABLE PARTITION, NOT A RE-SORT. The order handed in already means something
 * — grouping sorts a burst by what each person committed — so this may only lift
 * the familiar faces to the front, never reshuffle the rest.
 */
export function knownFirst<L extends string>(people: NamedPerson<L>[]): NamedPerson<L>[] {
  return [...people.filter((p) => p.relationship), ...people.filter((p) => !p.relationship)];
}
