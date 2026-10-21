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

  it("Fantastic Uber Kool Creator Majig: costs 1 less per [E] you control", () => {
    const { g, p } = setup();
    for (const r of g.q.resources(p)) g.move(r, "discard");
    resources(g, p, "elitism", 6);
    const m = put(g, p, "fantastic-uber-kool-creator-majig", "hand");
    act(g, p, { type: "deploy", iid: m });
    expect(g.q.unattached(p)).toHaveLength(2); // 10 - 6 = 4 paid
  });

  it("F.U.M.A.S.T.: faction abilities cost 1 less", () => {
    const { g, p } = setup();
    put(g, p, "first-unified-market-of-abstract-secure-theoreticals", "play");
    for (const r of g.q.resources(p)) g.move(r, "discard");
    resources(g, p, "greed", 2);
    const f = g.s.players[p].factionIid;
    act(g, p, { type: "ability", iid: f, index: g.q.abilities(f).find((a) => a.rule.name === "Draw")!.index }); // Pay 3
    expect(g.s.stack).toHaveLength(1);
    expect(g.q.unattached(p)).toHaveLength(0);
  });

  it("Flaming Cube: the opponent may use Control the Flame; reaching 6 tokens costs 6 influence", () => {
    const { g, p, o } = setup();
    const cube = put(g, p, "flaming-cube", "play");
    g.s.cards[cube].tokens = 5;
    const fodder = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "end_turn" });
    passAll(g);
    for (let i = 0; i < 10 && !(g.s.active === o && g.s.pending?.type === "main"); i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    const inf = g.s.players[o].influence;
    act(g, o, { type: "ability", iid: cube, index: g.q.abilities(cube)[0].index });
    answer(g, [fodder]);
    pass(g);
    answer(g, ["0"]); // add a token
    expect(g.s.cards[cube].zone).toBe("discard");
    expect(g.s.players[o].influence).toBe(inf - 6);
  });

  it("Fiscal Intercessor: the next damage this turn is reduced by 1", () => {
    const { g, p } = setup();
    const fi = put(g, p, "fiscal-intercessor", "play");
    const w = put(g, p, "fired-hand", "play");
    act(g, p, { type: "ability", iid: fi, index: g.q.abilities(fi)[0].index });
    answer(g, [w]);
    pass(g);
    g.inflict(w, 2, false);
    expect(g.s.cards[w].damage).toBe(1);
  });

  it("Ferret Oil Coating: the attached character must be picked", () => {
    const { g, p, o } = setup();
    const w = put(g, o, "wanton-wizard", "play");
    const other2 = put(g, o, "fired-hand", "play");
    const coat = put(g, o, "ferret-oil-coating", "play");
    g.s.cards[coat].attachedTo = w;
    resources(g, p, "rage", 1);
    const t = put(g, p, "distraction", "hand");
    act(g, p, { type: "deploy", iid: t });
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toEqual([w]);
    void other2;
  });

  it("Forced Recruitment: the responded character enters play under your control", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 2);
    resources(g, o, "deception", 4);
    const w = put(g, p, "barbaric-rifleman", "hand"); // cost 2
    const t = put(g, o, "forced-recruitment", "hand");
    act(g, p, { type: "deploy", iid: w });
    act(g, o, { type: "deploy", iid: t });
    passAll(g);
    expect(g.s.cards[w].zone).toBe("play");
    expect(g.s.cards[w].controller).toBe(o);
    expect(g.s.cards[w].owner).toBe(p);
  });

  it("Forbidden Knowledge: only its player sees the hidden cards", () => {
    const { g, p, o } = setup();
    put(g, o, "fired-hand", "hand");
    resources(g, p, "obsession", 2);
    const t = put(g, p, "forbidden-knowledge", "hand");
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    const line = g.s.log.find((l) => l.text.includes("hand: Fired Hand"))!;
    expect(line).toBeDefined();
    expect((line as any).to).toBe(p);
  });

  it("Frenzied Shriever: its battle damage to characters is 2 more", () => {
    const { g, p, o } = setup();
    const fs = put(g, p, "frenzied-shriever", "play");
    const w = put(g, o, "fired-hand", "play");
    g.inflict(w, 1, true, [fs]);
    expect(g.s.cards[w].damage).toBe(3);
    g.inflict(w, 1, false, [fs]);
    expect(g.s.cards[w].damage).toBe(4);
  });

  it("Frickin Sweet Pogo Bunny: RAAR! makes it a character this turn, HIDE! undoes it", () => {
    const { g, p } = setup();
    const b = put(g, p, "frickin-sweet-pogo-bunny", "play");
    resources(g, p, "elitism", 2);
    act(g, p, { type: "ability", iid: b, index: g.q.abilities(b)[0].index });
    pass(g);
    expect(g.q.isCharacter(b)).toBe(true);
    expect(g.q.stat(b, "spd")).toBe(3);
    act(g, p, { type: "ability", iid: b, index: g.q.abilities(b)[1].index });
    pass(g);
    expect(g.q.isCharacter(b)).toBe(false);
  });

  it("God's Blessing of Boost: stays attached and gives your characters 1 strength", () => {
    const { g, p } = setup();
    const w = put(g, p, "fired-hand", "play");
    const mate = put(g, p, "dragon-rider", "play");
    resources(g, p, "rage", 6);
    const b = put(g, p, "god-s-blessing-of-boost", "hand");
    act(g, p, { type: "deploy", iid: b });
    answer(g, [w]);
    pass(g);
    expect(g.s.cards[b].zone).toBe("play");
    expect(g.s.cards[b].attachedTo).toBe(w);
    expect(g.s.cards[mate].damage).toBe(1); // entered: 1 damage to all characters
    expect(g.q.stat(mate, "str")).toBe(g.q.printed(mate, "str") + 1);
  });

  it("Giada the Elegant: an opposing destruction may become a token", () => {
    const { g, p, o } = setup();
    const gi = put(g, o, "giada-the-elegant", "play");
    resources(g, p, "greed", 4);
    const t = put(g, p, "anesthetizing-opulence", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [gi]);
    pass(g);
    const d = expectPending(g, "choose", o);
    expect(d.prompt).toContain("would be destroyed");
    answer(g, ["yes"]);
    expect(g.s.cards[gi].zone).toBe("play");
    expect(g.s.cards[gi].tokens).toBe(1);
    expect(g.s.cards[gi].depleted).toBe(true);
  });

  it("Gigantitect's Giant Giant: only items can pick it, and opponents can't take it", () => {
    const { g, p, o } = setup();
    const giant = put(g, o, "gigantitect-s-giant-giant", "play");
    resources(g, p, "rage", 1);
    const t = put(g, p, "distraction", "hand");
    act(g, p, { type: "deploy", iid: t });
    expect(g.s.stack).toHaveLength(0); // nothing to pick: rolled back
    const hand = put(g, p, "carnival-whipmaster", "play");
    void hand;
    expect(g.q.cannot("take_control", giant, p)).toBe(true);
  });

  it("Gosche's Retained Earnings Vault: a character of yours with a token leaving play pays 2 influence", () => {
    const { g, p } = setup();
    put(g, p, "gosche-s-retained-earnings-vault", "play");
    const marked = put(g, p, "wanton-wizard", "play");
    const plain = put(g, p, "wanton-wizard", "play");
    g.s.cards[marked].tokens = 1;
    const inf = g.s.players[p].influence;
    resources(g, p, "rage", 3);
    const t = put(g, p, "acidic-phlegm", "hand"); // 1 damage to all: both wizards die
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    expect(g.s.cards[plain].zone).toBe("discard");
    expect(g.s.players[p].influence).toBe(inf + 2);
  });

  it("Guardbeast of Thabbash: with [V]x4 it can block a COVERT party", () => {
    const { g, p, o } = setup();
    const gb = put(g, o, "guardbeast-of-thabbash", "play");
    for (let i = 0; i < 4; i++) put(g, o, "wanton-wizard", "play", { faceDown: true });
    const sneak = put(g, p, "desperate-defender", "play"); // COVERT
    act(g, p, { type: "attack", target: "faction", attackers: [sneak] });
    pass(g);
    pass(g);
    expect(expectPending(g, "blockers", o).candidates).toContain(gb);
  });

  it("Guileful Astucion: a numeric cost change this turn affects cost checks", () => {
    const { g, p, o } = setup();
    const w = put(g, o, "fired-hand", "play"); // cost 6
    resources(g, p, "deception", 2);
    const t = put(g, p, "guileful-astucion", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [w]);
    pass(g);
    answer(g, ["1"]); // gains 1 numeric cost
    expect(g.q.numericCost(w)).toBe(7);
    expect(g.q.matches({ character: { cost_gte: 7 } }, w, { controller: p, source: w, vars: {} })).toBe(true);
  });

  it("Guardforce Morphmajig: grows when you deploy, shrinks when the opponent does", () => {
    const { g, p, o } = setup();
    const m = put(g, p, "guardforce-morphmajig", "play");
    resources(g, p, "rage", 1);
    const t = put(g, p, "distraction", "hand");
    const v = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [v]);
    pass(g);
    expect(g.s.cards[m].tokens).toBe(1);
    expect(g.q.keyword(m, "aggro")).toBe(true);
  });

  it("Ruling: two Fornicaves both apply, destroying every character with printed life 4 or more", () => {
    const { g, p, o } = setup();
    put(g, o, "fornicaves", "play");
    const life3 = put(g, o, "dragon-rider", "play"); // 3 - 1 - 1 = 1: survives
    const life4 = put(g, o, "abusive-major-general", "play"); // 4 - 2 - 2 = 0
    const life5 = put(g, o, "berserker-corps", "play"); // 5 - 3 - 3 = 0
    resources(g, p, "deception", 3);
    const f2 = put(g, p, "fornicaves", "hand");
    act(g, p, { type: "deploy", iid: f2 });
    pass(g);
    expect(g.s.cards[life3].zone).toBe("play");
    expect(g.q.stat(life3, "life")).toBe(1);
    expect(g.s.cards[life4].zone).toBe("discard");
    expect(g.s.cards[life5].zone).toBe("discard");
  });

  it("Ruling: under Limited Liability several Gideons stay in play until the turn ends", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 6);
    const ll = put(g, p, "limited-liability", "hand");
    act(g, p, { type: "deploy", iid: ll });
    pass(g);
    const gids = [0, 1, 2, 3].map(() => put(g, p, "gideon-the-ultimate-warrior", "play"));
    resources(g, p, "rage", 1);
    const t = put(g, p, "battle-surge", "hand"); // any action runs the state checks
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    expect(g.s.pending?.type).toBe("main");
    expect(gids.every((i) => g.s.cards[i].zone === "play")).toBe(true);
    // Once Limited Liability ends, the unique rule applies again.
    act(g, p, { type: "end_turn" });
    for (let i = 0; i < 10 && !(g.s.pending?.type === "choose" && g.s.pending.prompt.includes("Unique Gideon")); i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    expectPending(g, "choose", p);
    answer(g, [gids[0]]);
    expect(gids.filter((i) => g.s.cards[i].zone === "play")).toEqual([gids[0]]);
    void o;
  });
});
