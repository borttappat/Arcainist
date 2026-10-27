import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLibrary } from "../../server/library.ts";

const card = (extra = "") => `id: test-card\nname: Test Card\ntrade: rogue\ntypes: [character]\n${extra}text: Test.\n`;

function load(yaml: string, other?: [string, string]) {
  const dir = mkdtempSync(join(tmpdir(), "arcainist-cards-"));
  writeFileSync(join(dir, "test-card.yaml"), yaml);
  if (other) writeFileSync(join(dir, other[0]), other[1]);
  return () => loadLibrary(dir);
}

describe("card files: one YAML file per card", () => {
  it("reads the numbers from the card file", () => {
    const lib = load(card("cost: 3\nthreshold: { rage: 2 }\nstats: { str: 1, life: 2, spd: 3 }\n"))();
    expect(lib["test-card"].cost).toBe(3);
    expect(lib["test-card"].threshold).toEqual({ rage: 2 });
    expect(lib["test-card"].stats).toEqual({ str: 1, life: 2, spd: 3 });
  });

  it("rejects bad numbers and unknown fields", () => {
    expect(load(card("cost: -1\n"))).toThrow(/cost must be a whole number/);
    expect(load(card("threshold: { fire: 1 }\n"))).toThrow(/threshold.fire is not one of/);
    expect(load(card("stats: { str: 1.5 }\n"))).toThrow(/stats.str must be a whole number/);
    expect(load(card("cots: 3\n"))).toThrow(/unknown field "cots"/);
  });

  it("turns a top-level flip_up into the FLIP UP rule", () => {
    const lib = load(card("cost: 2\nflip_up: { cost: 1, threshold: { rage: 2 }, steps: [ draw: 1 ] }\n"))();
    expect(lib["test-card"].rules).toEqual([{ flip_up: { pay: 1, threshold: { rage: 2 }, cost: [{ draw: 1 }] } }]);
    expect((lib["test-card"] as any).flip_up).toBeUndefined();
  });

  it("rejects a bad flip_up, or one written inside rules", () => {
    expect(load(card("flip_up: { cost: 1, pay: 2 }\n"))).toThrow(/flip_up.pay is not one of/);
    expect(load(card("flip_up: { threshold: { rage: 1 } }\n"))).toThrow(/flip_up.cost must be a whole number/);
    expect(load(card("rules:\n  - flip_up: { pay: 1 }\n"))).toThrow(/flip_up belongs at the top of the card/);
  });

  it("rejects leftover JSON numbers files", () => {
    expect(load(card(), ["test-card.json", "{}"])).toThrow(/a card is one YAML file now/);
  });
});
