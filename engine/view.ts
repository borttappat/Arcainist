// Per-player view of a game. The server only ever sends views, never raw state, so
// hidden information (opponent's hand, decks, opponent's face-down cards) stays
// on the server.

import type { Game } from "./game.ts";
import type { Action, BattleState, CardInst, Decision, Icon, LogEntry, PlayerId, Window } from "./types.ts";
import { other } from "./types.ts";

export interface CardView {
  iid: string;
  /** null when the card is hidden from this viewer. */
  defId: string | null;
  owner: PlayerId;
  controller: PlayerId;
  zone: CardInst["zone"];
  faceDown: boolean;
  isResource: boolean;
  attached: boolean;
  depleted: boolean;
  damage: number;
  markers: number;
  tokens: number;
  revealed: boolean;
  /** Host card iid for attached gear. */
  host?: string;
  /** Choices the card remembers (named card, subtype, icon). */
  notes?: Record<string, any>;
  types?: string[];
  keywords?: string[];
  str?: number;
  life?: number;
  spd?: number;
  structure?: number;
  canAttack?: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  factionId: string;
  faction: CardView;
  influence: number;
  deckCount: number;
  handCount: number;
  hand: CardView[] | null;
  play: CardView[];
  discard: CardView[];
  void: CardView[];
  icons: Record<Icon, number>;
  unattached: number;
}

export interface Legal {
  deploy: string[];
  abilities: { iid: string; index: number; name: string }[];
  flipUp: string[];
  attackers: string[];
  targets: string[];
  canEndTurn: boolean;
  canPass: boolean;
}

export interface GameView {
  you: PlayerId;
  turn: number;
  active: PlayerId;
  phase: string;
  winner: PlayerId | "draw" | null;
  players: Record<PlayerId, PlayerView>;
  stack: { id: string; kind: string; controller: PlayerId; label: string; card: CardView }[];
  battle: BattleState | null;
  window: Window | null;
  /** Your current decision, with card options annotated with defIds. */
  pending: (Decision & { optionDefs?: Record<string, string | null> }) | null;
  /** Who the game is waiting on, and for what. */
  waiting: { player: PlayerId; type: string } | null;
  log: LogEntry[];
  legal: Legal | null;
}

export function viewFor(g: Game, you: PlayerId): GameView {
  return g.q.frozen(() => buildView(g, you));
}

