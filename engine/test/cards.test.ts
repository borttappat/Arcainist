// Scenario tests for the card language, one or more per mechanic, using real cards.

import { describe, expect, it } from "vitest";
import { Game } from "../game.ts";
import { viewFor } from "../view.ts";
import { KNOWN_OPS } from "../../server/library.ts";
import { other, type PlayerId } from "../types.ts";
import { act, answer, expectPending, lib, newGame, pass, passAll, put, resources, toMain } from "./helpers.ts";

/** A game in the first player's main phase, with both hands emptied for clarity. */
function setup(seed = 1) {
  const g = newGame(seed);
  const p = toMain(g);
  const o = other(p);
  for (const x of [p, o]) for (const iid of [...g.s.players[x].hand]) g.move(iid, "deck", { bottom: true });
  return { g, p, o };
}

/**
 * End the current turn and start the next player's: the faction's restore and develop
 * rules first (choosing "draw"), then any start-of-turn card triggers.
 */
function nextTurn(g: Game) {
  const p = g.s.active;
  act(g, p, { type: "end_turn" });
  pass(g); // opponent lets the turn end
  for (let i = 0; i < 6; i++) {
    const d = g.s.pending as any;
    if (d?.type !== "choose") return;
    if (/Several triggers|Start of turn/.test(d.prompt)) {
      const pick = d.options.find((o: any) => o.label.endsWith("Restore rule")) ?? d.options.find((o: any) => o.label.endsWith("Develop rule"));
      if (!pick) return; // only card triggers left: the test handles them
      act(g, d.player, { type: "answer", ids: [pick.id] });
    } else if (d.options.some((o: any) => o.label.startsWith("draw"))) {
      act(g, d.player, { type: "answer", ids: [d.options.findIndex((o: any) => o.label.startsWith("draw")).toString()] });
      return;
    } else return;
  }
}

const ability = (g: Game, iid: string, name: string) => g.q.abilities(iid).find((a) => a.rule.name === name)!.index;
const zone = (g: Game, iid: string) => g.s.cards[iid].zone;

describe("card language", () => {
  it("every instruction the validator accepts is implemented by the engine", () => {
    for (const op of KNOWN_OPS) expect(typeof (Game.prototype as any)["op_" + op], op).toBe("function");
  });
});

describe("cost modifiers", () => {
  it("1337! reduces the next card you deploy this turn by 4, once", () => {
    const { g, p } = setup();
    resources(g, p, "elitism", 3);
    const leet = put(g, p, "1337", "hand");
    const fh1 = put(g, p, "fired-hand", "hand");
    const fh2 = put(g, p, "fired-hand", "hand");
    resources(g, p, "deception", 1);
    act(g, p, { type: "deploy", iid: leet });
    pass(g);
    const before = g.q.unattached(p).length;
    act(g, p, { type: "deploy", iid: fh1 });
    expect(before - g.q.unattached(p).length).toBe(2); // 6 - 4
    pass(g);
    // The second one costs full price, which we can't afford: rolled back.
    act(g, p, { type: "deploy", iid: fh2 });
    expect(zone(g, fh2)).toBe("hand");
  });

  it("Canny Bailiff raises the opponent's tactics to at least 3", () => {
    const { g, p, o } = setup();
    put(g, o, "canny-bailiff", "play");
    resources(g, p, "greed", 3);
    const cash = put(g, p, "cash-out", "hand");
    act(g, p, { type: "deploy", iid: cash });
    act(g, p, { type: "answer", value: 0 });
    // X = 0 so Cash Out would cost 0; Bailiff makes it 3.
    expect(g.q.unattached(p).length).toBe(g.q.resources(p).length - 3);
  });

  it("Escrow Office: withdrawn tokens reduce the next numeric cost", () => {
    const { g, p } = setup();
    const esc = put(g, p, "escrow-office", "play");
    g.s.cards[esc].tokens = 3;
    act(g, p, { type: "ability", iid: esc, index: ability(g, esc, "Withdraw") });
    pass(g);
    expect(g.s.cards[esc].tokens).toBe(0);
    resources(g, p, "deception", 4);
    const fh = put(g, p, "fired-hand", "hand");
    const n = g.q.unattached(p).length;
    act(g, p, { type: "deploy", iid: fh });
    expect(n - g.q.unattached(p).length).toBe(3);
  });

  it("Rudo Mangod's Fealty reduces its threshold with 4 different staples", () => {
    const { g, p } = setup();
    for (const r of g.q.resources(p)) g.move(r, "discard");
    resources(g, p, "obsession", 1);
    resources(g, p, "greed", 1);
    resources(g, p, "elitism", 1);
    const rudo = put(g, p, "rudo-mangod-fightful-adonis", "hand");
    expect(g.canStart(p, { type: "deploy", iid: rudo }, true)).toMatch(/threshold/);
    resources(g, p, "rage", 1); // 4 different trades, 1 rage: missing 3 rage icons, reduced by 3
    expect(g.canStart(p, { type: "deploy", iid: rudo }, true)).toBe(null);
  });
});

