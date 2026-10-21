// Building blocks of the card language, each tested with a small test-only card.

import { describe, expect, it } from "vitest";
import { Game } from "../game.ts";
import { viewFor } from "../view.ts";
import { other, type CardDef } from "../types.ts";
import { act, answer, expectPending, lib, newGame, pass, passAll, put, resources, toMain } from "./helpers.ts";

/** Register a test-only card. */
function card(id: string, def: Partial<CardDef>): string {
  lib[id] = { id, name: id, trade: "universal", types: ["character"], stats: { str: 1, life: 2, spd: 3 }, cost: 0, ...def } as CardDef;
  return id;
}

function setup() {
  const g = newGame(1);
  const p = toMain(g);
  const o = other(p);
  for (const x of [p, o]) for (const iid of [...g.s.players[x].hand]) g.move(iid, "deck", { bottom: true });
  return { g, p, o };
}

describe("building blocks", () => {
  it("create_token: Micromajig tokens enter play and vanish when they leave", () => {
    const { g, p } = setup();
    card("t-maker", { types: ["tactic"], rules: [{ play: { effect: [{ create_token: { count: 2, as: "made" } }] } }] });
    const t = put(g, p, "t-maker", "hand");
    act(g, p, { type: "deploy", iid: t });
    pass(g);
    const tokens = g.s.players[p].play.filter((i) => g.s.cards[i].defId === "micromajig-token");
    expect(tokens).toHaveLength(2);
    expect(g.q.stat(tokens[0], "spd")).toBe(3);
    g.destroy(tokens[0]);
    expect(g.s.cards[tokens[0]].zone).toBe("void");
  });

  it("cannot_be_blocked: a party is unblockable only if all members are", () => {
    const { g, p, o } = setup();
    card("t-sneak", { rules: [{ static: { mods: [{ cannot_be_blocked: true }] } }] });
    const a = put(g, p, "t-sneak", "play");
    const b = put(g, p, "wanton-wizard", "play");
    put(g, o, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [a] });
    passAll(g);
    expect(g.s.battle).toBe(null); // nobody could block: the battle resolved without a blockers prompt
    g.s.cards[a].depleted = false;
    g.s.turnLog.attacks = {};
    act(g, p, { type: "attack", target: "faction", attackers: [a, b] });
    pass(g);
    pass(g);
    expectPending(g, "blockers", o);
  });

  it("lose_keyword: a card loses COVERT", () => {
    const { g, p } = setup();
    card("t-covert", { keywords: ["covert"] });
    const c = put(g, p, "t-covert", "play");
    expect(g.q.keyword(c, "covert")).toBe(true);
    g.s.effects.push({ id: "x", source: c, controller: p, vars: {}, mods: [{ lose_keyword: "covert", target: { iids: [c] } }], duration: "turn", turn: g.s.turn });
    expect(g.q.keyword(c, "covert")).toBe(false);
  });

  it("must_attack: you can't end the turn while it can still attack", () => {
    const { g, p } = setup();
    card("t-berserk", { rules: [{ static: { mods: [{ must_attack: true }] } }] });
    const c = put(g, p, "t-berserk", "play");
    expect(() => act(g, p, { type: "end_turn" })).toThrow(/must attack/);
    act(g, p, { type: "attack", target: "faction", attackers: [c] });
    passAll(g);
    act(g, p, { type: "end_turn" });
  });

  it("must_block and party rules are checked when blocking and attacking", () => {
    const { g, p, o } = setup();
    card("t-guard", { rules: [{ static: { mods: [{ must_block: true }] } }] });
    card("t-pair", { types: ["location"], structure: 3, rules: [{ static: { mods: [{ party: { side: "attacking", min: 2 }, target: "all" }] } }] });
    const pair = put(g, o, "t-pair", "play");
    const a = put(g, p, "wanton-wizard", "play");
    const b = put(g, p, "wanton-wizard", "play");
    expect(() => act(g, p, { type: "attack", target: "faction", attackers: [a] })).toThrow(/at least 2 members/);
    g.move(pair, "discard");
    const guard = put(g, o, "t-guard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [a, b] });
    pass(g);
    pass(g);
    expect(() => act(g, o, { type: "answer", ids: [] })).toThrow(/must block/);
    act(g, o, { type: "answer", ids: [guard] });
  });

  it("restored, depleted, moved and battle_end events reach triggers", () => {
    const { g, p } = setup();
    card("t-watch", {
      rules: [
        { trigger: { on: "restored", card: "self" }, effect: [{ draw: 1 }] },
        { trigger: { on: "moved", card: { character: { owner: "you" } }, from: "play", to: "discard" }, effect: [{ gain_influence: { amount: 1 } }] },
        { trigger: { on: "battle_end" }, effect: [{ tokens: { add: 1 } }] },
      ],
    });
    const w = put(g, p, "t-watch", "play");
    const v = put(g, p, "wanton-wizard", "play");
    act(g, p, { type: "attack", target: "faction", attackers: [w] });
    passAll(g);
    expect(g.s.cards[w].tokens).toBe(1);
    const infl = g.s.players[p].influence;
    resources(g, p, "greed", 1);
    const mh = put(g, p, "mutineers-hiatus", "hand");
    act(g, p, { type: "deploy", iid: mh });
    answer(g, [v]);
    expect(g.s.players[p].influence).toBe(infl + 1);
  });

  it("once_per_turn abilities and in-battle timing", () => {
    const { g, p } = setup();
    card("t-once", { rules: [{ ability: { name: "Ping", once_per_turn: true, effect: [{ draw: 1 }] } }, { ability: { name: "Fight", timing: { in_battle: true }, effect: [{ draw: 1 }] } }] });
    const c = put(g, p, "t-once", "play");
    act(g, p, { type: "ability", iid: c, index: 0 });
    pass(g);
    expect(g.canStart(p, { type: "ability", iid: c, index: 0 }, true)).toMatch(/once each turn/);
    expect(g.canStart(p, { type: "ability", iid: c, index: 1 }, true)).toMatch(/during a battle/);
  });

  it("remove_from_battle, top card to bottom, temporary control, enters depleted", () => {
    const { g, p, o } = setup();
    card("t-slow", { enters_depleted: true });
    const s1 = put(g, p, "t-slow", "hand");
    resources(g, p, "greed", 1);
    act(g, p, { type: "deploy", iid: s1 });
    pass(g);
    expect(g.s.cards[s1].depleted).toBe(true);

    card("t-tricks", {
      types: ["tactic"],
      rules: [{ play: { cost: [{ pick: { as: "c", from: { character: { controller: "opponent" } } } }], effect: [{ take_control: { card: "c", duration: "turn" } }, { mill: { who: "you", count: 1, to: "deck_bottom" } }] } }],
    });
    const enemy = put(g, o, "wanton-wizard", "play");
    const top = g.s.players[p].deck[0];
    const t = put(g, p, "t-tricks", "hand");
    act(g, p, { type: "deploy", iid: t });
    answer(g, [enemy]);
    pass(g);
    expect(g.s.cards[enemy].controller).toBe(p);
    expect(g.s.players[p].deck[g.s.players[p].deck.length - 1]).toBe(top);
    act(g, p, { type: "end_turn" });
    pass(g);
    expect(g.s.cards[enemy].controller).toBe(o);
  });

  it("cannot use_ability and reveal_top", () => {
    const { g, p, o } = setup();
    card("t-jam", { rules: [{ static: { mods: [{ cannot: "use_ability", target: { location: "any" } }, { reveal_top: "opponent", target: "none" }] } }] });
    put(g, p, "t-jam", "play");
    const esc = put(g, o, "escrow-office", "play");
    expect(g.canStart(o, { type: "ability", iid: esc, index: 0 }, false)).toMatch(/can't be used/);
    expect(viewFor(g, p).players[o].topCard?.iid).toBe(g.s.players[o].deck[0]);
    expect(viewFor(g, o).players[p].topCard).toBeNull();
  });
});

void Game;