function buildView(g: Game, you: PlayerId): GameView {
  const s = g.s;
  const q = g.q;

  const cv = (iid: string): CardView => {
    const c = s.cards[iid];
    const hiddenFaceDown = c.zone === "play" && c.faceDown && c.controller !== you && c.owner !== you && !c.revealed;
    const handRevealed = c.zone === "hand" && q.mods("reveal_hand").some((m) => m.controller === you);
    const hiddenZone = ((c.zone === "hand" && !handRevealed) || c.zone === "deck") && c.owner !== you;
    const hiddenVoid = c.zone === "void" && !!c.voidFaceDown && !(c.knownTo ?? []).includes(you);
    const v: CardView = {
      iid,
      defId: hiddenFaceDown || hiddenZone || hiddenVoid ? null : c.defId,
      owner: c.owner,
      controller: c.controller,
      zone: c.zone,
      faceDown: c.faceDown,
      isResource: c.isResource,
      attached: c.attachedTo !== null,
      depleted: c.depleted,
      damage: c.damage,
      markers: c.markers,
      tokens: c.tokens,
      revealed: c.revealed,
      host: c.attachedTo && c.attachedTo !== "faction" ? c.attachedTo : undefined,
      notes: c.notes,
    };
    if (c.zone === "play" && !c.isResource) {
      v.types = q.types(iid);
      v.keywords = ["covert", "aggro", "tactical"].filter((k) => q.keyword(iid, k));
      if (q.is(iid, "character")) {
        v.str = q.stat(iid, "str");
        v.life = q.stat(iid, "life");
        v.spd = q.stat(iid, "spd");
        v.canAttack = q.canAttack(iid);
      }
      if (q.is(iid, "location")) v.structure = q.stat(iid, "structure");
    }
    return v;
  };

  const pv = (p: PlayerId): PlayerView => {
    const ps = s.players[p];
    return {
      id: p,
      name: ps.name,
      factionId: ps.factionId,
      faction: cv(ps.factionIid),
      influence: ps.influence,
      deckCount: ps.deck.length,
      handCount: ps.hand.length,
      hand: p === you || q.mods("reveal_hand").some((m) => m.controller === you) ? ps.hand.map(cv) : null,
      play: ps.play.map(cv),
      discard: ps.discard.map(cv),
      void: ps.void.map(cv),
      icons: q.icons(p),
      unattached: q.unattached(p).length,
    };
  };

  let pending: GameView["pending"] = null;
  let waiting: GameView["waiting"] = null;
  if (s.pending) {
    if (s.pending.player === you) {
      pending = { ...s.pending } as any;
      if (s.pending.type === "choose") {
        const defs: Record<string, string | null> = {};
        for (const o of s.pending.options) if (o.iid) defs[o.iid] = s.cards[o.iid].defId;
        pending!.optionDefs = defs;
      }
    } else waiting = { player: s.pending.player, type: s.pending.type };
  }

  return {
    you,
    turn: s.turn,
    active: s.active,
    phase: s.phase,
    winner: s.winner,
    players: { A: pv("A"), B: pv("B") },
    stack: s.stack.map((x) => ({ id: x.id, kind: x.kind, controller: x.controller, label: x.label, card: cv(x.iid) })),
    battle: s.battle,
    window: s.window,
    pending,
    waiting,
    log: s.log.filter((e) => !e.to || e.to === you).slice(-200),
    legal: legalFor(g, you),
  };
}

/** Cheap legality hints for the UI. The engine still validates every action. */
export function legalFor(g: Game, p: PlayerId): Legal | null {
  return g.q.frozen(() => buildLegal(g, p));
}

function buildLegal(g: Game, p: PlayerId): Legal | null {
  const s = g.s;
  const q = g.q;
  const d = s.pending;
  if (!d || d.player !== p || !["main", "priority", "window", "endturn"].includes(d.type)) return null;
  const main = d.type === "main";
  const ok = (a: Action) => g.canStart(p, a, main) === null;
  const ps = s.players[p];

  // Cards in hand, plus cards other zones let you play (Pant Swipe, Eccentric Inquisition...).
  const elsewhere = Object.values(s.cards)
    .filter((c) => c.zone !== "hand" && c.zone !== "play" && c.zone !== "stack" && q.playGrant(c.iid, p))
    .map((c) => c.iid);
  const deploy = [...ps.hand, ...elsewhere].filter((iid) => ok({ type: "deploy", iid }));
  const abilities: Legal["abilities"] = [];
  const sources = [ps.factionIid, ...ps.play, ...ps.discard];
  // The Billionaire: abilities on the opponent's cards.
  if (q.mods("use_opponent_abilities").some((m) => m.controller === p)) sources.push(...s.players[other(p)].play);
  for (const iid of sources) {
    for (const ab of q.abilities(iid)) {
      if (ok({ type: "ability", iid, index: ab.index })) abilities.push({ iid, index: ab.index, name: ab.rule.name });
    }
  }
  const flipUp = ps.play.filter((iid) => s.cards[iid].faceDown && ok({ type: "flip_up", iid }));
  const attackers = main ? q.characters(p).filter((iid) => q.canAttack(iid)) : [];
  const targets = main ? ["faction", ...s.players[other(p)].play.filter((iid) => q.active(iid) && q.is(iid, "location"))] : [];
  return { deploy, abilities, flipUp, attackers, targets, canEndTurn: main, canPass: !main };
}
