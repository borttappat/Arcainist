// Random-play fuzzing: two bots make random legal choices with decks drawn from the
// whole card pool. Rules rejections (GameError) are fine; any other exception is
// an engine bug and fails with the seed so it can be replayed.

import { describe, expect, it } from "vitest";
import { Game, GameError } from "../game.ts";
import type { Action, PlayerId } from "../types.ts";
import { legalFor } from "../view.ts";
import { lib } from "./helpers.ts";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDeck(r: () => number): string[] {
  const pool = Object.values(lib).filter((d) => !d.types.includes("faction") && !d.staple);
  const staples = ["obsession", "greed", "elitism", "deception", "rage"];
  const cards: string[] = [];
  for (let i = 0; i < 30; i++) cards.push(pool[Math.floor(r() * pool.length)].id);
  for (let i = 0; i < 25; i++) cards.push(staples[Math.floor(r() * staples.length)]);
  return cards;
}

function randomAction(g: Game, r: () => number): { p: PlayerId; a: Action } | null {
  const d = g.s.pending;
  if (!d) return null;
  const p = d.player;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const subset = <T,>(xs: T[], min: number, max: number): T[] => {
    const pool = [...xs].sort(() => r() - 0.5);
    const n = min + Math.floor(r() * (Math.min(max, pool.length) - min + 1));
    return pool.slice(0, n);
  };
  switch (d.type) {
    case "main":
    case "priority":
    case "window":
    case "endturn": {
      const legal = legalFor(g, p)!;
      const opts: Action[] = [];
      for (const iid of legal.deploy) opts.push({ type: "deploy", iid });
      for (const ab of legal.abilities) opts.push({ type: "ability", iid: ab.iid, index: ab.index });
      for (const iid of legal.flipUp) opts.push({ type: "flip_up", iid });
      if (legal.attackers.length && r() < 0.5) opts.push({ type: "attack", target: pick(legal.targets), attackers: subset(legal.attackers, 1, legal.attackers.length) });
      const finish: Action = d.type === "main" ? { type: "end_turn" } : { type: "pass" };
      // Mostly move the game along; sometimes do something.
      return { p, a: opts.length && r() < 0.6 ? pick(opts) : finish };
    }
    case "choose":
      if (d.cancellable && r() < 0.05) return { p, a: { type: "cancel" } };
      return { p, a: { type: "answer", ids: subset(d.options.map((o) => o.id), d.min, d.max) } };
    case "order":
      return { p, a: { type: "answer", ids: [...d.options.map((o) => o.id)].sort(() => r() - 0.5) } };
    case "name":
      return { p, a: { type: "answer", ids: [pick(d.options).id] } };
    case "number":
      return { p, a: { type: "answer", value: d.min + Math.floor(r() * (Math.min(d.max, d.min + 3) - d.min + 1)) } };
    case "blockers":
      return { p, a: { type: "answer", ids: subset(d.candidates, 0, d.candidates.length) } };
    case "assign": {
      const total = d.min !== undefined ? Math.floor(r() * (d.total + 1)) : d.total;
      const m: Record<string, number> = {};
      for (let i = 0; i < total; i++) {
        const t = pick(d.targets);
        m[t] = (m[t] ?? 0) + 1;
      }
      return { p, a: { type: "answer", assign: m } };
    }
    case "play_resource": {
      const hand = g.s.players[p].hand;
      if (!hand.length || (d.optional && r() < 0.3)) return { p, a: { type: "answer" } };
      const iid = pick(hand);
      const def = lib[g.s.cards[iid].defId];
      return { p, a: { type: "answer", iid, faceDown: !def.types.includes("resource") || !!def.face_down_only || r() < 0.3 } };
    }
  }
}

describe("fuzz", () => {
  it("random games never crash the engine", { timeout: 600000 }, () => {
    let games = 0;
    let actions = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = mulberry(seed * 7919);
      const g = Game.create(lib, seed, {
        A: { name: "A", faction: r() < 0.5 ? "tournament-faction" : "unlikely-heroes", cards: randomDeck(r) },
        B: { name: "B", faction: r() < 0.5 ? "tournament-faction" : "unlikely-heroes", cards: randomDeck(r) },
      });
      let rejected = 0;
      for (let i = 0; i < 600 && g.s.phase !== "ended"; i++) {
        const next = randomAction(g, r);
        if (!next) break;
        try {
          g.act(next.p, next.a);
          actions++;
        } catch (e) {
          if (!(e instanceof GameError)) {
            const tail = g.s.log.slice(-12).map((x) => x.text).join("\n  ");
            throw new Error(`seed ${seed}, action ${i} ${JSON.stringify(next.a)}: ${(e as Error).stack}\n  ${tail}`);
          }
          // A rejected random choice: fall back to passing so the game keeps moving.
          if (++rejected > 200) break;
          const d = g.s.pending!;
          try {
            if (["main"].includes(d.type)) g.act(d.player, { type: "end_turn" });
            else if (["priority", "window", "endturn"].includes(d.type)) g.act(d.player, { type: "pass" });
            else if (d.type === "choose" && d.cancellable) g.act(d.player, { type: "cancel" });
          } catch (e2) {
            if (!(e2 instanceof GameError)) throw e2;
          }
        }
      }
      games++;
    }
    expect(games).toBe(40);
    expect(actions).toBeGreaterThan(1000);
  });
});
