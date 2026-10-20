// Every playable faction: setup, turn flow and its special rules.

import { describe, expect, it } from "vitest";
import { Game } from "../game.ts";
import { other, type Action, type PlayerId } from "../types.ts";
import { lib, put, resources } from "./helpers.ts";

const STAPLES = ["obsession", "greed", "elitism", "deception", "rage"];
const deck = () => [...STAPLES.flatMap((s) => Array(8).fill(s)), ...Array(10).fill("wanton-wizard"), ...Array(6).fill("cash-out")];

/** Answer every setup and start-of-turn decision with the first legal option. */
function auto(g: Game, until: (g: Game) => boolean, limit = 200) {
  for (let i = 0; i < limit && !until(g) && g.s.pending; i++) {
    const d = g.s.pending;
    const p = d.player;
    let a: Action;
    switch (d.type) {
      case "choose":
        a = { type: "answer", ids: d.options.slice(0, d.min).map((o) => o.id) };
        break;
      case "number":
        a = { type: "answer", value: Math.min(d.max, Math.max(d.min, 3)) };
        break;
      case "play_resource":
        a = { type: "answer", iid: g.s.players[p].hand[0], faceDown: true };
        break;
      case "main":
        a = { type: "end_turn" };
        break;
      default:
        a = { type: "pass" };
    }
    g.act(p, a);
  }
}

function game(a: string, b = "tournament-faction", seed = 3) {
  return Game.create(lib, seed, { A: { name: "A", faction: a, cards: deck() }, B: { name: "B", faction: b, cards: deck() } });
}

const playable = Object.values(lib).filter((d) => d.types.includes("faction") && !d.incomplete && !d.back_of);