describe("prohibitions and requirements", () => {
  it("Erotic Assassin is not restored by the restore rule, only by its ability", () => {
    const { g, p, o } = setup();
    const ea = put(g, p, "erotic-assassin", "play");
    g.s.cards[ea].depleted = true;
    nextTurn(g);
    nextTurn(g);
    expect(g.s.active).toBe(p);
    expect(g.s.cards[ea].depleted).toBe(true);
    resources(g, p, "greed", 2);
    act(g, p, { type: "ability", iid: ea, index: ability(g, ea, "Restore") });
    pass(g);
    expect(g.s.cards[ea].depleted).toBe(false);
    void o;
  });

  it("3cc3n7r1c 73chn1c14n can attack only once each turn", () => {
    const { g, p } = setup();
    const t = put(g, p, "3cc3n7r1c-73chn1c14n", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [t] });
    passAll(g);
    g.s.cards[t].depleted = false;
    expect(g.q.canAttack(t)).toBe(false);
  });

  it("Martial Artist can't be picked by the opponent; Ferrous Ferret must be picked", () => {
    const { g, p, o } = setup();
    const ma = put(g, o, "martial-artist", "play");
    const w = put(g, o, "wanton-wizard", "play");
    resources(g, p, "greed", 4);
    const aq = put(g, p, "alluring-quicksand", "hand");
    act(g, p, { type: "deploy", iid: aq });
    let d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).not.toContain(ma);
    expect(d.options.map((x: any) => x.id)).toContain(w);
    act(g, p, { type: "cancel" });
    const ferret = put(g, o, "ferrous-ferret", "play");
    act(g, p, { type: "deploy", iid: aq });
    d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toEqual([ferret]);
    answer(g, [ferret]);
    expect(g.s.cards[ferret].tokens).toBe(1);
    expect(g.q.stat(ferret, "str")).toBe(2);
  });

  it("Lucky Charm makes picking your characters cost 1 more", () => {
    const { g, p, o } = setup();
    put(g, o, "lucky-charm", "play");
    const w = put(g, o, "wanton-wizard", "play");
    resources(g, p, "greed", 4);
    const aq = put(g, p, "alluring-quicksand", "hand");
    const n = g.q.unattached(p).length;
    act(g, p, { type: "deploy", iid: aq });
    answer(g, [w]);
    expect(n - g.q.unattached(p).length).toBe(5);
  });

  it("Incriminating Photograph stops the named card from being played", () => {
    const { g, p, o } = setup();
    resources(g, o, "deception", 3);
    put(g, o, "incriminating-photograph", "play");
    // Simulate its enters-play choice by remembering a name.
    const photo = g.s.players[o].play.find((i) => g.s.cards[i].defId === "incriminating-photograph")!;
    g.s.cards[photo].notes = { named: "Wanton Wizard" };
    resources(g, p, "obsession", 3);
    const w = put(g, p, "wanton-wizard", "hand");
    expect(g.canStart(p, { type: "deploy", iid: w }, true)).toMatch(/can't be played/);
  });

  it("633fy 31f needs two other non-resource cards played this turn", () => {
    const { g, p } = setup();
    resources(g, p, "elitism", 2);
    const elf = put(g, p, "633fy-31f", "hand");
    act(g, p, { type: "deploy", iid: elf });
    expect(zone(g, elf)).toBe("hand");
    g.s.turnLog.played.push({ iid: "x", defId: "invent", player: p, types: ["tactic"], cost: 0 }, { iid: "y", defId: "invent", player: p, types: ["tactic"], cost: 0 });
    act(g, p, { type: "deploy", iid: elf });
    expect(zone(g, elf)).toBe("stack");
  });

  it("Tactician Vacation can't be responded to and stops tactics this turn", () => {
    const { g, p, o } = setup();
    resources(g, p, "rage", 4);
    const tv = put(g, p, "tactician-vacation", "hand");
    act(g, p, { type: "deploy", iid: tv });
    // The opponent never gets priority: it resolves at once.
    expect(g.s.stack).toHaveLength(0);
    expectPending(g, "main", p);
    expect(o).not.toBe(p);
    resources(g, p, "greed", 3);
    expect(g.canStart(p, { type: "deploy", iid: put(g, p, "cash-out", "hand") }, true)).toMatch(/can't be played/);
  });
});

