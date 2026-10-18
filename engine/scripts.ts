// Escape hatch for cards whose effect doesn't fit the card language (yet). A card
// uses `- script: name` as a step; the function gets the game, the step's context
// and task (for decisions), and the step's argument. Return "wait" after asking
// for a decision; the step is re-run with `task.answer` set. Keep scripts small:
// when a pattern repeats across cards, promote it into the card language instead.

import type { Game, StepResult } from "./game.ts";
import * as rng from "./rng.ts";
import type { Ctx, PlayerId, Task } from "./types.ts";
import { other } from "./types.ts";

export type Script = (g: Game, ctx: Ctx, task: Task, arg: any) => StepResult;

const NON_RESOURCE_TYPES = ["character", "item", "location", "tactic"] as const;

/**
 * "Each player chooses a card of each non-resource type they control / in their
 * hand; the rest go to hand / get discarded." Shared by both Spatchcocking modes.
 */
function keepOnePerType(g: Game, ctx: Ctx, task: Task, mode: "play" | "hand"): StepResult {
  const s = g.s;
  const q = g.q;
  const players: PlayerId[] = mode === "play" ? [s.active, other(s.active)] : [other(ctx.controller)];
  const cardsOf = (p: PlayerId) =>
    mode === "play" ? s.players[p].play.filter((i) => q.active(i) && !s.cards[i].isResource) : s.players[p].hand.filter((i) => !q.def(i).types.includes("resource"));
  if (!task.queue) {
    task.keep = [];
    task.queue = [];
    for (const p of players) {
      if (mode === "hand") g.log(`${g.pname(p)} reveals their hand: ${s.players[p].hand.map((i) => q.name(i)).join(", ") || "(empty)"}.`);
      for (const t of NON_RESOURCE_TYPES) if (cardsOf(p).some((i) => q.types(i).includes(t))) task.queue.push({ p, t });
    }
  }
  if (task.answer) {
    task.keep.push(task.answer.ids[0]);
    task.answer = undefined;
    task.queue.shift();
  }
  while (task.queue.length) {
    const { p, t } = task.queue[0];
    const opts = cardsOf(p).filter((i) => q.types(i).includes(t));
    if (opts.some((i) => task.keep.includes(i)) || opts.length <= 1) {
      if (opts.length === 1 && !task.keep.includes(opts[0])) task.keep.push(opts[0]);
      task.queue.shift();
      continue;
    }
    return g.ask(task, {
      type: "choose",
      player: p,
      prompt: `${q.name(ctx.source)}: choose a ${t} to keep.`,
      options: opts.map((iid) => ({ id: iid, iid, label: q.name(iid) })),
      min: 1,
      max: 1,
      list: mode === "hand",
    });
  }
  for (const p of players) {
    for (const iid of cardsOf(p)) {
      if (task.keep.includes(iid)) continue;
      if (mode === "play") {
        g.log(`${q.name(iid)} returns to its owner's hand.`);
        g.move(iid, "hand");
      } else {
        g.log(`${g.pname(p)} discards ${q.name(iid)}.`);
        g.move(iid, "discard");
      }
    }
  }
  return "ok";
}

