import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeck } from "../deck.ts";
import { validateDeck } from "../formats.ts";
import { loadFormats } from "../../server/library.ts";
import { lib } from "./helpers.ts";

const formats = loadFormats(join(import.meta.dirname, "../../formats"));
const check = (text: string, format: string) => validateDeck(parseDeck(text, lib), lib, formats[format]);

describe("formats", () => {
  it("casual allows anything, with warnings for missing starting staples", () => {
    const r = check("Faction: Hall of Great Justice\n5 Fired Hand", "casual");
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/starts with 1 rage staple/);
  });

  it("constructed enforces size, copies, bans and tournament legality", () => {
    const r = check("Faction: The Knitting Coalition\n5 Fired Hand\n2 Greed", "constructed");
    expect(r.errors.join("\n")).toMatch(/at least 75 cards/);
    expect(r.errors.join("\n")).toMatch(/At most 4 copies of Fired Hand/);
    expect(r.errors.join("\n")).toMatch(/can't be used in tournament play/);
    const banned = check("Faction: The Primitive Tribes of Thabbash\n75 Obsession", "constructed");
    expect(banned.errors.join()).toMatch(/banned/);
    const ok = check("Faction: The Tournament Faction\n71 Rage\n4 Fired Hand\n10 Party Clowns", "constructed");
    expect(ok.errors).toEqual([]);
  });

  it("a faction's own minimum deck size overrides the format's", () => {
    const r = check("Faction: The Society of Magical Propriety\n100 Obsession", "limited");
    expect(r.errors.join()).toMatch(/at least 300/);
  });
});
