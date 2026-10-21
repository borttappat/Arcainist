// Decklist parsing. Accepts lines like:
//   Faction: The Tournament Faction
//   3 Fired Hand
//   3x Fired Hand
//   Fired Hand            (one copy)
// Blank lines and lines starting with # or // are ignored. Names match
// case-insensitively, ignoring punctuation and accents.

import type { CardLibrary } from "./types.ts";

export interface ParsedDeck {
  faction: string | null;
  cards: string[];
  errors: string[];
}

// Case, punctuation and accents don't matter: "Dethmurderbludgeon" finds "Dethmürderblüdgeon".
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export function parseDeck(text: string, lib: CardLibrary): ParsedDeck {
  const byName = new Map<string, string>();
  for (const d of Object.values(lib)) {
    byName.set(norm(d.name), d.id);
    byName.set(norm(d.id), d.id);
  }
  const out: ParsedDeck = { faction: null, cards: [], errors: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const fm = line.match(/^faction\s*:\s*(.+)$/i);
    const m = fm ? null : line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const name = fm ? fm[1] : m ? m[2] : line;
    const count = m ? Number(m[1]) : 1;
    const id = byName.get(norm(name));
    if (!id) {
      out.errors.push(`Unknown card: "${name.trim()}"`);
      continue;
    }
    if (lib[id].token) {
      out.errors.push(`${lib[id].name} is a token: cards put it into play, it can't be in a deck.`);
      continue;
    }
    if (lib[id].back_of) {
      out.errors.push(`${lib[id].name} is the back side of ${lib[lib[id].back_of!]?.name ?? lib[id].back_of}; put that card in the decklist instead.`);
      continue;
    }
    if (lib[id].incomplete) {
      out.errors.push(`${lib[id].name} can't be played: ${lib[id].incomplete_reason ?? "its card data is missing"}.`);
      continue;
    }
    if (lib[id].types.includes("faction")) {
      if (out.faction && out.faction !== id) out.errors.push("Only one faction is allowed.");
      out.faction = id;
      continue;
    }
    for (let i = 0; i < count; i++) out.cards.push(id);
  }
  if (!out.faction) out.errors.push('No faction. Add a line like "Faction: The Tournament Faction".');
  if (!out.cards.length) out.errors.push("The deck has no cards.");
  return out;
}
