import { describe, expect, it } from "vitest";
import { Game } from "../game.ts";
import { viewFor, viewForSpectator } from "../view.ts";
import { other } from "../types.ts";
import { act, answer, expectPending, lib, newGame, pass, passAll, put, quickStart, resources, toMain } from "./helpers.ts";

describe("setup", () => {
  it("without a room choice, the die roll winner chooses to go first or second", () => {
    const g = newGame(5);
    const d = expectPending(g, "choose");
    expect(d.options.map((o: any) => o.id)).toEqual(["first", "second"]);
    const winner = d.player;
    answer(g, ["second"]);
    expect(g.s.first).toBe(other(winner));
    // The first player chooses and reveals their starting resources before the second.
    expect(g.s.pending?.player).toBe(other(winner));
    answer(g, [(g.s.pending as any).options[0].id]);
    answer(g, [(g.s.pending as any).options[0].id]);
    expect(g.s.log.some((l) => l.text.startsWith(`${g.s.players[other(winner)].name} starts with`))).toBe(true);
    expect(g.s.pending?.player).toBe(winner);
  });

  it("lets the room creator choose who goes first", () => {
    const deck = Array(20).fill("greed");
    const g = Game.create(lib, 5, { A: { name: "A", faction: "tournament-faction", cards: deck }, B: { name: "B", faction: "tournament-faction", cards: [...deck] } }, { first: "B" });
    expect(g.s.first).toBe("B");
  });

  it("places starting resources, draws per faction and starts turn 1", () => {
    const g = newGame(7);
    quickStart(g);
    const first = g.s.active;
    const second = other(first);
    expect(g.q.resources(first)).toHaveLength(2);
    expect(g.q.resources(second)).toHaveLength(2);
    expect(g.s.players[first].hand).toHaveLength(8);
    expect(g.s.players[second].hand).toHaveLength(9);
    expect(g.s.turn).toBe(1);
    // The turn player orders the restore and develop rules.
    const o = expectPending(g, "choose", first);
    expect(o.prompt).toMatch(/Start of turn/);
    answer(g, [o.options.find((x: any) => x.label.endsWith("Develop rule")).id]);
    // Develop rule: draw a card or play a resource.
    const d = expectPending(g, "choose", first);
    expect(d.options.map((o: any) => o.label)).toEqual(["draw 1 card", "play a resource"]);
  });

  it("Unlikely Heroes needs different staples and searches for a third", () => {
    const g = newGame(3, { factionA: "unlikely-heroes", factionB: "unlikely-heroes" });
    // The die roll winner chooses to go first.
    answer(g, ["first"]);
    const p = g.s.first!;
    answer(g, [(g.s.pending as any).options[0].id]);
    const second = expectPending(g, "choose", p);
    expect(second.options.map((o: any) => o.id)).not.toContain(g.s.cards[g.q.resources(p)[0]].defId);
    answer(g, [second.options[0].id]);
    // Other player's resources.
    answer(g, [(g.s.pending as any).options[0].id]);
    answer(g, [(g.s.pending as any).options[0].id]);
    // Starting draw search: offers only staples not among starting resources.
    const search = expectPending(g, "choose", p);
    const starting = g.q.resources(p).map((i) => g.s.cards[i].defId);
    for (const o of search.options) expect(starting).not.toContain(g.s.cards[o.id].defId);
    answer(g, [search.options[0].id]);
    expect(g.s.players[p].hand).toHaveLength(8); // 1 searched + 7
  });

  it("mulligan puts cards on the bottom and redraws the same number", () => {
    const g = newGame(11);
    for (let i = 0; i < 5; i++) answer(g, [(g.s.pending as any).options[0].id]); // die roll, then 2 staples each
    const p = g.s.first!;
    const before = [...g.s.players[p].hand];
    answer(g, before.slice(0, 3));
    const ps = g.s.players[p];
    expect(ps.hand).toHaveLength(8);
    expect(ps.deck.slice(-3)).toEqual(before.slice(0, 3));
  });
});

