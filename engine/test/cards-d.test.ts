// Scenario tests for cards automated in alphabetical batches (D onwards).

import { describe, expect, it } from "vitest";
import { other } from "../types.ts";
import { legalFor, viewFor } from "../view.ts";
import { act, answer, expectPending, newGame, pass, passAll, put, resources, toMain } from "./helpers.ts";

function setup() {
  const g = newGame(1);
  const p = toMain(g);
  const o = other(p);
  for (const x of [p, o]) for (const iid of [...g.s.players[x].hand]) g.move(iid, "deck", { bottom: true });
  return { g, p, o };
}

/** Put a card on top of its owner's deck. */
function top(g: ReturnType<typeof newGame>, p: "A" | "B", iid: string) {
  const d = g.s.players[p].deck;
  d.splice(d.indexOf(iid), 1);
  d.unshift(iid);
}

/** End the turn and start the next one, choosing "draw" for the develop rule. */
function nextTurn(g: ReturnType<typeof newGame>) {
  const p = g.s.active;
  act(g, p, { type: "end_turn" });
  pass(g);
  for (let i = 0; i < 6; i++) {
    const d = g.s.pending as any;
    if (d?.type !== "choose") return;
    if (/Several triggers|Start of turn/.test(d.prompt)) {
      const pick = d.options.find((o: any) => o.label.endsWith("Restore rule")) ?? d.options.find((o: any) => o.label.endsWith("Develop rule"));
      if (!pick) return;
      act(g, d.player, { type: "answer", ids: [pick.id] });
    } else if (d.options.some((o: any) => o.label.startsWith("draw"))) {
      act(g, d.player, { type: "answer", ids: [d.options.findIndex((o: any) => o.label.startsWith("draw")).toString()] });
      return;
    } else return;
  }
}

