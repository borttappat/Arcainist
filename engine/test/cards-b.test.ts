// Scenario tests for cards automated in alphabetical batches (B to D).

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseDeck } from "../deck.ts";
import { validateDeck } from "../formats.ts";
import { loadFormats } from "../../server/library.ts";
import { other } from "../types.ts";
import { lib } from "./helpers.ts";
import { act, answer, expectPending, newGame, pass, passAll, put, resources, toMain } from "./helpers.ts";

function setup() {
  const g = newGame(1);
  const p = toMain(g);
  const o = other(p);
  for (const x of [p, o]) for (const iid of [...g.s.players[x].hand]) g.move(iid, "deck", { bottom: true });
  return { g, p, o };
}

describe("cards: B to D", () => {
  it("Boorish Boar: destroyed while you control [R][R][R], then divides 2 damage", () => {
    const { g, p, o } = setup();
    const boar = put(g, p, "boorish-boar", "play");
    const victim = put(g, o, "barbaric-rifleman", "play"); // 1 life
    for (const r of g.q.resources(p)) g.move(r, "discard");
    resources(g, p, "rage", 2);
    expect(g.q.stat(boar, "str")).toBe(4);
    expect(g.q.stat(boar, "life")).toBe(2);
    const t = put(g, p, "battle-surge", "hand"); // anything that runs state checks
    resources(g, p, "rage", 1); // the third [R]
    act(g, p, { type: "deploy", iid: t });
    expect(g.s.cards[boar].zone).toBe("discard");
    answer(g, [victim]);
    const d = expectPending(g, "assign", p);
    g.act(p, { type: "answer", assign: { [victim]: d.total } });
    expect(g.s.cards[victim].zone).toBe("discard");
  });

  it("Candy Skull Commander: an opposing attack offers a paid coin flip, and coin flips offer a draw", () => {
    const { g, p, o } = setup();
    put(g, o, "candy-skull-commander", "play");
    resources(g, o, "deception", 6);
    const atk = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    const d = expectPending(g, "choose", o);
    expect(d.prompt).toContain("pay 2");
    answer(g, ["yes"]);
    // The flip happened; the [D]x6 trigger now offers a paid draw.
    const hand = g.s.players[o].hand.length;
    const d2 = expectPending(g, "choose", o);
    expect(d2.prompt).toContain("draw a card");
    answer(g, ["yes"]);
    expect(g.s.players[o].hand.length).toBe(hand + 1);
  });

  it("Carnival Funhouse: swaps printed stats while it is in play", () => {
    const { g, p, o } = setup();
    const mine = put(g, p, "wanton-wizard", "play");
    const theirs = put(g, o, "fired-hand", "play"); // 5 / 4 / 3
    resources(g, p, "deception", 4);
    const f = put(g, p, "carnival-funhouse", "hand");
    act(g, p, { type: "deploy", iid: f });
    pass(g);
    answer(g, [theirs]);
    answer(g, [mine]);
    expect(g.q.stat(mine, "str")).toBe(5);
    expect(g.q.stat(theirs, "str")).toBe(g.q.printed(mine, "str"));
    g.destroy(f);
    expect(g.q.stat(mine, "str")).toBe(g.q.printed(mine, "str"));
    expect(g.q.stat(theirs, "str")).toBe(5);
  });

  it("Catastrophic Caper: returns the character picked as a cost to its owner's hand", () => {
    const { g, p, o } = setup();
    const w = put(g, o, "wanton-wizard", "play");
    resources(g, p, "obsession", 4);
    resources(g, o, "deception", 1);
    const t = put(g, p, "anathematize", "hand"); // picks a character as an extra cost
    const caper = put(g, o, "catastrophic-caper", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [w]);
    act(g, o, { type: "deploy", iid: caper });
    passAll(g);
    expect(g.s.cards[w].zone).toBe("hand");
  });

  it("Braggadocian Aide: detaches a spent resource at the start of an opponent's turn, and provides [E]", () => {
    const { g, p } = setup();
    const aide = put(g, p, "braggadocian-aide", "play");
    expect(g.q.provided(aide)).toEqual({ elitism: 1 });
    const [r] = resources(g, p, "greed", 1);
    g.s.cards[r].attachedTo = "faction";
    act(g, p, { type: "end_turn" });
    passAll(g);
    for (let i = 0; i < 5 && !(g.s.pending?.type === "choose" && g.s.pending.prompt.includes("Braggadocian")); i++) {
      const d = g.s.pending!;
      if (d.type === "choose") answer(g, [d.options[0].id]);
      else pass(g);
    }
    answer(g, [r]);
    expect(g.s.cards[r].attachedTo).toBe(null);
  });

  it("Cannon Squadron: up to 2 damage, so 0 is allowed", () => {
    const { g, p, o } = setup();
    const c = put(g, p, "cannon-squadron", "play");
    const t = put(g, o, "fired-hand", "play"); // 4 life
    act(g, p, { type: "ability", iid: c, index: g.q.abilities(c)[0].index });
    answer(g, [t]);
    pass(g);
    const d = expectPending(g, "assign", p);
    expect(d.min).toBe(0);
    g.act(p, { type: "answer", assign: { [t]: 1 } });
    expect(g.s.cards[t].damage).toBe(1);
  });

  it("Colossal Flattener: may assign its battle damage to the attack's target past the blockers", () => {
    const { g, p, o } = setup();
    const f = put(g, p, "colossal-flattener", "play"); // 6 strength
    const blk = put(g, o, "fired-hand", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [f] });
    pass(g);
    pass(g);
    answer(g, [blk]);
    for (let i = 0; i < 4 && g.s.pending?.type !== "assign"; i++) pass(g);
    const d = expectPending(g, "assign", p);
    expect(d.targets).toContain("target");
    expect(d.caps).toEqual({ target: 6 });
    const inf = g.s.players[o].influence;
    g.act(p, { type: "answer", assign: { target: 6 } });
    passAll(g);
    for (let i = 0; i < 6 && g.s.battle; i++) {
      const x = g.s.pending!;
      if (x.type === "assign") g.act(x.player, { type: "answer", assign: { [x.targets[0]]: x.total } });
      else pass(g);
    }
    expect(g.s.players[o].influence).toBe(inf - 6);
  });

  it("Class-Action Defender: damage greater than 4 becomes 0", () => {
    const { g, p } = setup();
    const c = put(g, p, "class-action-defender", "play");
    g.inflict(c, 5, false);
    expect(g.s.cards[c].damage).toBe(0);
    g.inflict(c, 2, false);
    expect(g.s.cards[c].damage).toBe(2);
  });

  it("Cloaked Creeper: its attacking party is COVERT", () => {
    const { g, p, o } = setup();
    const a = put(g, p, "cloaked-creeper", "play");
    const b = put(g, p, "wanton-wizard", "play");
    put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [a, b] });
    expect(g.s.battle?.covert).toBe(true);
  });

  it("Compulsive Creeper: bigger with an even number of cards in hand", () => {
    const { g, p } = setup();
    const c = put(g, p, "compulsive-creeper", "play");
    expect(g.s.players[p].hand).toHaveLength(0);
    expect(g.q.stat(c, "str")).toBe(3);
    put(g, p, "wanton-wizard", "hand");
    expect(g.q.stat(c, "str")).toBe(2);
  });

  it("Change of Tactics: swaps the attacking party for depleted characters", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "wanton-wizard", "play");
    const fresh = put(g, p, "fired-hand", "play");
    const blk = put(g, o, "wanton-wizard", "play");
    resources(g, p, "rage", 4);
    const t = put(g, p, "change-of-tactics", "hand");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    pass(g);
    answer(g, [blk]);
    act(g, p, { type: "deploy", iid: t });
    answer(g, [fresh]);
    pass(g);
    expect(g.s.battle?.attackers).toEqual([fresh]);
    expect(g.s.cards[fresh].depleted).toBe(true);
  });

  it("Courageous Paladin: battle damage that could go to it must", () => {
    const { g, p, o } = setup();
    const atk = put(g, p, "fired-hand", "play");
    const pal = put(g, o, "courageous-paladin", "play");
    const other2 = put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [atk] });
    pass(g);
    pass(g);
    answer(g, [pal, other2]);
    for (let i = 0; i < 8 && g.s.battle; i++) {
      const d = g.s.pending!;
      if (d.type === "assign") g.act(d.player, { type: "answer", assign: { [d.targets[0]]: d.total } });
      else pass(g);
    }
    expect(g.s.cards[other2].damage).toBe(0);
    expect(g.s.cards[pal].zone).toBe("discard"); // took all 5
  });

  it("Cowering Golem: loses 1 strength and 1 life per member of the opposing party", () => {
    const { g, p, o } = setup();
    const golem = put(g, p, "cowering-golem", "play");
    const blk = [put(g, o, "wanton-wizard", "play"), put(g, o, "wanton-wizard", "play")];
    act(g, p, { type: "attack", target: "faction", attackers: [golem] });
    pass(g);
    pass(g);
    answer(g, blk);
    expect(g.q.stat(golem, "str")).toBe(3);
    expect(g.q.stat(golem, "life")).toBe(3);
  });

  it("Contiguous Defalcating Machine: a character entering play costs its controller something", () => {
    const { g, p, o } = setup();
    put(g, o, "contiguous-defalcating-machine", "play");
    resources(g, p, "rage", 2);
    const w = put(g, p, "barbaric-rifleman", "hand");
    act(g, p, { type: "deploy", iid: w });
    pass(g);
    let d = g.s.pending!;
    for (let i = 0; i < 3 && !(d.type === "choose" && d.prompt.includes("choose one")); i++) {
      answer(g, [(d as any).options[0].id]);
      d = g.s.pending!;
    }
    expect(d.player).toBe(p);
    const inf = g.s.players[p].influence;
    answer(g, [(d as any).options.find((x: any) => x.label.includes("influence")).id]);
    expect(g.s.players[p].influence).toBe(inf - 3);
  });

  it("Contriving Engineer: the Elitism it finds enters play attached to the faction", () => {
    const { g, p } = setup();
    resources(g, p, "elitism", 4);
    const e = put(g, p, "contriving-engineer", "hand");
    act(g, p, { type: "deploy", iid: e });
    pass(g);
    answer(g, ["yes"]);
    const d = expectPending(g, "choose", p);
    const found = d.options[0].id;
    answer(g, [found]);
    expect(g.s.cards[found].zone).toBe("play");
    expect(g.s.cards[found].isResource).toBe(true);
    expect(g.s.cards[found].attachedTo).toBe("faction");
  });

  it("Crow With Fists: any number of copies, and nothing left to resolve by hand", () => {
    const formats = loadFormats(join(import.meta.dirname, "../../formats"));
    const r = validateDeck(parseDeck("Faction: The Tournament Faction\n61 Rage\n14 Crow With Fists", lib), lib, formats.constructed);
    expect(r.errors).toEqual([]);
    expect(lib["crow-with-fists"].rules).toEqual([]);
  });

  it("Delectable Boon: the next X damage to the first card goes to the second, across hits", () => {
    const { g, p, o } = setup();
    const a = put(g, p, "fired-hand", "play");
    const f = g.s.players[o].factionIid;
    resources(g, p, "greed", 5);
    const t = put(g, p, "delectable-boon", "hand");
    act(g, p, { type: "deploy", iid: t });
    g.act(p, { type: "answer", value: 3 });
    answer(g, [a]);
    answer(g, [f]);
    pass(g);
    const inf = g.s.players[o].influence;
    g.inflict(a, 2, false);
    g.inflict(a, 2, false);
    expect(g.s.players[o].influence).toBe(inf - 3);
    expect(g.s.cards[a].damage).toBe(1);
  });

  it("Department of Rejections: opponents pay 2 to use a character's ability and to search", () => {
    const { g, p, o } = setup();
    put(g, o, "department-of-rejections", "play");
    const art = put(g, p, "aristocratic-artificer", "play"); // Snub: pay 1, deplete, search
    for (const r of g.q.unattached(p)) g.s.cards[r].attachedTo = "faction";
    resources(g, p, "elitism", 2);
    const idx = g.q.abilities(art)[0].index;
    act(g, p, { type: "ability", iid: art, index: idx }); // 1 + 2: can't pay
    expect(g.s.stack).toHaveLength(0);
    resources(g, p, "elitism", 1);
    act(g, p, { type: "ability", iid: art, index: idx });
    expect(g.s.stack).toHaveLength(1);
    expect(g.q.unattached(p)).toHaveLength(0);
    pass(g); // resolves: the search costs 2 more, which can't be paid
    expect(g.s.log.some((l) => l.text.includes("can't pay 2 to search"))).toBe(true);
  });

  it("Delicious Strawberry Flavored Death: depletes every non-Rogue character, skipping depleted ones", () => {
    const { g, p, o } = setup();
    const rogue = put(g, o, "agile-highwayman", "play");
    const w = put(g, o, "wanton-wizard", "play");
    const tired = put(g, o, "fired-hand", "play");
    g.s.cards[tired].depleted = true;
    resources(g, p, "deception", 5);
    const t = put(g, p, "delicious-strawberry-flavored-death", "hand");
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    expect(g.s.cards[w].depleted).toBe(true);
    expect(g.s.cards[rogue].depleted).toBe(false);
  });

  it("Cunning Ruse: the item becomes a face-down resource of its controller's opponent", () => {
    const { g, p, o } = setup();
    const item = put(g, o, "crematory-cache", "play");
    resources(g, p, "deception", 3);
    const t = put(g, p, "cunning-ruse", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [item]);
    pass(g);
    expect(g.s.cards[item].faceDown).toBe(true);
    expect(g.s.cards[item].controller).toBe(p);
  });

  it("Deity Delimitation Device: traps a character and releases one of matching cost", () => {
    const { g, p } = setup();
    const dev = put(g, p, "deity-delimitation-device", "play");
    const c = put(g, p, "fired-hand", "play"); // cost 6: 5 tokens
    act(g, p, { type: "ability", iid: dev, index: g.q.abilities(dev)[0].index });
    answer(g, [c]);
    pass(g);
    expect(g.s.cards[c].zone).toBe("void");
    expect(g.s.cards[dev].tokens).toBe(5);
    const cheap = put(g, p, "crazed-deputy", "void"); // cost 1
    g.s.cards[dev].depleted = false;
    act(g, p, { type: "ability", iid: dev, index: g.q.abilities(dev)[1].index });
    g.act(p, { type: "answer", value: 1 });
    pass(g);
    answer(g, [cheap]);
    expect(g.s.cards[cheap].zone).toBe("play");
    expect(g.s.cards[dev].tokens).toBe(4);
  });
});