describe("damage, influence and destruction", () => {
  it("Adriel takes no battle damage while blocking; Gideon none while attacking and adds influence loss", () => {
    const { g, p, o } = setup();
    const gid = put(g, p, "gideon-the-ultimate-warrior", "play");
    const adr = put(g, o, "adriel-defender-of-marduun", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [gid] });
    passAll(g);
    act(g, o, { type: "answer", ids: [adr] });
    passAll(g);
    passAll(g);
    expect(g.s.cards[gid].damage).toBe(0);
    expect(g.s.cards[adr].damage).toBe(0);
    // Gideon: opponent's influence loss is increased by 1.
    const before = g.s.players[o].influence;
    g.loseInfluence(o, 2);
    expect(g.s.players[o].influence).toBe(before - 3);
  });

  it("Deadly Striker: when destroyed, the opponent loses 4 influence", () => {
    const { g, p, o } = setup();
    const ds = put(g, p, "deadly-striker", "play");
    resources(g, p, "greed", 1);
    const mh = put(g, p, "mutineers-hiatus", "hand");
    const before = g.s.players[o].influence;
    act(g, p, { type: "deploy", iid: mh });
    answer(g, [ds]); // destroy a character you own (the cost)
    expect(zone(g, ds)).toBe("discard");
    expect(g.s.players[o].influence).toBe(before - 4);
  });

  it("Basic Node: if destroyed, all other node cards are destroyed", () => {
    const { g, p, o } = setup();
    const n1 = put(g, p, "basic-node", "play");
    const n2 = put(g, o, "clay-node", "play");
    resources(g, p, "greed", 1);
    const mh = put(g, p, "mutineers-hiatus", "hand");
    act(g, p, { type: "deploy", iid: mh });
    answer(g, [n1]);
    expect(zone(g, n1)).toBe("discard");
    expect(zone(g, n2)).toBe("discard");
  });

  it("Limited Liability: damage is 0 and only costs destroy cards this turn", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 2);
    const ll = put(g, p, "limited-liability", "hand");
    act(g, p, { type: "deploy", iid: ll });
    pass(g);
    const fh = put(g, p, "fired-hand", "play");
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [fh] });
    passAll(g);
    act(g, o, { type: "answer", ids: [w] });
    passAll(g);
    passAll(g);
    expect(zone(g, w)).toBe("play");
    expect(g.s.cards[w].damage).toBe(0);
  });

  it("Trickster's Globe replaces faction damage with milling, and an empty deck loses", () => {
    const { g, p, o } = setup();
    put(g, p, "trickster-s-globe", "play");
    const fh = put(g, p, "fired-hand", "play");
    const deck = g.s.players[o].deck.length;
    const infl = g.s.players[o].influence;
    act(g, p, { type: "attack", target: "faction", attackers: [fh] });
    passAll(g);
    passAll(g);
    const d = expectPending(g, "number", p);
    expect(d.max).toBe(5);
    act(g, p, { type: "answer", value: 3 });
    passAll(g);
    expect(g.s.players[o].influence).toBe(infl - 2);
    expect(g.s.players[o].deck.length).toBe(deck - 3);
    for (const iid of [...g.s.players[o].deck]) g.move(iid, "discard");
    act(g, p, { type: "manual", op: { op: "influence", delta: 0 } });
    expect(g.s.winner).toBe(p);
  });

  it("Armored Keep: you don't lose at 0 influence while it's in play", () => {
    const { g, p, o } = setup();
    const keep = put(g, o, "armored-keep", "play");
    g.s.players[o].influence = 0;
    act(g, p, { type: "manual", op: { op: "influence", delta: 0 } });
    expect(g.s.phase).toBe("play");
    g.move(keep, "discard");
    act(g, p, { type: "manual", op: { op: "influence", delta: 0 } });
    expect(g.s.winner).toBe(p);
  });
});

