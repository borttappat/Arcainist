import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../server/library.ts";

const card = (extra = "") => `id: test-card\nname: Test Card\ntrade: rogue\ntypes: [character]\n${extra}text: Test.\n`;

function load(yaml: string, json?: string) {
  const dir = mkdtempSync(join(tmpdir(), "arcainist-cards-"));
  writeFileSync(join(dir, "test-card.yaml"), yaml);
  if (json !== undefined) writeFileSync(join(dir, "test-card.json"), json);
  return () => loadLibrary(dir);
}

describe("card files: numbers in JSON, rules in YAML", () => {
  it("merges the numbers file into the card", () => {
    const lib = load(card(), '{ "cost": 3, "threshold": { "rage": 2 }, "stats": { "str": 1, "life": 2, "spd": 3 } }')();
    expect(lib["test-card"].cost).toBe(3);
    expect(lib["test-card"].stats).toEqual({ str: 1, life: 2, spd: 3 });
  });

  it("rejects numbers left in the YAML", () => {
    expect(load(card("cost: 3\n"), "{}")).toThrow(/"cost" is a number and belongs in test-card.json/);
  });

  it("rejects unknown keys and bad values in the JSON", () => {
    expect(load(card(), '{ "speed": 3 }')).toThrow(/unknown key "speed"/);
    expect(load(card(), '{ "cost": -1 }')).toThrow(/cost must be a whole number/);
    expect(load(card(), '{ "threshold": { "fire": 1 } }')).toThrow(/threshold.fire is not one of/);
    expect(load(card(), '{ "stats": { "str": 1.5 } }')).toThrow(/stats.str must be a whole number/);
  });

  it("requires a numbers file for every card", () => {
    expect(load(card())).toThrow(/test-card.json: missing/);
  });
});