describe("deploying and the stack", () => {
  it("pays numeric cost by attaching resources, resolves after opponent passes, detaches next turn", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "obsession", 3);
    const wiz = put(g, p, "wanton-wizard", "hand");
    act(g, p, { type: "deploy", iid: wiz });
    expect(g.s.stack).toHaveLength(1);
    expect(g.q.unattached(p)).toHaveLength(2); // 2 starting + 3 obsession - 3 paid
    expectPending(g, "priority", other(p));
    pass(g);
    // Wanton Wizard's enters-play trigger: "you may pick a tactic in your discard pile".
    answer(g, ["no"]);
    expect(g.s.cards[wiz].zone).toBe("play");
    expectPending(g, "main", p);
    act(g, p, { type: "end_turn" });
    pass(g); // opponent declines to respond to end of turn
    expect(g.s.active).toBe(other(p));
    // Resources only detach at the start of their controller's own turn.
    const attached = () => g.q.resources(p).filter((r) => g.s.cards[r].attachedTo).length;
    expect(attached()).toBe(3);
    const restoreFirst = () => answer(g, [(g.s.pending as any).options.find((x: any) => x.label.endsWith("Restore rule")).id]);
    restoreFirst(); // the opponent orders their start of turn
    answer(g, ["0"]); // opponent's develop: draw
    act(g, other(p), { type: "end_turn" });
    pass(g);
    expect(g.s.active).toBe(p);
    expect(attached()).toBe(3);
    restoreFirst();
    expect(attached()).toBe(0);
  });

  it("blocks deploys that don't meet threshold", () => {
    const g = newGame();
    const p = toMain(g);
    const fh = put(g, p, "fired-hand", "hand");
    resources(g, p, "rage", 6);
    // Starting staples may already include deception; strip them for this test.
    for (const r of g.q.resources(p)) if (g.s.cards[r].defId === "deception") g.move(r, "discard");
    expect(() => act(g, p, { type: "deploy", iid: fh })).toThrow(/threshold/);
  });

  it("rolls back when a cost can't be paid", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "greed", 1);
    const mh = put(g, p, "mutineers-hiatus", "hand");
    // COST - Destroy a character you own: there are none.
    act(g, p, { type: "deploy", iid: mh });
    expect(g.s.cards[mh].zone).toBe("hand");
    expect(g.s.stack).toHaveLength(0);
    expect(g.q.unattached(p).length).toBe(g.q.resources(p).length);
    expectPending(g, "main", p);
  });

  it("hides a failed attempt from the opponent's log", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    const ma = put(g, p, "martial-artist", "hand");
    resources(g, p, "deception", 2); // threshold met, but 6 resources short of the cost
    const before = viewFor(g, o).log.length;
    act(g, p, { type: "deploy", iid: ma });
    expect(g.s.cards[ma].zone).toBe("hand");
    expect(viewFor(g, o).log.length).toBe(before);
    expect(viewFor(g, p).log.some((e) => e.text.startsWith("Illegal"))).toBe(true);
    expect(viewFor(g, p).log.some((e) => e.text.includes("plays Martial Artist"))).toBe(false);
  });

  it("publishes the log lines once the card is on the stack", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    resources(g, p, "obsession", 3);
    const w = put(g, p, "wanton-wizard", "hand");
    act(g, p, { type: "deploy", iid: w });
    expect(viewFor(g, o).log.some((e) => e.text.includes("plays Wanton Wizard"))).toBe(true);
  });

  it("lets a player look through their own deck manually, shuffling when done", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    expect(viewFor(g, p).players[p].deck).toBeNull();
    act(g, p, { type: "manual", op: { op: "search_deck" } });
    const deck = viewFor(g, p).players[p].deck!;
    expect(deck.length).toBe(g.s.players[p].deck.length);
    expect(deck.every((c) => c.defId)).toBe(true);
    expect(viewFor(g, o).players[p].deck).toBeNull(); // the opponent never sees it
    act(g, p, { type: "manual", op: { op: "move", iid: deck[5].iid, zone: "hand" } });
    expect(g.s.cards[deck[5].iid].zone).toBe("hand");
    const order = [...g.s.players[p].deck];
    act(g, p, { type: "manual", op: { op: "end_search" } });
    expect(viewFor(g, p).players[p].deck).toBeNull();
    expect(g.s.players[p].deck).toEqual(order); // "Close" doesn't shuffle
    act(g, p, { type: "manual", op: { op: "search_deck" } });
    act(g, p, { type: "manual", op: { op: "end_search", shuffle: true } });
    expect(g.s.players[p].deck).not.toEqual(order);
    expect(viewFor(g, o).log.some((e) => e.text.includes("looks through their deck"))).toBe(true);
  });

  it("rolls back when the numeric cost is unaffordable", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "deception", 2);
    const fh = put(g, p, "fired-hand", "hand"); // costs 6, we have 4
    act(g, p, { type: "deploy", iid: fh });
    expect(g.s.cards[fh].zone).toBe("hand");
    expect(g.q.unattached(p)).toHaveLength(4);
  });

  it("lets the player cancel during a cost choice", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "greed", 4);
    const aq = put(g, p, "alluring-quicksand", "hand");
    put(g, other(p), "wanton-wizard", "play");
    act(g, p, { type: "deploy", iid: aq });
    expectPending(g, "choose", p);
    act(g, p, { type: "cancel" });
    expect(g.s.cards[aq].zone).toBe("hand");
    expectPending(g, "main", p);
  });

  it("responses resolve last-in first-out", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    resources(g, p, "obsession", 3);
    resources(g, o, "greed", 4);
    const wiz = put(g, p, "wanton-wizard", "hand");
    const aq = put(g, o, "alluring-quicksand", "hand");
    const target = put(g, p, "fired-hand", "play");
    act(g, p, { type: "deploy", iid: wiz });
    // Opponent responds with Alluring Quicksand on Fired Hand.
    act(g, o, { type: "deploy", iid: aq });
    answer(g, [target]);
    expect(g.s.stack.map((x) => x.label)).toEqual(["Wanton Wizard", "Alluring Quicksand"]);
    expectPending(g, "priority", p);
    pass(g); // Quicksand resolves first
    expect(g.s.cards[target].faceDown).toBe(true);
    expect(g.s.cards[target].isResource).toBe(true);
    expect(g.s.cards[wiz].zone).toBe("stack");
    expectPending(g, "priority", o);
    pass(g);
    answer(g, ["no"]);
    expect(g.s.cards[wiz].zone).toBe("play");
  });
});

