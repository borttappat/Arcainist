// The rules engine. A Game wraps a serializable GameState and advances it in
// response to player actions. See docs/SPEC.md for the rules model and
// docs/CARDS.md for the card language interpreted here.
//
// Execution model: work is a LIFO list of tasks in state.tasks. The run loop pops
// and executes tasks until one needs a player decision (state.pending) or the list
// is empty, at which point the engine works out whose free decision it is (main
// phase, stack priority, or an open window). After every task, state-based checks
// run and any triggers that fired are queued on top of the task list.

import * as rng from "./rng.ts";
import { Q, type Scope } from "./query.ts";
import { SCRIPTS } from "./scripts.ts";
import type { Action, CardInst, CardLibrary, Ctx, Decision, Effect, GameEvent, GameState, ManualOp, Option, PlayerId, Step, Task, Zone } from "./types.ts";
import { STAPLE_ICONS, other } from "./types.ts";

export class GameError extends Error {}

export interface DeckInput {
  name: string;
  faction: string; // card id
  cards: string[]; // card ids, one per copy
}

export type StepResult = "ok" | "wait" | "fail";

/** Decisions where the player chooses their next action freely. */
const FREE = new Set(["main", "priority", "window", "endturn"]);

export class Game {
  q: Q;

  constructor(
    public lib: CardLibrary,
    public s: GameState,
  ) {
    this.q = new Q(lib, s);
  }

  // -------------------------------------------------------------------------
  // Construction

  static create(lib: CardLibrary, seed: number, decks: Record<PlayerId, DeckInput>, opts: { first?: PlayerId; format?: string } = {}): Game {
    const s: GameState = {
      format: opts.format ?? "casual",
      rng: seed >>> 0,
      turn: 0,
      active: "A",
      first: null,
      phase: "setup",
      winner: null,
      cards: {},
      players: {} as any,
      stack: [],
      priority: null,
      window: null,
      endTurn: false,
      battle: null,
      tasks: [],
      ctxs: {},
      effects: [],
      events: [],
      turnLog: { played: [], attacks: {} },
      pending: null,
      waiting: null,
      snapshot: null,
      log: [],
    };
    const g = new Game(lib, s);
    for (const p of ["A", "B"] as PlayerId[]) {
      const d = decks[p];
      const fdef = lib[d.faction];
      if (!fdef || !fdef.types.includes("faction")) throw new GameError(`${d.name}: not a faction: ${d.faction}`);
      const fiid = g.newCard(d.faction, p, "play");
      s.players[p] = { id: p, name: d.name, factionId: d.faction, factionIid: fiid, influence: fdef.influence ?? 25, deck: [], hand: [], play: [], discard: [], void: [] };
      for (const id of d.cards) {
        if (!lib[id]) throw new GameError(`Unknown card: ${id}`);
        s.players[p].deck.push(g.newCard(id, p, "deck"));
      }
      rng.shuffle(s, s.players[p].deck);
    }
    g.log(`Game started: ${decks.A.name} (${lib[decks.A.faction].name}) vs ${decks.B.name} (${lib[decks.B.faction].name}).`);
    g.push({ t: "coin", first: opts.first }, { t: "startResources", p: "first" }, { t: "startResources", p: "second" }, { t: "equalizeResources" }, { t: "startDraw", p: "first" }, { t: "startDraw", p: "second" }, { t: "beginGame" });
    g.run();
    return g;
  }

  newCard(defId: string, owner: PlayerId, zone: Zone): string {
    let iid = rng.id(this.s);
    while (this.s.cards[iid]) iid = rng.id(this.s);
    this.s.cards[iid] = {
      iid,
      defId,
      owner,
      controller: owner,
      zone,
      faceDown: false,
      isResource: false,
      attachedTo: null,
      depleted: false,
      damage: 0,
      markers: 0,
      tokens: 0,
      controlSince: 0,
      revealed: false,
    };
    return iid;
  }

  // -------------------------------------------------------------------------
  // Public API

  /** Apply one action from a player. Throws GameError if it is not legal. */
  act(p: PlayerId, a: Action): void {
    if (this.s.phase === "ended") throw new GameError("The game is over.");
    if (a.type === "concede") {
      this.log(`${this.pname(p)} concedes.`);
      this.end(other(p));
      return;
    }
    if (a.type === "manual") {
      this.manual(p, a.op);
      return;
    }
    const d = this.s.pending;
    if (!d || d.player !== p) throw new GameError("It is not your decision.");

    if (FREE.has(d.type)) {
      this.free(p, d, a);
    } else if (a.type === "cancel") {
      if (!("cancellable" in d && d.cancellable) || !this.s.snapshot) throw new GameError("This can't be cancelled now.");
      this.rollback("Cancelled.");
    } else if (a.type === "answer") {
      this.validateAnswer(d, a);
      const task = this.s.waiting!;
      task.answer = a;
      this.s.pending = null;
      this.s.waiting = null;
      this.s.tasks.push(task);
    } else {
      throw new GameError("Answer the current prompt first.");
    }
    this.run();
  }

  // -------------------------------------------------------------------------
  // Run loop

  private run(): void {
    let guard = 0;
    while (this.s.phase !== "ended" && !this.s.pending) {
      if (++guard > 20000) throw new Error("Engine loop did not settle");
      // Events raised directly by a player action (declaring an attack) still need
      // their state checks and triggers before anyone gets a decision.
      if (this.s.events.length && !this.s.tasks.length) {
        this.checks();
        continue;
      }
      const task = this.s.tasks.pop();
      if (task) {
        this.exec(task);
        this.checks();
        continue;
      }
      if (this.s.phase !== "play") break;
      this.s.pending = this.freeDecision();
    }
  }

  private freeDecision(): Decision {
    const s = this.s;
    if (s.stack.length) return { type: "priority", player: s.priority ?? other(s.stack[s.stack.length - 1].controller) };
    if (s.window?.kind === "endturn") return { type: "endturn", player: s.window.current };
    if (s.window) return { type: "window", player: s.window.current, label: this.windowLabel() };
    return { type: "main", player: s.active };
  }

  private windowLabel(): string {
    const b = this.s.battle;
    if (!b) return "";
    if (this.s.window?.next === "blockers") return "Attack declared";
    if (this.s.window?.next === "assign") return `Before speed ${b.speed} assigns damage`;
    if (this.s.window?.next === "inflict") return `Before speed ${b.speed} damage is inflicted`;
    return "Battle";
  }

  /** Push tasks so that the first argument runs first. */
  push(...tasks: Task[]): void {
    for (let i = tasks.length - 1; i >= 0; i--) this.s.tasks.push(tasks[i]);
  }

  ask(task: Task, d: Decision): StepResult {
    this.s.pending = d;
    this.s.waiting = task;
    return "wait";
  }

  /**
   * Undo an action whose costs couldn't be paid (or were cancelled). Log lines
   * written while paying were private to the acting player; drop them, so the
   * opponent never learns the attempt happened.
   */
  private rollback(msg: string): void {
    const actor = this.s.costActor!;
    const restored = JSON.parse(this.s.snapshot!) as GameState;
    restored.log = this.s.log.filter((e) => !e.held);
    for (const k of Object.keys(this.s)) delete (this.s as any)[k];
    Object.assign(this.s, restored);
    this.s.snapshot = null;
    this.s.costActor = null;
    this.s.pending = null;
    this.s.waiting = null;
    this.log(msg, actor);
  }

  /** Start paying costs for player p: snapshot for rollback and hold log lines. */
  private takeSnapshot(p: PlayerId): void {
    this.s.snapshot = null;
    this.s.costActor = p;
    const { log, ...rest } = this.s;
    void log;
    this.s.snapshot = JSON.stringify({ ...rest, log: [] });
  }

  /** Costs are paid and the card or ability is on the stack: publish the held log lines. */
  private commitCosts(): void {
    this.s.snapshot = null;
    this.s.costActor = null;
    for (const e of this.s.log) {
      if (!e.held) continue;
      delete e.held;
      delete e.to;
    }
  }

  // -------------------------------------------------------------------------
  // Free actions

  private free(p: PlayerId, d: Decision, a: Action): void {
    const s = this.s;
    const main = d.type === "main";
    switch (a.type) {
      case "pass": {
        s.pending = null;
        if (d.type === "priority") {
          s.priority = null;
          this.push({ t: "resolve" });
        } else if (d.type === "window") {
          const w = s.window!;
          w.passes++;
          if (w.passes >= 2) {
            s.window = null;
            s.battle!.step = w.next!;
            this.push({ t: "battle" });
          } else w.current = other(w.current);
        } else if (d.type === "endturn") {
          s.window = null;
          this.push({ t: "finishTurn" });
        } else throw new GameError("Use End turn to finish your turn.");
        return;
      }
      case "end_turn": {
        if (!main) throw new GameError("You can only end your turn when nothing else is happening.");
        const must = this.q.characters(p).filter((i) => this.q.modsFor("must_attack", i).length && this.q.canAttack(i));
        if (must.length) throw new GameError(`${must.map((i) => this.q.name(i)).join(", ")} must attack this turn if able.`);
        s.pending = null;
        s.endTurn = true;
        s.window = { kind: "endturn", current: other(p), passes: 0 };
        this.log(`${this.pname(p)} ends their turn.`);
        return;
      }
      case "attack": {
        if (!main) throw new GameError("You can only attack when nothing else is happening.");
        this.declareAttack(p, a.target, a.attackers);
        s.pending = null;
        return;
      }
      case "deploy":
      case "ability":
      case "flip_up": {
        const err = this.canStart(p, a, main);
        if (err) throw new GameError(err);
        s.pending = null;
        if (s.window) {
          s.window.passes = 0;
          if (s.window.kind === "battle") s.window.current = other(p);
        }
        const responding = s.stack.length ? s.stack[s.stack.length - 1].id : undefined;
        if (a.type === "deploy") this.push({ t: "deploy", p, iid: a.iid, responding });
        else if (a.type === "ability") this.push({ t: "activate", p, iid: a.iid, index: a.index, responding });
        else this.push({ t: "deploy", p, iid: a.iid, flipUp: true, responding });
        return;
      }
      default:
        throw new GameError("That action isn't available right now.");
    }
  }

  /** Can this card be deployed at tactic speed (Tactical, or "whenever you could play a tactic")? */
  private tacticSpeed(iid: string): boolean {
    const d = this.q.def(iid);
    return d.types.includes("tactic") || (d.keywords ?? []).some((k) => k.toLowerCase() === "tactical") || this.q.modsFor("tactical", iid).length > 0;
  }

  /** Check a rule's timing restrictions ("only during your turn", "only in response to"). */
  private timingOk(timing: any, p: PlayerId, scope: Scope): string | null {
    if (!timing) return null;
    const s = this.s;
    const top = s.stack[s.stack.length - 1];
    if (timing.your_turn && s.active !== p) return "Only during your turn.";
    if (timing.in_battle && !s.battle) return "Only during a battle.";
    if (timing.not_in_battle && s.battle) return "Not during a battle.";
    if (timing.after_end_turn && !(s.endTurn && s.active === p)) return "Only after you have declared the end of your turn.";
    const r = timing.response_to;
    if (r) {
      if (!top || top.controller === p) return "Only in response to your opponent.";
      if (top.noResponse) return "That can't be responded to.";
      if (r.deploying !== undefined) {
        if (top.kind !== "card" || !this.q.matches(r.deploying, top.iid, scope, null)) return "Only in response to a matching card being deployed.";
        // "Only in response to a card being deployed using FLIP UP"
        if (r.via && this.s.ctxs[top.ctx]?.via !== r.via) return "Only in response to a card deployed using FLIP UP.";
      }
      if (r.ability !== undefined) {
        if (top.kind !== "ability") return "Only in response to an ability.";
        if (r.ability !== true && !this.q.matches(r.ability, top.iid, { ...scope, controller: p }, null)) return "Only in response to a matching ability.";
      }
      if (r.picked_character_as_cost && !(top.pickedInCost ?? []).length) return "Only in response to something that picked a character as a cost.";
    }
    return null;
  }

  /** Returns an error message, or null if the player may start this action now. */
  canStart(p: PlayerId, a: Action, main: boolean): string | null {
    const q = this.q;
    const s = this.s;
    const top = s.stack[s.stack.length - 1];
    if (top?.noResponse && top.controller !== p) return "That can't be responded to.";
    if (a.type === "deploy" || a.type === "flip_up") {
      const c = s.cards[a.iid];
      if (!c) return "No such card.";
      const def = q.def(a.iid);
      const scope: Scope = { controller: p, source: a.iid, vars: {} };
      if (a.type === "deploy") {
        const grant = c.zone !== "hand" || c.owner !== p ? q.playGrant(a.iid, p) : null;
        if ((c.zone !== "hand" || c.owner !== p) && !grant) return "That card isn't in your hand.";
        if (def.types.includes("resource")) return "Resources are played through your faction's develop rule or abilities.";
        if (!grant?.ignoreThreshold && !q.meets(p, def.threshold, q.thresholdReduction(a.iid))) return "You don't meet that card's threshold.";
      } else {
        const fu = q.ruleOf(a.iid, "flip_up");
        if (!fu) return "That card has no Flip Up.";
        // "Your opponents cannot use FLIP UP" (Lockbox of the Aeons).
        if (q.cannot("flip_up", a.iid, p)) return "You can't use Flip Up right now.";
        if (c.zone !== "play" || !c.faceDown || c.controller !== p) return "Flip Up only works on your face-down resources.";
        if (!q.meets(p, fu.threshold)) return "You don't meet the Flip Up threshold.";
      }
      if (q.cannot("play", a.iid, p)) return "That card can't be played right now.";
      const tactic = this.tacticSpeed(a.iid);
      if (!main && !tactic) return "Only tactics can be played right now.";
      if (main && !tactic && s.active !== p) return "You can only play that on your turn.";
      const play = q.ruleOf(a.iid, "play");
      return this.timingOk(play?.timing, p, scope);
    }
    if (a.type === "ability") {
      const c = s.cards[a.iid];
      if (!c) return "No such card.";
      const ab = q.abilities(a.iid).find((x) => x.index === a.index);
      if (!ab) return "No such ability.";
      // "Only an opponent may use this ability" (iDumb De-Itemizer).
      if (ab.rule.both_players === "opponent" && c.controller === p) return "Only an opponent may use that ability.";
      const from = ab.rule.from ?? ab.rule.usable_from ?? (q.isFaction(a.iid) ? "faction" : "play");
      const mine = c.controller === p || (q.mods("use_opponent_abilities").some((m) => m.controller === p) && c.zone === "play");
      const where =
        from === "faction"
          ? c.zone === "play" && (c.controller === p || !!ab.rule.both_players)
          : from === "play"
            ? q.active(a.iid) && (mine || !!ab.rule.both_players)
            : from === "face_down_resource"
              ? c.zone === "play" && c.faceDown && c.isResource && c.controller === p
              : from === "discard"
                ? c.zone === "discard" && c.owner === p
                : from === "hand"
                  ? c.zone === "hand" && c.owner === p
                  : false;
      if (!where) return "You can't use that ability from where the card is.";
      if (q.cannot("use_ability", a.iid, p)) return "That card's abilities can't be used right now.";
      if (ab.rule.once_per_turn && s.turnLog.abilities?.[`${a.iid}:${a.index}`]) return "That ability can only be used once each turn.";
      if (!q.meets(p, ab.rule.threshold)) return "You don't meet that ability's threshold.";
      return this.timingOk(ab.rule.timing, p, { controller: p, source: a.iid, vars: {} });
    }
    return "Not an action.";
  }

