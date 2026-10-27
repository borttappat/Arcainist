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
  /** Your own deck, top first, only while you are searching it. */
  deck: CardView[] | null;
  /** Your own registered decklist (card id to copies); not where the cards are now. */
  decklist: Record<string, number> | null;
  /** Top card of this deck, when an effect reveals it at all times. */
  topCard: CardView | null;
  play: CardView[];
  discard: CardView[];
  void: CardView[];
  icons: Record<Icon, number>;
  unattached: number;
  resources: number;
  autoPay: boolean;
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
  /** The side you play; it differs from your seat while sides are swapped (Emergency Obfuscation). */
  you: PlayerId;
  /** Your seat: the side whose deck you own, which is who wins with it. */
  seat: PlayerId;
  /** A spectator's view: only public information, no decisions. `you` is the side shown at the bottom. */
  spectator: boolean;
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

export function viewFor(g: Game, seat: PlayerId): GameView {
  return g.q.frozen(() => buildView(g, g.sideOf(seat), g.sideOf(seat), seat));
}

/** What a spectator sees: public information only (no hands, decks, face-down cards or private log lines). */
export function viewForSpectator(g: Game, side: PlayerId = "A"): GameView {
  return g.q.frozen(() => buildView(g, null, side, side));
}

/** `viewer`: whose hidden information is shown (null for a spectator); `you`: the side shown at the bottom. */
function buildView(g: Game, viewer: PlayerId | null, you: PlayerId, seat: PlayerId): GameView {
  const s = g.s;
  const q = g.q;

  const cv = (iid: string): CardView => {
    const c = s.cards[iid];
    const hiddenFaceDown = c.zone === "play" && c.faceDown && c.controller !== viewer && c.owner !== viewer && !c.revealed;
    const handRevealed = c.zone === "hand" && q.mods("reveal_hand").some((m) => m.controller === viewer);
    const hiddenZone = ((c.zone === "hand" && !handRevealed) || c.zone === "deck") && c.owner !== viewer;
    const hiddenVoid = c.zone === "void" && !!c.voidFaceDown && !(viewer && (c.knownTo ?? []).includes(viewer));
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
      hand: p === viewer || q.mods("reveal_hand").some((m) => m.controller === viewer) ? ps.hand.map(cv) : null,
      deck: p === viewer && ps.searching ? ps.deck.map(cv) : null,
      decklist: p === viewer ? countIds(ps.decklist ?? []) : null,
      // "The top card of your deck is revealed at all times."
      topCard: ps.deck.length && q.mods("reveal_top").some((m) => (m.value === "opponent" ? other(m.controller) : m.controller) === p) ? { ...cv(ps.deck[0]), defId: s.cards[ps.deck[0]].defId } : null,
      play: ps.play.map(cv),
      discard: ps.discard.map(cv),
      void: ps.void.map(cv),
      icons: q.icons(p),
      unattached: q.unattached(p).length,
      resources: q.resources(p).length,
      autoPay: !!ps.autoPay,
    };
  };

  let pending: GameView["pending"] = null;
  let waiting: GameView["waiting"] = null;
  if (s.pending) {
    if (s.pending.player === viewer) {
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
    seat,
    spectator: viewer === null,
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
    log: s.log.filter((e) => !e.to || e.to === viewer).slice(-200),
    legal: viewer ? legalFor(g, viewer) : null,
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
  // The opponent's faction too: some faction abilities can be used by both players.
  const sources = [ps.factionIid, s.players[other(p)].factionIid, ...ps.play, ...ps.discard];
  // The Billionaire: abilities on the opponent's cards.
  if (q.mods("use_opponent_abilities").some((m) => m.controller === p)) sources.push(...s.players[other(p)].play);
  // Abilities "any player may use" on the opponent's cards (Flaming Cube).
  else sources.push(...s.players[other(p)].play.filter((iid) => q.abilities(iid).some((ab) => ab.rule.both_players)));
  for (const iid of sources) {
    for (const ab of q.abilities(iid)) {
      if (ok({ type: "ability", iid, index: ab.index })) abilities.push({ iid, index: ab.index, name: ab.rule.name });
    }
  }
  const flipUp = ps.play.filter((iid) => s.cards[iid].faceDown && ok({ type: "flip_up", iid }));
  const limited = q.mods("attack_declarations").some((m) => (s.turnLog.declared ?? 0) >= q.value(m.value, m.scope));
  const attackers = main && !limited ? q.characters(p).filter((iid) => q.canAttack(iid)) : [];
  const targets = main ? [...(q.cannot("attack_faction", null, p) ? [] : ["faction"]), ...s.players[other(p)].play.filter((iid) => q.active(iid) && q.is(iid, "location"))] : [];
  return { deploy, abilities, flipUp, attackers, targets, canEndTurn: main, canPass: !main };
}

function countIds(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}
