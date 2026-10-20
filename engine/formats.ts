// Formats: deck-building rules a room plays under. Defined as data in formats/*.json
// and loaded by the server. "Casual" enforces nothing; other formats turn checks on.
//
// Later additions (allowed sets for Block/Chronicles-style formats, card-number
// rulesets for custom games) belong here and in the room options, not in the engine.

import type { ParsedDeck } from "./deck.ts";
import type { CardLibrary, Icon } from "./types.ts";

export interface Format {
  id: string;
  name: string;
  description: string;
  /** false: problems are only warnings. */
  enforce: boolean;
  /** Minimum cards, not counting the faction. A faction's own `min_deck` overrides it. */
  min_deck?: number;
  /** Copies allowed per card. Staples and cards with `deck_limit: null` are exempt. */
  max_copies?: number;
  /** Excludes cards marked `tournament_legal: false`. */
  tournament?: boolean;
  /** Card names not allowed. */
  banned?: string[];
  /** If set, only cards from these sets are allowed. */
  sets?: string[];
}

export interface DeckCheck {
  errors: string[];
  warnings: string[];
}

export function validateDeck(deck: ParsedDeck, lib: CardLibrary, format: Format): DeckCheck {
  const errors = [...deck.errors];
  const rules: string[] = [];
  if (!deck.faction) return { errors, warnings: [] };
  const faction = lib[deck.faction];
  const counts = new Map<string, number>();
  for (const id of deck.cards) counts.set(id, (counts.get(id) ?? 0) + 1);

  const min = faction.min_deck ?? format.min_deck;
  if (min !== undefined && deck.cards.length < min) rules.push(`${format.name} decks need at least ${min} cards besides the faction (this one has ${deck.cards.length}).`);
  for (const [id, n] of counts) {
    const d = lib[id];
    const limit = d.staple || d.deck_limit === null ? Infinity : (d.deck_limit ?? format.max_copies ?? Infinity);
    if (n > limit) rules.push(`At most ${limit} copies of ${d.name} (the deck has ${n}).`);
  }
  for (const id of [deck.faction, ...counts.keys()]) {
    const d = lib[id];
    if (format.banned?.includes(d.name)) rules.push(`${d.name} is banned in ${format.name}.`);
    if (format.tournament && d.tournament_legal === false) rules.push(`${d.name} can't be used in tournament play.`);
    if (format.sets && d.set && !format.sets.includes(d.set)) rules.push(`${d.name} (${d.set}) isn't in ${format.name}'s sets.`);
  }

  // The deck must contain the staples its faction starts with.
  const sr = faction.starting_resources ?? {};
  const staples = new Map<Icon, number>();
  for (const [id, n] of counts) if (lib[id].staple && lib[id].icon) staples.set(lib[id].icon!, (staples.get(lib[id].icon!) ?? 0) + n);
  const start: string[] = [];
  for (const [icon, n] of Object.entries({ ...(sr.specific ?? {}), ...(sr.face_down ?? {}) })) {
    if ((staples.get(icon as Icon) ?? 0) < (n ?? 0)) start.push(`${faction.name} starts with ${n} ${icon} staple${n === 1 ? "" : "s"}; the deck has ${staples.get(icon as Icon) ?? 0}.`);
  }
  const anyNeeded = (sr.any_staples ?? 0) + (sr.different_staples ?? 0) + Object.values(sr.specific ?? {}).reduce((a, b) => a + (b ?? 0), 0) + Object.values(sr.face_down ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const total = [...staples.values()].reduce((a, b) => a + b, 0);
  if (total < anyNeeded) start.push(`${faction.name} starts with ${anyNeeded} staple resources; the deck has ${total}.`);
  if (sr.different_staples && staples.size < sr.different_staples) start.push(`${faction.name} starts with ${sr.different_staples} different staples; the deck has ${staples.size} kind${staples.size === 1 ? "" : "s"}.`);

  if (format.enforce) return { errors: [...errors, ...rules, ...start], warnings: [] };
  return { errors, warnings: start };
}