  private validateAnswer(d: Decision, a: Extract<Action, { type: "answer" }>): void {
    switch (d.type) {
      case "choose":
      case "name": {
        const ids = a.ids ?? [];
        const min = d.type === "choose" ? d.min : 1;
        const max = d.type === "choose" ? d.max : 1;
        if (ids.length < min || ids.length > max) throw new GameError(`Choose between ${min} and ${max}.`);
        const valid = new Set(d.options.map((o) => o.id));
        if (!ids.every((i) => valid.has(i))) throw new GameError("Invalid choice.");
        if (new Set(ids).size !== ids.length) throw new GameError("Duplicate choice.");
        return;
      }
      case "order": {
        const ids = a.ids ?? [];
        const want = d.options.map((o) => o.id).sort();
        if ([...ids].sort().join() !== want.join()) throw new GameError("Put every card in order.");
        return;
      }
      case "number": {
        const v = a.value;
        if (v === undefined || !Number.isInteger(v) || v < d.min || v > d.max) throw new GameError(`Pick a whole number from ${d.min} to ${d.max}.`);
        return;
      }
      case "blockers": {
        const ids = a.ids ?? [];
        if (!ids.every((i) => d.candidates.includes(i))) throw new GameError("Invalid blocker.");
        const err = this.partyRuleError(ids, "blocking", d.player);
        if (err) throw new GameError(err);
        // "must block if it can"
        const missing = d.candidates.filter((i) => this.q.modsFor("must_block", i).length && !ids.includes(i));
        if (missing.length) throw new GameError(`${missing.map((i) => this.q.name(i)).join(", ")} must block if able.`);
        return;
      }
      case "assign": {
        const m = a.assign ?? {};
        const sum = Object.values(m).reduce((x, y) => x + y, 0);
        if (Object.keys(m).some((k) => !d.targets.includes(k))) throw new GameError("Invalid target.");
        if (Object.values(m).some((v) => !Number.isInteger(v) || v < 0)) throw new GameError("Amounts must be whole numbers.");
        if (sum > d.total || sum < (d.min ?? d.total)) throw new GameError(d.min === undefined ? `Assign exactly ${d.total}.` : `Assign between ${d.min} and ${d.total}.`);
        for (const [k, cap] of Object.entries(d.caps ?? {})) if ((m[k] ?? 0) > cap) throw new GameError(`At most ${cap} can go to ${d.labels?.[k] ?? "that card"}.`);
        return;
      }
      case "play_resource": {
        if (!a.iid) {
          if (!d.optional) throw new GameError("Pick a card to play as a resource.");
          return;
        }
        const c = this.s.cards[a.iid];
        if (!c || c.zone !== "hand" || c.owner !== d.player) throw new GameError("That card isn't in your hand.");
        const def = this.lib[c.defId];
        if (!a.faceDown && !def.types.includes("resource")) throw new GameError("Only resource cards can be played face-up.");
        if (!a.faceDown && def.face_down_only) throw new GameError("That resource may only be played face-down.");
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Task dispatch

  private exec(task: Task): void {
    const h = (this as any)["t_" + task.t];
    if (!h) throw new Error(`Unknown task ${task.t}`);
    h.call(this, task);
  }

  // --- setup ---------------------------------------------------------------

  /** Who goes first: chosen when the room was created, or random. */
  protected t_coin(task: Task): void {
    const chosen = task.first as PlayerId | undefined;
    this.s.first = chosen ?? (rng.int(this.s, 2) === 0 ? "A" : "B");
    this.s.active = this.s.first;
    this.log(`${this.pname(this.s.first)} goes first${chosen ? "" : " (random)"}.`);
  }

  private seat(which: string): PlayerId {
    return which === "first" ? this.s.first! : other(this.s.first!);
  }

  /**
   * Starting resources, from the faction's JSON:
   *   specific: { obsession: 1 }    these staples, face-up (no choice)
   *   face_down: { obsession: 1 }   these staples, face-down
   *   any_staples / different_staples: N   staples the player chooses
   *   any_resources: N              any resource cards the player chooses
   *   any_cards_face_down: N        any cards, put into play face-down
   *   choose_staples: N             choose X from 1 to N, then X staples (Money for Nothing)
   */
  protected t_startResources(task: Task): void {
    const p = this.seat(task.p);
    const ps = this.s.players[p];
    const sr: Record<string, any> = this.lib[ps.factionId].starting_resources ?? {};
    const findStaple = (icon: string) => ps.deck.find((i) => this.q.def(i).staple && this.q.def(i).icon === icon);
    if (!task.plan) {
      task.plan = [] as { kind: string }[];
      for (const [icon, n] of Object.entries(sr.specific ?? {})) for (let i = 0; i < (n as number); i++) task.plan.push({ kind: "specific", icon });
      for (const [icon, n] of Object.entries(sr.face_down ?? {})) for (let i = 0; i < (n as number); i++) task.plan.push({ kind: "face_down", icon });
      if (sr.choose_staples) task.plan.push({ kind: "choose_x", max: sr.choose_staples });
      for (let i = 0; i < (sr.any_staples ?? 0); i++) task.plan.push({ kind: "staple" });
      for (let i = 0; i < (sr.different_staples ?? 0); i++) task.plan.push({ kind: "different_staple" });
      for (let i = 0; i < (sr.any_resources ?? 0); i++) task.plan.push({ kind: "resource" });
      for (let i = 0; i < (sr.any_cards_face_down ?? 0); i++) task.plan.push({ kind: "card_face_down" });
      task.chosen = [] as string[];
    }
    if (task.answer) {
      const step = task.plan.shift();
      if (step.kind === "choose_x") {
        for (let i = 0; i < task.answer.value; i++) task.plan.unshift({ kind: "staple" });
      } else {
        const id = task.answer.ids[0];
        const iid = step.kind === "card_face_down" ? id : ps.deck.find((i) => this.s.cards[i].defId === id)!;
        this.putResource(p, iid, step.kind === "card_face_down", true);
        task.chosen.push(this.s.cards[iid].defId);
      }
      delete task.answer;
    }
    while (task.plan.length) {
      const step = task.plan[0];
      if (step.kind === "specific" || step.kind === "face_down") {
        task.plan.shift();
        const iid = findStaple(step.icon);
        if (iid) this.putResource(p, iid, step.kind === "face_down", true);
        else this.log(`${this.pname(p)} has no ${step.icon} staple to start with.`);
        continue;
      }
      if (step.kind === "choose_x") {
        return void this.ask(task, { type: "number", player: p, prompt: `${this.lib[ps.factionId].name}: choose a number for X (you start with X staple resources).`, min: 1, max: step.max });
      }
      if (step.kind === "card_face_down") {
        if (!ps.deck.length) {
          task.plan.shift();
          continue;
        }
        return void this.ask(task, { type: "choose", player: p, prompt: "Choose a card from your deck to start with as a face-down resource.", options: ps.deck.map((iid) => ({ id: iid, iid, label: this.q.name(iid) })), min: 1, max: 1, list: true });
      }
      const available = new Map<string, number>();
      for (const iid of ps.deck) {
        const d = this.q.def(iid);
        if (step.kind === "resource" ? !d.types.includes("resource") : !d.staple) continue;
        if (step.kind === "different_staple" && (task.chosen.includes(d.id) || this.q.resources(p).some((r) => this.s.cards[r].defId === d.id))) continue;
        available.set(d.id, (available.get(d.id) ?? 0) + 1);
      }
      if (!available.size) {
        task.plan.shift();
        this.log(`${this.pname(p)} has no more ${step.kind === "resource" ? "resources" : "staple resources"} to start with.`);
        continue;
      }
      return void this.ask(task, {
        type: "choose",
        player: p,
        prompt: `Choose a starting ${step.kind === "resource" ? "resource" : "staple resource"}${step.kind === "different_staple" ? " (different from your others)" : ""}.`,
        options: [...available].map(([id, n]) => ({ id, label: `${this.lib[id].name} (${n} in deck)` })),
        min: 1,
        max: 1,
      });
    }
    rng.shuffle(this.s, ps.deck);
  }

  /** Money for Nothing: the opponent gets staples until both have the same number of resources. */
  protected t_equalizeResources(task: Task): void {
    for (const p of ["A", "B"] as PlayerId[]) {
      if (!this.lib[this.s.players[p].factionId].opponent_rules?.equalize_starting_resources) continue;
      const o = other(p);
      const need = this.q.resources(p).length - this.q.resources(o).length;
      if (need <= 0) continue;
      if (task.answer) {
        const id = task.answer.ids[0];
        const iid = this.s.players[o].deck.find((i) => this.s.cards[i].defId === id)!;
        this.putResource(o, iid, false, true);
        delete task.answer;
        return void this.s.tasks.push(task);
      }
      const opts = [...new Set(this.s.players[o].deck.filter((i) => this.q.def(i).staple).map((i) => this.s.cards[i].defId))];
      if (!opts.length) continue;
      return void this.ask(task, { type: "choose", player: o, prompt: `Money for Nothing: choose a staple resource to start with (${need} more to match).`, options: opts.map((id) => ({ id, label: this.lib[id].name })), min: 1, max: 1 });
    }
    for (const p of ["A", "B"] as PlayerId[]) rng.shuffle(this.s, this.s.players[p].deck);
  }

  protected t_startDraw(task: Task): void {
    const p = this.seat(task.p);
    let fdef = this.lib[this.s.players[p].factionId];
    // The Knitting Coalition: "Your opponent ignores their faction's STARTING DRAW and uses this card's."
    const opp = this.lib[this.s.players[other(p)].factionId];
    if (opp.opponent_rules?.starting_draw === "this") fdef = { ...opp, starting_draw: { first: opp.starting_draw!.first, second: opp.starting_draw!.second } };
    const sd = fdef.starting_draw ?? { first: 8, second: 9 };
    const ctx = this.newCtx(p, this.s.players[p].factionIid);
    this.push(...this.steps(sd.before ?? [], ctx, "effect"), { t: "draw", p, n: task.p === "first" ? sd.first : sd.second }, { t: "mulligan", p });
  }

  protected t_mulligan(task: Task): void {
    const p = task.p as PlayerId;
    const hand = this.s.players[p].hand;
    if (!task.answer) {
      this.ask(task, {
        type: "choose",
        player: p,
        prompt: "Mulligan: choose any cards to put on the bottom of your deck and redraw.",
        options: hand.map((iid) => ({ id: iid, iid, label: this.q.name(iid) })),
        min: 0,
        max: hand.length,
        list: true,
      });
      return;
    }
    const ids: string[] = task.answer.ids;
    for (const iid of ids) this.move(iid, "deck", { bottom: true });
    this.log(`${this.pname(p)} mulligans ${ids.length} card${ids.length === 1 ? "" : "s"}.`);
    if (ids.length) this.drawCards(p, ids.length);
  }

  protected t_beginGame(): void {
    this.s.phase = "play";
    this.push({ t: "startTurn" });
  }

  // --- turn ----------------------------------------------------------------

  protected t_startTurn(): void {
    const s = this.s;
    s.turn++;
    const p = s.active;
    this.log(`--- Turn ${s.turn}: ${this.pname(p)} ---`);
    for (const c of Object.values(s.cards)) c.damage = 0;
    s.turnLog = { played: [], attacks: {} };
    // "This turn" effects end; "until the start of your next turn" ends for this player.
    s.effects = s.effects.filter((e) => {
      if (e.duration === "turn" || e.duration === "next" || e.duration === "battle") return false;
      if (e.duration === "until_your_next_turn" && e.controller === p) return false;
      return true;
    });
    // The faction's restore and develop rules and every "at the start of your turn"
    // trigger become available together; the turn player orders them. When only the
    // faction's own rules are there, they run in printed order without asking.
    const fdef = this.lib[s.players[p].factionId];
    const fiid = s.players[p].factionIid;
    // The Knitting Coalition: "Your opponent ignores their faction's DEVELOP RULE."
    const noDevelop = this.lib[s.players[other(p)].factionId].opponent_rules?.develop_rule === "none";
    const rules: Task[] = [];
    const rule = (steps: Step[] | undefined, label: string) => {
      if (!steps?.length) return;
      const ctx = this.newCtx(p, fiid);
      ctx.vars.by_rule = true;
      rules.push({ t: "trigger", iid: fiid, effect: steps, ctx: ctx.id, label, quiet: true });
    };
    rule(fdef.restore_rule, "Restore rule");
    if (!noDevelop) rule(fdef.develop_rule, "Develop rule");
    const cards = this.triggersFor({ e: "start_of_turn", player: p });
    if (!cards.length) this.push(...rules);
    else this.s.tasks.push({ t: "orderTriggers", list: [...rules, ...cards] });
  }

  protected t_finishTurn(): void {
    this.emit({ e: "end_of_turn", player: this.s.active });
    this.push({ t: "nextTurn" });
  }

  protected t_nextTurn(): void {
    const s = this.s;
    if (!s.endTurn) return; // the end of turn was terminated (Lost on Floor 3)
    s.endTurn = false;
    s.active = other(s.active);
    this.push({ t: "startTurn" });
  }

  protected t_emit(task: Task): void {
    this.emit(task.ev);
  }

  protected t_draw(task: Task): void {
    this.drawCards(task.p, task.n);
  }

  // --- deploying cards and using abilities ---------------------------------

  /** Move a card onto the stack and pay its costs. Rolls back if any cost fails. */
  protected t_deploy(task: Task): void {
    const p = task.p as PlayerId;
    const iid = task.iid as string;
    const c = this.q.card(iid);
    const def = this.q.def(iid);
    if (!task.nested) this.takeSnapshot(p);
    const ctx = this.newCtx(p, iid);
    ctx.responding = task.responding;
    ctx.via = task.flipUp ? "flip_up" : task.viaEffect ? "effect" : "normal";
    ctx.free = !!task.free;
    const grant = c.zone !== "hand" ? this.q.playGrant(iid, p) : null;
    ctx.ignoreThreshold = !!task.ignoreThreshold || !!grant?.ignoreThreshold;
    const play = this.q.ruleOf(iid, "play") ?? {};
    const extra: Step[] = [];
    if (task.flipUp) {
      const fu = this.q.ruleOf(iid, "flip_up");
      ctx.costOverride = fu.pay;
      extra.push(...(fu.cost ?? []));
      this.log(`${this.pname(p)} flips up ${def.name}.`);
    } else {
      const from = c.zone === "hand" ? "" : c.zone === "discard" ? " from a discard pile" : c.zone === "void" ? " from the void" : "";
      this.log(`${this.pname(p)} plays ${def.name}${from}.`);
    }
    this.move(iid, "stack");
    c.controller = p;
    // "Attach to Character" (a type), or a selector ("Attach to character you control").
    const hostSel = typeof def.attach_to === "string" ? { [def.attach_to]: "any" } : def.attach_to;
    const attach: Step[] = def.attach_to ? [{ pick: { as: "__host", from: hostSel } }] : [];
    this.push(
      ...this.steps([...attach, ...(play.cost ?? []), ...extra], ctx, "cost"),
      { t: "payNumeric", ctx: ctx.id, base: def.cost ?? 0, deploying: iid },
      { t: "deployed", iid, ctx: ctx.id, label: def.name, noResponse: !!play.no_response },
    );
  }

  protected t_activate(task: Task): void {
    const p = task.p as PlayerId;
    const ab = this.q.abilities(task.iid).find((x) => x.index === task.index)!;
    this.takeSnapshot(p);
    const src = this.q.card(task.iid);
    // Borrowed abilities (The Billionaire) keep the card's controller as "you";
    // abilities "both players may use" belong to whoever uses them.
    const ctx = this.newCtx(src.zone === "play" && !ab.rule.both_players ? src.controller : p, task.iid);
    ctx.actor = p;
    ctx.responding = task.responding;
    const label = src.faceDown ? `${ab.rule.name} (face-down card)` : `${this.q.name(task.iid)}: ${ab.rule.name}`;
    this.log(`${this.pname(p)} uses ${label}.`);
    this.push(...this.steps(ab.rule.cost ?? [], ctx, "cost"), { t: "payNumeric", ctx: ctx.id, base: 0 }, { t: "activated", iid: task.iid, index: task.index, ctx: ctx.id, label, noResponse: !!ab.rule.no_response });
  }

  /** Final numeric cost after cost modifiers. Marks used "next" effects when `apply`. */
  private numericCost(ctx: Ctx, base: number, deploying: string | undefined, apply: boolean): number {
    if (ctx.free) return Math.max(0, ctx.pay);
    let total = (ctx.costOverride ?? base) + ctx.pay;
    const payer = ctx.actor;
    let up = 0;
    let down = 0;
    let min = 0;
    // "Reduce the cost by 2, to a minimum of 1": reductions with a floor stop there.
    let floor = 0;
    const used: Effect[] = [];
    for (const m of this.q.mods("cost")) {
      if (!this.q.by(m, payer)) continue;
      const applies = m.mod.applies ?? "deploy";
      if (applies === "deploy" && (!deploying || !this.q.targets(m, deploying))) continue;
      // Abilities only ("must pay 2 to use a character's ability").
      if (applies === "ability" && (deploying || (m.mod.target && !this.q.targets(m, ctx.source)))) continue;
      if (applies === "flip_up" && (ctx.via !== "flip_up" || !deploying || !this.q.targets(m, deploying))) continue;
      // For abilities, the target is the card whose ability it is.
      if (applies === "any" && m.mod.target && !this.q.targets(m, deploying ?? ctx.source)) continue;
      const v = this.q.value(m.value, m.scope);
      if (v > 0) up += v;
      else down -= v;
      if (v < 0 && m.mod.floor !== undefined) floor = Math.max(floor, this.q.value(m.mod.floor, m.scope));
      if (m.effect?.duration === "next") used.push(m.effect);
    }
    for (const m of this.q.mods("cost_min")) {
      if (!this.q.by(m, payer) || !deploying || !this.q.targets(m, deploying)) continue;
      min = Math.max(min, this.q.value(m.value, m.scope));
    }
    const before = Math.max(total + up, min);
    total = Math.max(before - down, Math.min(floor, before));
    if (apply) for (const e of used) e.used = true;
    return Math.max(0, total);
  }

  protected t_payNumeric(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    const p = ctx.actor;
    const hasNumeric = task.deploying !== undefined || ctx.pay > 0;
    // An ability with no numeric cost still pays cost increases (Department of Rejections).
    if (!hasNumeric && this.numericCost(ctx, task.base, task.deploying, false) <= 0) return;
    const total = this.numericCost(ctx, task.base, task.deploying, false);
    if (total <= 0) {
      this.numericCost(ctx, task.base, task.deploying, true);
      return;
    }
    const avail = this.q.unattached(p);
    if (avail.length < total) {
      this.fail(`Not enough resources: need ${total}, have ${avail.length}.`);
      return;
    }
    const finish = (ids: string[]) => {
      this.numericCost(ctx, task.base, task.deploying, true);
      this.attach(ids);
    };
    if (task.answer) return finish(task.answer.ids);
    // Which face-up resource is attached never matters (threshold counts attached
    // resources too), so attach those first. Only ask when some, but not all, of
    // the face-down resources must be used, since their abilities may care.
    const up = avail.filter((i) => !this.s.cards[i].faceDown);
    if (total <= up.length) return finish(up.slice(0, total));
    if (total === avail.length) return finish(avail);
    this.ask(task, {
      type: "choose",
      player: p,
      prompt: `Pay ${total}: choose resources to attach to your faction.`,
      options: avail.map((iid) => ({ id: iid, iid, label: this.resourceLabel(iid) })),
      min: total,
      max: total,
      cancellable: !!this.s.snapshot,
    });
  }

  private attach(ids: string[]): void {
    for (const iid of ids) this.s.cards[iid].attachedTo = "faction";
  }

  /** Pay n immediately (outside of a cost), choosing resources automatically. */
  payNow(p: PlayerId, n: number): boolean {
    if (n <= 0) return true;
    const avail = this.q.unattached(p);
    if (avail.length < n) return false;
    const sorted = [...avail.filter((i) => !this.s.cards[i].faceDown), ...avail.filter((i) => this.s.cards[i].faceDown)];
    this.attach(sorted.slice(0, n));
    return true;
  }

  protected t_deployed(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    this.commitCosts();
    const iid = task.iid as string;
    this.s.stack.push({ id: rng.id(this.s), kind: "card", controller: ctx.controller, iid, ctx: ctx.id, label: task.label, noResponse: task.noResponse, pickedInCost: ctx.picked });
    this.s.priority = other(ctx.controller);
    this.s.turnLog.played.push({ iid, defId: this.s.cards[iid].defId, player: ctx.controller, types: this.q.def(iid).types, cost: this.q.numericCost(iid) });
    this.emit({ e: "played", iid, player: ctx.controller });
  }

  protected t_activated(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    (this.s.turnLog.abilities ??= {})[`${task.iid}:${task.index}`] = true;
    this.commitCosts();
    this.s.stack.push({ id: rng.id(this.s), kind: "ability", controller: ctx.actor, iid: task.iid, rule: task.index, ctx: ctx.id, label: task.label, noResponse: task.noResponse, pickedInCost: ctx.picked });
    this.s.priority = other(ctx.actor);
    this.emit({ e: "ability_used", iid: task.iid, player: ctx.actor });
  }

  protected t_resolve(): void {
    const item = this.s.stack.pop()!;
    const ctx = this.s.ctxs[item.ctx];
    if (item.nullified) {
      this.log(`${item.label} has no effect.`);
      if (item.kind === "card" && this.s.cards[item.iid].zone === "stack") this.move(item.iid, "discard");
      this.push({ t: "afterResolve", ctx: item.ctx });
      return;
    }
    this.log(`${item.label} resolves.`);
    // `rules: []` marks a card with nothing to automate (its text is a deckbuilding rule).
    if (item.kind === "card" && !this.q.def(item.iid).rules && this.q.def(item.iid).text) {
      this.log(`${item.label} isn't automated yet: resolve its text with the manual controls.`);
    }
    if (item.kind === "ability") {
      const rule = this.q.rules(item.iid)[item.rule!]?.ability;
      this.push(...this.steps(rule?.effect ?? [], ctx, "effect"), { t: "afterResolve", ctx: ctx.id });
      return;
    }
    if (item.kind === "duplicate") {
      const play = this.lib[ctx.vars.__dupDef].rules?.find((r) => r.play)?.play ?? {};
      this.push(...this.steps(play.effect ?? [], ctx, "effect"), { t: "afterResolve", ctx: ctx.id });
      return;
    }
    const def = this.q.def(item.iid);
    const play = this.q.ruleOf(item.iid, "play") ?? {};
    // A tactic that attaches to a character (the God's Blessings) stays in play attached.
    const permanent = def.types.some((t) => t === "character" || t === "item" || t === "location") || !!def.attach_to;
    if (permanent) {
      const host = ctx.vars.__host;
      if (def.attach_to && (!host || !this.q.isCharacter(host))) {
        this.log(`${def.name} has nothing to attach to and is discarded.`);
        this.move(item.iid, "discard");
      } else {
        const under = def.enters_under === "opponent" ? other(ctx.controller) : ctx.controller;
        this.enterPlay(item.iid, under, { attachTo: host, ctx });
      }
      this.push(...this.steps(play.effect ?? [], ctx, "effect"), { t: "afterResolve", ctx: ctx.id });
    } else {
      this.push(...this.steps(play.effect ?? [], ctx, "effect"), { t: "finishTactic", iid: item.iid, then: play.then }, { t: "afterResolve", ctx: ctx.id });
    }
  }

  protected t_finishTactic(task: Task): void {
    const c = this.s.cards[task.iid];
    if (c.zone !== "stack") return;
    if (!task.then && !task.asked) {
      // "If you deployed a tactic and it would go to a discard pile, ..." (The Primitive Tribes of Thabbash)
      for (const src of this.q.allInPlay()) {
        if (!this.q.active(src) || this.s.cards[src].controller !== c.controller) continue;
        const rule = this.q.rules(src).find((r) => r.replace?.event === "tactic_to_discard");
        if (!rule) continue;
        const ctx = this.newCtx(c.controller, src);
        ctx.vars.it = task.iid;
        this.push(...this.steps(rule.instead, ctx, "effect"), { t: "dropCtx", ctx: ctx.id }, { ...task, asked: true });
        return;
      }
    }
    if (task.then === "face_down_resource") {
      this.putResource(c.owner, task.iid, true, false);
      this.log(`${this.q.name(task.iid)} goes into play as a face-down resource.`);
    } else this.move(task.iid, "discard");
  }

  protected t_afterResolve(task: Task): void {
    this.dropCtx(task.ctx);
    const top = this.s.stack[this.s.stack.length - 1];
    this.s.priority = top ? other(top.controller) : null;
  }

  // --- triggers --------------------------------------------------------------

  protected t_orderTriggers(task: Task): void {
    const list: Task[] = task.list;
    if (list.length === 1) {
      this.push(list[0]);
      return;
    }
    if (task.answer) {
      const i = Number(task.answer.ids[0]);
      this.push(list[i], { t: "orderTriggers", list: list.filter((_, j) => j !== i) });
      return;
    }
    const owners = new Set(list.map((t) => this.s.ctxs[t.ctx]?.controller));
    const chooser = owners.size === 1 ? [...owners][0]! : this.s.active;
    this.ask(task, {
      type: "choose",
      player: chooser,
      prompt: "Several triggers happened at once. Choose which resolves next.",
      options: list.map((t, i) => ({ id: String(i), label: t.label ? `${this.q.name(t.iid)}: ${t.label}` : this.q.name(t.iid), iid: t.iid })),
      min: 1,
      max: 1,
    });
  }

  protected t_trigger(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    if (!ctx) return;
    if (!task.quiet) this.log(`${task.effectSource ? "Effect of " : ""}${this.q.name(task.iid)} triggers.`);
    this.push(...this.steps(task.effect ?? [], ctx, "effect"), { t: "dropCtx", ctx: ctx.id });
  }

  protected t_dropCtx(task: Task): void {
    this.dropCtx(task.ctx);
  }

  /** Trigger rules that could fire for an event, with their controller. */
  private triggerSources(ev: GameEvent) {
    const out: { iid: string; rule: any; effect: Step[]; controller: PlayerId; vars: Record<string, any>; fromEffect?: Effect }[] = [];
    const q = this.q;
    for (const c of Object.values(this.s.cards)) {
      // "When this card is destroyed / leaves play": it has already left, so look back.
      const lookback = (ev.e === "destroyed" || ev.e === "leaves_play") && ev.iid === c.iid;
      // "When the attached character leaves play": the attachment looks back too.
      const hostLeft = ev.e === "leaves_play" && (ev.attached ?? []).includes(c.iid);
      const rules = c.zone === "play" ? q.rules(c.iid) : q.baseRules(c.iid);
      for (const r of rules) {
        if (!r.trigger) continue;
        const zone = r.trigger.zone ?? "play";
        if (hostLeft && c.zone !== "play" && zone === "play") {
          if (r.trigger.card === "host") out.push({ iid: c.iid, rule: { ...r.trigger, card: undefined }, effect: r.effect ?? [], controller: c.owner, vars: c.notes ?? {} });
          continue;
        }
        if (zone === "play" && !lookback && !q.active(c.iid)) continue;
        if (zone !== "play" && c.zone !== zone) continue;
        if (lookback && zone === "play" && r.trigger.card !== "self") continue;
        const controller = lookback ? (ev.player ?? c.owner) : zone === "play" ? c.controller : c.owner;
        out.push({ iid: c.iid, rule: r.trigger, effect: r.effect ?? [], controller, vars: c.notes ?? {} });
      }
    }
    for (const e of this.s.effects) {
      for (const r of e.rules ?? []) if (r.trigger) out.push({ iid: e.source, rule: r.trigger, effect: r.effect ?? [], controller: e.controller, vars: e.vars, fromEffect: e });
    }
    return out;
  }

  private collectTriggers(): void {
    const s = this.s;
    if (!s.events.length) return;
    const events = s.events;
    s.events = [];
    const fired = events.flatMap((ev) => this.triggersFor(ev));
    if (fired.length) s.tasks.push({ t: "orderTriggers", list: fired });
  }

  /** Trigger tasks for one event (not yet queued). */
  private triggersFor(ev: GameEvent): Task[] {
    const s = this.s;
    const fired: Task[] = [];
    {
      for (const src of this.q.frozen(() => this.triggerSources(ev))) {
        const r = src.rule;
        if (r.on !== ev.e) continue;
        const scope: Scope = { controller: src.controller, source: src.iid, vars: src.vars };
        if (r.player && r.player !== "any" && ev.player !== this.q.who(r.player, scope)) continue;
        if (r.card !== undefined && (!ev.iid || !this.q.matches(r.card, ev.iid, scope, null))) continue;
        if (r.source !== undefined) {
          const sources: string[] = ev.sources ?? (ev.source ? [ev.source] : []);
          if (!sources.some((x) => this.q.matches(r.source, x, scope, null))) continue;
        }
        if (r.faction !== undefined && !!ev.faction !== !!r.faction) continue;
        if (r.battle !== undefined && !!ev.battle !== !!r.battle) continue;
        if (r.cause !== undefined && ev.cause !== r.cause) continue;
        if (r.from !== undefined && ev.from !== r.from) continue;
        if (r.to !== undefined && ev.to !== r.to) continue;
        if (r.side !== undefined && ev.side !== r.side) continue;
        // "a character with a token on it leaves play": had_tokens: true
        if (r.had_tokens !== undefined && (ev.tokens ?? 0) > 0 !== !!r.had_tokens) continue;
        // "destroyed by an opposing card": by: opponent | you
        if (r.by !== undefined && (!ev.by || ev.by !== this.q.who(r.by, scope))) continue;
        if (r.requires && !this.q.meets(src.controller, r.requires)) continue;
        if (r.while && !this.q.cond(r.while, scope)) continue;
        const ctx = this.newCtx(src.controller, src.iid);
        Object.assign(ctx.vars, src.vars);
        if (ev.iid) ctx.vars.it = ev.iid;
        if (ev.player) ctx.vars.player = ev.player;
        if (ev.amount !== undefined) ctx.vars.amount = ev.amount;
        if (ev.source) ctx.vars.source = ev.source;
        if (src.fromEffect && r.once) s.effects = s.effects.filter((x) => x !== src.fromEffect);
        fired.push({ t: "trigger", iid: src.iid, effect: src.effect, ctx: ctx.id, effectSource: !!src.fromEffect });
      }
    }
    return fired;
  }

  emit(ev: GameEvent): void {
    this.s.events.push(ev);
  }

  // --- steps (costs and effects) ---------------------------------------------

  steps(list: Step[], ctx: Ctx, phase: "cost" | "effect"): Task[] {
    return (list ?? []).map((step) => ({ t: "step", step, ctx: ctx.id, phase }));
  }

  newCtx(p: PlayerId, source: string, parent?: Ctx): Ctx {
    const id = rng.id(this.s);
    const ctx: Ctx = { id, controller: p, actor: p, source, vars: {}, pay: 0, ...(parent ? { parent: parent.id } : {}) };
    this.s.ctxs[id] = ctx;
    return ctx;
  }

  root(ctx: Ctx): Ctx {
    let c = ctx;
    while (c.parent && this.s.ctxs[c.parent]) c = this.s.ctxs[c.parent];
    return c;
  }

  /** The scope card data is evaluated in for this context. */
  scope(ctx: Ctx): Scope {
    const r = this.root(ctx);
    return { controller: ctx.controller, actor: ctx.actor, source: ctx.source, vars: r.vars, via: r.via, responding: r.responding, did: r.did };
  }

  setDid(ctx: Ctx, v: boolean): void {
    this.root(ctx).did = v;
  }

  private dropCtx(id: string): void {
    for (const c of Object.values(this.s.ctxs)) if (c.id === id || this.root(c).id === id) delete this.s.ctxs[c.id];
  }

  private fail(msg: string): void {
    if (this.s.snapshot) this.rollback(`Illegal: ${msg} The action was undone.`);
    else this.log(msg);
  }

  protected t_step(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    if (!ctx || (this.root(ctx) as any).terminated) return;
    const op = Object.keys(task.step)[0];
    const fn = (this as any)["op_" + op];
    if (!fn) {
      this.log(`[engine] Unsupported instruction "${op}" on ${this.q.name(ctx.source)}; resolve it manually.`);
      return;
    }
    const r: StepResult = fn.call(this, task.step[op], ctx, task);
    if (r === "fail" && task.phase === "cost") this.fail(`${this.q.name(ctx.source)}: a cost could not be paid.`);
  }

  ref(ctx: Ctx, x: any): string | undefined {
    return this.q.ref(x, this.scope(ctx));
  }

  /** Card references: a variable (list), "self", or a selector object (all matches). */
  refs(ctx: Ctx, x: any): string[] {
    if (x && typeof x === "object" && !Array.isArray(x)) return this.q.find(x, this.scope(ctx));
    return this.q.refs(x, this.scope(ctx));
  }

  num(ctx: Ctx, x: any): number {
    return Math.max(0, this.q.value(x, this.scope(ctx)));
  }

  who(ctx: Ctx, x: any): PlayerId {
    return this.q.who(x ?? "you", this.scope(ctx));
  }

  // Control flow ------------------------------------------------------------

  protected op_if(arg: any, ctx: Ctx, task: Task): StepResult {
    const ok = this.q.cond(arg.cond, this.scope(ctx));
    this.push(...this.steps(ok ? (arg.then ?? []) : (arg.else ?? []), ctx, task.phase));
    return "ok";
  }

  /** Set variables: numbers from values, or card references. */
  protected op_let(arg: any, ctx: Ctx): StepResult {
    const vars = this.root(ctx).vars;
    for (const [k, v] of Object.entries(arg)) {
      if (v && typeof v === "object" && "card" in (v as any)) vars[k] = this.ref(ctx, (v as any).card);
      // A fixed list of the cards matching a selector now: let: { others: { cards: <selector> } }
      else if (v && typeof v === "object" && "cards" in (v as any)) vars[k] = this.refs(ctx, (v as any).cards);
      else if (v && typeof v === "object" && "name_of" in (v as any)) {
        const r = this.ref(ctx, (v as any).name_of);
        vars[k] = r ? this.q.name(r) : undefined;
      }
      else vars[k] = this.q.value(v, this.scope(ctx));
    }
    return "ok";
  }

  protected op_repeat(arg: any, ctx: Ctx, task: Task): StepResult {
    // `while: <condition>`: run the steps, then check again ("repeat this until...").
    if (arg.while !== undefined) {
      if (this.q.cond(arg.while, this.scope(ctx))) this.push(...this.steps([...arg.steps, { repeat: arg }], ctx, task.phase));
      return "ok";
    }
    const n = this.num(ctx, arg.times);
    const list: Task[] = [];
    for (let i = 0; i < n; i++) list.push(...this.steps(arg.steps, ctx, task.phase));
    this.push(...list);
    return "ok";
  }

  /** Run steps as another player: "you" becomes that player. Variables are shared. */
  protected op_as(arg: any, ctx: Ctx, task: Task): StepResult {
    const p = this.who(ctx, arg.who);
    const child = this.newCtx(p, ctx.source, ctx);
    this.push(...this.steps(arg.steps, child, task.phase));
    return "ok";
  }

  /** Run steps once for each player, the active player first, with "you" = that player. */
  protected op_each_player(arg: any, ctx: Ctx, task: Task): StepResult {
    const steps: Step[] = Array.isArray(arg) ? arg : arg.steps;
    const tasks: Task[] = [];
    for (const p of [this.s.active, other(this.s.active)]) {
      const child = this.newCtx(p, ctx.source, ctx);
      tasks.push(...this.steps(steps, child, task.phase));
    }
    this.push(...tasks);
    return "ok";
  }

  protected op_may(arg: any, ctx: Ctx, task: Task): StepResult {
    const steps: Step[] = Array.isArray(arg) ? arg : arg.steps;
    const p = Array.isArray(arg) || !arg.who ? ctx.actor : this.who(ctx, arg.who);
    if (task.answer) {
      const yes = task.answer.ids[0] === "yes";
      this.setDid(ctx, yes);
      if (yes) this.push(...this.steps(steps, ctx, task.phase));
      else if (!Array.isArray(arg) && arg.else) this.push(...this.steps(arg.else, ctx, task.phase));
      return "ok";
    }
    return this.ask(task, {
      type: "choose",
      player: p,
      prompt: `${this.q.name(ctx.source)}: ${(!Array.isArray(arg) && arg.prompt) || this.describeSteps(steps)}?`,
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      min: 1,
      max: 1,
    });
  }

  /** "You may pay N. If you do, ... Otherwise, ..." */
  protected op_may_pay(arg: any, ctx: Ctx, task: Task): StepResult {
    const p = this.who(ctx, arg.who);
    const n = this.num(ctx, arg.amount);
    if (task.answer) {
      const yes = task.answer.ids[0] === "yes" && this.payNow(p, n);
      if (yes) this.log(`${this.pname(p)} pays ${n}.`);
      this.setDid(ctx, yes);
      this.push(...this.steps(yes ? (arg.then ?? []) : (arg.else ?? []), ctx, task.phase));
      return "ok";
    }
    if (this.q.unattached(p).length < n) {
      this.setDid(ctx, false);
      this.push(...this.steps(arg.else ?? [], ctx, task.phase));
      return "ok";
    }
    return this.ask(task, {
      type: "choose",
      player: p,
      prompt: `${this.q.name(ctx.source)}: pay ${n}${arg.prompt ? ` (${arg.prompt})` : ""}?`,
      options: [
        { id: "yes", label: `Pay ${n}` },
        { id: "no", label: "Don't pay" },
      ],
      min: 1,
      max: 1,
    });
  }

  protected op_choose_one(arg: any, ctx: Ctx, task: Task): StepResult {
    const opts: { label?: string; steps: Step[]; when?: any }[] = (Array.isArray(arg) ? arg : arg.options).map((o: any) => (o.steps ? o : { steps: [o] }));
    const p = Array.isArray(arg) || !arg.who ? ctx.actor : this.who(ctx, arg.who);
    // Options with `when` are only offered while their condition holds.
    const offered = opts.map((o, i) => ({ o, i })).filter(({ o }) => !o.when || this.q.cond(o.when, this.scope(ctx)));
    if (task.answer) {
      const chosen = opts[Number(task.answer.ids[0])];
      this.log(`${this.pname(p)} chooses: ${chosen.label ?? this.describeSteps(chosen.steps)}.`);
      this.push(...this.steps(chosen.steps, ctx, task.phase));
      return "ok";
    }
    // No option can be chosen: a cost fails, an effect does nothing.
    if (!offered.length) return task.phase === "cost" ? "fail" : "ok";
    return this.ask(task, {
      type: "choose",
      player: p,
      prompt: `${this.q.name(ctx.source)}: choose one.`,
      options: offered.map(({ o, i }) => ({ id: String(i), label: o.label ?? this.describeSteps(o.steps) })),
      min: 1,
      max: 1,
    });
  }

  protected op_script(arg: any, ctx: Ctx, task: Task): StepResult {
    const name = typeof arg === "string" ? arg : arg.name;
    const fn = SCRIPTS[name];
    if (!fn) {
      this.log(`[engine] No script "${name}"; resolve ${this.q.name(ctx.source)} manually.`);
      return "ok";
    }
    return fn(this, ctx, task, arg);
  }

  // Costs and choices -----------------------------------------------------------

  protected op_pay(arg: any, ctx: Ctx): StepResult {
    this.root(ctx).pay += this.num(ctx, arg);
    return "ok";
  }

  /**
   * Pick cards. { as, from, count, up_to, optional, who, choose, random, prompt, zone }
   * `choose: true` is for "choose" wording, which isn't picking (no pick restrictions).
   */
  protected op_pick(arg: any, ctx: Ctx, task: Task): StepResult {
    const scope = this.scope(ctx);
    const chooser = arg.who ? this.who(ctx, arg.who) : ctx.actor;
    const vars = this.root(ctx).vars;
    const isPick = !arg.choose;
    const multi = (arg.count ?? 1) !== 1 || !!arg.up_to;
    let cands = arg.like === "responded" ? this.repickCandidates(ctx) : this.q.find(arg.from, scope, arg.zone ?? "play");
    if (isPick) {
      cands = cands.filter((i) => !this.q.cannot("pick", i, chooser, ctx.source));
      const must = cands.filter((i) => this.q.modsFor("must_pick", i).length);
      if (must.length) cands = must;
      cands = cands.filter((i) => this.pickTax(i, chooser) <= this.q.unattached(chooser).length);
    }
    if (arg.exactly && cands.length < this.num(ctx, arg.count ?? 1)) {
      if (task.phase === "cost") return "fail";
    }
    const count = Math.min(this.num(ctx, arg.count ?? 1), cands.length);
    const optional = !!arg.optional || !!arg.up_to;
    if (task.answer || (arg.random && cands.length)) {
      const ids: string[] = task.answer ? task.answer.ids : this.randomPick(cands, count);
      if (arg.different_trades && new Set(ids.map((i) => this.q.def(i).trade)).size !== ids.length) {
        this.log("Those cards must not share a trade.", chooser);
        return task.phase === "cost" ? "fail" : "ok";
      }
      vars[arg.as] = multi ? ids : ids[0];
      this.setDid(ctx, ids.length > 0);
      if (isPick) {
        for (const i of ids) {
          const tax = this.pickTax(i, chooser);
          if (tax) {
            if (task.phase === "cost") this.root(ctx).pay += tax;
            else this.payNow(chooser, tax);
          }
          if (task.phase === "cost" && this.q.is(i, "character")) {
            (this.root(ctx).picked ??= []).push(i);
            (this.root(ctx).pickedFrom ??= []).push({ iid: i, from: arg.from, zone: arg.zone, chooser });
          }
          this.emit({ e: "picked", iid: i, player: chooser });
        }
      }
      if (ids.length && !arg.silent) this.log(`${this.pname(chooser)} ${isPick ? "picks" : "chooses"} ${ids.map((i) => this.visibleName(i, chooser)).join(", ")}.`);
      return "ok";
    }
    if (!cands.length || count === 0) {
      vars[arg.as] = multi ? [] : undefined;
      this.setDid(ctx, false);
      return optional || task.phase === "effect" ? "ok" : "fail";
    }
    return this.ask(task, {
      type: "choose",
      player: chooser,
      prompt: arg.prompt ?? `${this.q.name(ctx.source)}: ${arg.choose ? "choose" : "pick"} ${arg.up_to ? "up to " : ""}${count > 1 ? count + " × " : ""}${this.describeSel(arg.from)}.`,
      options: cands.map((iid) => ({ id: iid, iid, label: this.optionLabel(iid, chooser) })),
      min: optional ? 0 : count,
      max: count,
      cancellable: task.phase === "cost" && !!this.s.snapshot,
      list: cands.some((i) => this.s.cards[i].zone !== "play"),
    });
  }

  /**
   * Mistaken Identity: "another character that could be picked by that card or
   * ability": the same selector, from the original card's point of view, by the
   * original picker, excluding the character it picked.
   */
  private repickCandidates(ctx: Ctx): string[] {
    const item = this.s.stack.find((x) => x.id === this.root(ctx).responding);
    const ictx = item && this.s.ctxs[item.ctx];
    const rec = ictx && this.root(ictx).pickedFrom?.[0];
    if (!ictx || !rec) return [];
    const scope = this.scope(ictx);
    let cands = this.q.find(rec.from, scope, rec.zone ?? "play").filter((i) => i !== rec.iid && this.q.is(i, "character") && !this.q.cannot("pick", i, rec.chooser));
    const must = cands.filter((i) => this.q.modsFor("must_pick", i).length);
    if (must.length) cands = must;
    return cands.filter((i) => this.pickTax(i, rec.chooser) <= this.q.unattached(rec.chooser).length);
  }

  private pickTax(iid: string, picker: PlayerId): number {
    return this.q.modsFor("pick_tax", iid).reduce((n, m) => (this.q.by(m, picker) ? n + this.q.value(m.value, m.scope) : n), 0);
  }

  randomPick(cands: string[], n: number): string[] {
    const pool = [...cands];
    rng.shuffle(this.s, pool);
    return pool.slice(0, n);
  }

  protected op_choose_number(arg: any, ctx: Ctx, task: Task): StepResult {
    if (task.answer) {
      this.root(ctx).vars[arg.as] = task.answer.value;
      this.log(`${this.pname(ctx.actor)} chooses ${arg.as} = ${task.answer.value}.`);
      return "ok";
    }
    return this.ask(task, {
      type: "number",
      player: ctx.actor,
      prompt: arg.prompt ?? `${this.q.name(ctx.source)}: choose a number for ${arg.as}.`,
      min: this.num(ctx, arg.min ?? 0),
      max: arg.max !== undefined ? this.num(ctx, arg.max) : 99,
      cancellable: task.phase === "cost" && !!this.s.snapshot,
    });
  }

  /** Name a card, subtype or resource icon: { as, kind, not_type, remember, who } */
  protected op_name(arg: any, ctx: Ctx, task: Task): StepResult {
    const kind = arg.kind ?? "card";
    const p = arg.who ? this.who(ctx, arg.who) : ctx.actor;
    if (task.answer) {
      const v = task.answer.ids[0];
      const label = kind === "card" ? this.lib[v].name : v;
      this.root(ctx).vars[arg.as] = label;
      if (arg.remember) {
        const c = this.s.cards[ctx.source];
        c.notes = { ...(c.notes ?? {}), [arg.as]: label };
      }
      this.log(`${this.pname(p)} names ${label}.`);
      return "ok";
    }
    let options: Option[];
    if (kind === "card") {
      options = Object.values(this.lib)
        .filter((d) => !d.types.includes("faction"))
        .filter((d) => !arg.not_type || !d.types.includes(arg.not_type))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ id: d.id, label: d.name }));
    } else if (kind === "subtype") {
      const set = new Set<string>();
      for (const d of Object.values(this.lib)) for (const st of d.subtypes ?? []) set.add(st.toLowerCase());
      options = [...set].sort().map((x) => ({ id: x, label: x }));
    } else if (kind === "trade") {
      options = ["arcanist", "banker", "gearsmith", "rogue", "warlord"].filter((t) => !(arg.not ?? []).includes(t)).map((t) => ({ id: t, label: t }));
      return this.ask(task, { type: "choose", player: p, prompt: arg.prompt ?? `${this.q.name(ctx.source)}: name a trade.`, options, min: 1, max: 1 });
    } else {
      options = STAPLE_ICONS.map((i) => ({ id: i, label: i }));
      return this.ask(task, { type: "choose", player: p, prompt: `${this.q.name(ctx.source)}: name a resource icon.`, options, min: 1, max: 1 });
    }
    return this.ask(task, { type: "name", player: p, prompt: `${this.q.name(ctx.source)}: name a ${kind}.`, kind, options });
  }

