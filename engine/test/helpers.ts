import { join } from "node:path";
import { expect } from "vitest";
import { loadLibrary } from "../../server/library.ts";
import { Game } from "../game.ts";
import type { Action, PlayerId, Zone } from "../types.ts";

export const lib = loadLibrary(join(import.meta.dirname, "../../cards"));

const staples = (n: number, id: string) => Array.from({ length: n }, () => id);

export function newGame(seed = 1, opts: { factionA?: string; factionB?: string } = {}): Game {
  const deck = [...staples(10, "deception"), ...staples(10, "rage"), ...staples(10, "greed"), ...staples(10, "obsession"), ...staples(10, "elitism")];
  return Game.create(lib, seed, {
    A: { name: "Alice", faction: opts.factionA ?? "tournament-faction", cards: deck },
    B: { name: "Bob", faction: opts.factionB ?? "tournament-faction", cards: [...deck] },
  });
}

/** Run setup with default answers: coin winner goes first, first staples offered, no mulligan. */
export function quickStart(g: Game): void {
  while (g.s.phase === "setup") {
    const d = g.s.pending!;
    if (d.type !== "choose") throw new Error("Unexpected setup decision " + d.type);
    if (d.prompt.includes("Mulligan")) g.act(d.player, { type: "answer", ids: [] });
    else if (d.prompt.includes("search your deck")) g.act(d.player, { type: "answer", ids: [] });
    else g.act(d.player, { type: "answer", ids: [d.options[0].id] });
  }
}

/** Create a card directly in a zone, bypassing rules (test setup only). */
export function put(g: Game, p: PlayerId, defId: string, zone: Zone, opts: { faceDown?: boolean; resource?: boolean; since?: number } = {}): string {
  const iid = (g as any).newCard(defId, p, "void") as string;
  g.s.players[p].void.push(iid);
  g.move(iid, zone, { controller: p });
  const c = g.s.cards[iid];
  if (zone === "play") {
    c.isResource = !!opts.resource || !!opts.faceDown;
    c.faceDown = !!opts.faceDown;
    c.controlSince = opts.since ?? 0;
  }
  return iid;
}

export function resources(g: Game, p: PlayerId, icon: string, n: number): string[] {
  return Array.from({ length: n }, () => put(g, p, icon, "play", { resource: true }));
}

export function act(g: Game, p: PlayerId, a: Action): void {
  g.act(p, a);
}

export function answer(g: Game, ids: string[]): void {
  const d = g.s.pending!;
  g.act(d.player, { type: "answer", ids });
}

export function pass(g: Game): void {
  const d = g.s.pending!;
  g.act(d.player, { type: "pass" });
}

/** Pass until the stack is empty and no window is open. */
export function passAll(g: Game): void {
  let n = 0;
  while (g.s.pending && ["priority", "window", "endturn"].includes(g.s.pending.type)) {
    if (++n > 50) throw new Error("passAll did not settle");
    pass(g);
  }
}

export function expectPending(g: Game, type: string, player?: PlayerId) {
  expect(g.s.pending?.type).toBe(type);
  if (player) expect(g.s.pending?.player).toBe(player);
  return g.s.pending as any;
}

/** Start the first player's first turn and choose "draw" for the develop rule. */
export function toMain(g: Game): PlayerId {
  quickStart(g);
  const p = g.s.active;
  const d = expectPending(g, "choose", p);
  g.act(p, { type: "answer", ids: [d.options.findIndex((o: any) => o.label.startsWith("draw")).toString()] });
  expectPending(g, "main", p);
  return p;
}