describe("battles", () => {
  it("unblocked attackers damage the faction", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    const fh = put(g, p, "fired-hand", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [fh] });
    expect(g.s.cards[fh].depleted).toBe(true);
    passAll(g); // window after declaring; then "no blockers" is automatic only if none exist
    expect(g.s.players[o].influence).toBe(20);
    expect(g.s.battle).toBe(null);
  });

  it("characters that entered play this turn can't attack", () => {
    const g = newGame();
    const p = toMain(g);
    const fh = put(g, p, "fired-hand", "play", { since: g.s.turn });
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [fh] })).toThrow(/can't attack/);
  });

  it("resolves speed groups fastest first; Fired Hand flips face-down instead of being destroyed", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    const fh = put(g, p, "fired-hand", "play"); // 5/4/3
    const w1 = put(g, o, "wanton-wizard", "play"); // 1/1/3
    const w2 = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [fh] });
    pass(g);
    pass(g);
    expectPending(g, "blockers", o);
    act(g, o, { type: "answer", ids: [w1, w2] });
    pass(g);
    pass(g);
    // Attacker divides 5 damage between two blockers.
    const d = expectPending(g, "assign", p);
    expect(d.total).toBe(5);
    act(g, p, { type: "answer", assign: { [w1]: 3, [w2]: 2 } });
    // Blockers' 2 damage go to the only attacker automatically.
    expect(g.s.battle!.locked).toEqual({ [w1]: 3, [w2]: 2, [fh]: 2 });
    pass(g);
    pass(g);
    expect(g.s.cards[w1].zone).toBe("discard");
    expect(g.s.cards[w2].zone).toBe("discard");
    expect(g.s.cards[fh].damage).toBe(2);
    expect(g.s.battle).toBe(null);
    expect(g.s.cards[fh].depleted).toBe(true);

    // Now destroy Fired Hand by damage: it becomes a face-down resource for its owner.
    g.s.cards[fh].damage = 4;
    act(g, p, { type: "manual", op: { op: "damage", iid: fh, delta: 0 } });
    expect(g.s.cards[fh].zone).toBe("play");
    expect(g.s.cards[fh].faceDown).toBe(true);
    expect(g.s.cards[fh].isResource).toBe(true);
    expect(g.s.cards[fh].controller).toBe(p);
  });

  it("damage goes to the target once all blockers are dead", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    const fh = put(g, p, "fired-hand", "play"); // spd 3
    const slow = put(g, p, "fired-hand", "play");
    g.s.effects.push({ id: "e1", source: slow, controller: p, vars: {}, mods: [{ stat: { spd: -2 }, target: { iids: [slow] } }], duration: "game", turn: 1 }); // spd 1
    const w = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [fh, slow] });
    passAll(g);
    act(g, o, { type: "answer", ids: [w] });
    passAll(g);
    // Speed 3: Fired Hand's 5 goes to the only blocker; the wizard splits its 1 between attackers.
    act(g, o, { type: "answer", assign: { [fh]: 1 } });
    passAll(g); // inflict, then speed 1: no blockers left, slow Fired Hand hits the faction
    expect(g.s.cards[w].zone).toBe("discard");
    expect(g.s.players[o].influence).toBe(20);
  });
});