describe("zones, attachments and control", () => {
  it("Dethmurderbludgeon attaches, grants +2/+2, and goes to hand instead of the discard pile", () => {
    const { g, p } = setup();
    resources(g, p, "rage", 5);
    const fh = put(g, p, "fired-hand", "play");
    const dm = put(g, p, "dethmurderbludgeon-the-craghammer", "hand");
    act(g, p, { type: "deploy", iid: dm });
    answer(g, [fh]); // pick the host as part of the cost
    pass(g);
    expect(g.s.cards[dm].attachedTo).toBe(fh);
    expect(g.q.stat(fh, "str")).toBe(7);
    expect(g.q.stat(fh, "life")).toBe(6);
    // The host leaves play: the gear goes with it, but to hand instead of discard.
    g.move(fh, "discard");
    expect(zone(g, dm)).toBe("hand");
  });

  it("Hidden Sandwich is destroyed instead of its host, which forgets its damage", () => {
    const { g, p } = setup();
    resources(g, p, "elitism", 3);
    const w = put(g, p, "wanton-wizard", "play");
    const hs = put(g, p, "hidden-sandwich", "hand");
    act(g, p, { type: "deploy", iid: hs });
    answer(g, [w]);
    pass(g);
    g.s.cards[w].damage = 5;
    act(g, p, { type: "manual", op: { op: "damage", iid: w, delta: 0 } });
    expect(zone(g, w)).toBe("play");
    expect(g.s.cards[w].damage).toBe(0);
    expect(zone(g, hs)).toBe("discard");
  });

  it("Hollow Moose enters under the opponent's control and drains them each turn", () => {
    const { g, p, o } = setup();
    resources(g, p, "deception", 2);
    const hm = put(g, p, "hollow-moose", "hand");
    act(g, p, { type: "deploy", iid: hm });
    pass(g);
    expect(g.s.cards[hm].controller).toBe(o);
    const infl = g.s.players[o].influence;
    nextTurn(g);
    passAll(g);
    expect(g.s.players[o].influence).toBe(infl - 1);
  });

  it("Resurrection Emporium removes your characters from the game instead of discarding them", () => {
    const { g, p } = setup();
    put(g, p, "resurrection-emporium", "play");
    const w = put(g, p, "wanton-wizard", "play");
    g.destroy(w);
    expect(zone(g, w)).toBe("void");
  });

  it("Quotidian Misfire: cards going to hand this turn go to the discard pile instead", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 2);
    const qm = put(g, p, "quotidian-misfire", "hand");
    act(g, p, { type: "deploy", iid: qm });
    pass(g);
    const top = g.s.players[p].deck[0];
    g.drawCards(p, 1);
    expect(zone(g, top)).toBe("discard");
  });

  it("Gilded Yurt removes a character and returns it at the start of your next turn", () => {
    const { g, p } = setup();
    const yurt = put(g, p, "gilded-yurt", "play");
    const w = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "ability", iid: yurt, index: ability(g, yurt, "Chillax") });
    answer(g, [w]);
    pass(g);
    expect(zone(g, w)).toBe("void");
    nextTurn(g);
    nextTurn(g);
    passAll(g);
    // Wanton Wizard's own enters-play trigger asks; decline.
    if (g.s.pending?.type === "choose") answer(g, ["no"]);
    expect(zone(g, w)).toBe("play");
  });

  it("Pant Swipe lets you play the opponent's cards from the void without threshold", () => {
    const { g, p, o } = setup();
    put(g, o, "cash-out", "deck");
    resources(g, p, "deception", 7);
    const ps = put(g, p, "pant-swipe", "hand");
    act(g, p, { type: "deploy", iid: ps });
    pass(g);
    const swiped = g.s.players[o].void.filter((i) => g.s.cards[i].tags?.includes(ps));
    expect(swiped).toHaveLength(4);
    const cash = swiped.find((i) => g.s.cards[i].defId === "cash-out")!;
    // The opponent can't see what was swiped; you can.
    expect(viewFor(g, o).players[o].void.find((c) => c.iid === cash)!.defId).toBe(null);
    expect(viewFor(g, p).players[o].void.find((c) => c.iid === cash)!.defId).toBe("cash-out");
    expect(g.canStart(p, { type: "deploy", iid: cash }, true)).toBe(null);
  });

  it("Ass: at the end of your turn you steal a character, then hand the Ass over", () => {
    const { g, p, o } = setup();
    const ass = put(g, p, "ass", "play");
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "end_turn" });
    pass(g);
    // Two end-of-turn triggers: choose the order, then the opponent picks.
    if (g.s.pending?.type === "choose" && /Several triggers|Start of turn/.test((g.s.pending as any).prompt)) answer(g, ["0"]);
    if (g.s.pending?.type === "choose" && g.s.pending.player === o) answer(g, [w]);
    if (g.s.pending?.type === "choose" && /Several triggers|Start of turn/.test((g.s.pending as any).prompt)) answer(g, ["0"]);
    expect(g.s.cards[w].controller).toBe(p);
    expect(g.s.cards[ass].controller).toBe(o);
  });
});