describe("factions", () => {
  it("16 factions are playable, the Showdown ones and Counter-Imperial Army are not", () => {
    expect(playable.length).toBe(16);
    expect(lib["the-evil-alliance"].incomplete).toBe(true);
    expect(lib["counter-imperial-army"].back_of).toBe("imperial-army");
  });

  for (const f of playable) {
    it(`${f.name}: sets up and plays three turns`, () => {
      const g = game(f.id);
      auto(g, (g) => g.s.turn >= 4);
      expect(g.s.turn).toBeGreaterThanOrEqual(4);
      const p = g.s.players.A;
      expect(p.influence).toBe(f.influence);
      const sr = f.starting_resources ?? {};
      const minStart = Object.values(sr.specific ?? {}).reduce((n, v) => n + (v ?? 0), 0) + (sr.any_staples ?? 0) + (sr.different_staples ?? 0);
      expect(g.q.resources("A").length).toBeGreaterThanOrEqual(minStart);
    });
  }

  it("Imperial Army: starts with 2 Rage, next character costs 2 less, turns over on a won coin flip", () => {
    let flipped = false;
    for (let seed = 1; seed < 30 && !flipped; seed++) {
      const g = game("imperial-army", "tournament-faction", seed);
      auto(g, (g) => g.s.phase === "play");
      expect(g.q.resources("A").map((r) => g.s.cards[r].defId)).toEqual(["rage", "rage"]);
      auto(g, (g) => g.s.turn >= 6);
      flipped = g.s.players.A.factionId === "counter-imperial-army" || g.s.log.some((e) => e.text.includes("turns over"));
    }
    expect(flipped).toBe(true);

    const g = game("imperial-army", "tournament-faction", 1);
    auto(g, (g) => g.s.phase === "play" && g.s.pending?.type === "main" && g.s.active === "A");
    const w = put(g, "A", "fired-hand", "hand");
    resources(g, "A", "deception", 4);
    const before = g.q.unattached("A").length;
    g.act("A", { type: "deploy", iid: w });
    expect(before - g.q.unattached("A").length).toBe(4); // 6 - 2
  });

  it("The Knitting Coalition: opponent uses its starting draw, has no develop rule, and can use its abilities", () => {
    const g = game("tournament-faction", "the-knitting-coalition");
    auto(g, (g) => g.s.phase === "play");
    const first = g.s.first!;
    // Both players draw 3 going first or 4 going second.
    expect(g.s.players[first].hand.length).toBe(3);
    expect(g.s.players[other(first)].hand.length).toBe(4);
    // A (Tournament) has no develop decision at the start of its turn.
    auto(g, (g) => g.s.active === "A" && g.s.pending?.type === "main");
    expect(g.s.log.some((e) => e.text.includes("A chooses: draw 1 card"))).toBe(false);
    const k = g.s.players.B.factionIid;
    const idx = g.q.abilities(k).find((x) => x.rule.name.includes("Draw"))!.index;
    resources(g, "A", "greed", 2);
    const hand = g.s.players.A.hand.length;
    g.act("A", { type: "ability", iid: k, index: idx });
    g.act("B", { type: "pass" });
    expect(g.s.players.A.hand.length).toBe(hand + 1);
  });

  it("The Primitive Tribes of Thabbash: a resolved tactic can become an attached face-down resource for 3", () => {
    const g = game("the-primitive-tribes-of-thabbash");
    auto(g, (g) => g.s.active === "A" && g.s.pending?.type === "main");
    expect(g.q.resources("A").some((r) => g.s.cards[r].faceDown)).toBe(true);
    resources(g, "A", "greed", 6);
    const cash = put(g, "A", "cash-out", "hand");
    g.act("A", { type: "deploy", iid: cash });
    g.act("A", { type: "answer", value: 0 });
    g.act("B", { type: "pass" });
    g.act("A", { type: "answer", ids: ["yes"] });
    expect(g.s.cards[cash].zone).toBe("play");
    expect(g.s.cards[cash].faceDown).toBe(true);
    expect(g.s.cards[cash].attachedTo).toBe("faction");
  });

  it("The Union of Unextraordinary Miners: the opponent's starting resources are topped up to match", () => {
    const g = game("the-union-of-unextraordinary-miners");
    auto(g, (g) => g.s.phase === "play");
    // X = 3 by the auto-answerer, plus 1 Deception.
    expect(g.q.resources("A").length).toBe(4);
    expect(g.q.resources("B").length).toBe(4);
  });

  it("Lugubrian Council: a token each turn, spent on Energize With Humour", () => {
    const g = game("lugubrian-council-expedition-division");
    auto(g, (g) => g.s.turn >= 4 && g.s.active === "A" && g.s.pending?.type === "main");
    const f = g.s.players.A.factionIid;
    expect(g.s.cards[f].tokens).toBeGreaterThanOrEqual(2);
    const w = put(g, "A", "wanton-wizard", "play");
    g.act("A", { type: "ability", iid: f, index: g.q.abilities(f).find((x) => x.rule.name === "Energize With Humour")!.index });
    g.act("A", { type: "answer", ids: [w] });
    g.act("B", { type: "pass" });
    expect(g.s.cards[w].tokens).toBe(1);
  });

  it("Defenders of Marduun: Rally needs 3 characters that don't share a trade", () => {
    const g = game("defenders-of-marduun");
    auto(g, (g) => g.s.active === "A" && g.s.pending?.type === "main");
    const f = g.s.players.A.factionIid;
    const idx = g.q.abilities(f).find((x) => x.rule.name === "Rally")!.index;
    resources(g, "A", "rage", 5);
    const a = put(g, "A", "wanton-wizard", "play");
    const b = put(g, "A", "wanton-wizard", "play");
    const c = put(g, "A", "fired-hand", "play");
    const d = put(g, "A", "deadly-striker", "play");
    g.act("A", { type: "ability", iid: f, index: idx });
    g.act("A", { type: "answer", ids: [a, b, c] }); // two Arcanists: illegal, rolled back
    expect(g.s.pending?.type).toBe("main");
    g.act("A", { type: "ability", iid: f, index: idx });
    g.act("A", { type: "answer", ids: [a, c, d] });
    g.act("B", { type: "pass" });
    expect(g.q.stat(a, "str")).toBe(3);
  });

  it("Legions of Chaos: a character entering play lets you search for one of another trade", () => {
    const g = game("legions-of-chaos");
    auto(g, (g) => g.s.active === "A" && g.s.pending?.type === "main");
    resources(g, "A", "obsession", 6);
    const w = put(g, "A", "wanton-wizard", "hand");
    put(g, "A", "fired-hand", "deck");
    g.act("A", { type: "deploy", iid: w });
    g.act("B", { type: "pass" });
    // Two triggers at once (Wanton Wizard and Legions): take them in order.
    for (let i = 0; i < 6 && g.s.pending?.type === "choose"; i++) {
      const d = g.s.pending;
      if (d.prompt.includes("Several triggers")) g.act("A", { type: "answer", ids: [d.options.find((o) => o.label === "Legions of Chaos")?.id ?? d.options[0].id] });
      else if (d.prompt.includes("pay 3")) g.act("A", { type: "answer", ids: ["yes"] });
      else if (d.prompt.includes("search")) {
        expect(d.options.every((o) => lib[g.s.cards[o.id].defId].trade !== "arcanist")).toBe(true);
        g.act("A", { type: "answer", ids: [d.options[0].id] });
      } else g.act("A", { type: "answer", ids: [d.options[d.options.length - 1].id] });
    }
    expect(g.s.players.A.hand.some((i) => g.s.cards[i].defId === "fired-hand")).toBe(true);
  });
});

void ({} as PlayerId);
