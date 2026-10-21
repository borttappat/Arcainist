// Scenario tests for cards automated in alphabetical batches (D onwards).

import { describe, expect, it } from "vitest";
import { other } from "../types.ts";
import { act, answer, expectPending, newGame, pass, passAll, put, resources, toMain } from "./helpers.ts";

function setup() {
  const g = newGame(1);
  const p = toMain(g);
  const o = other(p);
  for (const x of [p, o]) for (const iid of [...g.s.players[x].hand]) g.move(iid, "deck", { bottom: true });
  return { g, p, o };
}

describe("cards: D onwards", () => {
  it("Desolate: destroys every character with exactly X strength", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 3);
    const two = put(g, o, "wanton-wizard", "play");
    const five = put(g, o, "fired-hand", "play");
    const t = put(g, p, "desolate", "hand");
    act(g, p, { type: "deploy", iid: t });
    g.act(p, { type: "answer", value: g.q.stat(two, "str") });
    pass(g);
    expect(g.s.cards[two].zone).toBe("discard");
    expect(g.s.cards[five].zone).toBe("play");
  });

  it("Don't Trip: the attacker's battle damage hits itself", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "fired-hand", "play");
    resources(g, o, "deception", 3);
    const t = put(g, o, "don-t-trip", "hand");
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    act(g, o, { type: "deploy", iid: t });
    answer(g, [atk]);
    pass(g);
    for (let i = 0; i < 8 && g.s.battle; i++) pass(g);
    expect(g.s.players[o].influence).toBe(inf);
    expect(g.q.isCharacter(atk)).toBe(false); // 5 damage to a 4-life Fired Hand (it flips face-down)
  });

  it("Dragon Catheter: the strongest character gets a token and 1 strength per token", () => {
    const { g, p, o } = setup();
    put(g, p, "dragon-catheter", "play");
    const big = put(g, o, "fired-hand", "play");
    put(g, p, "wanton-wizard", "play");
    const start = g.s.turn;
    act(g, p, { type: "end_turn" });
    // Play through the opponent's turn until the Catheter asks at the start of ours.
    for (let i = 0; i < 40 && !(g.s.pending?.type === "choose" && g.s.pending.prompt.includes("highest strength")); i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else if (d.type === "main") act(g, d.player, { type: "end_turn" });
      else pass(g);
    }
    expect(g.s.turn).toBe(start + 2);
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toEqual([big]);
    answer(g, [big]);
    expect(g.q.stat(big, "str")).toBe(6);
  });

  it("Direstock Cuffs: the attached character loses COVERT", () => {
    const { g, p } = setup();
    const c = put(g, p, "desperate-defender", "play");
    expect(g.q.keyword(c, "covert")).toBe(true);
    const cuffs = put(g, p, "direstock-cuffs", "play");
    g.s.cards[cuffs].attachedTo = c;
    expect(g.q.keyword(c, "covert")).toBe(false);
  });

  it("Dizzying Blow: only while a character attacks your faction", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "fired-hand", "play");
    resources(g, o, "rage", 4);
    const t = put(g, o, "dizzying-blow", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    act(g, o, { type: "deploy", iid: t });
    answer(g, [atk]);
    pass(g);
    expect(g.s.battle?.attackers ?? []).not.toContain(atk);
    expect(g.s.cards[atk].damage).toBe(1);
  });

  it("Ecneret: destroyed by an opposing card, your characters gain 2/2 until the end of your next turn", () => {
    const { g, p, o } = setup();
    const e = put(g, o, "ecneret-the-expendable-one", "play");
    const mate = put(g, o, "wanton-wizard", "play");
    const base = g.q.stat(mate, "str");
    resources(g, p, "greed", 4);
    const t = put(g, p, "anesthetizing-opulence", "hand"); // destroy a character
    act(g, p, { type: "deploy", iid: t });
    answer(g, [e]);
    pass(g);
    expect(g.s.cards[e].zone).toBe("discard");
    expect(g.q.stat(mate, "str")).toBe(base + 2);
  });

  it("Ecneret: destroyed by its own controller's card, nothing happens", () => {
    const { g, p } = setup();
    const e = put(g, p, "ecneret-the-expendable-one", "play");
    const mate = put(g, p, "wanton-wizard", "play");
    const base = g.q.stat(mate, "str");
    resources(g, p, "greed", 4);
    const t = put(g, p, "anesthetizing-opulence", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [e]);
    pass(g);
    expect(g.q.stat(mate, "str")).toBe(base);
  });

  it("Drive-By Boobing: only a character that damaged your faction this turn", () => {
    const { g, p, o } = setup();
    const hitter = put(g, p, "wanton-wizard", "play");
    const idle = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [hitter] });
    for (let i = 0; i < 8 && g.s.battle; i++) pass(g);
    expect(g.s.turnLog.factionHits?.[o]).toContain(hitter);
    resources(g, o, "deception", 3);
    put(g, o, "drive-by-boobing", "hand");
    const scope = { controller: o, source: hitter, vars: {} };
    expect(g.q.matches({ character: { damaged_faction: "you" } }, hitter, scope)).toBe(true);
    expect(g.q.matches({ character: { damaged_faction: "you" } }, idle, scope)).toBe(false);
  });

  it("Dweedle Tee: tokens equal to the revealed card's threshold", () => {
    const { g, p } = setup();
    const d = put(g, p, "dweedle-tee", "play");
    for (let i = 0; i < 3; i++) put(g, p, "wanton-wizard", "play", { faceDown: true }); // face-down resources provide [V]
    const top = put(g, p, "fired-hand", "deck"); // threshold: 1 icon
    g.s.players[p].deck.splice(g.s.players[p].deck.indexOf(top), 1);
    g.s.players[p].deck.unshift(top);
    act(g, p, { type: "ability", iid: d, index: g.q.abilities(d)[0].index });
    answer(g, ["1"]); // shuffle instead of paying
    g.s.players[p].deck.splice(g.s.players[p].deck.indexOf(top), 1);
    g.s.players[p].deck.unshift(top);
    pass(g);
    expect(g.s.cards[top].zone).toBe("discard");
    expect(g.s.cards[d].tokens).toBe(1);
  });

  it("Enlightened Mau: no damage from characters with items attached", () => {
    const { g, p, o } = setup();
    const mau = put(g, o, "enlightened-mau", "play");
    const plain = put(g, p, "wanton-wizard", "play");
    const geared = put(g, p, "fired-hand", "play");
    const pepper = put(g, p, "b14nd-p3pp3r", "play");
    g.s.cards[pepper].attachedTo = geared;
    g.inflict(mau, 1, true, [geared]);
    expect(g.s.cards[mau].damage).toBe(0);
    g.inflict(mau, 1, true, [plain]);
    expect(g.s.cards[mau].damage).toBe(1);
  });

  it("Ensmallment Ray: characters cost 2 less, but not below 1", () => {
    const { g, p } = setup();
    put(g, p, "ensmallment-ray", "play");
    resources(g, p, "rage", 3);
    let before = g.q.unattached(p).length;
    const cheap = put(g, p, "barbaric-rifleman", "hand"); // cost 2
    act(g, p, { type: "deploy", iid: cheap });
    passAll(g);
    expect(before - g.q.unattached(p).length).toBe(1);
    before = g.q.unattached(p).length;
    const four = put(g, p, "battle-ready-back-breaker", "hand"); // cost 4
    act(g, p, { type: "deploy", iid: four });
    passAll(g);
    if (g.s.pending?.type === "choose") answer(g, []);
    expect(before - g.q.unattached(p).length).toBe(2);
  });

  it("Elzibeth, Counter-Imperial Countess: the picked character goes on top of the deck instead", () => {
    const { g, p, o } = setup();
    const el = put(g, p, "elzibeth-counter-imperial-countess", "play");
    const w = put(g, o, "wanton-wizard", "play");
    resources(g, p, "rage", 3);
    act(g, p, { type: "ability", iid: el, index: g.q.abilities(el)[0].index });
    answer(g, [w]);
    pass(g);
    g.destroy(w);
    expect(g.s.players[o].deck[0]).toBe(w);
  });

  it("Essence of Greed: the chosen option is its rules text", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 2);
    const t = put(g, p, "essence-of-greed", "hand");
    const inf = g.s.players[p].influence;
    act(g, p, { type: "deploy", iid: t });
    answer(g, ["2"]); // gain 4 influence
    pass(g);
    expect(g.s.players[p].influence).toBe(inf + 4);
  });

  it("Everlasting Blade of Light: stays in play when its character leaves", () => {
    const { g, p } = setup();
    const w = put(g, p, "wanton-wizard", "play");
    const blade = put(g, p, "everlasting-blade-of-light", "play");
    g.s.cards[blade].attachedTo = w;
    expect(g.q.stat(w, "str")).toBe(g.q.printed(w, "str") + 3);
    g.destroy(w);
    expect(g.s.cards[blade].zone).toBe("play");
    expect(g.s.cards[blade].attachedTo).toBe(null);
  });

  it("Expert Debater: battle damage while blocking becomes tokens", () => {
    const { g, p, o } = setup();
    const deb = put(g, o, "expert-debater", "play"); // 6 life
    const atk = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    pass(g);
    answer(g, [deb]);
    for (let i = 0; i < 8 && g.s.battle; i++) pass(g);
    expect(g.s.cards[deb].damage).toBe(0);
    expect(g.s.cards[deb].tokens).toBe(g.q.printed(atk, "str"));
    expect(g.q.stat(deb, "life")).toBe(6 - g.q.printed(atk, "str"));
  });

  it("Executive Poaching: the opponent's character with the highest numeric cost", () => {
    const { g, p, o } = setup();
    const big = put(g, o, "fired-hand", "play"); // cost 6
    put(g, o, "wanton-wizard", "play");
    put(g, p, "dragon-tank", "play"); // mine, cost 12: not a candidate
    resources(g, p, "greed", 5);
    const t = put(g, p, "executive-poaching", "hand");
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toEqual([big]);
  });
});
