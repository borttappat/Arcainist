// Scenario tests for cards automated in alphabetical batches (A).

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

describe("cards: A", () => {
  it("6r4wny 60dy9u4rd5: takes the picked character's damage and is destroyed in its place", () => {
    const { g, p } = setup();
    resources(g, p, "rage", 5);
    const w = put(g, p, "wanton-wizard", "play");
    const bg = put(g, p, "6r4wny-60dy9u4rd5", "hand");
    act(g, p, { type: "deploy", iid: bg });
    answer(g, [w]);
    passAll(g);
    g.inflict(w, 2, false);
    expect(g.s.cards[w].damage).toBe(0);
    expect(g.s.cards[bg].damage).toBe(2);
    g.destroy(w);
    expect(g.s.cards[w].zone).toBe("play");
    expect(g.s.cards[bg].zone).toBe("discard");
    // With the bodyguard gone, the effect ends.
    g.inflict(w, 1, false);
    expect(g.s.cards[w].damage).toBe(1);
  });

  it("A Series of Tubes: Redirect moves only the next 1 damage", () => {
    const { g, p } = setup();
    const tubes = put(g, p, "a-series-of-tubes", "play");
    const node = put(g, p, "basic-node", "play");
    const idx = g.q.abilities(tubes).find((a) => a.rule.name === "Redirect")!.index;
    act(g, p, { type: "ability", iid: tubes, index: idx });
    answer(g, [node]);
    passAll(g);
    g.inflict(node, 3, false);
    expect(g.s.cards[tubes].damage).toBe(1);
    expect(g.s.cards[node].damage).toBe(2);
    g.inflict(node, 1, false);
    expect(g.s.cards[tubes].damage).toBe(1);
  });

  it("Adriel, Supreme General: its owner may put it on top of their deck instead of destroying it", () => {
    const { g, p, o } = setup();
    const a = put(g, p, "adriel-supreme-general-of-the-imperial-army", "play"); // 1 life
    resources(g, p, "rage", 3);
    const phlegm = put(g, p, "acidic-phlegm", "hand"); // 1 damage to all characters
    act(g, p, { type: "deploy", iid: phlegm });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toContain("would be destroyed");
    answer(g, ["yes"]);
    expect(g.s.players[p].deck[0]).toBe(a);

    const b = put(g, o, "adriel-supreme-general-of-the-imperial-army", "play");
    const phlegm2 = put(g, p, "acidic-phlegm", "hand");
    resources(g, p, "rage", 2);
    act(g, p, { type: "deploy", iid: phlegm2 });
    pass(g);
    expectPending(g, "choose", o); // the owner decides
    answer(g, ["no"]);
    expect(g.s.cards[b].zone).toBe("discard");
  });

  it("12-Man Brunch of Doom: X is the number of characters depleted", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 2);
    const mine = [put(g, p, "wanton-wizard", "play"), put(g, p, "wanton-wizard", "play")];
    const big = put(g, o, "fired-hand", "play"); // 5 strength
    const brunch = put(g, p, "12-man-brunch-of-doom", "hand");
    act(g, p, { type: "deploy", iid: brunch });
    answer(g, mine);
    answer(g, [big]);
    passAll(g);
    expect(mine.every((i) => g.s.cards[i].depleted)).toBe(true);
    expect(g.s.cards[big].zone).toBe("play"); // 5 > 2 + 2
  });

  it("53cur17y 5y573m: COVERT parties can be blocked by characters without COVERT", () => {
    const { g, p, o } = setup();
    put(g, o, "53cur17y-5y573m", "play");
    const sneak = put(g, p, "wanton-wizard", "play");
    g.s.effects.push({ id: "cv", source: sneak, controller: p, vars: {}, mods: [{ keyword: "covert", target: { iids: [sneak] } }], duration: "turn", turn: g.s.turn });
    const blocker = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [sneak] });
    pass(g);
    pass(g);
    const d = expectPending(g, "blockers", o);
    expect(d.candidates).toContain(blocker);
  });

  it("Adjunct Artisan: Fabricate reduces an item's cost, not a character's", () => {
    const { g, p } = setup();
    const art = put(g, p, "adjunct-artisan", "play");
    resources(g, p, "elitism", 8);
    act(g, p, { type: "ability", iid: art, index: g.q.abilities(art)[0].index });
    passAll(g);
    let before = g.q.unattached(p).length;
    const ch = put(g, p, "a-boy-and-his-toy", "hand"); // a 4-cost character: full price
    act(g, p, { type: "deploy", iid: ch });
    passAll(g);
    expect(before - g.q.unattached(p).length).toBe(4);
    before = g.q.unattached(p).length;
    const gear = put(g, p, "3p1c-d00dm4k3r", "hand"); // a 4-cost item: 2 less
    act(g, p, { type: "deploy", iid: gear });
    answer(g, [ch]);
    passAll(g);
    expect(before - g.q.unattached(p).length).toBe(2);
  });

  it("A Death Fit for a King: picks a UNIQUE character, not an ordinary one", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 2);
    const unique = put(g, o, "adriel-supreme-general-of-the-imperial-army", "play");
    const plain = put(g, o, "wanton-wizard", "play");
    const t = put(g, p, "a-death-fit-for-a-king", "hand");
    act(g, p, { type: "deploy", iid: t });
    const d = expectPending(g, "choose", p);
    const ids = d.options.map((x: any) => x.id);
    expect(ids).toContain(unique);
    expect(ids).not.toContain(plain);
    answer(g, [unique]);
    passAll(g);
    expect(g.s.cards[unique].zone).toBe("void");
  });

  it("Ambuscade: destroys a defender and divides twice its strength among the attackers", () => {
    const { g, p, o } = setup();
    const atk = [put(g, p, "wanton-wizard", "play"), put(g, p, "wanton-wizard", "play")];
    const def = put(g, o, "fired-hand", "play"); // 5 strength: X = 10
    resources(g, o, "deception", 3);
    const amb = put(g, o, "ambuscade", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: atk });
    pass(g);
    act(g, o, { type: "deploy", iid: amb });
    answer(g, [def]);
    pass(g);
    const d = expectPending(g, "assign", o);
    expect(d.total).toBe(10);
    g.act(o, { type: "answer", assign: { [atk[0]]: 4, [atk[1]]: 6 } });
    expect(atk.every((i) => g.s.cards[i].zone === "discard")).toBe(true);
    expect(g.q.isCharacter(def)).toBe(false); // Fired Hand flips face-down instead
  });

  it("Architectural Restitution: a location comes back and becomes the attack's target", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "wanton-wizard", "play");
    const loc = put(g, o, "ancient-and-disreputable-law-office", "discard");
    resources(g, o, "greed", 4);
    const t = put(g, o, "architectural-restitution", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    act(g, o, { type: "deploy", iid: t });
    answer(g, [loc]);
    pass(g);
    expect(g.s.cards[loc].zone).toBe("play");
    expect(g.s.battle?.target).toBe(loc);
  });

  it("Arcane Monkey Ritual: RECUR makes the picked player discard 2", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 4);
    for (let i = 0; i < 3; i++) put(g, o, "wanton-wizard", "hand");
    const r = put(g, p, "arcane-monkey-ritual", "discard");
    act(g, p, { type: "ability", iid: r, index: g.q.abilities(r)[0].index });
    answer(g, [g.s.players[o].factionIid]);
    pass(g);
    expectPending(g, "choose", o);
    answer(g, g.s.players[o].hand.slice(0, 2));
    expect(g.s.players[o].hand).toHaveLength(1);
    expect(g.s.cards[r].zone).toBe("void");
  });

  it("Arrogance: entering play as a resource costs 1 influence", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 4);
    const before = g.s.players[p].influence;
    const card = put(g, p, "arrogance", "hand");
    const f = g.s.players[p].factionIid;
    act(g, p, { type: "ability", iid: f, index: g.q.abilities(f).find((a) => a.rule.name === "Resource")!.index });
    pass(g);
    g.act(p, { type: "answer", iid: card, faceDown: false });
    expect(g.s.players[p].influence).toBe(before - 1);
    expect(g.q.icons(p).elitism).toBeGreaterThanOrEqual(2);
  });

  it("Arcane Ambush: names in UNIQUE lines are recognised", () => {
    const { g, p } = setup();
    const pluck = put(g, p, "abram-ka-darbo-alkazin", "play");
    expect(g.q.matches({ card: { unique: "Pluck" } }, pluck, { controller: p, source: pluck, vars: {} })).toBe(true);
    expect(g.q.matches({ card: { unique: "Jo" } }, pluck, { controller: p, source: pluck, vars: {} })).toBe(false);
  });

  it("Auspicious Tax: attacking with the character costs 3", () => {
    const { g, p, o } = setup();
    const w = put(g, p, "wanton-wizard", "play");
    const tax = put(g, o, "auspicious-tax", "play");
    g.s.cards[tax].attachedTo = w;
    for (const r of g.q.unattached(p)) g.s.cards[r].attachedTo = "faction";
    expect(() => g.act(p, { type: "attack", target: "faction", attackers: [w] })).toThrow(/costs 3/);
    resources(g, p, "rage", 3);
    act(g, p, { type: "attack", target: "faction", attackers: [w] });
    expect(g.q.unattached(p)).toHaveLength(0);
  });

  it("Backdoor Brigand: Exit Stage Right only before it assigns damage", () => {
    const { g, p } = setup();
    const b = put(g, p, "backdoor-brigand", "play");
    resources(g, p, "deception", 2);
    const idx = g.q.abilities(b)[0].index;
    g.s.turnLog.assigned = { [b]: true };
    act(g, p, { type: "ability", iid: b, index: idx });
    expect(g.s.stack).toHaveLength(0); // rolled back
    g.s.turnLog.assigned = {};
    act(g, p, { type: "ability", iid: b, index: idx });
    passAll(g);
    expect(g.s.cards[b].faceDown).toBe(true);
  });

  it("Axeclaw Grandchest: reveals the top card and gains its numeric cost in strength", () => {
    const { g, p } = setup();
    const a = put(g, p, "axeclaw-grandchest", "play");
    const top = put(g, p, "fired-hand", "deck");
    g.s.players[p].deck.splice(g.s.players[p].deck.indexOf(top), 1);
    g.s.players[p].deck.unshift(top);
    expect(g.q.stat(a, "str")).toBe(6);
  });

  it("Barracks of Precipitancy: the character is removed from the game at end of turn", () => {
    const { g, p } = setup();
    const b = put(g, p, "barracks-of-precipitancy", "play");
    const top = put(g, p, "wanton-wizard", "deck");
    g.s.players[p].deck.splice(g.s.players[p].deck.indexOf(top), 1);
    g.s.players[p].deck.unshift(top);
    g.s.players[p].deck = [top]; // the shuffle can only find the wizard
    act(g, p, { type: "ability", iid: b, index: g.q.abilities(b)[0].index });
    passAll(g);
    answer(g, ["no"]); // Wanton Wizard's own enter trigger
    const entered = g.s.players[p].play.find((i) => g.q.isCharacter(i))!;
    expect(entered).toBe(top);
    expect(g.q.keyword(entered, "aggro")).toBe(true);
    g.destroy(entered);
    expect(g.s.cards[entered].zone).toBe("void");
  });

  it("Banners: PROVIDES from the card's numbers, and the trigger sees the banner itself", () => {
    const { g, p } = setup();
    resources(g, p, "rage", 3);
    const ban = put(g, p, "banner-of-fury", "hand");
    const w = put(g, p, "wanton-wizard", "play");
    const before = g.q.icons(p).rage;
    act(g, p, { type: "deploy", iid: ban });
    passAll(g);
    expect(g.q.icons(p).rage).toBe(before + 1);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toContain("pay 1");
    answer(g, ["yes"]);
    answer(g, [w]);
    expect(g.q.stat(w, "str")).toBe(g.q.printed(w, "str") + 1);
  });

  it("Avuncular Merlion: a destroyed character comes back depleted for 1 and a token", () => {
    const { g, p } = setup();
    const m = put(g, p, "avuncular-merlion", "play");
    g.s.cards[m].tokens = 2;
    const w = put(g, p, "barbaric-rifleman", "play"); // 1 life
    resources(g, p, "rage", 3);
    const phlegm = put(g, p, "acidic-phlegm", "hand"); // 1 damage to all characters
    act(g, p, { type: "deploy", iid: phlegm });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toContain("Avuncular Merlion");
    answer(g, ["yes"]);
    expect(g.s.cards[w].zone).toBe("play");
    expect(g.s.cards[w].depleted).toBe(true);
    expect(g.s.cards[m].tokens).toBe(1);
  });

  it("Auspicious Arrival: only characters with 1 strength or less among the top 8", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 3);
    const weak = put(g, p, "aristocratic-artificer", "deck"); // 0 strength
    const strong = put(g, p, "fired-hand", "deck");
    for (const i of [weak, strong]) {
      g.s.players[p].deck.splice(g.s.players[p].deck.indexOf(i), 1);
      g.s.players[p].deck.unshift(i);
    }
    const t = put(g, p, "auspicious-arrival", "hand");
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    const d = expectPending(g, "choose", p);
    const ids = d.options.map((x: any) => x.id);
    expect(ids).toContain(weak);
    expect(ids).not.toContain(strong);
    answer(g, [weak]);
    expect(g.s.cards[weak].zone).toBe("hand");
  });

  it("Beatrix Winterbottom: draws one extra, and no draws at 10 cards in hand", () => {
    const { g, p } = setup();
    put(g, p, "beatrix-winterbottom", "play");
    g.drawCards(p, 1);
    expect(g.s.players[p].hand).toHaveLength(2);
    for (let i = 0; i < 8; i++) put(g, p, "wanton-wizard", "hand");
    g.drawCards(p, 2); // 10 cards: stops
    expect(g.s.players[p].hand).toHaveLength(10);
  });

  it("Bask Bomb: the opponent divides Y damage among the attackers", () => {
    const { g, p, o } = setup();
    const atk = [put(g, p, "fired-hand", "play"), put(g, p, "wanton-wizard", "play")];
    const blk = put(g, o, "wanton-wizard", "play");
    resources(g, p, "rage", 3);
    const bomb = put(g, p, "bask-bomb", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: atk });
    pass(g);
    pass(g);
    answer(g, [blk]);
    act(g, p, { type: "deploy", iid: bomb });
    answer(g, [atk[0]]); // Fired Hand: 5 strength, X = 10, Y = 5
    pass(g);
    let d = expectPending(g, "assign", p);
    expect(d.total).toBe(10);
    g.act(p, { type: "answer", assign: { [blk]: 10 } });
    d = expectPending(g, "assign", o);
    expect(d.total).toBe(5);
    expect(d.targets).toEqual([atk[1]]);
  });

  it("Berserker Corps: eats a character for tokens, or destroys itself", () => {
    const { g, p, o } = setup();
    const corps = put(g, p, "berserker-corps", "play");
    const food = put(g, p, "fired-hand", "play");
    g.s.cards[corps].controlSince = 0;
    act(g, p, { type: "end_turn" });
    passAll(g);
    // Opponent's turn: answer its develop choice, then end it.
    while (g.s.active === o) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else if (d.type === "main") act(g, o, { type: "end_turn" });
      else pass(g);
    }
    for (let i = 0; i < 10 && !(g.s.pending?.type === "choose" && g.s.pending.prompt.includes("Berserker")); i++) {
      const d = g.s.pending!;
      answer(g, [d.type === "choose" ? (d as any).options[0].id : ""]);
    }
    answer(g, [food]);
    expect(g.s.cards[corps].tokens).toBe(5);
    expect(g.q.stat(corps, "str")).toBe(10);
  });
});