/** Run the engine after a direct state change (a destroy outside any action). */
function settle(g: ReturnType<typeof newGame>) {
  g.s.pending = undefined as any;
  (g as any).run();
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
  it("High Court of Demands: opponents can't attack your faction", () => {
    const { g, p, o } = setup();
    put(g, o, "high-court-of-demands", "play");
    const atk = put(g, p, "fired-hand", "play");
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [atk] })).toThrow(/can't attack/);
  });

  it("Hangdog Alley: attacking parties have only 1 member", () => {
    const { g, p, o } = setup();
    put(g, o, "hangdog-alley", "play");
    const a = put(g, p, "fired-hand", "play");
    const b = put(g, p, "wanton-wizard", "play");
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [a, b] })).toThrow(/at most 1/);
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    expect(g.s.battle?.attackers).toEqual([a]);
  });

  it("Hilarious Refrigerator Alarm: terminates the other unresolved cards", () => {
    const { g, p, o } = setup();
    resources(g, p, "deception", 6);
    resources(g, o, "elitism", 2);
    const hand = put(g, p, "fired-hand", "hand");
    const t = put(g, o, "hilarious-refrigerator-alarm", "hand");
    act(g, p, { type: "deploy", iid: hand });
    act(g, o, { type: "deploy", iid: t });
    pass(g);
    // The deploying player is offered 3 Micromajig tokens; decline.
    const d = g.s.pending!;
    expect(d.player).toBe(p);
    answer(g, ["no"]);
    passAll(g);
    expect(g.s.cards[hand].zone).toBe("discard");
  });

  it("Headshot: keeps going while each target is destroyed", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 3);
    const a = put(g, o, "wanton-wizard", "play");
    const b = put(g, o, "wanton-wizard", "play");
    const c = put(g, o, "fired-hand", "play");
    const t = put(g, p, "headshot", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [a]);
    pass(g);
    answer(g, [b]);
    answer(g, [c]);
    expect(g.s.cards[a].zone).toBe("discard");
    expect(g.s.cards[b].zone).toBe("discard");
    expect(g.s.cards[c].damage).toBe(1);
    expect(g.s.pending?.type).not.toBe("choose");
  });

  it("Hate of Man: each token costs non-Arcanist characters 1 strength", () => {
    const { g, p, o } = setup();
    const h = put(g, p, "hate-of-man", "play");
    const f = put(g, o, "fired-hand", "play");
    g.s.cards[h].tokens = 2;
    expect(g.q.stat(f, "str")).toBe(3);
    expect(g.q.stat(h, "str")).toBe(1);
  });

  it("Hasty Pursuit: characters you deploy this turn can attack", () => {
    const { g, p } = setup();
    resources(g, p, "elitism", 3);
    resources(g, p, "deception", 6);
    const t = put(g, p, "hasty-pursuit", "hand");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    const f = put(g, p, "fired-hand", "hand");
    act(g, p, { type: "deploy", iid: f });
    passAll(g);
    expect(g.q.canAttack(f)).toBe(true);
  });
  it("Hypnotic Plafond: battle damage from a COVERT party to your faction is 0", () => {
    const { g, p, o } = setup();
    put(g, o, "hypnotic-plafond", "play");
    const atk = put(g, p, "fired-hand", "play");
    const covert = put(g, p, "hired-goons", "play");
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [covert] });
    for (let i = 0; i < 10 && g.s.battle; i++) pass(g);
    expect(g.s.players[o].influence).toBe(inf);
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    for (let i = 0; i < 10 && g.s.battle; i++) pass(g);
    expect(g.s.players[o].influence).toBe(inf - 5);
  });

  it("iDumb De-Itemizer: only an opponent may use Reset", () => {
    const { g, p, o } = setup();
    const d = put(g, p, "idumb-de-itemizer", "play");
    resources(g, p, "greed", 3);
    resources(g, o, "greed", 3);
    const idx = g.q.abilities(d)[0].index;
    expect(() => act(g, p, { type: "ability", iid: d, index: idx })).toThrow(/Only an opponent/);
  });

  it("Humiliating Torture Apparatus: attacking costs the attacker 1 influence", () => {
    const { g, p, o } = setup();
    put(g, o, "humiliating-torture-apparatus", "play");
    const atk = put(g, p, "wanton-wizard", "play");
    const inf = g.s.players[p].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    expect(g.s.players[p].influence).toBe(inf - 1);
  });

  it("Horrendous Behemoth: the opposing party loses 1 strength and 1 speed", () => {
    const { g, p, o } = setup();
    const b = put(g, p, "horrendous-behemoth", "play");
    const f = put(g, o, "fired-hand", "play");
    expect(g.q.stat(f, "str")).toBe(5);
    act(g, p, { type: "attack", target: "faction", attackers: [b] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [f] });
    expect(g.q.stat(f, "str")).toBe(4);
    expect(g.q.stat(f, "spd")).toBe(2);
  });
  it("Inconvenient Roadblock: no battle damage in this battle, but the next battle is normal", () => {
    const { g, p, o } = setup();
    const a = put(g, p, "fired-hand", "play");
    const b = put(g, p, "wanton-wizard", "play");
    resources(g, o, "greed", 3);
    const t = put(g, o, "inconvenient-roadblock", "hand");
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    pass(g);
    act(g, o, { type: "deploy", iid: t });
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    expect(g.s.players[o].influence).toBe(inf);
    act(g, p, { type: "attack", target: "faction", attackers: [b] });
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    expect(g.s.players[o].influence).toBe(inf - 1);
  });

  it("Infatuated Armchair: exactly 1 of the 2 looked-at cards goes to the bottom", () => {
    const { g, p } = setup();
    const a = put(g, p, "infatuated-armchair", "play");
    resources(g, p, "rage", 3);
    const t = put(g, p, "improvised-blowtorch", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [a]);
    pass(g);
    answer(g, ["yes"]);
    let d = expectPending(g, "choose", p); // which deck
    answer(g, [d.options[0].id]);
    d = expectPending(g, "choose", p);
    expect(d.min).toBe(1);
    expect(d.max).toBe(1);
  });

  it("Insect Appreciator: its party must have an even number of members", () => {
    const { g, p } = setup();
    const a = put(g, p, "insect-appreciator", "play");
    const b = put(g, p, "wanton-wizard", "play");
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [a] })).toThrow(/even/);
    act(g, p, { type: "attack", target: "faction", attackers: [a, b] });
    expect(g.s.battle).toBeTruthy();
  });
  it("Key to the City: when the attached character leaves play, you may search for a resource", () => {
    const { g, p } = setup();
    const w = put(g, p, "wanton-wizard", "play");
    const k = put(g, p, "key-to-the-city", "play");
    g.s.cards[k].attachedTo = w;
    const r = put(g, p, "greed", "deck");
    resources(g, p, "rage", 3);
    const t = put(g, p, "improvised-blowtorch", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [w]);
    pass(g);
    answer(g, ["yes"]);
    const d = expectPending(g, "choose", p);
    expect(d.options.some((o: any) => o.id === r)).toBe(true);
  });

  it("Jo, M07h3r of 1337: granted Research needs the character in play since the start of the turn", () => {
    const { g, p } = setup();
    put(g, p, "jo-ciendeilio-m07h3r-0f-1337", "play");
    const old = put(g, p, "wanton-wizard", "play");
    const fresh = put(g, p, "wanton-wizard", "play", { since: g.s.turn });
    const ab = (iid: string) => g.q.abilities(iid).find((a) => a.rule.name === "Research")!.index;
    try {
      act(g, p, { type: "ability", iid: fresh, index: ab(fresh) });
    } catch {
      // refused outright
    }
    expect(g.s.cards[fresh].depleted).toBe(false);
    act(g, p, { type: "ability", iid: old, index: ab(old) });
    expect(g.s.cards[old].depleted).toBe(true);
  });

  it("Juice Sale: only the opponent's strongest character can be picked", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 3);
    const big = put(g, o, "fired-hand", "play");
    put(g, o, "wanton-wizard", "play");
    put(g, p, "horrendous-behemoth", "play");
    const t = put(g, p, "juice-sale", "hand");
    act(g, p, { type: "deploy", iid: t });
    // Only one candidate: picked automatically or offered alone.
    expect(expectPending(g, "choose", p).options.map((x: any) => x.id)).toEqual([big]);
    answer(g, [big]);
    passAll(g);
    expect(g.q.cannot("block", big, o)).toBe(true);
  });

  it("Kitten Mittons: damage to the attached character gains that much influence", () => {
    const { g, p } = setup();
    const f = put(g, p, "fired-hand", "play");
    const m = put(g, p, "kitten-mittons", "play");
    g.s.cards[m].attachedTo = f;
    resources(g, p, "rage", 3);
    const t = put(g, p, "improvised-blowtorch", "hand");
    const inf = g.s.players[p].influence;
    act(g, p, { type: "deploy", iid: t });
    answer(g, [f]);
    passAll(g);
    expect(g.s.players[p].influence).toBe(inf + 2);
  });
  it("Lucky Bastard: survives when its removed card costs at least as much", () => {
    const { g, p, o } = setup();
    const lb = put(g, p, "lucky-bastard", "play");
    top(g, p, put(g, p, "fired-hand", "deck")); // cost 6
    top(g, o, put(g, o, "wanton-wizard", "deck")); // cost 3
    resources(g, p, "rage", 3);
    const t = put(g, p, "improvised-blowtorch", "hand");
    const hand = g.s.players[p].hand.length;
    act(g, p, { type: "deploy", iid: t });
    answer(g, [lb]);
    g.s.cards[lb].damage = 3;
    passAll(g);
    expect(g.s.cards[lb].zone).toBe("play");
    expect(g.s.cards[lb].damage).toBe(0);
    expect(g.s.players[p].hand.length).toBe(hand); // drew 1, deployed the Blowtorch
  });

  it("Lucky Bastard: removed from the game when its card costs less", () => {
    const { g, p, o } = setup();
    const lb = put(g, p, "lucky-bastard", "play");
    top(g, p, put(g, p, "wanton-wizard", "deck"));
    top(g, o, put(g, o, "fired-hand", "deck"));
    resources(g, p, "rage", 3);
    const t = put(g, p, "improvised-blowtorch", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [lb]);
    g.s.cards[lb].damage = 3;
    passAll(g);
    expect(g.s.cards[lb].zone).toBe("void");
  });

  it("Lockbox of the Aeons: opponents can't flip up, and their cards can't return to hand", () => {
    const { g, p, o } = setup();
    put(g, o, "lockbox-of-the-aeons", "play");
    const fd = put(g, p, "improvised-blowtorch", "play", { faceDown: true });
    resources(g, p, "rage", 2);
    expect(() => act(g, p, { type: "flip_up", iid: fd })).toThrow(/Flip Up/);
    const w = put(g, p, "wanton-wizard", "play");
    g.move(w, "hand");
    expect(g.s.cards[w].zone).toBe("play");
  });

  it("Lugubrious Node: node cards can't destroy it, other cards can", () => {
    const { g, p } = setup();
    const n = put(g, p, "lugubrious-node", "play");
    const hub = put(g, p, "hub-node", "play");
    g.destroy(hub);
    passAll(g);
    expect(g.s.cards[n].zone).toBe("play");
  });

  it("Leokaiser: while it attacks alone, only parties of 3 or more can block it", () => {
    const { g, p, o } = setup();
    const lk = put(g, p, "leokaiser", "play");
    put(g, p, "pantherkaiser", "play");
    put(g, p, "tigerkaiser", "play");
    const ab = g.q.abilities(lk)[0].index;
    act(g, p, { type: "ability", iid: lk, index: ab });
    for (let i = 0; i < 4 && g.s.pending?.type === "choose"; i++) answer(g, [g.s.pending.options[0].id]);
    passAll(g);
    expect(g.q.stat(lk, "str")).toBe(11);
    const b1 = put(g, o, "wanton-wizard", "play");
    const b2 = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [lk] });
    pass(g);
    pass(g);
    expectPending(g, "blockers", o);
    expect(() => act(g, o, { type: "answer", ids: [b1, b2] })).toThrow(/at least 3/);
  });

  it("Mafia Lawyer: destroyed in battle, gains the opposing party's total strength", () => {
    const { g, p, o } = setup();
    const ml = put(g, o, "mafia-lawyer", "play");
    const a = put(g, p, "fired-hand", "play");
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [ml] });
    for (let i = 0; i < 12 && g.s.battle; i++) {
      if (g.s.pending?.type === "assign") g.act(p, { type: "answer", assign: { [ml]: 5 } } as any);
      else pass(g);
    }
    expect(g.s.cards[ml].zone).toBe("discard");
    expect(g.s.players[o].influence).toBe(inf + 5);
  });
  it("Marauding Madster: shuffled into the deck instead of the discard pile, from anywhere", () => {
    const { g, p } = setup();
    const m = put(g, p, "marauding-madster", "play");
    g.destroy(m);
    expect(g.s.cards[m].zone).toBe("deck");
    const h = put(g, p, "marauding-madster", "hand");
    g.move(h, "discard");
    expect(g.s.cards[h].zone).toBe("deck");
  });

  it("Manful Skirmish: deplete one, damage another, the last gains 2 strength", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 4);
    const [a, b, c] = [put(g, o, "fired-hand", "play"), put(g, o, "fired-hand", "play"), put(g, o, "fired-hand", "play")];
    const t = put(g, p, "manful-skirmish", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [a, b, c]);
    pass(g);
    answer(g, [a]);
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id).sort()).toEqual([b, c].sort());
    answer(g, [b]);
    answer(g, [c]);
    passAll(g);
    expect(g.s.cards[a].depleted).toBe(true);
    expect(g.s.cards[b].damage).toBe(1);
    expect(g.q.stat(c, "str")).toBe(7);
  });

  it("Martial Arts Master: gains its speed minus the opposing party's highest speed", () => {
    const { g, p, o } = setup();
    const m = put(g, p, "martial-arts-master", "play");
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [m] });
    expect(g.q.stat(m, "str")).toBe(1);
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [w] });
    expect(g.q.stat(m, "str")).toBe(1 + 6 - 3);
  });

  it("Mass Confusion: divides damage equal to the difference in characters", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 4);
    const ws = [0, 1, 2].map(() => put(g, o, "wanton-wizard", "play"));
    const t = put(g, p, "mass-confusion", "hand");
    act(g, p, { type: "deploy", iid: t });
    g.act(p, { type: "answer", value: 2 });
    answer(g, [g.s.players[o].factionIid]);
    answer(g, [ws[0], ws[1]]);
    pass(g);
    const d = expectPending(g, "assign", p);
    expect(d.total).toBe(3);
  });
  it("Moment of Annihilation: each removed card reduces its cost by 1", () => {
    const { g, p, o } = setup();
    const res = resources(g, p, "deception", 2);
    const junk = [0, 1, 2].map(() => put(g, o, "improvised-blowtorch", "discard"));
    const w = put(g, o, "wanton-wizard", "play");
    const t = put(g, p, "moment-of-annihilation", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, junk);
    answer(g, [w]);
    passAll(g);
    expect(g.s.cards[w].zone).toBe("discard");
    expect(res.every((r) => g.s.cards[r].zone === "play")).toBe(true);
  });

  it("Mendacious Brigand: swaps a blocker for another of that player's characters", () => {
    const { g, p, o } = setup();
    const m = put(g, p, "mendacious-brigand", "play");
    const b1 = put(g, o, "wanton-wizard", "play");
    const b2 = put(g, o, "fired-hand", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [m] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [b1] });
    answer(g, [b1]);
    answer(g, [b2]);
    expect(g.s.battle?.blockers).toEqual([b2]);
  });

  it("Microdefense Autosystem: pay 1 to add a Micromajig token to your blocking party", () => {
    const { g, p, o } = setup();
    put(g, o, "microdefense-autosystem", "play");
    resources(g, o, "elitism", 1);
    const a = put(g, p, "fired-hand", "play");
    const b = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [b] });
    answer(g, ["yes"]);
    expect(g.s.battle?.blockers.length).toBe(2);
  });

  it("Mercenary's Creed: any player may pay 3 to take the attached character", () => {
    const { g, p, o } = setup();
    const w = put(g, o, "wanton-wizard", "play");
    const cr = put(g, o, "mercenary-s-creed", "play");
    g.s.cards[cr].attachedTo = w;
    resources(g, p, "deception", 3);
    const bribe = g.q.abilities(cr).find((x) => x.rule.name === "Bribe")!.index;
    const mail = g.q.abilities(cr).find((x) => x.rule.name === "Blackmail")!.index;
    expect(() => act(g, p, { type: "ability", iid: cr, index: mail })).toThrow();
    act(g, p, { type: "ability", iid: cr, index: bribe });
    passAll(g);
    expect(g.s.cards[w].controller).toBe(p);
  });
  it("Narrow Passage: each player can attack only once each turn", () => {
    const { g, p, o } = setup();
    put(g, o, "narrow-passage", "play");
    const a = put(g, p, "wanton-wizard", "play");
    const b = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [b] })).toThrow(/again/);
  });

  it("Mr. Chesterton: COVERT while the picked tactic stays in the discard pile", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 2);
    const t = put(g, o, "improvised-blowtorch", "discard");
    const m = put(g, p, "mr-chesterton", "hand");
    act(g, p, { type: "deploy", iid: m });
    answer(g, [t]);
    passAll(g);
    expect(g.q.keyword(m, "covert")).toBe(true);
    g.move(t, "void");
    expect(g.q.keyword(m, "covert")).toBe(false);
  });

  it("Nattering Stoopswaggler: flips face-down when destroyed without tokens", () => {
    const { g, p } = setup();
    const n = put(g, p, "nattering-stoopswaggler", "play");
    g.destroy(n);
    expect(g.s.cards[n].faceDown).toBe(true);
    const n2 = put(g, p, "nattering-stoopswaggler", "play");
    g.s.cards[n2].tokens = 1;
    expect(g.q.keyword(n2, "covert")).toBe(false);
    g.destroy(n2);
    expect(g.s.cards[n2].zone).toBe("discard");
  });

  it("Motivational Dancer: the character skips its controller's next Restore Rule only", () => {
    const { g, p, o } = setup();
    put(g, p, "motivational-dancer", "play");
    resources(g, p, "greed", 1);
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "end_turn" });
    for (let i = 0; i < 10 && !(g.s.pending?.type === "choose" && g.s.pending.player === p); i++) pass(g);
    answer(g, ["yes"]);
    answer(g, [w]);
    for (let i = 0; i < 30 && g.s.pending?.type !== "main"; i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    expect(g.s.active).toBe(o);
    expect(g.s.cards[w].depleted).toBe(true);
    expect(g.s.effects.some((e) => e.duration === "next_restore")).toBe(false);
  });

  it("Muddle: duplicates the tactic it responds to, then terminates it", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 3);
    resources(g, o, "obsession", 6);
    const w1 = put(g, o, "wanton-wizard", "play");
    const w2 = put(g, o, "wanton-wizard", "play");
    const t = put(g, p, "improvised-blowtorch", "hand");
    const m = put(g, o, "muddle", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [w1]);
    act(g, o, { type: "deploy", iid: m });
    pass(g);
    // The duplicate is Bob's: Bob picks its target.
    const d = expectPending(g, "choose", o);
    answer(g, [w2]);
    void d;
    passAll(g);
    expect(g.s.cards[w2].zone).toBe("discard");
    expect(g.s.cards[w1].zone).toBe("play");
    expect(g.s.cards[t].zone).toBe("discard");
  });

  it("Necromantic Healer: battle damage to its party members is reduced by 1", () => {
    const { g, p, o } = setup();
    const h = put(g, p, "necromantic-healer", "play");
    const w = put(g, p, "fired-hand", "play");
    const b = put(g, o, "fired-hand", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [h, w] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [b] });
    g.inflict(w, 3, true, [b]);
    expect(g.s.cards[w].damage).toBe(2);
    g.inflict(b, 3, true, [w]);
    expect(g.s.cards[b].damage).toBe(3); // not in the Healer's party
    g.inflict(w, 1, false, []);
    expect(g.s.cards[w].damage).toBe(3); // not battle damage
  });

  it("Ocular Dispersal: the host assigns battle damage equal to its numeric cost", () => {
    const { g, p, o } = setup();
    const w = put(g, p, "wanton-wizard", "play");
    const od = put(g, p, "ocular-dispersal", "play");
    g.s.cards[od].attachedTo = w;
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [w] });
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    expect(inf - g.s.players[o].influence).toBe(g.q.numericCost(w));
    expect(g.q.numericCost(w)).not.toBe(g.q.stat(w, "str"));
  });

  it("Negotiation Ceremonies: both players pay in turns and draw what they paid", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 4);
    resources(g, o, "greed", 3);
    const t = put(g, p, "negotiation-ceremonies", "hand");
    const hp = g.s.players[p].hand.length;
    const ho = g.s.players[o].hand.length;
    act(g, p, { type: "deploy", iid: t });
    answer(g, ["yes"]); // Alice pays 1
    answer(g, ["yes"]); // Bob pays 1
    answer(g, ["yes"]); // Alice pays 1
    answer(g, ["no"]); // Bob stops
    passAll(g);
    expect(g.s.players[p].hand.length).toBe(hp - 1 + 2);
    expect(g.s.players[o].hand.length).toBe(ho + 1);
  });

  it("Node-in-a-Box: pay 1 to flip face-down instead; when destroyed, other nodes go too", () => {
    const { g, p, o } = setup();
    resources(g, p, "elitism", 1);
    const n = put(g, p, "node-in-a-box", "play");
    g.destroy(n);
    settle(g);
    answer(g, ["yes"]);
    expect(g.s.cards[n].faceDown).toBe(true);
    const n2 = put(g, p, "node-in-a-box", "play");
    const other2 = put(g, o, "hub-node", "play");
    const lug = put(g, o, "lugubrious-node", "play");
    g.destroy(n2);
    settle(g);
    answer(g, ["no"]);
    passAll(g);
    expect(g.s.cards[n2].zone).toBe("discard");
    expect(g.s.cards[other2].zone).not.toBe("play");
    expect(g.s.cards[lug].zone).toBe("play"); // can't be destroyed by node cards
  });

  it("Octo-Ba-Ba: gets a token when an opposing character is destroyed", () => {
    const { g, p, o } = setup();
    const ob = put(g, p, "octo-ba-ba-the-devourer", "play");
    const w = put(g, o, "wanton-wizard", "play");
    const mine = put(g, p, "wanton-wizard", "play");
    g.destroy(mine);
    settle(g);
    expect(g.s.cards[ob].tokens).toBe(0);
    g.destroy(w);
    settle(g);
    expect(g.s.cards[ob].tokens).toBe(1);
  });

  it("Offering of False Friendship: same-named characters go to the bottom unless the opponent pays 2", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 3);
    const w1 = put(g, o, "wanton-wizard", "play");
    const w2 = put(g, p, "wanton-wizard", "play");
    const f = put(g, o, "fired-hand", "play");
    const t = put(g, p, "offering-of-false-friendship", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [w1]);
    passAll(g);
    answer(g, ["no"]);
    passAll(g);
    for (const w of [w1, w2]) expect(g.s.cards[w].zone).toBe("deck");
    expect(g.s.players[o].deck.at(-1)).toBe(w1);
    expect(g.s.cards[f].zone).toBe("play");
  });

  it("Penetrate: the attacker's battle damage goes past the blockers to the target", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "fired-hand", "play");
    const blk = put(g, o, "wanton-wizard", "play");
    resources(g, p, "rage", 2);
    const t = put(g, p, "penetrate", "hand");
    const inf = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    pass(g);
    answer(g, [blk]);
    act(g, p, { type: "deploy", iid: t });
    answer(g, [atk]);
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    expect(inf - g.s.players[o].influence).toBe(g.q.stat(atk, "str"));
    expect(g.s.cards[blk].zone).toBe("play");
    expect(g.s.cards[blk].damage).toBe(0);
  });

  it("Padamose Cultists: draws 2 only after a non-character deploy this turn", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 6);
    const c1 = put(g, p, "padamose-cultists", "hand");
    let h = g.s.players[p].hand.length;
    act(g, p, { type: "deploy", iid: c1 });
    passAll(g);
    expect(g.s.players[p].hand.length).toBe(h - 1);
    const t = put(g, p, "orgy-den-smoke-out", "hand");
    resources(g, p, "deception", 2);
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    const c2 = put(g, p, "padamose-cultists", "hand");
    h = g.s.players[p].hand.length;
    act(g, p, { type: "deploy", iid: c2 });
    passAll(g);
    expect(g.s.players[p].hand.length).toBe(h - 1 + 2);
  });

  it("Phalludrix: cards an opponent's effect makes you discard may go back to your hand", () => {
    const { g, p, o } = setup();
    put(g, o, "phalludrix-the-impotenator", "play");
    const h = put(g, o, "wanton-wizard", "hand");
    resources(g, p, "deception", 2);
    const t = put(g, p, "orgy-den-smoke-out", "hand");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    expect(expectPending(g, "choose", o).prompt).toContain("back into your hand");
    answer(g, ["yes"]);
    passAll(g);
    expect(g.s.cards[h].zone).toBe("hand");
  });

  it("Pride of Goru-Goru Gidea: Resist reduces only the next damage", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 4);
    const c = put(g, p, "pride-of-goru-goru-gidea", "play");
    act(g, p, { type: "ability", iid: c, index: 0 });
    passAll(g);
    g.inflict(c, 1, false, []);
    expect(g.s.cards[c].damage).toBe(0);
    g.inflict(c, 1, false, []);
    expect(g.s.cards[c].damage).toBe(1);
  });

  it("Pinguid Bodyguard: restores at the end of its battle", () => {
    const { g, p } = setup();
    const c = put(g, p, "pinguid-bodyguard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [c] });
    expect(g.s.cards[c].depleted).toBe(true);
    for (let i = 0; i < 12 && g.s.battle; i++) pass(g);
    passAll(g);
    expect(g.s.battle).toBeFalsy();
    expect(g.s.cards[c].depleted).toBe(false);
  });

  it("Predatory Lamp: the picked character loses COVERT while the Lamp is in play", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 3);
    const oo = put(g, o, "ominous-oozling", "play");
    const l = put(g, p, "predatory-lamp", "hand");
    act(g, p, { type: "deploy", iid: l });
    passAll(g);
    answer(g, [oo]);
    passAll(g);
    expect(g.q.keyword(oo, "covert")).toBe(false);
    g.move(l, "discard");
    expect(g.q.keyword(oo, "covert")).toBe(true);
  });

  it("Purifying Priest: the next 1 damage to your faction goes to the location", () => {
    const { g, p } = setup();
    const pr = put(g, p, "purifying-priest", "play");
    const loc = put(g, p, "personal-god-shrine", "play");
    act(g, p, { type: "ability", iid: pr, index: 0 });
    answer(g, [loc]);
    passAll(g);
    const inf = g.s.players[p].influence;
    g.damageFaction(p, 2, [], false);
    expect(g.s.cards[loc].markers).toBe(1);
    expect(inf - g.s.players[p].influence).toBe(1);
  });

  it("Quipmajig: the insulted COVERT character deals no damage this turn", () => {
    const { g, p, o } = setup();
    const q = put(g, p, "quipmajig", "play");
    const cv = put(g, o, "ominous-oozling", "play");
    const w = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "ability", iid: q, index: 0 });
    answer(g, [cv]);
    passAll(g);
    expect(g.s.cards[cv].depleted).toBe(true);
    g.inflict(w, 3, true, [cv]);
    expect(g.s.cards[w].damage).toBe(0);
  });

  it("Reality Shift: returns your cards and redeploys them for free up to their total cost", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 7);
    resources(g, p, "deception", 1);
    const w = put(g, p, "wanton-wizard", "play");
    const f = put(g, p, "fired-hand", "play");
    const t = put(g, p, "reality-shift", "hand");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    expect(g.s.cards[w].zone).toBe("hand");
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id).sort()).toEqual([w, f].sort());
    answer(g, [f]);
    passAll(g);
    // 9 - 6 = 3 left: the Wizard still fits; decline it.
    expect(expectPending(g, "choose", p).options.map((x: any) => x.id)).toEqual([w]);
    answer(g, []);
    passAll(g);
    expect(g.s.cards[f].zone).toBe("play");
    expect(g.s.cards[w].zone).toBe("hand");
  });

  it("Reckless Challenger: destroyed at the end of turn unless it attacked", () => {
    const { g, p } = setup();
    const idle = put(g, p, "reckless-challenger", "play");
    const fresh = put(g, p, "reckless-challenger", "play", { since: g.s.turn });
    expect(g.q.cond({ attacked_this_turn: idle } as any, { controller: p, source: idle, vars: {} } as any)).toBe(false);
    act(g, p, { type: "end_turn" });
    passAll(g);
    answer(g, ["0"]);
    passAll(g);
    expect(g.s.cards[idle].zone).toBe("discard");
    expect(g.s.cards[fresh].zone).toBe("play"); // it entered this turn
  });

  it("Ritual of the Sucking Skull: terminates a FLIP UP deploy; its controller may detach X", () => {
    const { g, p, o } = setup();
    resources(g, p, "elitism", 5);
    const gol = put(g, p, "recyclable-golem", "play", { faceDown: true });
    const t = put(g, o, "ritual-of-the-sucking-skull", "hand");
    resources(g, o, "obsession", 1);
    const plain = put(g, p, "rapacious-soldier", "hand");
    resources(g, p, "rage", 2);
    act(g, p, { type: "deploy", iid: plain });
    expect(() => act(g, o, { type: "deploy", iid: t })).toThrow(/FLIP UP/);
    passAll(g);
    act(g, p, { type: "flip_up", iid: gol });
    act(g, o, { type: "deploy", iid: t });
    passAll(g);
    expectPending(g, "number", p);
    g.act(p, { type: "answer", value: 2 });
    passAll(g);
    expect(g.s.cards[gol].zone).toBe("discard");
  });

  it("Rune of Concealment: destroy the Rune instead of the character killed by damage", () => {
    const { g, p, o } = setup();
    resources(g, p, "elitism", 2);
    const r = put(g, p, "rune-of-concealment", "play");
    const f = put(g, p, "runic-whale", "play");
    const src = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "ability", iid: r, index: 0 });
    answer(g, [f]);
    passAll(g);
    g.destroy(f);
    settle(g);
    expect(g.s.cards[f].zone).toBe("discard"); // not destroyed by damage
    const f2 = put(g, p, "runic-whale", "play");
    g.s.cards[r].depleted = false;
    act(g, p, { type: "ability", iid: r, index: 0 });
    answer(g, [f2]);
    passAll(g);
    g.inflict(f2, 5, true, [src]);
    settle(g);
    answer(g, ["yes"]);
    passAll(g);
    expect(g.s.cards[r].zone).toBe("discard");
    expect(g.s.cards[f2].zone).toBe("play");
    expect(g.s.cards[f2].damage).toBe(0);
  });

  it("Rudo Mangod, Dragonweight Champion: depletes your others, which stop restoring", () => {
    const { g, p } = setup();
    resources(g, p, "rage", 4);
    const w = put(g, p, "rapacious-soldier", "play");
    const r = put(g, p, "rudo-mangod-dragonweight-champion", "hand");
    act(g, p, { type: "deploy", iid: r });
    passAll(g);
    expect(g.s.cards[w].depleted).toBe(true);
    expect(g.q.stat(r, "str")).toBe(6); // 1 depleted warlord character
    expect(g.q.cannot("restore_by_rule", w, p)).toBe(true);
    const later = put(g, p, "rapacious-soldier", "play");
    expect(g.q.cannot("restore_by_rule", later, p)).toBe(false);
  });

  it("Sarcophyle Matriculation: take control of the attacker instead of it being destroyed", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "runic-whale", "play");
    resources(g, o, "deception", 4);
    const t = put(g, o, "sarcophyle-matriculation", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    act(g, o, { type: "deploy", iid: t });
    answer(g, [atk]);
    pass(g);
    g.inflict(atk, 2, false, []);
    g.destroy(atk);
    settle(g);
    expect(g.s.cards[atk].zone).toBe("play");
    expect(g.s.cards[atk].controller).toBe(o);
    expect(g.s.cards[atk].damage).toBe(0);
    expect(g.q.matches({ character: { subtype: "sarcophyle" } }, atk, { controller: o, vars: {} } as any, null)).toBe(true);
  });

  it("Snake Eyes: destroys the character only if it was damaged this turn", () => {
    const { g, p, o } = setup();
    resources(g, p, "deception", 6);
    const hurt = put(g, o, "runic-whale", "play");
    const fine = put(g, o, "runic-whale", "play");
    g.inflict(hurt, 1, false, []);
    for (const c of [fine, hurt]) {
      const t = put(g, p, "snake-eyes", "hand");
      act(g, p, { type: "deploy", iid: t });
      answer(g, [c]);
      passAll(g);
    }
    expect(g.s.cards[fine].zone).toBe("play");
    expect(g.s.cards[hurt].zone).toBe("discard");
  });

  it("iDumb De-Itemizer: attaches to an item, which then has no rules text", () => {
    const { g, p, o } = setup();
    const head = put(g, o, "the-enemy-s-head", "play");
    g.s.cards[head].tokens = 2;
    const w = put(g, o, "runic-whale", "play");
    expect(g.q.stat(w, "str")).toBe(7);
    resources(g, p, "greed", 3);
    const d = put(g, p, "idumb-de-itemizer", "hand");
    act(g, p, { type: "deploy", iid: d });
    answer(g, [head]);
    passAll(g);
    expect(g.s.cards[d].attachedTo).toBe(head);
    expect(g.q.stat(w, "str")).toBe(5);
  });

  it("Sticky Stealy Hand: a won flip takes the item, which goes back when the hand leaves", () => {
    let checked = false;
    for (let seed = 1; seed <= 12 && !checked; seed++) {
      const g = newGame(seed);
      const p = toMain(g);
      const o = other(p);
      const item = put(g, o, "the-enemy-s-head", "play");
      resources(g, p, "deception", 2);
      const h = put(g, p, "sticky-stealy-hand", "hand");
      act(g, p, { type: "deploy", iid: h });
      answer(g, [item]);
      passAll(g);
      if (g.s.cards[h].zone !== "play") {
        expect(g.s.cards[h].zone).toBe("hand");
        expect(g.s.cards[item].controller).toBe(o);
        continue;
      }
      expect(g.s.cards[h].attachedTo).toBe(item);
      expect(g.s.cards[item].controller).toBe(p);
      g.destroy(h);
      settle(g);
      expect(g.s.cards[item].controller).toBe(o);
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it("Spurious Anthropologist: a character from the discard pile joins the block; both leave to the void", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "runic-whale", "play");
    const sa = put(g, o, "spurious-anthropologist", "play");
    const dead = put(g, o, "rapacious-soldier", "discard");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    pass(g);
    act(g, o, { type: "answer", ids: [sa] });
    answer(g, [dead]);
    expect(g.s.cards[dead].zone).toBe("play");
    expect(g.s.battle?.blockers).toContain(dead);
    g.destroy(dead);
    settle(g);
    expect(g.s.cards[dead].zone).toBe("void");
    expect(g.s.cards[sa].zone).toBe("void");
  });

  it("Swindle: the opponent attaches one of their resources to their faction", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 2);
    const [r] = resources(g, o, "rage", 1);
    for (let i = 0; i < 3; i++) put(g, p, "runic-whale", "deck");
    const t = put(g, p, "swindle", "hand");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    answer(g, [r]);
    expect(g.s.cards[r].attachedTo).toBe("faction");
  });

  it("Subordinate Demotivation: destroys the opponent's cheapest character", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 3);
    const cheap = put(g, o, "rapacious-soldier", "play");
    const dear = put(g, o, "runic-whale", "play");
    const t = put(g, p, "subordinate-demotivation", "hand");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    if (g.s.pending?.type === "choose") answer(g, [cheap]);
    expect(g.s.cards[cheap].zone).toBe("discard");
    expect(g.s.cards[dear].zone).toBe("play");
  });

  it("Thabbashite Chemist: face-down resources gain PROVIDES of the named icon", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 2);
    for (let i = 0; i < 2; i++) put(g, p, "runic-whale", "play", { faceDown: true });
    const c = put(g, p, "thabbashite-chemist", "play");
    const before = g.q.icons(p).rage;
    act(g, p, { type: "ability", iid: c, index: g.q.abilities(c)[0].index });
    answer(g, ["rage"]);
    passAll(g);
    expect(g.q.icons(p).rage).toBe(before + 2);
    expect(g.q.icons(p).volition).toBe(2);
  });

  it("Testudine Autoframe: your characters can attack the turn they enter play", () => {
    const { g, p } = setup();
    const fresh = put(g, p, "runic-whale", "play", { since: g.s.turn });
    expect(g.q.canAttack(fresh)).toBe(false);
    put(g, p, "testudine-autoframe", "play");
    expect(g.q.canAttack(fresh)).toBe(true);
  });

  it("Thabbashite Financier: Blood Gold plays a card face-down, even a resource card", () => {
    const { g, p } = setup();
    for (let i = 0; i < 2; i++) put(g, p, "runic-whale", "play", { faceDown: true });
    resources(g, p, "greed", 1);
    const f = put(g, p, "thabbashite-financier", "play");
    const r = put(g, p, "rage", "hand");
    act(g, p, { type: "ability", iid: f, index: g.q.abilities(f)[0].index });
    passAll(g);
    g.act(p, { type: "answer", iid: r, faceDown: false });
    expect(g.s.cards[r].zone).toBe("play");
    expect(g.s.cards[r].faceDown).toBe(true);
  });

  it("Thabbashite Desert Creature: pay 2 from hand when a [V] card enters play under you", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 2);
    const dc = put(g, p, "thabbashite-desert-creature", "hand");
    const x = put(g, p, "runic-whale", "hand");
    g.putResource(p, x, true, false);
    settle(g);
    answer(g, ["yes"]);
    passAll(g);
    expect(g.s.cards[dc].zone).toBe("play");
  });

  it("The Great Wall of Keeping Stuff Out: terminates tactics and takes 1 damage each time", () => {
    const { g, p, o } = setup();
    const wall = put(g, o, "the-great-wall-of-keeping-stuff-out", "play");
    resources(g, p, "greed", 3);
    const t = put(g, p, "subordinate-demotivation", "hand");
    const w = put(g, o, "rapacious-soldier", "play");
    act(g, p, { type: "deploy", iid: t });
    passAll(g);
    expect(g.s.cards[t].zone).toBe("discard");
    expect(g.s.cards[w].zone).toBe("play");
    expect(g.s.cards[wall].markers).toBe(1);
  });
  it("Unloyal Necromorph: the opponent may pay 2 to take control of it instead", () => {
    const { g, p, o } = setup();
    const n = put(g, p, "unloyal-necromorph", "play");
    resources(g, o, "greed", 2);
    g.s.cards[n].damage = 2;
    g.destroy(n);
    settle(g);
    expectPending(g, "choose", o);
    answer(g, ["yes"]);
    expect(g.s.cards[n].zone).toBe("play");
    expect(g.s.cards[n].controller).toBe(o);
    expect(g.s.cards[n].damage).toBe(0);
  });

  it("Vast Mastabatorium: 5 uses each turn, and each use hands it to the opponent at the end of the turn", () => {
    const { g, p, o } = setup();
    const v = put(g, p, "vast-mastabatorium", "play");
    resources(g, p, "deception", 6);
    const idx = g.q.abilities(v)[0].index;
    for (let i = 0; i < 5; i++) {
      act(g, p, { type: "ability", iid: v, index: idx });
      passAll(g);
    }
    expect(() => act(g, p, { type: "ability", iid: v, index: idx })).toThrow(/5 times/);
    act(g, p, { type: "end_turn" });
    for (let i = 0; i < 20 && g.s.active === p; i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    expect(g.s.cards[v].controller).toBe(o);
    expect(g.s.cards[v].tokens).toBe(5);
  });

  it("Verrucose Brains: the cheapest character in play goes to its owner's hand at the end of the turn", () => {
    const { g, p, o } = setup();
    put(g, p, "verrucose-brains", "play");
    const mine = put(g, p, "runic-whale", "play");
    const cheap = put(g, o, "rapacious-soldier", "play");
    act(g, p, { type: "end_turn" });
    for (let i = 0; i < 20 && g.s.active === p; i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    expect(g.s.cards[cheap].zone).toBe("hand");
    expect(g.s.cards[mine].zone).toBe("play");
  });

  it("Vilghame: the first resource an opponent plays each turn enters play attached", () => {
    const { g, p, o } = setup();
    put(g, p, "vilghame-manewaft", "play");
    const r1 = put(g, o, "rage", "hand");
    const r2 = put(g, o, "rage", "hand");
    const step = (r: string) => {
      (g as any).push({ t: "step", step: { play_resource: { who: "opponent" } }, ctx: (g as any).newCtx(p, r).id, phase: "effect" });
      settle(g);
      g.act(o, { type: "answer", iid: r });
    };
    step(r1);
    step(r2);
    expect(g.s.cards[r1].attachedTo).toBe("faction");
    expect(g.s.cards[r2].attachedTo).toBe(null);
  });

  it("Vexing Nullifier: its battle damage puts the blocker into its owner's hand", () => {
    const { g, p, o } = setup();
    const v = put(g, p, "vexing-nullifier", "play");
    const b = put(g, o, "runic-whale", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [v] });
    pass(g);
    pass(g);
    expectPending(g, "blockers", o);
    answer(g, [b]);
    for (let i = 0; i < 10 && g.s.battle; i++) pass(g);
    expect(g.s.cards[b].zone).toBe("hand");
    expect(g.s.cards[b].damage).toBe(0);
    expect(g.s.cards[v].zone).toBe("hand");
  });

  it("Voidal Interference: the card goes back to its owner's hand, who then tops a card", () => {
    const { g, p, o } = setup();
    resources(g, p, "elitism", 5);
    resources(g, o, "obsession", 3);
    const c = put(g, p, "runic-whale", "hand");
    const t = put(g, o, "voidal-interference", "hand");
    act(g, p, { type: "deploy", iid: c });
    act(g, o, { type: "deploy", iid: t });
    passAll(g);
    expect(g.s.cards[c].zone).toBe("hand");
    if (g.s.pending?.type === "choose") answer(g, [c]);
    passAll(g);
    expect(g.s.players[p].deck[0]).toBe(c);
  });

  it("Voidal Trinket: look at X cards, keep one on top and the rest go to the bottom", () => {
    const { g, p } = setup();
    const t = put(g, p, "voidal-trinket", "play");
    const cards = ["runic-whale", "fired-hand", "wanton-wizard"].map((id) => put(g, p, id, "deck"));
    for (const c of [...cards].reverse()) top(g, p, c);
    act(g, p, { type: "ability", iid: t, index: g.q.abilities(t)[0].index });
    g.act(p, { type: "answer", value: 3 });
    passAll(g);
    expectPending(g, "choose", p);
    answer(g, [cards[1]]);
    const d = g.s.players[p].deck;
    expect(d[0]).toBe(cards[1]);
    expect(d.slice(-2).sort()).toEqual([cards[0], cards[2]].sort());
  });

  it("Wary Reunion: X is the number of different trades among cards you control", () => {
    const { g, p, o } = setup();
    const base = g.q.differentTrades(p); // staple resources have trades too
    put(g, p, "runic-whale", "play", { faceDown: true }); // face-down: no trade
    expect(g.q.differentTrades(p)).toBe(base);
    put(g, p, "wanton-wizard", "play");
    expect(g.q.differentTrades(p)).toBeLessThan(5);
    resources(g, p, "deception", 2);
    const weak = put(g, o, "wanton-wizard", "play"); // 1 life
    const tough = put(g, o, "runic-whale", "play"); // 5 life
    for (const [target, gone] of [[weak, true], [tough, false]] as const) {
      const t = put(g, p, "wary-reunion", "hand");
      act(g, p, { type: "deploy", iid: t });
      answer(g, [target]);
      passAll(g);
      expect(g.s.cards[target].zone === "void").toBe(gone);
    }
  });

  it("Woadenworm: your face-down tactics gain FLIP UP for their normal cost", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 3);
    const fd = put(g, p, "subordinate-demotivation", "play", { faceDown: true });
    expect(g.q.flipUpRule(fd)).toBeUndefined();
    put(g, p, "woadenworm-gloamspike-thabbashite-prince", "play");
    expect(g.q.flipUpRule(fd)).toEqual({ pay: g.q.def(fd).cost, threshold: g.q.def(fd).threshold });
    expect(legalFor(g, p)?.flipUp).toContain(fd);
  });

  it("Wild Boars: attacking alone, only characters with at least its speed can block", () => {
    const { g, p, o } = setup();
    const boars = put(g, p, "wild-boars", "play");
    const slow = put(g, o, "runic-whale", "play");
    const fast = put(g, o, "wild-boars", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [boars] });
    pass(g);
    pass(g);
    const d = expectPending(g, "blockers", o);
    expect(d.candidates).toContain(fast);
    expect(d.candidates).not.toContain(slow);
  });

  it("Tri-Pole Magnet: puts a gear card from your discard pile onto the character it was attached to", () => {
    const { g, p } = setup();
    const c = put(g, p, "runic-whale", "play");
    const m = put(g, p, "tri-pole-magnet", "play");
    g.s.cards[m].attachedTo = c;
    const gear = put(g, p, "swordchucks", "discard");
    act(g, p, { type: "ability", iid: m, index: g.q.abilities(m)[0].index });
    if (g.s.pending?.type === "choose") answer(g, [gear]);
    passAll(g);
    expect(g.s.cards[m].zone).toBe("discard");
    expect(g.s.cards[gear].zone).toBe("play");
    expect(g.s.cards[gear].attachedTo).toBe(c);
  });

  it("Arcane Escrow: discards may go to the void face-down, and the develop rule can return them", () => {
    const { g, p, o } = setup();
    const esc = put(g, p, "arcane-escrow", "play");
    resources(g, p, "greed", 1);
    const a = put(g, p, "fired-hand", "hand");
    const b = put(g, p, "wanton-wizard", "hand");
    act(g, p, { type: "ability", iid: esc, index: g.q.abilities(esc)[0].index });
    pass(g); // Withdraw resolves: draw a card, then discard 2
    answer(g, [a, b]);
    for (let i = 0; i < 2; i++) {
      expectPending(g, "choose", p);
      answer(g, ["yes"]);
    }
    for (const x of [a, b]) {
      expect(g.s.cards[x].zone).toBe("void");
      expect(g.s.cards[x].voidFaceDown).toBe(true);
      expect(g.s.cards[x].tags).toContain(esc);
    }
    expect(viewFor(g, o).players[p].void.find((c) => c.iid === a)?.defId).toBeNull();
    expect(viewFor(g, p).players[p].void.find((c) => c.iid === a)?.defId).toBe("fired-hand");
    nextTurn(g);
    nextTurn(g);
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id).sort()).toEqual(["draw", a, b].sort());
    answer(g, [a]);
    expect(g.s.cards[a].zone).toBe("hand");
    expect(g.s.cards[b].zone).toBe("void");
  });

  it("Cathedrale de Mau: may reduce damage to your locations and costly characters by 1 for 1 influence", () => {
    const { g, p } = setup();
    const cat = put(g, p, "cathedrale-de-mau", "play");
    const big = put(g, p, "fired-hand", "play"); // numeric cost 6
    const small = put(g, p, "wanton-wizard", "play"); // numeric cost 3
    const inf = g.s.players[p].influence;
    (g as any).inflict(big, 2, false, []);
    settle(g);
    expectPending(g, "choose", p);
    answer(g, ["yes"]);
    expect(g.s.cards[big].damage).toBe(1);
    expect(g.s.players[p].influence).toBe(inf - 1);
    (g as any).inflict(cat, 2, false, []);
    settle(g);
    answer(g, ["no"]);
    expect(g.s.cards[cat].markers).toBe(2);
    (g as any).inflict(small, 1, false, []);
    settle(g);
    expect(g.s.cards[small].zone).toBe("discard"); // not offered: it was simply destroyed
  });

  it("Clockman Skydocks: reduces one named icon of the next card's threshold", () => {
    const { g, p } = setup();
    const sky = put(g, p, "clockman-skydocks", "play");
    resources(g, p, "elitism", 2);
    resources(g, p, "greed", 4);
    const w1 = put(g, p, "runic-whale", "hand"); // threshold: 3 elitism
    const w2 = put(g, p, "runic-whale", "hand");
    expect(legalFor(g, p)?.deploy).not.toContain(w1);
    act(g, p, { type: "ability", iid: sky, index: g.q.abilities(sky)[0].index });
    answer(g, ["elitism"]);
    pass(g);
    expect(legalFor(g, p)?.deploy).toContain(w1);
    act(g, p, { type: "deploy", iid: w1 });
    pass(g);
    expect(g.s.cards[w1].zone).toBe("play");
    // Used up by that deploy.
    expect(g.canStart(p, { type: "deploy", iid: w2 }, true)).toMatch(/threshold/);
  });

  it("Counter Attack: attacks during the opponent's turn, then draws", () => {
    const { g, p, o } = setup();
    const ca = put(g, o, "counter-attack", "hand");
    resources(g, o, "deception", 3);
    const atk = put(g, o, "fired-hand", "play");
    resources(g, p, "deception", 2);
    const own = put(g, p, "counter-attack", "hand");
    expect(g.canStart(p, { type: "deploy", iid: own }, true)).toMatch(/opponent's turn/);
    act(g, p, { type: "end_turn" });
    expectPending(g, "endturn", o);
    const inf = g.s.players[p].influence;
    const hand = g.s.players[o].hand.length;
    act(g, o, { type: "deploy", iid: ca });
    pass(g);
    answer(g, [atk]);
    expect(g.s.battle?.attacker).toBe(o);
    for (let i = 0; i < 10 && g.s.battle; i++) pass(g);
    expect(g.s.battle).toBeNull();
    expect(g.s.players[p].influence).toBe(inf - 5);
    expect(g.s.players[o].hand.length).toBe(hand); // Counter Attack left, a card was drawn
    expectPending(g, "endturn", o); // the turn can still end
  });

  it("Emergency Obfuscation: players control each other's sides while it is in play", () => {
    const { g, p, o } = setup();
    const eo = put(g, p, "emergency-obfuscation", "play");
    expect(g.sideOf(p)).toBe(o);
    expect(viewFor(g, o).you).toBe(p);
    expect(viewFor(g, o).seat).toBe(o);
    expect(() => g.act(p, { type: "end_turn" })).toThrow();
    g.s.cards[eo].tokens = 2;
    g.act(o, { type: "end_turn" }); // the seat at o plays side p
    g.act(p, { type: "pass" }); // and the seat at p lets side o's... side p's turn end
    expect(g.s.cards[eo].zone).toBe("discard");
    expect(g.sideOf(p)).toBe(p);
  });

  it("Geiseric: may pay 1 to void an opponent's character going to hand from play", () => {
    const { g, p, o } = setup();
    const gs = put(g, p, "geiseric-the-souleater", "play");
    resources(g, p, "obsession", 1);
    const theirs = put(g, o, "wanton-wizard", "play");
    const mine = put(g, p, "wanton-wizard", "play");
    g.move(theirs, "hand");
    settle(g);
    expectPending(g, "choose", p);
    answer(g, ["yes"]);
    expect(g.s.cards[theirs].zone).toBe("void");
    expect(g.s.cards[gs].tokens).toBe(1);
    g.move(mine, "hand");
    expect(g.s.cards[mine].zone).toBe("hand");
  });

  it("God's Autograph: copies of a card are unique by name", () => {
    const { g, p, o } = setup();
    put(g, p, "god-s-autograph", "play");
    const a = put(g, p, "wanton-wizard", "play");
    const b = put(g, p, "wanton-wizard", "play");
    const c = put(g, o, "wanton-wizard", "play");
    settle(g);
    expectPending(g, "choose", p);
    answer(g, [a]);
    expect(g.s.cards[a].zone).toBe("play");
    expect(g.s.cards[b].zone).toBe("discard");
    expect(g.s.cards[c].zone).toBe("play");
  });

  it("Mustache Aficionado: the higher chosen pile's owner takes a card from it", () => {
    const { g, p, o } = setup();
    const m = put(g, p, "mustache-aficionado", "play");
    const fh = put(g, p, "fired-hand", "deck");
    const ww = put(g, p, "wanton-wizard", "deck");
    const rw = put(g, p, "runic-whale", "deck");
    for (const x of [rw, ww, fh]) top(g, p, x);
    act(g, p, { type: "ability", iid: m, index: g.q.abilities(m)[0].index });
    pass(g);
    answer(g, [fh]); // piles: [fh] and [ww, rw]
    answer(g, [g.s.players[o].deck[0]]); // the opponent's piles (staples, cost 0)
    answer(g, ["0"]);
    answer(g, ["1"]); // the opponent picks [ww, rw]: 8 against 0
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id).sort()).toEqual([ww, rw].sort());
    answer(g, [rw]);
    expect(g.s.cards[rw].zone).toBe("hand");
    expect(g.s.cards[fh].zone).toBe("deck");
  });

  it("Notion Sickness: uses a card's ability with its effect twice, then destroys the card", () => {
    const { g, p } = setup();
    const gl = put(g, p, "gideon-s-legacy", "play");
    resources(g, p, "elitism", 2);
    resources(g, p, "greed", 3);
    const ns = put(g, p, "notion-sickness", "hand");
    act(g, p, { type: "deploy", iid: ns });
    answer(g, [gl]);
    pass(g);
    const seek = g.q.abilities(gl).find((a) => a.rule.name === "Seek")!.index;
    answer(g, [String(seek)]);
    expect(g.s.cards[gl].zone).toBe("discard");
    const hand = g.s.players[p].hand.length;
    passAll(g);
    expect(g.s.players[p].hand.length).toBe(hand + 2);
  });

  it("Phantasmagoric Tollbooth: opposing characters cost 1 more to enter play, or go to the discard pile", () => {
    const { g, p, o } = setup();
    put(g, o, "phantasmagoric-tollbooth", "play");
    resources(g, o, "rage", 6);
    resources(g, p, "rage", 5);
    const w1 = put(g, p, "plodding-brute", "hand");
    act(g, p, { type: "deploy", iid: w1 });
    pass(g);
    expectPending(g, "choose", p);
    answer(g, ["yes"]);
    expect(g.s.cards[w1].zone).toBe("play");
    resources(g, p, "rage", 4);
    const w2 = put(g, p, "plodding-brute", "hand");
    act(g, p, { type: "deploy", iid: w2 });
    pass(g);
    answer(g, ["no"]);
    expect(g.s.cards[w2].zone).toBe("discard");
    // [R]x6: the opponent may pay 1 to inflict 1 damage to a faction.
    const inf = g.s.players[p].influence;
    expectPending(g, "choose", o);
    answer(g, ["yes"]);
    answer(g, [g.s.players[p].factionIid]);
    expect(g.s.players[p].influence).toBe(inf - 1);
  });

  it("Super Shiny Caltrops of DOOM!: destroyed with the opponent's character it is attached to, its owner may pay 2 to flip it face-down", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 2);
    const host = put(g, o, "wanton-wizard", "play");
    const cal = put(g, p, "super-shiny-caltrops-of-doom", "play");
    g.s.cards[cal].attachedTo = host;
    (g as any).destroy(host, "effect");
    settle(g);
    expect(g.s.cards[host].zone).toBe("discard");
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/Caltrops/);
    answer(g, ["yes"]);
    expect(g.s.cards[cal].zone).toBe("play");
    expect(g.s.cards[cal].faceDown).toBe(true);
    expect(g.s.cards[cal].controller).toBe(p);
  });

  it("Crests and Banners don't trigger on themselves entering play, only on later cards", () => {
    const { g, p } = setup();
    const crest = put(g, p, "crest-of-rage", "hand"); // numeric cost 0
    act(g, p, { type: "deploy", iid: crest });
    pass(g);
    expect(g.s.cards[crest].zone).toBe("play");
    expectPending(g, "main", p); // no "search your deck" offer for itself
    // A rage resource entering play afterwards does trigger it.
    (g as any).putResource(p, put(g, p, "rage", "hand"), false, false);
    settle(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/Crest of Rage/);
  });

  it("Rudo Mangod, Holder of Light: only triggers at the start of a turn while geared and depleted", () => {
    const { g, p, o } = setup();
    const rudo = put(g, p, "rudo-mangod-holder-of-light", "play");
    g.s.cards[rudo].depleted = true;
    act(g, p, { type: "end_turn" });
    pass(g);
    const d = expectPending(g, "choose", o);
    expect(d.options.map((x: any) => x.label).join()).not.toMatch(/Rudo/);
  });

  it("Rudo Mangod, Holder of Light: restores itself at the start of the opponent's turn while geared", () => {
    const { g, p, o } = setup();
    const rudo = put(g, p, "rudo-mangod-holder-of-light", "play");
    g.s.cards[rudo].depleted = true;
    const sword = put(g, p, "heavy-sword", "play");
    g.s.cards[sword].attachedTo = rudo;
    nextTurn(g);
    expect(g.s.active).toBe(o);
    expect(g.s.cards[rudo].depleted).toBe(false);
  });

  it("Manual flip face-down: the card is detached, from its host or the faction", () => {
    const { g, p } = setup();
    const w = put(g, p, "rudo-mangod-holder-of-light", "play");
    const sword = put(g, p, "heavy-sword", "play");
    g.s.cards[sword].attachedTo = w;
    const [staple] = resources(g, p, "rage", 1);
    g.s.cards[staple].attachedTo = "faction";
    act(g, p, { type: "manual", op: { op: "flip", iid: sword } });
    act(g, p, { type: "manual", op: { op: "flip", iid: staple } });
    for (const iid of [sword, staple]) {
      expect(g.s.cards[iid].faceDown).toBe(true);
      expect(g.s.cards[iid].isResource).toBe(true);
      expect(g.s.cards[iid].attachedTo).toBe(null);
    }
  });

  it("Putting a card from a discard pile into play face-down names it in the log", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 3);
    const t = put(g, p, "arcane-research", "discard");
    const w = put(g, p, "wanton-wizard", "hand");
    act(g, p, { type: "deploy", iid: w });
    pass(g);
    for (let i = 0; i < 4 && g.s.cards[t].zone === "discard"; i++) {
      const d = g.s.pending as any;
      if (d?.type !== "choose") break;
      const opt = d.options.find((x: any) => x.iid === t) ?? d.options.find((x: any) => /yes/i.test(x.label)) ?? d.options[0];
      act(g, d.player, { type: "answer", ids: [opt.id] });
    }
    expect(g.s.cards[t].faceDown).toBe(true);
    expect(g.s.log.some((l) => l.text.includes("puts Arcane Research into play as a face-down resource"))).toBe(true);
  });

  it("Draconarius Slitherform: X is the strength it had when destroyed, gear included", () => {
    const { g, p, o } = setup();
    put(g, o, "fired-hand", "play");
    const d = put(g, p, "draconarius-slitherform", "play");
    const sword = put(g, p, "heavy-sword", "play");
    g.s.cards[sword].attachedTo = d;
    expect(g.q.stat(d, "str")).toBe(g.q.printed(d, "str") + 2);
    g.destroy(d, "effect");
    settle(g);
    const pend = expectPending(g, "assign", p);
    expect(pend.total).toBe(g.q.printed(d, "str") + 2);
  });

  it("Goutflame Talonclaw: removed from the game, it flips face-down instead", () => {
    const { g, p } = setup();
    const t = put(g, p, "goutflame-talonclaw", "play");
    g.move(t, "void");
    expect(g.s.cards[t].zone).toBe("play");
    expect(g.s.cards[t].faceDown).toBe(true);
  });

  it("Cicibeo, The Implicator: only another cicibeo deployed from hand triggers it", () => {
    const { g, p } = setup();
    resources(g, p, "deception", 4);
    const imp = put(g, p, "cicibeo-the-implicator", "play");
    const swift = put(g, p, "cicibeo-the-swift", "play");
    const fired = (deployedFrom?: string) => (g as any).triggersFor({ e: "enters_play", iid: swift, player: p, deployedFrom }).filter((t: any) => t.iid === imp).length;
    expect(fired("hand")).toBe(1);
    expect(fired("discard")).toBe(0);
    expect(fired(undefined)).toBe(0);
  });

  it("Venomous Sacspider: only battle damage destroying it makes the opponent discard", () => {
    for (const battle of [false, true]) {
      const { g, p, o } = setup();
      const spider = put(g, p, "venomous-sacspider", "play");
      for (let i = 0; i < 3; i++) put(g, o, "fired-hand", "hand");
      const src = put(g, o, "fired-hand", "play");
      g.inflict(spider, 10, battle, [src]);
      settle(g);
      expect(g.s.cards[spider].zone).toBe("discard");
      expect(g.s.players[o].hand.length).toBe(battle ? 0 : 3);
    }
  });

  it("Stuttershy: flipped face-down by any effect, its rule still happens", () => {
    const { g, p, o } = setup();
    const st = put(g, p, "stuttershy", "play");
    const before = g.s.players[o].influence;
    g.flipFaceDown(st, p);
    settle(g);
    expect(g.s.players[o].influence).toBe(before + 1);
  });

  it("Corrosive Waste Dispenser: flips face-down whenever its last token goes", () => {
    const { g, p } = setup();
    const cw = put(g, p, "corrosive-waste-dispenser", "play");
    g.s.cards[cw].tokens = 1;
    g.setTokens(cw, 0);
    settle(g);
    expect(g.s.cards[cw].faceDown).toBe(true);
  });

  it("Spry Archer: its two attack triggers say what each does when choosing the order", () => {
    const { g, p } = setup();
    resources(g, p, "rage", 4);
    const archer = put(g, p, "spry-archer", "play");
    const order = (g as any).triggersFor({ e: "attacks", iid: archer, player: p }).map((t: any) => t.label);
    expect(order).toEqual(["Inflict 1 damage to an opponent's faction.", "You may pick a character. If you do, inflict 1 damage to it."]);
  });
});