  // Card operations ------------------------------------------------------------

  protected op_destroy(arg: any, ctx: Ctx, task: Task): StepResult {
    const cause = task.phase === "cost" ? "cost" : "effect";
    if (arg && typeof arg === "object" && arg.from) {
      // "Destroy a character you own": pick, then destroy.
      const r = this.op_pick({ ...arg, as: "__destroy" }, ctx, task);
      if (r !== "ok" || this.root(ctx).vars.__destroy === undefined) return r;
      if (this.q.cannot("destroy", this.root(ctx).vars.__destroy, ctx.controller, ctx.source)) return "ok";
      this.destroy(this.root(ctx).vars.__destroy, cause, false, ctx.controller);
      return "ok";
    }
    const targets = this.refs(ctx, arg);
    if (!targets.some((i) => this.q.inPlay(i))) return task.phase === "cost" ? "fail" : "ok";
    // "This card cannot be destroyed by the effects of node cards" (Lugubrious Node).
    for (const iid of targets) if (!this.q.cannot("destroy", iid, ctx.controller, ctx.source)) this.destroy(iid, cause, false, ctx.controller);
    return "ok";
  }

  /** Discard: { who, count, random, chooser, filter, cards, all, up_to } */
  protected op_discard(arg: any, ctx: Ctx, task: Task): StepResult {
    const a = typeof arg === "object" && arg !== null ? arg : { count: arg ?? 1 };
    const p = this.who(ctx, a.who);
    const chooser = a.chooser ? this.who(ctx, a.chooser) : p;
    if (a.cards !== undefined) {
      for (const iid of this.refs(ctx, a.cards)) if (this.s.cards[iid].zone === "hand") this.discardCard(iid, ctx.controller);
      return "ok";
    }
    const hand = this.s.players[p].hand.filter((i) => !a.filter || this.q.matches(a.filter, i, this.scope(ctx), "hand"));
    if (task.answer) {
      for (const iid of task.answer.ids) this.discardCard(iid, ctx.controller);
      if (a.as) this.root(ctx).vars[a.as] = task.answer.ids.length === 1 ? task.answer.ids[0] : task.answer.ids;
      this.setDid(ctx, task.answer.ids.length > 0);
      return "ok";
    }
    const count = a.all ? hand.length : this.num(ctx, a.count ?? 1);
    if (hand.length < count && task.phase === "cost") return "fail";
    const n = Math.min(count, hand.length);
    if (n <= 0) {
      this.setDid(ctx, false);
      return "ok";
    }
    if (a.random || (n === hand.length && !a.up_to && !a.as)) {
      const ids = this.randomPick(hand, n);
      for (const iid of ids) this.discardCard(iid, ctx.controller);
      if (a.as) this.root(ctx).vars[a.as] = ids.length === 1 ? ids[0] : ids;
      this.setDid(ctx, true);
      return "ok";
    }
    return this.ask(task, {
      type: "choose",
      player: chooser,
      prompt: `${this.q.name(ctx.source)}: ${chooser === p ? "discard" : `choose ${this.pname(p)}'s discards:`} ${n} card${n === 1 ? "" : "s"}.`,
      options: hand.map((iid) => ({ id: iid, iid, label: this.q.name(iid) })),
      min: a.up_to ? 0 : n,
      max: n,
      cancellable: task.phase === "cost" && !!this.s.snapshot,
      list: chooser !== p,
    });
  }