describe("cards", () => {
  it("Mutineer's Hiatus: destroy-cost, then Recur from discard voids it", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "greed", 3);
    const mh = put(g, p, "mutineers-hiatus", "hand");
    const w = put(g, p, "wanton-wizard", "play");
    const hand = g.s.players[p].hand.length;
    act(g, p, { type: "deploy", iid: mh });
    answer(g, [w]);
    expect(g.s.cards[w].zone).toBe("discard");
    pass(g);
    expect(g.s.players[p].hand.length).toBe(hand - 1 + 2);
    expect(g.s.cards[mh].zone).toBe("discard");

    const w2 = put(g, p, "wanton-wizard", "play");
    const idx = g.q.abilities(mh).find((a) => a.rule.name === "Recur")!.index;
    act(g, p, { type: "ability", iid: mh, index: idx });
    expect(g.s.cards[mh].zone).toBe("void");
    answer(g, [w2]);
    pass(g);
    expect(g.s.cards[w2].zone).toBe("discard");
  });

  it("Alluring Quicksand Recur needs 4 greed", () => {
    const g = newGame();
    const p = toMain(g);
    const aq = put(g, p, "alluring-quicksand", "discard");
    for (const r of g.q.resources(p)) if (g.s.cards[r].defId === "greed") g.move(r, "discard");
    resources(g, p, "greed", 3);
    const idx = g.q.abilities(aq)[0].index;
    expect(() => act(g, p, { type: "ability", iid: aq, index: idx })).toThrow(/threshold/);
    resources(g, p, "greed", 1);
    put(g, other(p), "wanton-wizard", "play");
    act(g, p, { type: "ability", iid: aq, index: idx });
    expect(g.s.cards[aq].zone).toBe("void");
  });

  it("Invent: X=3 pays 6 and searches for 2 cards", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "elitism", 4);
    const inv = put(g, p, "invent", "hand");
    act(g, p, { type: "deploy", iid: inv });
    act(g, p, { type: "answer", value: 3 });
    expect(g.q.unattached(p)).toHaveLength(0);
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.max).toBe(2);
    const picks = d.options.slice(0, 2).map((o: any) => o.id);
    answer(g, picks);
    for (const i of picks) expect(g.s.cards[i].zone).toBe("hand");
  });

  it("Fornicaves reduces life to 2 for big characters only", () => {
    const g = newGame();
    const p = toMain(g);
    const fh = put(g, p, "fired-hand", "play");
    const w = put(g, p, "wanton-wizard", "play");
    expect(g.q.stat(fh, "life")).toBe(4);
    put(g, other(p), "fornicaves", "play");
    expect(g.q.stat(fh, "life")).toBe(2);
    expect(g.q.stat(w, "life")).toBe(1);
  });

  it("Unique: a second Fornicaves forces a choice", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "deception", 5);
    const f1 = put(g, p, "fornicaves", "play");
    const f2 = put(g, p, "fornicaves", "hand");
    act(g, p, { type: "deploy", iid: f2 });
    pass(g);
    const d = expectPending(g, "choose", p);
    expect(d.prompt).toMatch(/Unique Fornicaves/);
    answer(g, [f2]);
    expect(g.s.cards[f1].zone).toBe("discard");
  });

  it("Crest of Obsession provides icons and triggers on obsession cards entering play", () => {
    const g = newGame();
    const p = toMain(g);
    const before = g.q.icons(p).obsession;
    const crest = put(g, p, "crest-of-obsession", "hand");
    act(g, p, { type: "deploy", iid: crest });
    pass(g);
    expect(g.q.icons(p).obsession).toBe(before + 2);
    // Crest sees itself enter play (it provides obsession).
    expect(expectPending(g, "choose", p).prompt).toMatch(/search your deck/);
    answer(g, ["no"]);
    // Playing an obsession staple via the faction's Resource ability triggers it again.
    resources(g, p, "rage", 4);
    const ob = put(g, p, "obsession", "hand");
    const idx = g.q.abilities(g.s.players[p].factionIid).find((a) => a.rule.name === "Resource")!.index;
    act(g, p, { type: "ability", iid: g.s.players[p].factionIid, index: idx });
    pass(g);
    act(g, p, { type: "answer", iid: ob, faceDown: false });
    expect(expectPending(g, "choose", p).prompt).toMatch(/search your deck/);
  });

  it("Wanton Wizard puts a tactic from the discard pile into play face-down", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "obsession", 3);
    const t = put(g, p, "invent", "discard");
    const w = put(g, p, "wanton-wizard", "hand");
    const n = g.q.resources(p).length;
    act(g, p, { type: "deploy", iid: w });
    pass(g);
    answer(g, ["yes"]);
    answer(g, [t]);
    expect(g.s.cards[t].faceDown).toBe(true);
    expect(g.q.resources(p)).toHaveLength(n + 1);
    expect(g.q.icons(p).volition).toBeGreaterThanOrEqual(1);
  });

  it("Dark Awakening Flip Up: play from a face-down resource, replay a card, then discard", () => {
    const g = newGame();
    const p = toMain(g);
    resources(g, p, "rage", 1);
    resources(g, p, "obsession", 4);
    const da = put(g, p, "dark-awakening", "play", { faceDown: true });
    const w = put(g, p, "wanton-wizard", "discard");
    act(g, p, { type: "flip_up", iid: da });
    // Cost: pick a non-resource card in your discard pile (only the wizard qualifies).
    const pick = expectPending(g, "choose", p);
    expect(pick.options.map((o: any) => o.id)).toEqual([w]);
    answer(g, [w]);
    expect(g.s.cards[da].zone).toBe("stack");
    pass(g);
    answer(g, ["yes"]); // You may play the card
    expect(g.s.cards[da].zone).toBe("discard");
    expect(g.s.stack.map((x) => x.label)).toEqual(["Wanton Wizard"]);
    pass(g);
    answer(g, ["no"]);
    expect(g.s.cards[w].zone).toBe("play");
  });

  it("Fired Hand's Petty Vengeance works from a face-down resource", () => {
    const g = newGame();
    const p = toMain(g);
    const fh = put(g, p, "fired-hand", "play", { faceDown: true });
    const target = put(g, other(p), "wanton-wizard", "play");
    const idx = g.q.abilities(fh)[0].index;
    act(g, p, { type: "ability", iid: fh, index: idx });
    expect(g.s.cards[fh].revealed).toBe(true);
    // Discard a card, then pick a character.
    answer(g, [g.s.players[p].hand[0]]);
    answer(g, [target]);
    pass(g);
    // Life 1 - 1 = 0, so the wizard is destroyed.
    expect(g.s.cards[target].zone).toBe("discard");
  });
});