export const SCRIPTS: Record<string, Script> = {
  /**
   * Auction House: the turn player reveals cards from the top of their deck until a
   * character; players alternate bids (active player first), limited by their
   * detached resources. The winner pays and puts the character into play.
   */
  auction_house(g, ctx, task) {
    const s = g.s;
    const q = g.q;
    const p = g.who(ctx, "player");
    if (!task.stage) {
      const deck = s.players[p].deck;
      const idx = deck.findIndex((i) => q.def(i).types.includes("character"));
      const revealed = idx >= 0 ? deck.slice(0, idx + 1) : [...deck];
      g.log(`Auction House: ${g.pname(p)} reveals ${revealed.map((i) => q.name(i)).join(", ") || "nothing"}.`);
      if (idx < 0) {
        rng.shuffle(s, deck);
        return "ok";
      }
      Object.assign(task, { stage: "bid", char: deck[idx], bid: 0, high: null, turn: s.active, passes: 0 });
    }
    if (task.answer) {
      const v = task.answer.value as number;
      if (v > task.bid) {
        task.bid = v;
        task.high = task.turn;
        task.passes = 0;
        g.log(`${g.pname(task.turn)} bids ${v}.`);
      } else {
        task.passes++;
        g.log(`${g.pname(task.turn)} passes.`);
      }
      task.answer = undefined;
      task.turn = other(task.turn);
    }
    while (!((task.high && task.passes >= 1) || task.passes >= 2)) {
      const max = q.unattached(task.turn).length;
      if (max <= task.bid) {
        task.passes++;
        task.turn = other(task.turn);
        continue;
      }
      return g.ask(task, {
        type: "number",
        player: task.turn,
        prompt: `Auction House: bid on ${q.name(task.char)} (current bid ${task.bid}${task.high ? ` by ${g.pname(task.high)}` : ""}). Bid higher, or 0 to pass.`,
        min: 0,
        max,
      });
    }
    const deck = s.players[p].deck;
    if (task.high) {
      g.payNow(task.high, task.bid);
      g.log(`${g.pname(task.high)} wins the auction for ${task.bid}.`);
      g.enterPlay(task.char, task.high);
    } else g.log("Nobody bids.");
    rng.shuffle(s, deck);
    return "ok";
  },

  /** Mistaken Identity: the responded card or ability resolves as if the other character was picked. */
  mistaken_identity(g, ctx) {
    const s = g.s;
    const vars = g.root(ctx).vars;
    const item = s.stack.find((x) => x.id === g.root(ctx).responding);
    const old = item?.pickedInCost?.[0];
    if (!item || !old || !vars.other) return "ok";
    const ictx = s.ctxs[item.ctx];
    if (!ictx) return "ok";
    const iv = g.root(ictx).vars;
    for (const [k, v] of Object.entries(iv)) {
      if (v === old) iv[k] = vars.other;
      else if (Array.isArray(v)) iv[k] = v.map((x) => (x === old ? vars.other : x));
    }
    item.pickedInCost = [vars.other];
    g.log(`${item.label} will now affect ${g.q.name(vars.other)} instead of ${g.q.name(old)}.`);
    return "ok";
  },

  /** Skin Suit: if exactly one of the two characters died, void it; the survivor gains its rules text. */
  skin_suit(g, ctx) {
    const v = g.root(ctx).vars;
    const a = v.mine as string;
    const b = v.theirs as string;
    if (!a || !b) return "ok";
    const deadA = !g.q.inPlay(a);
    const deadB = !g.q.inPlay(b);
    if (deadA === deadB) return "ok";
    const dead = deadA ? a : b;
    const alive = deadA ? b : a;
    if (g.s.cards[dead].zone === "discard") g.move(dead, "void");
    g.s.effects.push({
      id: rng.id(g.s),
      source: ctx.source,
      controller: ctx.controller,
      vars: {},
      mods: [{ grant_rules: g.q.def(dead).rules ?? [], target: { iids: [alive] } }],
      duration: "game",
      turn: g.s.turn,
    });
    g.log(`${g.q.name(alive)} gains the rules text of ${g.q.name(dead)} for the rest of the game.`);
    return "ok";
  },

  spatchcocking(g, ctx, task) {
    return keepOnePerType(g, ctx, task, "play");
  },

  spatchcocking_recur(g, ctx, task) {
    return keepOnePerType(g, ctx, task, "hand");
  },

  /**
   * Voidal Poisoning: spend tokens from cards you control on a menu of effects, any
   * number of times. Each choice removes tokens (you pick which cards when it
   * matters), runs the effect, then offers the menu again.
   */
  voidal_poisoning(g, ctx, task) {
    const s = g.s;
    const p = ctx.controller;
    const holders = () => s.players[p].play.filter((i) => s.cards[i].tokens > 0);
    const total = () => holders().reduce((n, i) => n + s.cards[i].tokens, 0);
    const menu = [
      { id: "dmg", cost: 1, label: "1 token: pick a character, inflict 1 damage to it", steps: [{ pick: { as: "vp", from: { character: "any" } } }, { damage: { card: "vp", amount: 1 } }] },
      { id: "draw", cost: 2, label: "2 tokens: draw a card", steps: [{ draw: 1 }] },
      { id: "discard", cost: 2, label: "2 tokens: your opponent discards a card", steps: [{ discard: { who: "opponent", count: 1 } }] },
      { id: "tutor", cost: 3, label: "3 tokens: search your deck for a card and put it into your hand", steps: [{ search: { deck: "you", count: 1, to: "hand" } }] },
    ];
    if (task.stage === "pay") {
      const choice = menu.find((m) => m.id === task.choice)!;
      let left = choice.cost;
      const plan = (task.answer?.assign ?? {}) as Record<string, number>;
      for (const [iid, n] of Object.entries(plan)) {
        const take = Math.min(n, s.cards[iid].tokens, left);
        s.cards[iid].tokens -= take;
        left -= take;
      }
      for (const iid of holders()) {
        const take = Math.min(left, s.cards[iid].tokens);
        s.cards[iid].tokens -= take;
        left -= take;
      }
      g.log(`Voidal Poisoning: ${choice.label}.`);
      g.push(...g.steps(choice.steps, ctx, "effect"), { t: "step", step: { script: "voidal_poisoning" }, ctx: ctx.id, phase: "effect" });
      return "ok";
    }
    if (task.answer) {
      const id = task.answer.ids[0];
      if (id === "done") return "ok";
      const choice = menu.find((m) => m.id === id)!;
      const h = holders();
      task.choice = id;
      task.stage = "pay";
      task.answer = undefined;
      if (h.length > 1 && h.some((i) => s.cards[i].tokens < choice.cost)) {
        return g.ask(task, { type: "assign", player: p, prompt: `Remove ${choice.cost} token${choice.cost === 1 ? "" : "s"} from your cards.`, total: choice.cost, targets: h });
      }
      return SCRIPTS.voidal_poisoning(g, ctx, task, undefined);
    }
    const t = total();
    const opts = menu.filter((m) => m.cost <= t).map((m) => ({ id: m.id, label: m.label }));
    if (!opts.length) return "ok";
    return g.ask(task, {
      type: "choose",
      player: p,
      prompt: `Voidal Poisoning: you have ${t} token${t === 1 ? "" : "s"} on cards you control. Spend them on:`,
      options: [...opts, { id: "done", label: "Stop" }],
      min: 1,
      max: 1,
    });
  },
};
