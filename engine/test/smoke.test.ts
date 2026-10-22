// Smoke test for every automated card: on a busy table, deploy it, use each of its
// abilities and Flip Up, answering every prompt automatically. Fails on engine
// errors and on instructions the engine doesn't understand. It doesn't check that
// a card does the right thing (scenario tests do that), only that its rules run.

import { describe, expect, it } from "vitest";
import { Game, GameError } from "../game.ts";
import { STAPLE_ICONS, other, type Action, type PlayerId } from "../types.ts";
import { lib, put } from "./helpers.ts";

const FILLER = ["wanton-wizard", "fired-hand", "deadly-striker", "cash-out", "fornicaves", "lucky-charm", "escrow-office"];

function table(seed: number) {
  const deck = [...STAPLE_ICONS.flatMap((s) => Array(6).fill(s)), ...FILLER.flatMap((f) => Array(3).fill(f))];
  const g = Game.create(lib, seed, { A: { name: "A", faction: "tournament-faction", cards: deck }, B: { name: "B", faction: "tournament-faction", cards: [...deck] } }, { first: "A" });
  drive(g, (g) => g.s.phase === "play" && g.s.pending?.type === "main");
  const p: PlayerId = "A";
  const o: PlayerId = "B";
  for (const x of [p, o]) {
    for (const icon of STAPLE_ICONS) for (let i = 0; i < 5; i++) put(g, x, icon, "play", { resource: true });
    for (const f of ["wanton-wizard", "fired-hand", "deadly-striker"]) put(g, x, f, "play");
    put(g, x, "lucky-charm", "play");
    put(g, x, "escrow-office", "play");
    for (const f of ["wanton-wizard", "cash-out", "fired-hand", "lucky-charm"]) put(g, x, f, "discard");
    for (const f of ["cash-out", "wanton-wizard"]) put(g, x, f, "hand");
  }
  put(g, p, "fired-hand", "play", { faceDown: true });
  return { g, p, o };
}

/** Answer prompts with the first legal option until `stop` holds (or nothing is pending). */
function drive(g: Game, stop: (g: Game) => boolean, limit = 150) {
  for (let i = 0; i < limit && g.s.phase !== "ended" && !stop(g); i++) {
    const d = g.s.pending;
    if (!d) return;
    let a: Action;
    switch (d.type) {
      case "choose":
        a = { type: "answer", ids: d.options.slice(0, Math.max(d.min, Math.min(1, d.max))).map((x) => x.id) };
        break;
      case "name":
        a = { type: "answer", ids: [d.options[0].id] };
        break;
      case "order":
        a = { type: "answer", ids: d.options.map((x) => x.id) };
        break;
      case "number":
        a = { type: "answer", value: Math.min(d.max, Math.max(d.min, 1)) };
        break;
      case "assign": {
        const m: Record<string, number> = {};
        if (d.targets.length) m[d.targets[0]] = d.min === undefined ? d.total : 0;
        a = { type: "answer", assign: m };
        break;
      }
      case "blockers":
        a = { type: "answer", ids: [] };
        break;
      case "play_resource":
        a = g.s.players[d.player].hand.length ? { type: "answer", iid: g.s.players[d.player].hand[0], faceDown: true } : { type: "answer" };
        break;
      case "main":
        return;
      default:
        a = { type: "pass" };
    }
    try {
      g.act(d.player, a);
    } catch (e) {
      if (!(e instanceof GameError)) throw e;
      if ("cancellable" in d && d.cancellable) g.act(d.player, { type: "cancel" });
      else if (d.type === "choose" && d.options.length > d.min) g.act(d.player, { type: "answer", ids: d.options.slice(-Math.max(1, d.min)).map((x) => x.id) });
      else throw e;
    }
  }
}

function attempt(g: Game, p: PlayerId, a: Action) {
  if (g.s.pending?.type !== "main" || g.s.pending.player !== p) return;
  try {
    g.act(p, a);
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    return;
  }
  drive(g, (g) => g.s.pending?.type === "main" && !g.s.stack.length);
}

const automated = Object.values(lib).filter((d) => d.rules?.length && !d.types.includes("faction") && !d.token && !d.id.startsWith("t-"));

describe("coverage", () => {
  it("every non-faction card with rules text has rules (`rules: []` when there is nothing to automate)", () => {
    const missing = Object.values(lib).filter((d) => !d.types.includes("faction") && (d.text ?? "").trim() && !d.rules).map((d) => d.id);
    expect(missing).toEqual([]);
  });
});

describe("smoke: every automated card runs", () => {
  for (const def of automated) {
    it(def.name, () => {
      const { g, p } = table(7);
      const unsupported = () => g.s.log.filter((e) => e.text.includes("[engine]")).map((e) => e.text);
      if (def.types.includes("resource")) {
        const iid = put(g, p, def.id, "play", { resource: true, faceDown: !!def.face_down_only });
        for (const ab of g.q.abilities(iid)) attempt(g, p, { type: "ability", iid, index: ab.index });
      } else {
        const iid = put(g, p, def.id, "hand");
        attempt(g, p, { type: "deploy", iid });
        for (const ab of g.q.abilities(iid)) attempt(g, p, { type: "ability", iid, index: ab.index });
        // From the discard pile (Recur) and as a face-down resource (Flip Up).
        const again = put(g, p, def.id, "discard");
        for (const ab of g.q.abilities(again)) attempt(g, p, { type: "ability", iid: again, index: ab.index });
        if (g.q.ruleOf(def.id === "" ? again : again, "flip_up")) {
          const fd = put(g, p, def.id, "play", { faceDown: true });
          attempt(g, p, { type: "flip_up", iid: fd });
        }
      }
      // Let a few turns pass so start/end of turn triggers run too.
      for (let i = 0; i < 2 && g.s.phase === "play"; i++) {
        const active = g.s.active;
        attempt(g, active, { type: "end_turn" });
        drive(g, (g) => g.s.pending?.type === "main");
      }
      expect(unsupported()).toEqual([]);
      void other;
    });
  }
});