describe("views", () => {
  it("hide the opponent's hand and face-down cards", () => {
    const g = newGame();
    const p = toMain(g);
    const o = other(p);
    const fd = put(g, p, "fired-hand", "play", { faceDown: true });
    const mine = viewFor(g, p);
    const theirs = viewFor(g, o);
    expect(mine.players[p].hand).not.toBeNull();
    expect(theirs.players[p].hand).toBeNull();
    expect(theirs.players[p].handCount).toBe(g.s.players[p].hand.length);
    expect(mine.players[p].play.find((c) => c.iid === fd)!.defId).toBe("fired-hand");
    expect(theirs.players[p].play.find((c) => c.iid === fd)!.defId).toBe(null);
    expect(theirs.pending).toBe(null);
    expect(theirs.waiting).toEqual({ player: p, type: "main" });
    // Private log lines (what you drew) only go to their owner.
    expect(theirs.log.every((e) => !e.to || e.to === o)).toBe(true);
    expect(mine.log.some((e) => e.to === p && e.text.startsWith("You drew"))).toBe(true);
  });

  it("all card files load and validate", () => {
    expect(Object.keys(lib).length).toBeGreaterThanOrEqual(121);
  });
});

describe("spectators", () => {
  it("see only public information and get no decisions", () => {
    const g = newGame();
    const p = toMain(g);
    const fd = put(g, p, "fired-hand", "play", { faceDown: true });
    const v = viewForSpectator(g);
    expect(v.spectator).toBe(true);
    expect(v.players.A.hand).toBeNull();
    expect(v.players.B.hand).toBeNull();
    expect(v.pending).toBeNull();
    expect(v.legal).toBeNull();
    expect(v.waiting?.player).toBe(p);
    expect(v.log.every((l) => !l.to)).toBe(true);
    expect(v.players[p].play.find((c) => c.iid === fd)?.defId).toBeNull();
    // The player still sees their own face-down card and hand.
    expect(viewFor(g, p).players[p].play.find((c) => c.iid === fd)?.defId).toBe("fired-hand");
    expect(viewFor(g, p).players[p].hand).not.toBeNull();
  });
});