  /** `by`: the player controlling the effect that makes them discard. */
  private discardCard(iid: string, by?: PlayerId): void {
    const c = this.s.cards[iid];
    this.log(`${this.pname(c.owner)} discards ${this.q.name(iid)}.`);
    this.move(iid, "discard");
    this.emit({ e: "discarded", iid, player: c.owner, ...(by ? { by } : {}) });
  }

  protected op_reveal(arg: any, ctx: Ctx): StepResult {
    const ids = this.refs(ctx, arg);
    if (!ids.length) return "fail";
    for (const iid of ids) {
      this.s.cards[iid].revealed = true;
      this.log(`${this.pname(this.s.cards[iid].controller)} reveals ${this.q.name(iid)}.`);
    }
    return "ok";
  }

  protected op_reveal_hand(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg);
    const names = this.s.players[p].hand.map((i) => this.q.name(i));
    this.log(`${this.pname(p)} reveals their hand: ${names.join(", ") || "(empty)"}.`);
    return "ok";
  }

  /** Remove from the game: a reference, or { card, face_down, tag } */
  protected op_void(arg: any, ctx: Ctx, task: Task): StepResult {
    const a = typeof arg === "object" && arg !== null && !Array.isArray(arg) && "card" in arg ? arg : { card: arg };
    const ids = this.refs(ctx, a.card);
    // An empty list ("put X characters into the void" with X = 0) is fine.
    if (!ids.length) return task.phase === "cost" && !Array.isArray(this.scope(ctx).vars[a.card]) ? "fail" : "ok";
    for (const iid of ids) {
      this.log(`${a.face_down ? "A card" : this.q.name(iid)} is removed from the game${a.face_down ? " face-down" : ""}.`);
      this.move(iid, "void", { tag: a.tag ? ctx.source : undefined, faceDown: !!a.face_down, knownTo: a.face_down ? [ctx.controller] : undefined });
    }
    return "ok";
  }

  /**
   * Deplete a card, every card in a list, or all cards matching a selector. As a
   * cost it fails if any can't be depleted; as an effect it depletes those it can.
   */
  protected op_deplete(arg: any, ctx: Ctx, task: Task): StepResult {
    const ids = this.refs(ctx, arg);
    const list = Array.isArray(this.scope(ctx).vars[arg]) || (arg && typeof arg === "object");
    if (!ids.length) return list ? "ok" : "fail";
    const ok = (i: string) => this.q.inPlay(i) && !this.s.cards[i].depleted && !this.s.cards[i].isResource;
    if (task.phase === "cost" && !ids.every(ok)) return "fail";
    if (!ids.some(ok)) return task.phase === "cost" ? "fail" : "ok";
    for (const iid of ids.filter(ok)) this.setDepleted(iid, true);
    return "ok";
  }

  /** Deplete or restore a card, emitting "depleted" / "restored" for triggers. */
  setDepleted(iid: string, v: boolean): void {
    const c = this.s.cards[iid];
    if (c.depleted === v) return;
    c.depleted = v;
    this.emit({ e: v ? "depleted" : "restored", iid, player: c.controller });
  }

  protected op_restore(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.refs(ctx, arg)) if (this.q.inPlay(iid) && !this.q.cannot("restore", iid, ctx.controller)) this.setDepleted(iid, false);
    return "ok";
  }

  /**
   * Look at hidden cards, privately: { who: opponent, hand, top, face_down }.
   * Only the looking player sees the result in their log.
   */
  protected op_peek(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg.who ?? "opponent");
    const ps = this.s.players[p];
    const me = ctx.actor;
    const names = (ids: string[]) => ids.map((i) => this.q.name(i)).join(", ") || "(none)";
    this.log(`${this.pname(me)} looks at ${this.pname(p)}'s hidden cards.`);
    if (arg.hand) this.log(`${this.pname(p)}'s hand: ${names(ps.hand)}.`, me);
    if (arg.top) this.log(`Top of ${this.pname(p)}'s deck: ${names(ps.deck.slice(0, typeof arg.top === "number" ? arg.top : 1))}.`, me);
    if (arg.face_down) this.log(`${this.pname(p)}'s face-down resources: ${names(this.q.resources(p).filter((i) => this.s.cards[i].faceDown))}.`, me);
    return "ok";
  }

  /** "The character enters play under your control": take over a card being deployed. */
  protected op_steal_deploy(arg: any, ctx: Ctx): StepResult {
    const id = arg === "responded" ? this.root(ctx).responding : arg;
    const item = this.s.stack.find((x) => x.id === id && x.kind === "card");
    if (!item) return "ok";
    item.controller = ctx.controller;
    const ictx = this.s.ctxs[item.ctx];
    if (ictx) ictx.controller = ictx.actor = ctx.controller;
    this.log(`${item.label} will enter play under ${this.pname(ctx.controller)}'s control.`);
    return "ok";
  }

  protected op_draw(arg: any, ctx: Ctx): StepResult {
    const a = typeof arg === "object" && arg !== null ? arg : { count: arg };
    this.drawCards(this.who(ctx, a.who), this.num(ctx, a.count ?? 1));
    return "ok";
  }

  /** Inflict damage: { card | faction: who, amount, source } */
  protected op_damage(arg: any, ctx: Ctx): StepResult {
    const n = this.num(ctx, arg.amount);
    const source = arg.source ? this.ref(ctx, arg.source) : ctx.source;
    if (arg.faction !== undefined) {
      this.damageFaction(this.who(ctx, arg.faction), n, source ? [source] : [], false, ctx.controller);
      return "ok";
    }
    for (const iid of this.refs(ctx, arg.card)) this.inflict(iid, n, false, source ? [source] : []);
    return "ok";
  }

  protected op_heal(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.refs(ctx, arg.card)) {
      const c = this.s.cards[iid];
      const n = arg.all ? Infinity : this.num(ctx, arg.amount);
      if (this.q.is(iid, "location")) c.markers = Math.max(0, c.markers - n);
      else c.damage = Math.max(0, c.damage - n);
    }
    return "ok";
  }

  /** Add damage markers directly (not damage). */
  protected op_markers(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.refs(ctx, arg.card)) this.s.cards[iid].markers += this.num(ctx, arg.add);
    return "ok";
  }

  protected op_lose_influence(arg: any, ctx: Ctx): StepResult {
    this.loseInfluence(this.who(ctx, arg.who ?? "opponent"), this.num(ctx, arg.amount));
    return "ok";
  }

  protected op_gain_influence(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg.who ?? "you");
    const n = this.num(ctx, arg.amount);
    this.s.players[p].influence += n;
    this.log(`${this.pname(p)} gains ${n} influence.`);
    return "ok";
  }

  /** Sugar for a one-stat temporary effect: { card, stat, gain, lose, duration } */
  protected op_modify(arg: any, ctx: Ctx): StepResult {
    const delta = this.num(ctx, arg.gain ?? 0) - this.num(ctx, arg.lose ?? 0);
    this.log(`${this.refs(ctx, arg.card).map((i) => this.q.name(i)).join(", ")} ${delta >= 0 ? "gains" : "loses"} ${Math.abs(delta)} ${arg.stat}${(arg.duration ?? "turn") === "turn" ? " this turn" : ""}.`);
    return this.op_create_effect({ duration: arg.duration ?? "turn", mods: [{ stat: { [arg.stat]: delta }, target: arg.card }] }, ctx);
  }

  /**
   * Create a continuous effect: { duration, mods, rules }. A mod `target` that names
   * a variable (or "self") is fixed to those cards now; selector targets stay live.
   * Stat values are frozen when the effect is created.
   */
  protected op_create_effect(arg: any, ctx: Ctx): StepResult {
    const scope = this.scope(ctx);
    const fix = (t: any) => {
      if (t === undefined) return { iids: [ctx.source] };
      if (typeof t === "string" && t !== "all" && t !== "none") return { iids: this.q.refs(t, scope) };
      return t;
    };
    // "This turn, all your characters gain 1 strength" means the characters in play now.
    // Changes to cards' characteristics freeze their selector targets; rules about
    // future actions (costs, prohibitions, play permissions) stay live. `live: true` opts out.
    const SNAPSHOT = ["stat", "set_stats", "add_type", "remove_type", "keyword", "add_subtype"];
    const mods = (arg.mods ?? []).map((m: any) => {
      let target = fix(m.target);
      if (!m.live && SNAPSHOT.some((k) => k in m) && target && typeof target === "object" && !Array.isArray(target.iids)) target = { iids: this.q.find(target, scope) };
      const out = { ...m, target };
      if (typeof out.provides === "string") out.provides = { [scope.vars[out.provides]]: 1 };
      if (out.stat) {
        out.stat = { ...out.stat };
        for (const k of Object.keys(out.stat)) if (typeof out.stat[k] !== "number") out.stat[k] = this.q.value(out.stat[k], scope);
      }
      return out;
    });
    const e: Effect = { id: rng.id(this.s), source: ctx.source, controller: ctx.controller, vars: { ...scope.vars }, mods, rules: arg.rules, duration: arg.duration ?? "turn", turn: this.s.turn, ...(arg.tag ? { tag: arg.tag } : {}) };
    // "does not restore during its controller's next RESTORE RULE": ends after that player's restore rule.
    if (e.duration === "next_restore") e.restorer = arg.who ? this.who(ctx, arg.who) : ctx.controller;
    this.s.effects.push(e);
    return "ok";
  }

  protected op_flip_face_down(arg: any, ctx: Ctx): StepResult {
    const a = typeof arg === "object" && arg !== null && "card" in arg ? arg : { card: arg };
    for (const iid of this.refs(ctx, a.card)) {
      if (!this.q.inPlay(iid)) continue;
      const c = this.s.cards[iid];
      // controller: owner (default) | you | opponent (the opponent of its current controller)
      this.flipFaceDown(iid, a.controller === "you" ? ctx.controller : a.controller === "opponent" ? other(c.controller) : c.owner);
    }
    return "ok";
  }

  flipFaceDown(iid: string, ctl: PlayerId): void {
    const c = this.s.cards[iid];
    this.log(`${this.q.name(iid)} is flipped face-down as a resource under ${this.pname(ctl)}'s control.`);
    this.leavePlayCleanup(iid);
    for (const a of this.q.attachments(iid)) this.destroy(a, "rule");
    c.faceDown = true;
    c.isResource = true;
    c.attachedTo = null;
    c.notes = undefined;
    c.tokens = 0;
    this.relist(iid, ctl);
    c.controlSince = this.s.turn;
  }

  /** Put a card into play: { card, controller, as: face_down_resource|resource, attach_to } */
  protected op_put_into_play(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.refs(ctx, arg.card)) {
      const c = this.s.cards[iid];
      const ctl = arg.controller === "owner" ? c.owner : this.who(ctx, arg.controller ?? "you");
      if (arg.as === "face_down_resource") {
        this.putResource(ctl, iid, true, false);
        if (arg.attached) this.s.cards[iid].attachedTo = "faction";
        this.log(`${this.pname(ctl)} puts ${this.visibleName(iid)} into play as a face-down resource.`);
      } else if (arg.as === "resource" || (!arg.as && this.q.def(iid).types.includes("resource"))) {
        this.putResource(ctl, iid, false, false);
        if (arg.attached) this.s.cards[iid].attachedTo = "faction";
        this.log(`${this.pname(ctl)} puts ${this.q.name(iid)} into play as a resource.`);
      } else {
        const def = this.q.def(iid);
        let host = arg.attach_to ? this.ref(ctx, arg.attach_to) : undefined;
        if (def.attach_to && !host) {
          host = this.q.allInPlay().find((i) => this.q.isCharacter(i));
          if (!host) {
            this.move(iid, "discard");
            continue;
          }
        }
        this.enterPlay(iid, ctl, { attachTo: host, ctx });
      }
    }
    return "ok";
  }

  /** Move cards: { card, to: hand|discard|void|deck_top|deck_bottom|deck_shuffle, tag } */
  protected op_move(arg: any, ctx: Ctx): StepResult {
    const ids = this.refs(ctx, arg.card);
    const to = arg.to as string;
    for (const iid of ids) {
      const name = this.visibleName(iid);
      if (to === "deck_top" || to === "deck_bottom") this.move(iid, "deck", { bottom: to === "deck_bottom" });
      else if (to === "deck_shuffle") {
        this.move(iid, "deck");
        rng.shuffle(this.s, this.s.players[this.s.cards[iid].owner].deck);
      } else this.move(iid, to as Zone, { tag: arg.tag ? ctx.source : undefined });
      const where: Record<string, string> = {
        hand: "into its owner's hand",
        discard: "into the discard pile",
        void: "out of the game",
        deck_top: "on top of its owner's deck",
        deck_bottom: "on the bottom of its owner's deck",
        deck_shuffle: "into its owner's deck",
      };
      if (!arg.silent) this.log(`${name} is put ${where[to] ?? to}.`);
    }
    this.setDid(ctx, ids.length > 0);
    return "ok";
  }

  protected op_shuffle(arg: any, ctx: Ctx): StepResult {
    rng.shuffle(this.s, this.s.players[this.who(ctx, arg)].deck);
    return "ok";
  }

  /** Take control: { card, who, duration: turn } (a "this turn" control change reverts at end of turn). */
  protected op_take_control(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg.who ?? "you");
    for (const iid of this.refs(ctx, arg.card)) {
      if (this.s.cards[iid].controller !== p && this.q.cannot("take_control", iid, p)) {
        this.log(`Control of ${this.q.name(iid)} can't be taken.`);
        continue;
      }
      const prev = this.s.cards[iid].controller;
      this.takeControl(iid, p);
      if (arg.duration === "turn" && prev !== p) {
        this.s.effects.push({
          id: rng.id(this.s),
          source: iid,
          controller: p,
          vars: { back: prev, card: iid },
          rules: [{ trigger: { on: "end_of_turn", player: "any", once: true }, effect: [{ take_control: { card: "card", who: "back" } }] }],
          duration: "game",
          turn: this.s.turn,
        });
      }
    }
    return "ok";
  }

  protected op_attach(arg: any, ctx: Ctx): StepResult {
    const host = this.ref(ctx, arg.to);
    if (!host || !this.q.isCharacter(host)) return "ok";
    for (const iid of this.refs(ctx, arg.card)) {
      if (!this.q.inPlay(iid)) continue;
      this.s.cards[iid].attachedTo = host;
      this.log(`${this.q.name(iid)} is attached to ${this.q.name(host)}.`);
    }
    return "ok";
  }

  /** Tokens: { card, add, remove (number or "all"), set, as } */
  protected op_tokens(arg: any, ctx: Ctx, task: Task): StepResult {
    for (const iid of this.refs(ctx, arg.card ?? "self")) {
      const c = this.s.cards[iid];
      if (arg.remove !== undefined) {
        const n = arg.remove === "all" ? c.tokens : this.num(ctx, arg.remove);
        if (c.tokens < n && task.phase === "cost") return "fail";
        if (arg.as) this.root(ctx).vars[arg.as] = Math.min(n, c.tokens);
        c.tokens = Math.max(0, c.tokens - n);
      }
      if (arg.add !== undefined) c.tokens += this.num(ctx, arg.add);
      if (arg.set !== undefined) c.tokens = this.num(ctx, arg.set);
    }
    return "ok";
  }

  /** Put up to N tokens divided among chosen cards: { total, from } */
  protected op_distribute_tokens(arg: any, ctx: Ctx, task: Task): StepResult {
    if (task.answer) {
      for (const [iid, n] of Object.entries(task.answer.assign as Record<string, number>)) this.s.cards[iid].tokens += n;
      return "ok";
    }
    const cands = this.q.find(arg.from, this.scope(ctx));
    if (!cands.length) return "ok";
    const total = this.num(ctx, arg.total);
    return this.ask(task, { type: "assign", player: ctx.actor, prompt: `${this.q.name(ctx.source)}: put up to ${total} tokens on cards you control.`, total, min: 0, targets: cands });
  }

  /** "Inflict X damage divided however you want among ...": { amount, from: <selector>, up_to } */
  protected op_divide_damage(arg: any, ctx: Ctx, task: Task): StepResult {
    if (task.answer) {
      for (const [iid, n] of Object.entries(task.answer.assign as Record<string, number>)) if (n > 0) this.inflict(iid, n, false, [ctx.source]);
      return "ok";
    }
    const cands = this.q.find(arg.from, this.scope(ctx));
    const total = this.num(ctx, arg.amount);
    if (!cands.length || total <= 0) return "ok";
    return this.ask(task, { type: "assign", player: ctx.actor, prompt: `${this.q.name(ctx.source)}: divide ${arg.up_to ? "up to " : ""}${total} damage.`, total, targets: cands, ...(arg.up_to ? { min: 0 } : {}) });
  }

  /** Change the target of the current attack to a location the defender controls. */
  protected op_retarget_attack(arg: any, ctx: Ctx): StepResult {
    const b = this.s.battle;
    const iid = this.ref(ctx, arg);
    if (!b || !iid || !this.q.inPlay(iid) || !this.q.is(iid, "location") || this.s.cards[iid].controller !== b.defender) return "ok";
    b.target = iid;
    this.log(`The attack now targets ${this.q.name(iid)}.`);
    return "ok";
  }

  /** Search a deck: { deck: who, for, count (number|"any"), to, reveal, attach_to, controller, different_names, as, tag, face_down } */
  protected op_search(arg: any, ctx: Ctx, task: Task): StepResult {
    const p = this.who(ctx, arg.deck);
    const deck = this.s.players[p].deck;
    const searcher = ctx.actor;
    const count = arg.count === "any" ? deck.length : this.num(ctx, arg.count ?? 1);
    if (task.answer) {
      let ids: string[] = task.answer.ids;
      if (arg.different_names) {
        // Keep the first card of each name (validation can't reject an answer mid-run).
        const seen = new Set<string>();
        ids = ids.filter((i) => !seen.has(this.s.cards[i].defId) && !!seen.add(this.s.cards[i].defId));
      }
      for (const iid of ids) deck.splice(deck.indexOf(iid), 1);
      rng.shuffle(this.s, deck);
      for (const iid of ids) deck.push(iid);
      this.root(ctx).vars[arg.as ?? "found"] = arg.count === undefined || arg.count === 1 ? ids[0] : ids;
      this.setDid(ctx, ids.length > 0);
      const to = arg.to ?? "hand";
      for (const iid of ids) {
        if (arg.reveal) this.log(`${this.pname(searcher)} reveals ${this.q.name(iid)}.`);
        if (to === "deck_top") this.move(iid, "deck");
        else if (to === "play") this.enterPlay(iid, this.who(ctx, arg.controller ?? "you"), { attachTo: arg.attach_to ? this.ref(ctx, arg.attach_to) : undefined, ctx });
        else if (to !== "keep") this.move(iid, to as Zone, { tag: arg.tag ? ctx.source : undefined, faceDown: !!arg.face_down, knownTo: arg.face_down ? [searcher] : undefined });
      }
      if (!arg.reveal && ids.length && to === "hand") this.log(`${this.pname(searcher)} searches and takes ${ids.length} card${ids.length === 1 ? "" : "s"}.`);
      if (!ids.length) this.log(`${this.pname(searcher)} searches ${p === searcher ? "their" : this.pname(p) + "'s"} deck and finds nothing.`);
      return "ok";
    }
    if (count <= 0) return "ok";
    // "If a player would search their deck" (Golden Charm): announce it once.
    if (!task.announced) {
      task.announced = true;
      this.emit({ e: "search", player: searcher, deck: p });
    }
    // "Your opponents must pay 2 to search their deck" (Department of Rejections).
    if (p === searcher && !task.taxed) {
      const tax = this.q.mods("search_tax").reduce((n, m) => (this.q.by(m, searcher) ? n + this.q.value(m.value, m.scope) : n), 0);
      if (tax > 0) {
        if (!this.payNow(searcher, tax)) {
          this.log(`${this.pname(searcher)} can't pay ${tax} to search their deck.`);
          this.setDid(ctx, false);
          return "ok";
        }
        this.log(`${this.pname(searcher)} pays ${tax} to search their deck.`);
      }
      task.taxed = true;
    }
    const scope = this.scope(ctx);
    const cands = deck.filter((iid) => this.q.matches(arg.for ?? {}, iid, scope, null));
    return this.ask(task, {
      type: "choose",
      player: searcher,
      prompt: arg.prompt ?? `${this.q.name(ctx.source)}: search ${p === searcher ? "your" : this.pname(p) + "'s"} deck for ${arg.count === "any" ? "any number of" : "up to " + count} ${this.describeSel(arg.for ?? {}).replace(/^a /, "")}${count === 1 ? "" : "s"}.`,
      options: cands.map((iid) => ({ id: iid, iid, label: this.q.name(iid) })),
      min: arg.exactly ? Math.min(count, cands.length) : 0,
      max: Math.min(count, cands.length),
      list: true,
    });
  }

  /** Move the top N cards of a deck: { who, count, to (discard|hand|void), face_down, tag, as } */
  protected op_mill(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg.who ?? "opponent");
    const ids = this.s.players[p].deck.slice(0, this.num(ctx, arg.count ?? 1));
    const to: Zone = arg.to ?? "discard";
    for (const iid of ids) {
      if ((to as string) === "deck_bottom") this.move(iid, "deck", { bottom: true });
      else this.move(iid, to, { tag: arg.tag ? ctx.source : undefined, faceDown: !!arg.face_down, knownTo: arg.face_down ? [ctx.controller] : undefined });
    }
    if (ids.length) {
      const names = arg.face_down || to === "hand" ? `${ids.length} card${ids.length === 1 ? "" : "s"}` : ids.map((i) => this.q.name(i)).join(", ");
      this.log(`${names} from the top of ${this.pname(p)}'s deck ${ids.length === 1 ? "goes" : "go"} to ${to === "void" ? "the void" + (arg.face_down ? " face-down" : "") : to === "hand" ? "their hand" : "the discard pile"}.`);
    }
    if (arg.as) this.root(ctx).vars[arg.as] = ids;
    return "ok";
  }

  /** Reveal the top N cards of a deck (they stay there): { who, count, as } */
  protected op_reveal_top(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, arg.who ?? "opponent");
    const ids = this.s.players[p].deck.slice(0, this.num(ctx, arg.count ?? 1));
    this.log(`${this.pname(p)} reveals the top ${ids.length} card${ids.length === 1 ? "" : "s"} of their deck: ${ids.map((i) => this.q.name(i)).join(", ") || "(none)"}.`);
    this.root(ctx).vars[arg.as ?? "revealed"] = ids;
    return "ok";
  }

  /** "Play this only if ...": fail (cost) or stop (effect) unless the condition holds. */
  protected op_require(arg: any, ctx: Ctx, task: Task): StepResult {
    if (this.q.cond(arg, this.scope(ctx))) return "ok";
    if (task.phase === "cost") return "fail";
    (this.root(ctx) as any).terminated = true;
    return "ok";
  }

  /** Remember a value on the source card while it is in play: { key: value } */
  protected op_remember(arg: any, ctx: Ctx): StepResult {
    const c = this.s.cards[ctx.source];
    // `{ var: t }` stores a variable's value ("the picked card", Mr. Chesterton).
    const vars = this.root(ctx).vars;
    const vals = Object.fromEntries(Object.entries(arg).map(([k, v]: [string, any]) => [k, v && typeof v === "object" && "var" in v ? vars[v.var] : v]));
    c.notes = { ...(c.notes ?? {}), ...vals };
    return "ok";
  }

  /** Turn a face-down resource face-up (it stays a resource). */
  protected op_flip_face_up(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.refs(ctx, arg)) {
      const c = this.s.cards[iid];
      if (c.zone !== "play" || !c.faceDown) continue;
      c.faceDown = false;
      this.log(`${this.q.name(iid)} is turned face-up.`);
      this.emit({ e: "enters_play", iid, player: c.controller, flipped: true });
    }
    return "ok";
  }

  /** Remove continuous effects created by this card. */
  /** Remove continuous effects this card created: `clear_effects: self`, or `{ tag: name }` for some of them. */
  protected op_clear_effects(arg: any, ctx: Ctx): StepResult {
    const tag = arg && typeof arg === "object" ? arg.tag : undefined;
    this.s.effects = this.s.effects.filter((e) => e.source !== ctx.source || (tag !== undefined && e.tag !== tag));
    return "ok";
  }

  /**
   * Look at the top N cards of a deck and rearrange them:
   * { deck: who|"choose", count, to_hand, bottom: "any"|"rest", reorder }
   * First `to_hand` cards go to hand, then any `bottom` cards go to the bottom, the
   * rest go back on top in an order the player chooses.
   */
  protected op_look(arg: any, ctx: Ctx, task: Task): StepResult {
    const looker = ctx.actor;
    task.stage ??= arg.deck === "choose" ? "deck" : "hand";
    if (task.stage === "deck") {
      if (!task.answer) {
        return this.ask(task, {
          type: "choose",
          player: looker,
          prompt: `${this.q.name(ctx.source)}: look at which deck?`,
          options: [
            { id: ctx.controller, label: "Your deck" },
            { id: other(ctx.controller), label: "Your opponent's deck" },
          ],
          min: 1,
          max: 1,
        });
      }
      task.deckOwner = task.answer.ids[0];
      task.answer = undefined;
      task.stage = "hand";
    }
    const p: PlayerId = task.deckOwner ?? this.who(ctx, arg.deck);
    const deck = this.s.players[p].deck;
    const whose = p === looker ? "their" : `${this.pname(p)}'s`;
    if (!task.cards) {
      task.cards = deck.slice(0, this.num(ctx, arg.count));
      this.log(`${this.pname(looker)} looks at the top ${task.cards.length} card${task.cards.length === 1 ? "" : "s"} of ${whose} deck.`);
    }
    // Cards still to be placed: looked at, still in the deck, not yet sent to hand or bottom.
    task.placed ??= [];
    const remaining = () => (task.cards as string[]).filter((i) => deck.includes(i) && !task.placed.includes(i));
    if (task.stage === "hand") {
      if (arg.to_hand && !task.answer && remaining().length) {
        const n = Math.min(arg.to_hand, remaining().length);
        return this.ask(task, { type: "choose", player: looker, prompt: `Put ${n} into your hand.`, options: this.cardOptions(remaining()), min: n, max: n, list: true });
      }
      if (task.answer) for (const iid of task.answer.ids) this.move(iid, "hand");
      task.answer = undefined;
      task.stage = "bottom";
    }
    if (task.stage === "bottom") {
      if (arg.bottom === "any" && !task.answer && remaining().length) {
        return this.ask(task, { type: "choose", player: looker, prompt: "Choose any of these to put on the bottom of the deck.", options: this.cardOptions(remaining()), min: 0, max: remaining().length, list: true });
      }
      // "Put 1 card on the bottom of that deck": an exact number.
      if (typeof arg.bottom === "number" && !task.answer && remaining().length) {
        const n = Math.min(arg.bottom, remaining().length);
        return this.ask(task, { type: "choose", player: looker, prompt: `Put ${n} on the bottom of the deck.`, options: this.cardOptions(remaining()), min: n, max: n, list: true });
      }
      const toBottom: string[] = arg.bottom === "rest" ? remaining() : (task.answer?.ids ?? []);
      for (const iid of toBottom) this.move(iid, "deck", { bottom: true });
      task.placed.push(...toBottom);
      if (toBottom.length) this.log(`${toBottom.length} card${toBottom.length === 1 ? " goes" : "s go"} to the bottom of ${whose} deck.`);
      task.answer = undefined;
      task.stage = "order";
    }
    if (task.stage === "order") {
      const rest = remaining();
      if (rest.length > 1 && arg.reorder !== false && !task.answer) {
        return this.ask(task, { type: "order", player: looker, prompt: "Put these back on top of the deck (first = top).", options: this.cardOptions(rest) });
      }
      if (task.answer) for (const iid of [...(task.answer.ids as string[])].reverse()) this.move(iid, "deck");
    }
    return "ok";
  }

  private cardOptions(ids: string[]): Option[] {
    return ids.map((iid) => ({ id: iid, iid, label: this.q.name(iid) }));
  }

  /** Play a card through an effect: { card, free, ignore_threshold } */
  protected op_play_card(arg: any, ctx: Ctx): StepResult {
    const iid = this.ref(ctx, arg.card);
    if (!iid) return "ok";
    const def = this.q.def(iid);
    const ignore = !!arg.ignore_threshold;
    if (!ignore && !this.q.meets(ctx.actor, def.threshold, this.q.thresholdReduction(iid))) {
      this.log(`${this.pname(ctx.actor)} doesn't meet the threshold to play ${def.name}.`);
      return "ok";
    }
    if (this.q.cannot("play", iid, ctx.actor)) {
      this.log(`${def.name} can't be played.`);
      return "ok";
    }
    this.setDid(ctx, true);
    this.push({ t: "deploy", p: ctx.actor, iid, nested: true, free: !!arg.free, ignoreThreshold: ignore, viaEffect: true });
    return "ok";
  }

  /** Play a resource from hand: count, or { who, count, optional } */
  protected op_play_resource(arg: any, ctx: Ctx, task: Task): StepResult {
    const a = typeof arg === "object" && arg !== null ? arg : { count: arg };
    const p = this.who(ctx, a.who);
    if (task.answer) {
      const ans = task.answer;
      if (ans.iid) {
        this.putResource(p, ans.iid, !!ans.faceDown, false);
        if (ans.faceDown) {
          this.log(`${this.pname(p)} plays a face-down resource.`);
          this.log(`(face-down: ${this.q.name(ans.iid)})`, p);
        } else this.log(`${this.pname(p)} plays ${this.q.name(ans.iid)} as a resource.`);
        this.setDid(ctx, true);
      }
      const left = (task.left ?? this.num(ctx, a.count ?? 1)) - 1;
      if (left > 0 && ans.iid) this.push({ ...task, answer: undefined, left });
      return "ok";
    }
    if (!this.s.players[p].hand.length) {
      this.log(`${this.pname(p)} has no cards to play as a resource.`);
      return "ok";
    }
    return this.ask(task, { type: "play_resource", player: p, optional: !!a.optional || !!a.up_to });
  }

  protected op_restore_all_depleted(arg: any, ctx: Ctx): StepResult {
    const p = this.who(ctx, typeof arg === "object" && arg ? arg.who : arg);
    const byRule = !!this.root(ctx).vars.by_rule;
    for (const iid of [...this.s.players[p].play, this.s.players[p].factionIid]) {
      if (byRule && this.q.cannot("restore_by_rule", iid, p)) continue;
      if (this.q.cannot("restore", iid, p)) continue;
      this.setDepleted(iid, false);
    }
    if (byRule) this.s.effects = this.s.effects.filter((e) => !(e.duration === "next_restore" && e.restorer === p));
    return "ok";
  }

  protected op_detach_all_resources(arg: any, ctx: Ctx): StepResult {
    for (const iid of this.q.resources(this.who(ctx, arg))) this.s.cards[iid].attachedTo = null;
    return "ok";
  }

  /** Detach up to N resources from your faction: { who, count }, or specific ones: { card: r } */
  protected op_detach(arg: any, ctx: Ctx): StepResult {
    if (arg.card !== undefined) {
      for (const iid of this.refs(ctx, arg.card)) if (this.s.cards[iid].attachedTo === "faction") this.s.cards[iid].attachedTo = null;
      return "ok";
    }
    const p = this.who(ctx, arg.who);
    const n = this.num(ctx, arg.count ?? 1);
    const spent = this.q.resources(p).filter((i) => this.s.cards[i].attachedTo === "faction");
    for (const iid of spent.slice(0, n)) this.s.cards[iid].attachedTo = null;
    this.log(`${this.pname(p)} detaches ${Math.min(n, spent.length)} resource${Math.min(n, spent.length) === 1 ? "" : "s"}.`);
    return "ok";
  }

  /** That player destroys one of their resources: { who, face_down } */
  protected op_destroy_resource(arg: any, ctx: Ctx, task: Task): StepResult {
    const p = this.who(ctx, arg.who);
    const cands = this.q.resources(p).filter((i) => arg.face_down === undefined || this.s.cards[i].faceDown === arg.face_down);
    if (task.answer) {
      for (const iid of task.answer.ids) this.destroy(iid, task.phase === "cost" ? "cost" : "effect", false, ctx.controller);
      return "ok";
    }
    if (!cands.length) return task.phase === "cost" ? "fail" : "ok";
    return this.ask(task, {
      type: "choose",
      player: p,
      prompt: `${this.q.name(ctx.source)}: destroy a${arg.face_down ? " face-down" : ""} resource you control.`,
      options: cands.map((iid) => ({ id: iid, iid, label: this.resourceLabel(iid) })),
      min: 1,
      max: 1,
      cancellable: task.phase === "cost" && !!this.s.snapshot,
    });
  }

  /** Terminate a card or ability being played: "responded", "self", or a card on the stack. */
  protected op_terminate(arg: any, ctx: Ctx): StepResult {
    if (arg === "self") {
      (this.root(ctx) as any).terminated = true;
      this.log(`${this.q.name(ctx.source)} is terminated.`);
      return "ok";
    }
    // "All other unresolved cards are terminated" (Hilarious Refrigerator Alarm).
    if (arg === "all") {
      for (const item of this.s.stack.splice(0).reverse()) {
        if (item.kind === "card") this.move(item.iid, "discard");
        this.dropCtx(item.ctx);
        this.log(`${item.label} is terminated.`);
      }
      return "ok";
    }
    // "responded", a stack item id, or a card reference (the card being deployed).
    const id = arg === "responded" ? this.root(ctx).responding : arg;
    const card = arg === "responded" ? undefined : this.ref(ctx, arg);
    const i = this.s.stack.findIndex((x) => x.id === id || (card !== undefined && x.kind === "card" && x.iid === card));
    if (i < 0) return "ok";
    const [item] = this.s.stack.splice(i, 1);
    if (item.kind === "card") this.move(item.iid, "discard");
    this.dropCtx(item.ctx);
    this.log(`${item.label} is terminated.`);
    return "ok";
  }

  /**
   * Flip a coin: { as: won }. Sets the variable and "did" to whether you won.
   * Two-Headed Coin: if you'd lose, you may shuffle it into your deck, reflip and draw a card.
   */
  protected op_coin_flip(arg: any, ctx: Ctx, task: Task): StepResult {
    const p = ctx.controller;
    const vars = this.root(ctx).vars;
    const settle = (won: boolean) => {
      this.emit({ e: "coin_flipped", player: p, won });
      vars[arg?.as ?? "won"] = won;
      this.setDid(ctx, won);
      this.log(`${this.pname(p)} flips a coin and ${won ? "wins" : "loses"}.`);
      return "ok" as StepResult;
    };
    if (task.answer) {
      if (task.answer.ids[0] === "yes") {
        const coin = task.coin as string;
        this.log(`${this.pname(p)} shuffles ${this.q.name(coin)} into their deck to reflip.`);
        this.move(coin, "deck");
        rng.shuffle(this.s, this.s.players[this.s.cards[coin].owner].deck);
        const won = rng.int(this.s, 2) === 0;
        this.drawCards(p, 1);
        return settle(won);
      }
      return settle(false);
    }
    const won = rng.int(this.s, 2) === 0;
    if (won) return settle(true);
    const coin = this.s.players[p].play.find((i) => this.q.active(i) && this.q.rules(i).some((r) => "coin_reflip" in r));
    if (!coin) return settle(false);
    task.coin = coin;
    this.log(`${this.pname(p)} would lose a coin flip.`);
    return this.ask(task, { type: "choose", player: p, prompt: `You would lose the coin flip. Shuffle ${this.q.name(coin)} into your deck to reflip and draw a card?`, options: [{ id: "yes", label: "Yes, reflip" }, { id: "no", label: "No" }], min: 1, max: 1 });
  }

  /** Put tokens into play: { card: micromajig-token, count, controller, as } */
  protected op_create_token(arg: any, ctx: Ctx): StepResult {
    const a = typeof arg === "string" ? { card: arg } : (arg ?? {});
    const defId = a.card ?? "micromajig-token";
    if (!this.lib[defId]) {
      this.log(`[engine] Unknown token ${defId}.`);
      return "ok";
    }
    const ctl = this.who(ctx, a.controller ?? "you");
    const made: string[] = [];
    for (let i = 0; i < this.num(ctx, a.count ?? 1); i++) {
      const iid = this.newCard(defId, ctl, "void");
      this.s.players[ctl].void.push(iid);
      this.enterPlay(iid, ctl, { ctx });
      made.push(iid);
    }
    if (a.as) this.root(ctx).vars[a.as] = made.length === 1 ? made[0] : made;
    return "ok";
  }

  /** Remove characters from the current battle: { remove_from_battle: c } */
  protected op_remove_from_battle(arg: any, ctx: Ctx): StepResult {
    const b = this.s.battle;
    if (!b) return "ok";
    for (const iid of this.refs(ctx, arg)) {
      if (!b.attackers.includes(iid) && !b.blockers.includes(iid)) continue;
      b.attackers = b.attackers.filter((i) => i !== iid);
      b.blockers = b.blockers.filter((i) => i !== iid);
      delete b.locked[iid];
      this.log(`${this.q.name(iid)} is removed from the battle.`);
    }
    return "ok";
  }

  /** Add characters to a party in the current battle: { card, side: attacking|blocking } (default: their controller's side). */
  protected op_add_to_battle(arg: any, ctx: Ctx): StepResult {
    const b = this.s.battle;
    if (!b) return "ok";
    for (const iid of this.refs(ctx, arg.card)) {
      if (!this.q.isCharacter(iid) || b.attackers.includes(iid) || b.blockers.includes(iid)) continue;
      const side = arg.side ?? (this.s.cards[iid].controller === b.attacker ? "attacking" : "blocking");
      (side === "attacking" ? b.attackers : b.blockers).push(iid);
      this.log(`${this.q.name(iid)} joins the ${side} party.`);
    }
    return "ok";
  }

  /** Turn a double-sided faction over: { transform: <card id of the other side> } */
  protected op_transform(arg: any, ctx: Ctx): StepResult {
    const c = this.s.cards[ctx.source];
    if (!this.q.isFaction(ctx.source) || !this.lib[arg]) return "ok";
    const before = this.q.name(ctx.source);
    c.defId = arg;
    this.s.players[c.owner].factionId = arg;
    this.log(`${before} turns over: ${this.lib[arg].name}.`);
    return "ok";
  }

  /** "The ability has no effect." */
  protected op_nullify(arg: any, ctx: Ctx): StepResult {
    const id = arg === "responded" ? this.root(ctx).responding : arg;
    const item = this.s.stack.find((x) => x.id === id);
    if (item) item.nullified = true;
    return "ok";
  }

  /** Lost on Floor 3: terminate the end of turn declaration. */
  protected op_cancel_end_turn(): StepResult {
    if (!this.s.endTurn) return "ok";
    this.s.endTurn = false;
    if (this.s.window?.kind === "endturn") this.s.window = null;
    this.log(`${this.pname(this.s.active)}'s end of turn is terminated; the turn continues.`);
    return "ok";
  }

  /** Duplicate the last tactic played this turn (Ectypal Stave). */
  protected op_duplicate(arg: any, ctx: Ctx): StepResult {
    // `duplicate: responded`: the tactic this card responds to (Muddle).
    if (arg === "responded") {
      const item = this.s.stack.find((x) => x.id === this.root(ctx).responding);
      if (item?.kind === "card") this.push({ t: "duplicate", p: ctx.actor, defId: this.s.cards[item.iid].defId, source: ctx.source });
      return "ok";
    }
    const last = [...this.s.turnLog.played].reverse().find((e) => e.types.includes("tactic"));
    if (last) this.push({ t: "duplicate", p: ctx.actor, defId: last.defId, source: ctx.source });
    return "ok";
  }

  protected t_duplicate(task: Task): void {
    const def = this.lib[task.defId];
    const play = def.rules?.find((r) => r.play)?.play ?? {};
    const ctx = this.newCtx(task.p, task.source);
    ctx.vars.__dupDef = task.defId;
    ctx.free = true;
    this.takeSnapshot(task.p);
    this.log(`${def.name} is duplicated.`);
    this.push(...this.steps(play.cost ?? [], ctx, "cost"), { t: "payNumeric", ctx: ctx.id, base: 0 }, { t: "duplicated", ctx: ctx.id, label: `${def.name} (duplicate)` });
  }

  protected t_duplicated(task: Task): void {
    const ctx = this.s.ctxs[task.ctx];
    this.commitCosts();
    this.s.stack.push({ id: rng.id(this.s), kind: "duplicate", controller: ctx.controller, iid: ctx.source, ctx: ctx.id, label: task.label, noResponse: true });
    this.s.priority = other(ctx.controller);
  }

  // --- battle ----------------------------------------------------------------

  private declareAttack(p: PlayerId, target: string, attackers: string[]): void {
    const q = this.q;
    const d = other(p);
    if (this.s.stack.length || this.s.battle) throw new GameError("You can't attack right now.");
    // "Your opponents cannot attack your faction" (High Court of Demands).
    if (target === "faction" && q.cannot("attack_faction", null, p)) throw new GameError("You can't attack that faction.");
    if (target !== "faction") {
      const t = this.s.cards[target];
      if (!t || !q.inPlay(target) || t.controller !== d || !q.is(target, "location")) throw new GameError("You can only attack your opponent's faction or locations.");
    }
    if (!attackers.length) throw new GameError("Choose at least one attacker.");
    if (new Set(attackers).size !== attackers.length) throw new GameError("Duplicate attacker.");
    for (const iid of attackers) {
      if (!this.s.cards[iid] || this.s.cards[iid].controller !== p || !q.canAttack(iid)) throw new GameError(`${this.s.cards[iid] ? q.name(iid) : iid} can't attack.`);
    }
    // "Players can attack only once each turn" (Narrow Passage).
    const declared = this.s.turnLog.declared ?? 0;
    if (q.mods("attack_declarations").some((m) => declared >= q.value(m.value, m.scope))) throw new GameError("You can't attack again this turn.");
    // Party rules ("must have at least 2 members", "only 1 member", "even number").
    const partyErr = this.partyRuleError(attackers, "attacking", p);
    if (partyErr) throw new GameError(partyErr);
    // "Must pay N to attack with it" (Auspicious Tax).
    const toll = attackers.reduce((n, iid) => n + q.modsFor("attack_cost", iid).reduce((k, m) => k + q.value(m.value, m.scope), 0), 0);
    if (toll > 0) {
      if (!this.payNow(p, toll)) throw new GameError(`Attacking with those characters costs ${toll}.`);
      this.log(`${this.pname(p)} pays ${toll} to attack.`);
    }
    this.s.turnLog.declared = declared + 1;
    for (const iid of attackers) {
      if (!q.mods("no_deplete_on_attack").some((m) => q.targets(m, iid))) this.setDepleted(iid, true);
      this.s.turnLog.attacks[iid] = (this.s.turnLog.attacks[iid] ?? 0) + 1;
    }
    // COVERT parties: every member has COVERT, or a member makes its party COVERT (Cloaked Creeper).
    const covert = attackers.every((i) => q.keyword(i, "covert")) || attackers.some((i) => q.modsFor("party_covert", i).length > 0);
    this.s.battle = { attacker: p, defender: d, target, attackers, blockers: [], covert, done: [], speed: null, locked: {}, sources: {}, step: "declared" };
    this.log(`${this.pname(p)} attacks ${target === "faction" ? this.pname(d) + "'s faction" : q.name(target)} with ${attackers.map((i) => q.name(i)).join(", ")}${covert ? " (Covert)" : ""}.`);
    this.emit({ e: "party_formed", player: p, side: "attacking" });
    for (const iid of attackers) this.emit({ e: "attacks", iid, player: p });
    this.s.window = { kind: "battle", current: p, passes: 0, next: "blockers" };
  }

  /**
   * "This card cannot be blocked [by ...]": a party can't be blocked by a character
   * if every attacker in it can't be blocked by that character (like COVERT, which
   * only protects a party when all its members have it).
   */
  private canBlockParty(blocker: string, attackers: string[]): boolean {
    const q = this.q;
    const unblockable = (a: string) =>
      q.modsFor("cannot_be_blocked", a).some((m) => {
        const by = m.value?.by;
        return by === undefined || q.matches(by, blocker, m.scope, null);
      });
    return !attackers.length || !attackers.every(unblockable);
  }

  /** Party rules from modifiers: { party: { side, min, max, even, including } }. */
  partyRuleError(members: string[], side: "attacking" | "blocking", p: PlayerId): string | null {
    const q = this.q;
    for (const m of q.mods("party")) {
      const r = m.value;
      if (r.side && r.side !== side && r.side !== "both") continue;
      if (r.by && !q.by({ ...m, mod: { by: r.by } }, p)) continue;
      if (r.including && !members.some((x) => q.targets({ ...m, mod: { target: r.including } }, x))) continue;
      const n = members.length;
      if (!n) continue;
      const who = q.name(m.source);
      if (r.min !== undefined && n < r.min) return `${who}: the ${side} party must have at least ${r.min} members.`;
      if (r.max !== undefined && n > r.max) return `${who}: the ${side} party can have at most ${r.max} member${r.max === 1 ? "" : "s"}.`;
      if (r.even && n % 2) return `${who}: the ${side} party must have an even number of members.`;
    }
    return null;
  }

  private inBattle(iid: string): boolean {
    const b = this.s.battle!;
    const c = this.s.cards[iid];
    if (!c || !this.q.isCharacter(iid)) return false;
    if (b.attackers.includes(iid)) return c.controller === b.attacker;
    if (b.blockers.includes(iid)) return c.controller === b.defender;
    return false;
  }

  protected t_battle(task: Task): void {
    const b = this.s.battle;
    if (!b) return;
    const q = this.q;
    b.attackers = b.attackers.filter((i) => this.inBattle(i));
    b.blockers = b.blockers.filter((i) => this.inBattle(i));

    switch (b.step) {
      case "blockers": {
        const cands = q.characters(b.defender).filter((i) => !this.s.cards[i].depleted && !q.cannot("block", i, b.defender) && (q.modsFor("blocks_any", i).length > 0 || (b.covert ? q.keyword(i, "covert") || q.mods("covert_blockable").length > 0 : !q.keyword(i, "covert"))) && this.canBlockParty(i, b.attackers));
        if (task.answer || !cands.length) {
          b.blockers = task.answer?.ids ?? [];
          if (b.blockers.length) {
            this.log(`${this.pname(b.defender)} blocks with ${b.blockers.map((i) => q.name(i)).join(", ")}.`);
            this.emit({ e: "party_formed", player: b.defender, side: "blocking" });
            for (const iid of b.blockers) this.emit({ e: "blocks", iid, player: b.defender });
            for (const iid of b.attackers) this.emit({ e: "blocked", iid, player: b.attacker });
          } else this.log(cands.length ? `${this.pname(b.defender)} does not block.` : `${this.pname(b.defender)} has no characters able to block.`);
          b.step = "group";
          this.push({ t: "battle" });
          return;
        }
        this.ask(task, { type: "blockers", player: b.defender, candidates: cands });
        return;
      }
      case "group": {
        const pending = [...b.attackers, ...b.blockers].filter((i) => !b.done.includes(i));
        if (!pending.length) {
          b.step = "end";
          this.push({ t: "battle" });
          return;
        }
        b.speed = Math.max(...pending.map((i) => q.stat(i, "spd")));
        this.s.window = { kind: "battle", current: b.attacker, passes: 0, next: "assign" };
        return;
      }
      case "assign": {
        const pending = [...b.attackers, ...b.blockers].filter((i) => !b.done.includes(i));
        if (!pending.length) {
          b.step = "end";
          this.push({ t: "battle" });
          return;
        }
        b.speed = Math.max(...pending.map((i) => q.stat(i, "spd")));
        const group = pending.filter((i) => q.stat(i, "spd") === b.speed);
        b.done.push(...group);
        this.log(`Speed ${b.speed}: ${group.map((i) => q.name(i)).join(", ")} assign damage.`);
        this.push({ t: "assignDamage", side: "attacker", group: group.filter((i) => b.attackers.includes(i)) }, { t: "assignDamage", side: "defender", group: group.filter((i) => b.blockers.includes(i)) }, { t: "battleWindow2" });
        return;
      }
      case "inflict": {
        const locked = b.locked;
        const sources = b.sources;
        b.locked = {};
        b.sources = {};
        for (const [k, n] of Object.entries(locked)) {
          if (k === "target") {
            if (b.target === "faction") this.damageFaction(b.defender, n, sources[k] ?? [], true, b.attacker);
            else if (this.q.inPlay(b.target)) this.inflict(b.target, n, true, sources[k] ?? []);
          } else if (this.q.isCharacter(k)) this.inflict(k, n, true, sources[k] ?? []);
        }
        b.step = "group";
        this.push({ t: "battle" });
        return;
      }
      case "end": {
        for (const iid of [...b.attackers, ...b.blockers]) this.setDepleted(iid, true);
        this.log("The battle ends.");
        this.emit({ e: "battle_end", player: b.attacker, attackers: [...b.attackers], blockers: [...b.blockers] });
        this.s.battle = null;
        // "During this battle" effects end with it (Inconvenient Roadblock).
        this.s.effects = this.s.effects.filter((e) => e.duration !== "battle");
        return;
      }
    }
  }

  protected t_battleWindow2(): void {
    const b = this.s.battle;
    if (b) this.s.window = { kind: "battle", current: b.attacker, passes: 0, next: "inflict" };
  }

  /** The battle damage a character assigns: its strength, or its numeric cost under `assign_cost` (Ocular Dispersal). */
  private battlePower(i: string): number {
    return this.q.modsFor("assign_cost", i).length ? this.q.numericCost(i) : this.q.stat(i, "str");
  }

  protected t_assignDamage(task: Task): void {
    const b = this.s.battle;
    if (!b) return;
    let group = (task.group as string[]).filter((i) => this.inBattle(i));
    // "If the character would inflict battle damage, inflict that damage to itself instead" (Don't Trip).
    // (Only once: this task runs again with the answer to the assignment prompt.)
    for (const i of task.answer ? [] : group.filter((x) => this.q.modsFor("battle_damage_to_self", x).length)) {
      const n = this.battlePower(i);
      if (n <= 0) continue;
      b.locked[i] = (b.locked[i] ?? 0) + n;
      b.sources[i] = [...new Set([...(b.sources[i] ?? []), i])];
      (this.s.turnLog.assigned ??= {})[i] = true;
      this.log(`${this.q.name(i)} assigns ${n} damage to itself.`);
    }
    group = group.filter((x) => !this.q.modsFor("battle_damage_to_self", x).length);
    // "If it would assign battle damage to the blocking party, assign it to the target of the attack instead" (Penetrate).
    const mustPass = (x: string) => task.side === "attacker" && this.q.modsFor("assign_to_target", x).some((m) => m.value?.must);
    for (const i of task.answer ? [] : group.filter(mustPass)) {
      const n = this.battlePower(i);
      if (n <= 0) continue;
      b.locked.target = (b.locked.target ?? 0) + n;
      b.sources.target = [...new Set([...(b.sources.target ?? []), i])];
      (this.s.turnLog.assigned ??= {})[i] = true;
      this.log(`${this.q.name(i)} assigns ${n} damage to the target of the attack.`);
    }
    group = group.filter((x) => !mustPass(x));
    const total = group.reduce((n, i) => n + this.battlePower(i), 0);
    if (total <= 0) return;
    for (const i of group) if (this.battlePower(i) > 0) (this.s.turnLog.assigned ??= {})[i] = true;
    const attacking = task.side === "attacker";
    const player = attacking ? b.attacker : b.defender;
    const targets = attacking ? b.blockers.filter((i) => this.inBattle(i)) : b.attackers.filter((i) => this.inBattle(i));
    const lock = (m: Record<string, number>) => {
      for (const [k, n] of Object.entries(m)) {
        if (n <= 0) continue;
        b.locked[k] = (b.locked[k] ?? 0) + n;
        b.sources[k] = [...new Set([...(b.sources[k] ?? []), ...group])];
      }
      const parts = Object.entries(m)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} to ${k === "target" ? (b.target === "faction" ? this.pname(b.defender) + "'s faction" : this.q.name(b.target)) : this.q.name(k)}`);
      this.log(`${this.pname(player)} assigns ${parts.join(", ")}.`);
    };
    if (task.answer) return lock(task.answer.assign);
    if (!targets.length) {
      if (attacking) lock({ target: total });
      return;
    }
    // "You may assign its battle damage to the target of the attack instead of the blocking party" (Colossal Flattener).
    const past = attacking ? group.filter((i) => this.q.modsFor("assign_to_target", i).length).reduce((n, i) => n + this.battlePower(i), 0) : 0;
    if (past > 0) {
      const label = b.target === "faction" ? `${this.pname(b.defender)}'s faction` : this.q.name(b.target);
      this.ask(task, { type: "assign", player, prompt: `Divide ${total} damage among the blocking party (up to ${past} may go to ${label}).`, total, targets: [...targets, "target"], labels: { target: label }, caps: { target: past } });
      return;
    }
    // "All battle damage that could be assigned to this card must be assigned to it" (Courageous Paladin).
    const forced = targets.filter((i) => this.q.modsFor("must_be_assigned", i).length);
    if (forced.length) targets.splice(0, targets.length, ...forced);
    if (targets.length === 1) return lock({ [targets[0]]: total });
    this.ask(task, { type: "assign", player, prompt: `Divide ${total} damage among the ${attacking ? "blocking" : "attacking"} party.`, total, targets });
  }

  // --- state-based checks ----------------------------------------------------

  private checks(): void {
    const s = this.s;
    const q = this.q;
    if (s.phase === "ended") return;
    // Each pass scans read-only (with cached modifiers), then applies destructions.
    for (let pass = 0; pass < 20; pass++) {
      const doomed = q.frozen(() => {
        const out: { iid: string; cause: "rule" | "damage" }[] = [];
        for (const iid of q.allInPlay()) {
          const c = s.cards[iid];
          if (c.isResource || q.isFaction(iid)) continue;
          // Attached cards whose host is gone or no longer a character are destroyed.
          if (c.attachedTo && c.attachedTo !== "faction" && !q.isCharacter(c.attachedTo) && !q.modsFor("stays_in_play", iid).length) out.push({ iid, cause: "rule" });
          else if (q.is(iid, "character") && c.damage >= q.stat(iid, "life")) out.push({ iid, cause: "damage" });
          else if (q.is(iid, "location") && c.markers >= q.stat(iid, "structure")) out.push({ iid, cause: "damage" });
          // "[R][R][R]: Destroy this card." (Boorish Boar)
          else if (q.modsFor("destroy_self", iid).length) out.push({ iid, cause: "rule" });
        }
        return out;
      });
      let changed = false;
      // Destroyed by damage: the player whose card inflicted the last damage destroyed it.
      for (const { iid, cause } of doomed) if (q.inPlay(iid) && this.destroy(iid, cause, false, cause === "damage" ? s.cards[iid].hitBy : undefined)) changed = true;
      if (!changed) break;
    }
    const verdict = q.frozen(() => {
      for (const p of ["A", "B"] as PlayerId[]) {
        const groups = new Map<string, string[]>();
        for (const iid of s.players[p].play) {
          if (!q.active(iid) || q.silenced(iid)) continue;
          const u = q.ruleOf(iid, "unique");
          if (u) groups.set(u, [...(groups.get(u) ?? []), iid]);
        }
        for (const [name, ids] of groups) {
          if (ids.length < 2) continue;
          // While duplicates can't be destroyed (Limited Liability), they stay; the rule
          // applies again once the protection ends.
          if (ids.some((i) => this.destroyProtected(i))) continue;
          const queued = s.tasks.some((t) => t.t === "unique" && t.p === p && t.name === name) || (s.waiting?.t === "unique" && s.waiting.name === name);
          if (!queued) s.tasks.push({ t: "unique", p, name });
        }
      }
      if (s.phase !== "play") return null;
      const loses = (p: PlayerId) => {
        if (s.players[p].influence <= 0 && !q.mods("cannot").some((m) => m.value === "lose_game" && m.controller === p)) return true;
        return !s.players[p].deck.length && q.mods("lose_when_deck_empty").length > 0;
      };
      const a = loses("A");
      const b = loses("B");
      return a || b ? (a && b ? "draw" : a ? "B" : "A") : null;
    });
    if (verdict) {
      this.end(verdict);
      return;
    }
    this.collectTriggers();
  }

  protected t_unique(task: Task): void {
    const p = task.p as PlayerId;
    const ids = this.s.players[p].play.filter((i) => this.q.active(i) && this.q.ruleOf(i, "unique") === task.name);
    if (ids.length < 2) return;
    if (task.answer) {
      for (const iid of ids) if (iid !== task.answer.ids[0]) this.destroy(iid, "rule");
      return;
    }
    this.ask(task, { type: "choose", player: p, prompt: `Unique ${task.name}: choose the one to keep. The rest are destroyed.`, options: ids.map((iid) => ({ id: iid, iid, label: this.q.name(iid) })), min: 1, max: 1 });
  }

  // --- card movement, damage, influence ---------------------------------------

  /**
   * Move a card between zones, applying redirect modifiers ("if a card would be put
   * into X, put it into Y instead"). Cards attached to it follow it out of play.
   */
  move(iid: string, zone: Zone, opts: { bottom?: boolean; controller?: PlayerId; tag?: string; faceDown?: boolean; knownTo?: PlayerId[]; noRedirect?: boolean } = {}): void {
    const c = this.s.cards[iid];
    const from = c.zone;
    if (!opts.noRedirect && zone !== "play" && zone !== "stack") {
      for (const m of this.q.mods("redirect")) {
        const r = m.value;
        if (r.to !== zone || (r.from && r.from !== from) || !this.q.targets(m, iid)) continue;
        // "Cards cannot be put into your opponents' hands" (Lockbox of the Aeons): it stays.
        if (r.instead === "stay") {
          this.log(`${this.q.name(iid)} can't be put there; it stays where it is.`);
          return;
        }
        // "Shuffle it into your deck instead" (Marauding Madster).
        if (r.instead === "deck_shuffle") {
          this.log(`${this.q.name(iid)} is shuffled into its owner's deck instead.`);
          this.move(iid, "deck", { noRedirect: true });
          rng.shuffle(this.s, this.s.players[c.owner].deck);
          return;
        }
        this.log(`${this.q.name(iid)} goes to ${r.instead === "void" ? "the void" : `the ${r.instead}`} instead.`);
        zone = r.instead;
        break;
      }
    }
    const wasInPlay = from === "play";
    // Tokens that would leave play are removed from the game instead.
    if (wasInPlay && zone !== "play" && this.lib[c.defId].token) zone = "void";
    const attached = wasInPlay ? this.q.attachments(iid) : [];
    for (const p of ["A", "B"] as PlayerId[]) {
      const ps = this.s.players[p];
      for (const key of ["deck", "hand", "play", "discard", "void"] as const) {
        const i = ps[key].indexOf(iid);
        if (i >= 0) ps[key].splice(i, 1);
      }
    }
    if (wasInPlay && zone !== "play") {
      const ctl = c.controller;
      const hadTokens = c.tokens;
      // Cards attached to it, for "when the attached character leaves play" (they leave too).
      const attached = Object.values(this.s.cards).filter((x) => x.attachedTo === iid && x.zone === "play").map((x) => x.iid);
      this.leavePlayCleanup(iid);
      c.faceDown = false;
      c.isResource = false;
      c.attachedTo = null;
      c.depleted = false;
      c.markers = 0;
      c.tokens = 0;
      c.notes = undefined;
      c.controller = c.owner;
      this.emit({ e: "leaves_play", iid, to: zone, player: ctl, tokens: hadTokens, attached });
    }
    if (zone !== "play") c.revealed = false;
    c.zone = zone;
    c.voidFaceDown = zone === "void" && opts.faceDown ? true : undefined;
    c.knownTo = zone === "void" && opts.faceDown ? opts.knownTo : undefined;
    c.tags = opts.tag ? [opts.tag] : undefined;
    if (zone !== "stack") {
      if (zone === "play") {
        const ctl = opts.controller ?? c.controller;
        c.controller = ctl;
        this.s.players[ctl].play.push(iid);
      } else {
        const list = this.s.players[c.owner][zone];
        if (zone === "deck" && !opts.bottom) list.unshift(iid);
        else list.push(iid);
      }
    }
    if (from !== zone && zone !== "stack" && from !== "stack") this.emit({ e: "moved", iid, from, to: zone, player: c.owner });
    // "If something causes a card to leave play, any cards attached to it leave play in the same way."
    for (const a of attached) {
      if (this.s.cards[a].zone !== "play") continue;
      // "This card does not leave play if the attached card leaves play" (Everlasting Blade of Light).
      if (this.q.modsFor("stays_in_play", a).length) this.s.cards[a].attachedTo = null;
      else this.move(a, zone);
    }
  }

  private relist(iid: string, ctl: PlayerId): void {
    const c = this.s.cards[iid];
    if (c.controller === ctl) return;
    const from = this.s.players[c.controller].play;
    const i = from.indexOf(iid);
    if (i >= 0) from.splice(i, 1);
    this.s.players[ctl].play.push(iid);
    c.controller = ctl;
  }

  takeControl(iid: string, p: PlayerId): void {
    const c = this.s.cards[iid];
    if (c.zone !== "play" || c.controller === p) return;
    const b = this.s.battle;
    if (b) {
      b.attackers = b.attackers.filter((i) => i !== iid);
      b.blockers = b.blockers.filter((i) => i !== iid);
    }
    this.relist(iid, p);
    c.controlSince = this.s.turn;
    this.log(`${this.pname(p)} takes control of ${this.q.name(iid)}.`);
  }

  private leavePlayCleanup(iid: string): void {
    const c = this.s.cards[iid];
    c.damage = 0;
    c.hitBy = undefined;
    c.depleted = false;
    for (const e of this.s.effects) {
      for (const m of e.mods ?? []) if (m.target?.iids) m.target.iids = m.target.iids.filter((i: string) => i !== iid);
    }
    const b = this.s.battle;
    if (b) {
      b.attackers = b.attackers.filter((i) => i !== iid);
      b.blockers = b.blockers.filter((i) => i !== iid);
      delete b.locked[iid];
    }
  }

  enterPlay(iid: string, ctl: PlayerId, opts: { attachTo?: string; ctx?: Ctx } = {}): void {
    const c = this.s.cards[iid];
    this.move(iid, "play", { controller: ctl });
    c.faceDown = false;
    c.isResource = false;
    c.controlSince = this.s.turn;
    c.attachedTo = opts.attachTo && this.q.isCharacter(opts.attachTo) ? opts.attachTo : null;
    const def = this.q.def(iid);
    if (def.enters_depleted) c.depleted = true;
    if (def.enters_with_tokens !== undefined) {
      const scope: Scope = opts.ctx ? this.scope(opts.ctx) : { controller: ctl, source: iid, vars: {} };
      c.tokens = Math.max(0, this.q.value(def.enters_with_tokens, scope));
    }
    this.log(`${def.name} enters play under ${this.pname(ctl)}'s control${c.attachedTo ? `, attached to ${this.q.name(c.attachedTo)}` : ""}.`);
    this.emit({ e: "enters_play", iid, player: ctl });
  }

  putResource(p: PlayerId, iid: string, faceDown: boolean, silent: boolean): void {
    const c = this.s.cards[iid];
    if (c.zone === "play") this.leavePlayCleanup(iid);
    this.move(iid, "play", { controller: p });
    c.isResource = true;
    c.faceDown = faceDown;
    c.attachedTo = null;
    c.controlSince = this.s.turn;
    if (!silent) this.emit({ e: "enters_play", iid, player: p });
  }

  /**
   * Destroy a card in play, applying prohibitions and "instead" replacements.
   * `cause` distinguishes costs (Limited Liability) from effects, damage and rules.
   * Returns true if something happened to the card.
   */
  /** `by`: the player whose card or rule destroys it ("destroyed by an opposing card"). */
  destroy(iid: string, cause: "cost" | "effect" | "damage" | "rule" = "effect", skipOptional = false, by?: PlayerId): boolean {
    const q = this.q;
    if (!q.inPlay(iid) || q.isFaction(iid)) return false;
    // Waiting on an optional replacement ("its owner may ... instead").
    if (this.s.cards[iid].replacing) return true;
    // "Can only be destroyed by costs" (Limited Liability) also stops the game's rules,
    // such as the unique rule, from destroying the card.
    if (cause !== "cost" && this.destroyProtected(iid)) return false;
    // Replacements: from cards in play, then from continuous effects.
    const candidates: { rules: any[]; scope: Scope }[] = [];
    for (const src of q.allInPlay()) if (q.active(src)) candidates.push({ rules: q.rules(src), scope: q.scopeOf(src) });
    for (const e of this.s.effects) if (e.rules) candidates.push({ rules: e.rules, scope: { controller: e.controller, source: e.source, vars: e.vars } });
    for (const { rules, scope } of candidates) {
      for (const r of rules) {
        if (!r.replace || r.replace.event !== "destroy") continue;
        if (r.replace.card !== undefined && !q.matches(r.replace.card, iid, scope, null)) continue;
        // "destroyed by an opposing card or effect": by: opponent
        if (r.replace.by !== undefined && (!by || by !== q.who(r.replace.by, scope))) continue;
        // "would be destroyed by battle damage": cause: damage
        if (r.replace.cause !== undefined && r.replace.cause !== cause) continue;
        // "If there are no tokens on this card and it would be destroyed": while: <condition>
        if (r.replace.while !== undefined && !q.cond(r.replace.while, scope)) continue;
        if (r.replace.optional) {
          if (skipOptional) continue;
          // "you may pay N to ... instead": only offered when its owner can pay.
          if (r.replace.pay !== undefined && this.q.unattached(this.s.cards[iid].owner).length < q.value(r.replace.pay, scope)) continue;
          this.s.cards[iid].replacing = true;
          this.push({ t: "optionalReplace", iid, cause, by, instead: r.instead, prompt: r.replace.prompt, pay: r.replace.pay !== undefined ? q.value(r.replace.pay, scope) : undefined, controller: scope.controller, source: scope.source, vars: scope.vars });
          return true;
        }
        const ctx = this.newCtx(scope.controller, scope.source);
        Object.assign(ctx.vars, scope.vars, { it: iid });
        this.log(`${q.name(iid)} would be destroyed; ${q.name(scope.source)} replaces it.`);
        // Until the replacement finishes (steps it queues included), the card can't be
        // destroyed again, so state checks don't replace it over and over (Lucky Bastard).
        this.s.cards[iid].replacing = true;
        this.push({ t: "endReplace", iid, ctx: ctx.id });
        for (const step of r.instead) this.t_step({ t: "step", step, ctx: ctx.id, phase: "effect" });
        return true;
      }
    }
    const ctl = this.s.cards[iid].controller;
    if (cause === "damage") this.log(`${q.name(iid)} is destroyed.`);
    this.emit({ e: "destroyed", iid, player: ctl, cause, ...(by ? { by } : {}) });
    this.move(iid, "discard");
    return true;
  }

  protected t_endReplace(task: Task): void {
    if (this.s.cards[task.iid]) this.s.cards[task.iid].replacing = undefined;
    this.dropCtx(task.ctx);
  }

  /** "Its owner may ... instead": ask the destroyed card's owner, then replace or destroy. */
  protected t_optionalReplace(task: Task): void {
    const c = this.s.cards[task.iid];
    if (!task.answer) {
      if (!this.q.inPlay(task.iid)) {
        c.replacing = undefined;
        return;
      }
      this.ask(task, {
        type: "choose",
        player: c.owner,
        prompt: `${this.q.name(task.iid)} would be destroyed. ${task.prompt ?? "Replace it"}?`,
        options: [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No, destroy it" },
        ],
        min: 1,
        max: 1,
      });
      return;
    }
    c.replacing = undefined;
    if (task.answer.ids[0] !== "yes" || (task.pay !== undefined && !this.payNow(c.owner, task.pay))) {
      this.destroy(task.iid, task.cause, true, task.by);
      return;
    }
    if (task.pay !== undefined) this.log(`${this.pname(c.owner)} pays ${task.pay}.`);
    const ctx = this.newCtx(task.controller, task.source);
    Object.assign(ctx.vars, task.vars, { it: task.iid });
    this.log(`${this.q.name(task.iid)} would be destroyed; ${this.q.name(task.source)} replaces it.`);
    for (const step of task.instead) this.t_step({ t: "step", step, ctx: ctx.id, phase: "effect" });
    this.dropCtx(ctx.id);
  }

  /** Can this card only be destroyed by costs right now (Limited Liability)? */
  private destroyProtected(iid: string): boolean {
    return this.q.mods("cannot").some((m) => m.value === "destroy_except_cost" && this.q.targets(m, iid));
  }

  /** Damage modifiers: "reduce the amount to 0", Limited Liability. */
  private modifyDamage(target: string, n: number, battle: boolean, sources: string[] = []): number {
    let set: number | null = null;
    let delta = 0;
    for (const m of this.q.mods("damage")) {
      const v = m.value;
      if (v.battle !== undefined && !!v.battle !== battle) continue;
      if (!this.q.targets(m, target)) continue;
      // Only damage from matching sources: { damage: { set: 0, from: <selector> } }
      if (v.from !== undefined && !sources.some((x) => this.q.matches(v.from, x, m.scope, null))) continue;
      // "When any amount of damage greater than 4 is inflicted, reduce it to 0": { set: 0, over: 4 }
      if (v.over !== undefined && n <= v.over) continue;
      if (v.set !== undefined) set = set === null ? v.set : Math.min(set, v.set);
      if (v.delta !== undefined) delta += this.q.value(v.delta, m.scope);
      // "Reduce the next damage inflicted to this card": a `next` effect is used up.
      if (m.effect?.duration === "next" && n > 0) m.effect.used = true;
    }
    return Math.max(0, (set ?? n) + delta);
  }

  /**
   * "Damage that would be inflicted to X is inflicted to Y instead": moves damage to
   * other cards and returns what is left. With `amount`, only the next that much
   * damage moves, across any number of hits; then the effect is used up.
   */
  private redirectDamage(iid: string, n: number, battle: boolean, sources: string[], seen: string[]): number {
    const q = this.q;
    for (const m of q.modsFor("redirect_damage", iid)) {
      const to = q.ref(m.value?.to ?? "self", m.scope);
      if (!to || to === iid || seen.includes(to) || !q.inPlay(to) || m.effect?.used) continue;
      let k = n;
      if (m.value?.amount !== undefined && m.effect) {
        m.effect.left ??= q.value(m.value.amount, m.scope);
        k = Math.min(n, m.effect.left);
        m.effect.left -= k;
        if (m.effect.left <= 0) m.effect.used = true;
      }
      if (k <= 0) continue;
      this.log(`${k} damage to ${q.name(iid)} is inflicted to ${q.name(to)} instead.`);
      this.inflict(to, k, battle, sources, [...seen, iid]);
      n -= k;
      if (n <= 0) return 0;
    }
    return n;
  }

  inflict(iid: string, n: number, battle: boolean, sources: string[] = [], seen: string[] = []): void {
    const q = this.q;
    if (q.isFaction(iid)) return this.damageFaction(this.s.cards[iid].owner, n, sources, battle, undefined, seen);
    n = this.redirectDamage(iid, n, battle, sources, seen);
    if (n <= 0) return;
    // "If battle damage would be inflicted to this card, add that many tokens instead" (Expert Debater).
    const asTokens = q.modsFor("damage_as_tokens", iid).find((m) => m.value?.battle === undefined || !!m.value.battle === battle);
    if (asTokens) {
      this.s.cards[iid].tokens += n;
      this.log(`${q.name(iid)} gets ${n} token${n === 1 ? "" : "s"} instead of damage.`);
      return;
    }
    n = this.modifyDamage(iid, n, battle, sources);
    if (n <= 0) return;
    const c = this.s.cards[iid];
    if (sources.length && this.s.cards[sources[0]]) c.hitBy = this.s.cards[sources[0]].controller;
    const hits = ((this.s.turnLog.hits ??= {})[iid] ??= []);
    for (const x of sources) if (!hits.includes(x)) hits.push(x);
    if (q.isCharacter(iid)) c.damage += n;
    else if (q.inPlay(iid) && q.is(iid, "location")) c.markers += n;
    else return;
    this.log(`${q.name(iid)} takes ${n}${battle ? " battle" : ""} damage.`);
    this.emit({ e: "damage", iid, player: c.controller, amount: n, battle, sources, source: sources[0] });
  }

  damageFaction(p: PlayerId, n: number, sources: string[], battle: boolean, by?: PlayerId, seen: string[] = []): void {
    n = this.redirectDamage(this.s.players[p].factionIid, n, battle, sources, seen);
    if (n <= 0) return;
    n = this.modifyDamage(this.s.players[p].factionIid, n, battle, sources);
    if (n <= 0) return;
    // Optional replacements on faction damage (Trickster's Globe): ask first.
    const repl = this.factionDamageReplacement(p, by);
    if (repl) {
      this.push({ t: "factionDamageChoice", p, n, sources, battle, src: repl });
      return;
    }
    this.applyFactionDamage(p, n, sources, battle);
  }

  private factionDamageReplacement(p: PlayerId, by?: PlayerId): string | undefined {
    for (const iid of this.q.allInPlay()) {
      if (!this.q.active(iid)) continue;
      const ctl = this.s.cards[iid].controller;
      for (const r of this.q.rules(iid)) {
        if (r.replace?.event !== "faction_damage") continue;
        if (r.replace.by === "you" && by !== ctl) continue;
        if (r.replace.to === "opponent" && p === ctl) continue;
        return iid;
      }
    }
    return undefined;
  }

  protected t_factionDamageChoice(task: Task): void {
    const src = task.src as string;
    const ctl = this.s.cards[src]?.controller;
    const rule = this.q.active(src) ? this.q.rules(src).find((r) => r.replace?.event === "faction_damage") : undefined;
    if (!ctl || !rule) return this.applyFactionDamage(task.p, task.n, task.sources, task.battle);
    if (!task.answer) {
      this.ask(task, {
        type: "number",
        player: ctl,
        prompt: `${this.q.name(src)}: ${task.n} damage to ${this.pname(task.p)}'s faction. How much of it to replace (${rule.replace.label ?? "replacement"})?`,
        min: 0,
        max: task.n,
      });
      return;
    }
    const k = task.answer.value as number;
    if (task.n - k > 0) this.applyFactionDamage(task.p, task.n - k, task.sources, task.battle);
    if (k > 0) {
      const ctx = this.newCtx(ctl, src);
      ctx.vars.amount = k;
      ctx.vars.player = task.p;
      this.push(...this.steps(rule.instead, ctx, "effect"), { t: "dropCtx", ctx: ctx.id });
    }
  }

  private applyFactionDamage(p: PlayerId, n: number, sources: string[], battle: boolean): void {
    const ps = this.s.players[p];
    const lost = this.influenceLoss(p, n);
    ps.influence = Math.max(0, ps.influence - lost);
    this.log(`${this.pname(p)}'s faction takes ${n} damage${lost !== n ? ` and loses ${lost} influence` : ""} (influence ${ps.influence}).`);
    // "A character that inflicted damage to your faction this turn" (Drive-By Boobing).
    const hits = ((this.s.turnLog.factionHits ??= {})[p] ??= []);
    for (const x of sources) if (!hits.includes(x)) hits.push(x);
    this.emit({ e: "damage", iid: ps.factionIid, player: p, amount: n, battle, faction: true, sources, source: sources[0] });
    this.emit({ e: "influence_lost", player: p, amount: lost });
  }

  /** Influence loss after modifiers (Gideon: "increase the amount by 1"). */
  private influenceLoss(p: PlayerId, n: number): number {
    if (n <= 0) return 0;
    for (const m of this.q.mods("influence_loss")) {
      const who = m.value.player === "opponent" ? other(m.controller) : m.value.player === "you" ? m.controller : null;
      if (who && who !== p) continue;
      n += this.q.value(m.value.delta ?? 0, m.scope);
    }
    return Math.max(0, n);
  }

  loseInfluence(p: PlayerId, n: number): void {
    const lost = this.influenceLoss(p, n);
    if (lost <= 0) return;
    const ps = this.s.players[p];
    ps.influence = Math.max(0, ps.influence - lost);
    this.log(`${this.pname(p)} loses ${lost} influence (now ${ps.influence}).`);
    this.emit({ e: "influence_lost", player: p, amount: lost });
  }

  drawCards(p: PlayerId, n: number): void {
    const ps = this.s.players[p];
    const drawn: string[] = [];
    let count = 0;
    // "When you draw any number of cards, increase the amount by 1" (Beatrix Winterbottom).
    if (n > 0) for (const m of this.q.mods("draw_bonus")) if (this.q.by(m, p)) n += this.q.value(m.value, m.scope);
    for (let i = 0; i < n && ps.deck.length; i++) {
      if (this.q.cannot("draw", null, p)) {
        this.log(`${this.pname(p)} can't draw cards.`);
        n = i;
        break;
      }
      const iid = ps.deck[0];
      this.move(iid, "hand");
      count++;
      if (this.s.cards[iid].zone === "hand") drawn.push(iid);
    }
    if (n > 0) {
      this.log(`${this.pname(p)} draws ${count} card${count === 1 ? "" : "s"}${count < n ? " (deck empty)" : ""}.`);
      if (drawn.length) this.log(`You drew: ${drawn.map((i) => this.q.name(i)).join(", ")}.`, p);
      if (count) this.emit({ e: "draw", player: p, count, amount: count });
    }
  }

  private end(winner: PlayerId | "draw"): void {
    this.s.winner = winner;
    this.s.phase = "ended";
    this.s.pending = null;
    this.log(winner === "draw" ? "The game is a draw." : `${this.pname(winner)} wins!`);
  }

  // --- manual actions ----------------------------------------------------------

  private manual(p: PlayerId, op: ManualOp): void {
    const s = this.s;
    if (s.pending && !FREE.has(s.pending.type)) throw new GameError("Finish the current prompt before making manual changes.");
    const own = (iid: string): CardInst => {
      const c = s.cards[iid];
      if (!c) throw new GameError("No such card.");
      if (c.owner !== p && c.controller !== p) throw new GameError("You can only adjust your own cards.");
      return c;
    };
    const say = (t: string) => s.log.push({ n: s.log.length, text: `[manual] ${this.pname(p)} ${t}`, manual: true });
    const nameOf = (iid: string) => (s.cards[iid].faceDown ? "a face-down card" : this.q.name(iid));
    switch (op.op) {
      case "move": {
        const c = own(op.iid);
        if (this.q.isFaction(op.iid)) throw new GameError("Factions can't be moved.");
        const hidden = op.zone === "hand" || op.zone === "deck" || op.faceDown;
        say(`moves ${hidden && c.zone !== "play" ? "a card" : nameOf(op.iid)} to ${op.zone}${op.faceDown ? " face-down" : ""}.`);
        if (op.zone === "play") {
          if (op.faceDown) this.putResource(p, op.iid, true, true);
          else {
            this.move(op.iid, "play", { controller: p, noRedirect: true });
            c.controlSince = s.turn;
          }
        } else this.move(op.iid, op.zone, { noRedirect: true });
        break;
      }
      case "flip": {
        const c = own(op.iid);
        if (c.zone !== "play") throw new GameError("Only cards in play can be flipped.");
        c.faceDown = !c.faceDown;
        c.isResource = c.faceDown || this.q.def(op.iid).types.includes("resource");
        say(`flips ${this.q.name(op.iid)} ${c.faceDown ? "face-down" : "face-up"}.`);
        break;
      }
      case "deplete": {
        const c = own(op.iid);
        c.depleted = !c.depleted;
        say(`${c.depleted ? "depletes" : "restores"} ${nameOf(op.iid)}.`);
        break;
      }
      case "attach": {
        const c = own(op.iid);
        if (!c.isResource) throw new GameError("Only resources attach to the faction.");
        c.attachedTo = c.attachedTo ? null : "faction";
        say(`${c.attachedTo ? "attaches" : "detaches"} ${nameOf(op.iid)}.`);
        break;
      }
      case "damage": {
        const c = own(op.iid);
        if (this.q.is(op.iid, "location")) c.markers = Math.max(0, c.markers + op.delta);
        else c.damage = Math.max(0, c.damage + op.delta);
        say(`${op.delta > 0 ? "adds" : "removes"} ${Math.abs(op.delta)} damage ${op.delta > 0 ? "to" : "from"} ${nameOf(op.iid)}.`);
        break;
      }
      case "tokens": {
        const c = own(op.iid);
        c.tokens = Math.max(0, c.tokens + op.delta);
        say(`${op.delta > 0 ? "adds" : "removes"} a token ${op.delta > 0 ? "to" : "from"} ${nameOf(op.iid)} (now ${c.tokens}).`);
        break;
      }
      case "influence": {
        const ps = s.players[p];
        ps.influence = Math.max(0, ps.influence + op.delta);
        say(`adjusts influence by ${op.delta} (now ${ps.influence}).`);
        break;
      }
      case "draw":
        say("draws a card.");
        this.drawCards(p, 1);
        break;
      case "shuffle":
        rng.shuffle(s, s.players[p].deck);
        say("shuffles their deck.");
        break;
      case "search_deck":
        s.players[p].searching = true;
        say("looks through their deck.");
        break;
      case "end_search":
        if (!s.players[p].searching) break;
        s.players[p].searching = false;
        if (op.shuffle) {
          rng.shuffle(s, s.players[p].deck);
          say("stops looking through their deck and shuffles it.");
        } else say("stops looking through their deck (not shuffled).");
        break;
    }
    // Manual changes don't fire triggers, but rules consequences (lethal damage, wins) apply.
    s.events = [];
    const pending = s.pending;
    s.pending = null;
    this.checks();
    s.events = [];
    if (s.phase !== "ended") {
      if (s.tasks.length) this.run();
      else s.pending = pending;
    }
  }

  // --- helpers -------------------------------------------------------------------

  pname(p: PlayerId): string {
    return this.s.players[p]?.name ?? p;
  }

  log(text: string, to?: PlayerId): void {
    // While a player is paying costs, public lines are held privately until the
    // action is committed (see takeSnapshot / commitCosts / rollback).
    if (!to && this.s.snapshot && this.s.costActor) {
      this.s.log.push({ n: this.s.log.length, text, to: this.s.costActor, held: true });
      return;
    }
    this.s.log.push({ n: this.s.log.length, text, ...(to ? { to } : {}) });
  }

  /** A card's name as safe to print in the public log (or to `viewer`). */
  visibleName(iid: string, viewer?: PlayerId): string {
    const c = this.s.cards[iid];
    if (viewer && (c.owner === viewer || c.controller === viewer)) return this.q.name(iid);
    if ((c.zone === "hand" || c.zone === "deck") && !c.revealed && !viewer) return "a card";
    if (c.zone === "play" && c.faceDown && !c.revealed) return "a face-down card";
    return this.q.name(iid);
  }

  private optionLabel(iid: string, viewer: PlayerId): string {
    const c = this.s.cards[iid];
    if (c.zone === "play" && c.faceDown && c.controller !== viewer && !c.revealed) return "Face-down resource";
    return this.q.name(iid);
  }

  resourceLabel(iid: string): string {
    const c = this.s.cards[iid];
    return c.faceDown ? `Face-down: ${this.q.name(iid)}` : this.q.name(iid);
  }

  describeSel(sel: any): string {
    if (Array.isArray(sel)) return sel.map((x) => this.describeSel(x)).join(" or ");
    if (typeof sel !== "object" || sel === null) return "a card";
    const key = Object.keys(sel)[0];
    const f = (sel[key] === "any" ? {} : sel[key]) ?? {};
    const own = f.owner === "you" ? " you own" : f.controller === "you" ? " you control" : f.controller === "opponent" ? " your opponent controls" : "";
    const where = f.zone && f.zone !== "play" ? ` in ${f.zone === "discard" ? "a discard pile" : "the " + f.zone}` : "";
    const sub = f.subtype ? `"${f.subtype}" ` : "";
    const noun = key === "card" ? (f.not_type ? `non-${f.not_type} card` : (f.type ?? "card")) : key;
    return `a ${sub}${noun}${own}${where}`;
  }

  describeSteps(steps: Step[]): string {
    return (steps ?? [])
      .map((st) => {
        const op = Object.keys(st)[0];
        const v = st[op];
        switch (op) {
          case "draw": {
            const n = typeof v === "object" ? (v.count ?? 1) : v;
            return `draw ${n} card${n === 1 ? "" : "s"}`;
          }
          case "play_resource":
            return "play a resource";
          case "pick":
            return `pick ${this.describeSel(v.from)}`;
          case "search":
            return "search your deck";
          case "play_card":
            return "play the card";
          case "discard":
            return "discard";
          case "look":
            return "look at the top of a deck";
          case "as":
            return this.describeSteps(v.steps);
          case "may":
            return this.describeSteps(Array.isArray(v) ? v : v.steps);
          default:
            return op.replace(/_/g, " ");
        }
      })
      .join(", then ");
  }
}