describe("responses and the stack", () => {
  it("Snooty Doorman terminates a character being played", () => {
    const { g, p, o } = setup();
    const doorman = put(g, o, "snooty-doorman", "play");
    resources(g, p, "obsession", 3);
    const w = put(g, p, "wanton-wizard", "hand");
    act(g, p, { type: "deploy", iid: w });
    act(g, o, { type: "ability", iid: doorman, index: ability(g, doorman, "Denied!") });
    pass(g);
    expect(zone(g, doorman)).toBe("discard");
    expect(zone(g, w)).toBe("discard");
    expect(g.s.stack).toHaveLength(0);
  });

  it("Anatidaephobia costs the character's cost, or 5 influence when flipped up", () => {
    const { g, p, o } = setup();
    resources(g, p, "deception", 6);
    const fh = put(g, p, "fired-hand", "hand");
    resources(g, o, "greed", 6);
    const an = put(g, o, "anatidaephobia", "hand");
    act(g, p, { type: "deploy", iid: fh });
    const n = g.q.unattached(o).length;
    act(g, o, { type: "deploy", iid: an });
    expect(n - g.q.unattached(o).length).toBe(6);
    pass(g);
    expect(zone(g, fh)).toBe("discard");

    // Flip Up version: pay 1 and lose 5 influence instead.
    nextTurn(g);
    nextTurn(g);
    const fh2 = put(g, p, "fired-hand", "hand");
    const an2 = put(g, o, "anatidaephobia", "play", { faceDown: true });
    act(g, p, { type: "deploy", iid: fh2 });
    const infl = g.s.players[o].influence;
    const m = g.q.unattached(o).length;
    act(g, o, { type: "flip_up", iid: an2 });
    // Pays 1: the flipped card was unattached, so it pays for itself.
    expect(m - g.q.unattached(o).length).toBe(1);
    expect(g.s.players[o].influence).toBe(infl - 5);
  });

  it("Cock Block terminates an ability and becomes a face-down resource", () => {
    const { g, p, o } = setup();
    const ea = put(g, p, "erotic-assassin", "play");
    g.s.cards[ea].depleted = true;
    resources(g, p, "greed", 2);
    act(g, p, { type: "ability", iid: ea, index: ability(g, ea, "Restore") });
    resources(g, o, "elitism", 3);
    const cb = put(g, o, "cock-block", "hand");
    act(g, o, { type: "deploy", iid: cb });
    pass(g);
    expect(g.s.cards[ea].depleted).toBe(true);
    expect(g.s.cards[cb].zone).toBe("play");
    expect(g.s.cards[cb].faceDown).toBe(true);
  });

  it("Exploding Sock Puppet terminates a character's ability and destroys the character", () => {
    const { g, p, o } = setup();
    const ea = put(g, p, "erotic-assassin", "play");
    g.s.cards[ea].depleted = true;
    resources(g, p, "greed", 2);
    act(g, p, { type: "ability", iid: ea, index: ability(g, ea, "Restore") });
    resources(g, o, "elitism", 2);
    const sp = put(g, o, "exploding-sock-puppet", "hand");
    act(g, o, { type: "deploy", iid: sp });
    // It can't be responded to, so it resolves without giving priority.
    expect(zone(g, ea)).toBe("discard");
    expect(g.s.stack).toHaveLength(0);
  });

  it("Additional Tribute: the opponent may pay 1 to cancel it, otherwise the card is terminated", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 3);
    const w = put(g, p, "wanton-wizard", "hand");
    resources(g, o, "obsession", 2);
    const at = put(g, o, "additional-tribute", "hand");
    act(g, p, { type: "deploy", iid: w });
    act(g, o, { type: "deploy", iid: at });
    pass(g);
    // Opponent of Additional Tribute's controller (p) decides whether to pay 1.
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/pay 1/);
    answer(g, ["no"]);
    expect(zone(g, w)).toBe("discard");
  });

  it("Lost on Floor 3 terminates your own end of turn declaration", () => {
    const { g, p, o } = setup();
    resources(g, p, "deception", 3);
    const lost = put(g, p, "lost-on-floor-3", "hand");
    resources(g, o, "greed", 3);
    const cash = put(g, o, "cash-out", "hand");
    act(g, p, { type: "end_turn" });
    act(g, o, { type: "deploy", iid: cash });
    act(g, o, { type: "answer", value: 0 });
    act(g, p, { type: "deploy", iid: lost });
    passAll(g);
    expect(g.s.active).toBe(p);
    expectPending(g, "main", p);
  });

  it("Mistaken Identity redirects a pick made as a cost", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 4);
    const aq = put(g, p, "alluring-quicksand", "hand");
    const w1 = put(g, o, "wanton-wizard", "play");
    const w2 = put(g, o, "fired-hand", "play");
    act(g, p, { type: "deploy", iid: aq });
    answer(g, [w1]);
    resources(g, o, "deception", 2);
    const mi = put(g, o, "mistaken-identity", "hand");
    act(g, o, { type: "deploy", iid: mi });
    answer(g, [w2]);
    passAll(g);
    expect(g.s.cards[w1].faceDown).toBe(false);
    expect(g.s.cards[w2].faceDown).toBe(true);
  });

  it("Mistaken Identity only offers characters the original card could have picked", () => {
    const { g, p, o } = setup();
    resources(g, p, "greed", 1);
    // Mutineer's Hiatus picks "a character you own": only p's characters qualify.
    const mine1 = put(g, p, "wanton-wizard", "play");
    const mine2 = put(g, p, "fired-hand", "play");
    const theirs = put(g, o, "deadly-striker", "play");
    const mh = put(g, p, "mutineers-hiatus", "hand");
    act(g, p, { type: "deploy", iid: mh });
    answer(g, [mine1]);
    resources(g, o, "deception", 2);
    const mi = put(g, o, "mistaken-identity", "hand");
    act(g, o, { type: "deploy", iid: mi });
    const d = expectPending(g, "choose", o);
    const ids = d.options.map((x: any) => x.id);
    expect(ids).toContain(mine2);
    expect(ids).not.toContain(theirs);
    expect(ids).not.toContain(mine1);
  });
});

describe("turn-based and scripted cards", () => {
  it("Party Clowns fetches another copy for 1 at the start of your turn", () => {
    const { g, p } = setup();
    put(g, p, "party-clowns", "play");
    const next = put(g, p, "party-clowns", "deck");
    g.move(next, "deck", { bottom: true }); // not drawn by the develop rule
    resources(g, p, "deception", 1);
    nextTurn(g);
    nextTurn(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/pay 1/);
    answer(g, ["yes"]);
    answer(g, [next]);
    expect(zone(g, next)).toBe("play");
  });

  it("start of turn: faction rules and card triggers are ordered together by the turn player", () => {
    const { g, p } = setup();
    put(g, p, "party-clowns", "play");
    resources(g, p, "deception", 1);
    nextTurn(g); // the opponent's turn
    act(g, other(p), { type: "end_turn" });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/Start of turn/);
    expect(d.options.map((o: any) => o.label)).toEqual(expect.arrayContaining([expect.stringMatching(/Restore rule$/), expect.stringMatching(/Develop rule$/), expect.stringMatching(/^Party Clowns: /)]));
    // Resolve the card's trigger first: its "pay 1" prompt comes before the develop choice.
    answer(g, [d.options.find((o: any) => o.label.startsWith("Party Clowns")).id]);
    expect((g.s.pending as any).prompt).toMatch(/pay 1/);
  });

  it("Free Trade Agreement: the turn player picks an option", () => {
    const { g, p, o } = setup();
    put(g, p, "free-trade-agreement", "play");
    nextTurn(g);
    const d = expectPending(g, "choose", o);
    expect(d.options).toHaveLength(4);
    const hand = g.s.players[o].hand.length;
    answer(g, ["2"]); // both players may draw up to 2
    act(g, o, { type: "answer", value: 2 });
    act(g, p, { type: "answer", value: 0 });
    expect(g.s.players[o].hand.length).toBe(hand + 2);
  });

  it("Auction House: players bid with detached resources, highest bidder gets the character", () => {
    const { g, p, o } = setup();
    put(g, o, "auction-house", "play");
    const char = put(g, o, "fired-hand", "deck");
    // Second from the top: the develop rule draws the top card before the trigger.
    const rest = g.s.players[o].deck.filter((i) => i !== char);
    g.s.players[o].deck = [rest[0], char, ...rest.slice(1)];
    resources(g, o, "greed", 3);
    nextTurn(g);
    // o is active and bids first.
    act(g, o, { type: "answer", value: 1 });
    act(g, p, { type: "answer", value: 0 }); // p passes (they could have bid 2)
    expect(zone(g, char)).toBe("play");
    expect(g.s.cards[char].controller).toBe(o);
  });

  it("Voidal Poisoning spends tokens on a menu of effects", () => {
    const { g, p, o } = setup();
    const bib = put(g, p, "forbidden-bibliotheca", "play");
    g.s.cards[bib].tokens = 3;
    resources(g, p, "obsession", 3);
    const vp = put(g, p, "voidal-poisoning", "hand");
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "deploy", iid: vp });
    pass(g);
    answer(g, ["dmg"]);
    answer(g, [w]);
    expect(zone(g, w)).toBe("discard");
    const hand = g.s.players[p].hand.length;
    answer(g, ["draw"]);
    expect(g.s.players[p].hand.length).toBe(hand + 1);
    expect(g.s.cards[bib].tokens).toBe(0);
    expectPending(g, "main", p);
  });

  it("Skin Suit: the survivor gains the removed character's rules text", () => {
    const { g, p, o } = setup();
    const fh = put(g, p, "cantankerous-claywork", "play"); // 6/5: survives 4 damage
    const ds = put(g, o, "deadly-striker", "play"); // 4/2
    resources(g, p, "rage", 4);
    const ss = put(g, p, "skin-suit", "hand");
    act(g, p, { type: "deploy", iid: ss });
    answer(g, [fh]);
    answer(g, [ds]);
    passAll(g);
    expect(zone(g, ds)).toBe("void");
    expect(g.q.rules(fh).some((r) => r.trigger?.on === "destroyed")).toBe(true);
  });

  it("Spatchcocking: each player keeps one card per type, the rest return to hand", () => {
    const { g, p, o } = setup();
    const a1 = put(g, p, "wanton-wizard", "play");
    const a2 = put(g, p, "fired-hand", "play");
    const b1 = put(g, o, "lucky-charm", "play");
    resources(g, p, "obsession", 4);
    const sc = put(g, p, "spatchcocking", "hand");
    act(g, p, { type: "deploy", iid: sc });
    pass(g);
    answer(g, [a2]);
    expect(zone(g, a1)).toBe("hand");
    expect(zone(g, a2)).toBe("play");
    expect(zone(g, b1)).toBe("play");
  });

  it("The Billionaire uses abilities on the opponent's cards", () => {
    const { g, p, o } = setup();
    put(g, p, "the-billionaire", "play");
    const esc = put(g, o, "escrow-office", "play");
    resources(g, p, "greed", 1);
    const before = g.q.unattached(p).length;
    act(g, p, { type: "ability", iid: esc, index: ability(g, esc, "Deposit") });
    expect(before - g.q.unattached(p).length).toBe(1);
    pass(g);
    expect(g.s.cards[esc].tokens).toBe(1);
  });

  it("Ectypal Stave duplicates the last tactic played this turn", () => {
    const { g, p } = setup();
    const st = put(g, p, "ectypal-stave", "play");
    resources(g, p, "greed", 6);
    resources(g, p, "obsession", 4);
    const cash = put(g, p, "cash-out", "hand");
    act(g, p, { type: "deploy", iid: cash });
    act(g, p, { type: "answer", value: 1 });
    pass(g);
    const hand = g.s.players[p].hand.length;
    act(g, p, { type: "ability", iid: st, index: ability(g, st, "Counterfeit") });
    pass(g);
    // The duplicate repeats Cash Out's written costs: choose X and pay 2X. It can't be
    // responded to, so it resolves at once.
    act(g, p, { type: "answer", value: 0 });
    expect(g.s.players[p].hand.length).toBe(hand + 1);
  });

  it("Odious Diva reveals the opponent's hand in your view", () => {
    const { g, p, o } = setup();
    put(g, p, "odious-diva", "play");
    put(g, o, "cash-out", "hand");
    expect(viewFor(g, p).players[o].hand).not.toBeNull();
    expect(viewFor(g, o).players[p].hand).toBeNull(); // no Diva on that side
  });

  it("One-Legged Hopping Pogo-Bear becomes a 3/3/3 character and can hide again", () => {
    const { g, p } = setup();
    const bear = put(g, p, "one-legged-hopping-pogo-bear", "play");
    resources(g, p, "elitism", 3);
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "RAAR!") });
    pass(g);
    expect(g.q.isCharacter(bear)).toBe(true);
    expect(g.q.stat(bear, "str")).toBe(3);
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "HIDE!") });
    pass(g);
    expect(g.q.isCharacter(bear)).toBe(false);
  });

  it("Thief Doyen enters with tokens equal to the discarded card's cost", () => {
    const { g, p } = setup();
    resources(g, p, "deception", 4);
    const td = put(g, p, "thief-doyen", "hand");
    const fh = put(g, p, "fired-hand", "hand");
    act(g, p, { type: "deploy", iid: td });
    answer(g, [fh]);
    pass(g);
    expect(g.s.cards[td].tokens).toBe(6);
    expect(g.q.stat(td, "str")).toBe(6);
  });

  it("Craniata Nester grows with characters in the opponent's discard pile", () => {
    const { g, p, o } = setup();
    const n = put(g, p, "craniata-nester", "play");
    put(g, o, "wanton-wizard", "discard");
    put(g, o, "fired-hand", "discard");
    expect(g.q.stat(n, "str")).toBe(4);
    expect(g.q.stat(n, "life")).toBe(4);
  });

  it("Meat of the Mountain: removing a token needs one to remove", () => {
    const { g, p } = setup();
    const meat = put(g, p, "meat-of-the-mountain", "play");
    g.drawCards(p, 1);
    act(g, p, { type: "manual", op: { op: "tokens", iid: meat, delta: 0 } });
    // Events from a manual action are dropped; trigger the draw through the engine instead.
    resources(g, p, "greed", 3);
    const cash = put(g, p, "cash-out", "hand");
    act(g, p, { type: "deploy", iid: cash });
    act(g, p, { type: "answer", value: 0 });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.label)).not.toContain("Remove a token from Meat of the Mountain");
    answer(g, [d.options.find((x: any) => x.label.startsWith("Add")).id]);
    expect(g.s.cards[meat].tokens).toBe(1);
  });

  it("Obsessive Compulsion: cards sent to the bottom stay there; only the rest are reordered on top", () => {
    const { g, p } = setup();
    resources(g, p, "obsession", 1);
    const oc = put(g, p, "obsessive-compulsion", "hand");
    act(g, p, { type: "deploy", iid: oc });
    pass(g);
    const deck = g.s.players[p].deck;
    const [a, b, c] = deck.slice(0, 3);
    answer(g, [a, b]);
    // Only one card left for the top: no ordering prompt; then the draw takes it.
    expect(deck.slice(-2)).toEqual([a, b]);
    expect(g.s.cards[c].zone).toBe("hand");
  });

  it("Inhibit removes a card's rules text until the start of your next turn", () => {
    const { g, p, o } = setup();
    const fh = put(g, o, "fired-hand", "play");
    const forn = put(g, o, "fornicaves", "play");
    expect(g.q.stat(fh, "life")).toBe(2);
    resources(g, p, "obsession", 1);
    const inh = put(g, p, "inhibit", "hand");
    const hand = g.s.players[p].hand.length;
    act(g, p, { type: "deploy", iid: inh });
    const d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toEqual(expect.arrayContaining([fh, forn]));
    answer(g, [forn]);
    pass(g);
    expect(g.q.stat(fh, "life")).toBe(4); // Fornicaves has no rules text
    expect(g.s.players[p].hand.length).toBe(hand); // Inhibit left, one card drawn
    nextTurn(g);
    expect(g.q.stat(fh, "life")).toBe(4); // still silenced during the opponent's turn
    nextTurn(g);
    expect(g.q.stat(fh, "life")).toBe(2); // back at the start of your next turn
  });

  it("Karmic Cake fetches a resource, and Recur fetches a staple", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 2);
    const viol = put(g, p, "violence", "deck");
    const cake = put(g, p, "karmic-cake", "hand");
    act(g, p, { type: "deploy", iid: cake });
    pass(g);
    let d = expectPending(g, "choose", p);
    expect(d.options.map((x: any) => x.id)).toContain(viol); // non-staple resources count
    answer(g, [viol]);
    expect(zone(g, viol)).toBe("hand");
    act(g, p, { type: "ability", iid: cake, index: ability(g, cake, "Recur") });
    pass(g);
    d = expectPending(g, "choose", p);
    expect(d.options.every((x: any) => g.q.def(x.id).staple)).toBe(true);
    expect(zone(g, cake)).toBe("void");
  });

  it("Cantankerous Claywork only boosts characters already in play when it attacks", () => {
    const { g, p } = setup();
    const clay = put(g, p, "cantankerous-claywork", "play");
    const before = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [clay] });
    const later = put(g, p, "wanton-wizard", "play");
    expect(g.q.stat(before, "str")).toBe(2);
    expect(g.q.stat(later, "str")).toBe(1);
  });

  it("Quotidian Misfire catches every card going to a hand: draws, returns, searches", () => {
    const { g, p, o } = setup();
    resources(g, p, "obsession", 2);
    const qm = put(g, p, "quotidian-misfire", "hand");
    act(g, p, { type: "deploy", iid: qm });
    pass(g);
    const w = put(g, o, "wanton-wizard", "play");
    g.move(w, "hand"); // returned to its owner's hand
    expect(zone(g, w)).toBe("discard");
    const top = g.s.players[o].deck[0];
    g.drawCards(o, 1);
    expect(zone(g, top)).toBe("discard");
  });

  it("One-Legged Hopping Pogo-Bear keeps Covert through HIDE!", () => {
    const { g, p } = setup();
    const bear = put(g, p, "one-legged-hopping-pogo-bear", "play");
    resources(g, p, "elitism", 6);
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "RAAR!") });
    pass(g);
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "SCHPROING!") });
    pass(g);
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "HIDE!") });
    pass(g);
    expect(g.q.isCharacter(bear)).toBe(false);
    g.s.cards[bear].depleted = false;
    act(g, p, { type: "ability", iid: bear, index: ability(g, bear, "RAAR!") });
    pass(g);
    expect(g.q.keyword(bear, "covert")).toBe(true);
  });

  it("Lodge Dock Florist gives every character an upkeep", () => {
    const { g, p } = setup();
    put(g, p, "lodge-dock-florist", "play");
    const w = put(g, p, "wanton-wizard", "play");
    nextTurn(g);
    nextTurn(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/pay 1/);
    answer(g, ["no"]);
    expect(zone(g, w)).toBe("discard");
  });

  it("Quilt of Old Banners provides the named icon until your next turn", () => {
    const { g, p } = setup();
    resources(g, p, "greed", 1);
    const before = g.q.icons(p).rage;
    const quilt = put(g, p, "quilt-of-old-banners", "hand");
    act(g, p, { type: "deploy", iid: quilt });
    pass(g);
    answer(g, ["rage"]);
    expect(g.q.icons(p).rage).toBe(before + 1);
  });

  it("Eccentric Inquisition voids revealed tactics and lets you play them", () => {
    const { g, p, o } = setup();
    const t = put(g, o, "cash-out", "deck");
    g.s.players[o].deck = [t, ...g.s.players[o].deck.filter((i) => i !== t)];
    resources(g, p, "obsession", 4);
    const ei = put(g, p, "eccentric-inquisition", "hand");
    act(g, p, { type: "deploy", iid: ei });
    pass(g);
    expect(zone(g, t)).toBe("void");
    expect(g.canStart(p, { type: "deploy", iid: t }, true)).toBe(null);
  });
});

describe("all cards", () => {
  it("every card with rules can be put into play and leave play without engine errors", () => {
    // Only cards with automated rules; the rest are played with manual controls.
    for (const def of Object.values(lib)) {
      if (def.types.includes("faction") || !def.rules?.length) continue;
      const { g, p } = setup(7);
      const iid = put(g, p, def.id, def.types.includes("resource") ? "play" : "hand", def.types.includes("resource") ? { resource: true } : {});
      if (!def.types.includes("resource") && !def.types.includes("tactic")) {
        g.enterPlay(iid, p);
        (g as any).checks();
        g.destroy(iid);
      }
      expect(g.s.cards[iid], def.id).toBeTruthy();
      void ({} as PlayerId);
    }
  }, 30000);
});
