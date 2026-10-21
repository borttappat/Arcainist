// Core data types for the rules engine. Everything in GameState is plain JSON so a
// game can be serialized, snapshotted for cost rollback, and replayed.
//
// The card language (what goes in cards/*.yaml) is documented in docs/CARDS.md.

export type PlayerId = "A" | "B";
export const other = (p: PlayerId): PlayerId => (p === "A" ? "B" : "A");

export type Icon = "obsession" | "greed" | "elitism" | "deception" | "rage" | "volition";
export const ICONS: Icon[] = ["obsession", "greed", "elitism", "deception", "rage", "volition"];
export const STAPLE_ICONS: Icon[] = ["obsession", "greed", "elitism", "deception", "rage"];
export type Icons = Partial<Record<Icon, number>>;

export type CardType = "faction" | "resource" | "character" | "tactic" | "item" | "location";
export const CARD_TYPES: CardType[] = ["faction", "resource", "character", "tactic", "item", "location"];
export type Stat = "str" | "life" | "spd" | "structure";

// ---------------------------------------------------------------------------
// Card definitions (loaded from cards/*.yaml). Rule bodies are loosely typed:
// they are interpreted by the engine and checked by server/library.ts.

/** One instruction in a cost or effect list: a single-key object, e.g. `{ draw: 1 }`. */
export type Step = Record<string, any>;
export type Rule = Record<string, any>;

export interface CardDef {
  id: string;
  name: string;
  flavor_title?: string;
  trade: string;
  types: CardType[];
  subtypes?: string[];
  staple?: boolean;
  /** Icon a face-up staple resource provides. */
  icon?: Icon;
  /** Icons a face-up non-staple resource provides. */
  provides?: Icons;
  /** Resource that may only be played face-down. */
  face_down_only?: boolean;
  cost?: number;
  threshold?: Icons;
  stats?: { str: number; life: number; spd: number };
  /** Stat bonus a gear item gives the character it is attached to. */
  gear?: { str: number; life: number; spd: number };
  structure?: number;
  keywords?: string[];
  /** "character" for "Attach to Character". */
  attach_to?: string | Record<string, any>;
  /** Copies allowed in a constructed deck; null means any number. */
  deck_limit?: number | null;
  /** Tokens the card enters play with (number or value). */
  enters_with_tokens?: any;
  /** A token (Micromajig): removed from the game whenever it would leave play; not allowed in decks. */
  token?: boolean;
  /** "This card enters play depleted." */
  enters_depleted?: boolean;
  /** Player who controls the card when it enters play: "opponent" for Hollow Moose. */
  enters_under?: "you" | "opponent";
  text?: string;
  rules?: Rule[];
  /** Latest set the card was printed in, and its rarity there. */
  set?: string;
  rarity?: string;
  /** Data is missing (17 factions): shown in the card pool but not playable. */
  incomplete?: boolean;
  // Faction-only fields
  influence?: number;
  starting_resources?: {
    any_staples?: number;
    different_staples?: number;
    specific?: Icons;
    face_down?: Icons;
    any_resources?: number;
    any_cards_face_down?: number;
    choose_staples?: number;
  };
  /** Rules this faction imposes on the opponent's faction (The Knitting Coalition, Union of Miners). */
  opponent_rules?: { starting_draw?: "this"; develop_rule?: "none"; equalize_starting_resources?: boolean };
  /** false for cards printed "cannot be used in tournament play". */
  tournament_legal?: boolean;
  /** Faction rule: minimum deck size (The Society of Magical Propriety). */
  min_deck?: number;
  /** Why an incomplete card can't be played. */
  incomplete_reason?: string;
  /** This card is the back side of another (Counter-Imperial Army). */
  back_of?: string;
  starting_draw?: { before?: Step[]; first: number; second: number };
  restore_rule?: Step[];
  develop_rule?: Step[];
}

export type CardLibrary = Record<string, CardDef>;

// ---------------------------------------------------------------------------
// Game state

export type Zone = "deck" | "hand" | "stack" | "play" | "discard" | "void";

export interface CardInst {
  iid: string;
  defId: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  faceDown: boolean;
  isResource: boolean;
  /** "faction" for a spent resource, or the iid of the card this is attached to. */
  attachedTo: string | null;
  depleted: boolean;
  damage: number;
  markers: number;
  tokens: number;
  /** Turn number since which this card has been under its current controller in play. */
  controlSince: number;
  revealed: boolean;
  /** Face-down in the void: only the owner and `knownTo` may look. */
  voidFaceDown?: boolean;
  knownTo?: PlayerId[];
  /** Controller of the card that last inflicted damage to this card (who destroyed it). */
  hitBy?: PlayerId;
  /** An optional destroy replacement is waiting on its owner's answer. */
  replacing?: boolean;
  /** Source iids that put this card where it is (for "removed by this card"). */
  tags?: string[];
  /** Choices remembered by the card while in play (a named card, subtype, icon). */
  notes?: Record<string, any>;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  factionId: string;
  factionIid: string;
  influence: number;
  deck: string[]; // top of deck is index 0
  hand: string[];
  play: string[];
  discard: string[]; // top is the last element
  void: string[];
  /** Looking through their own deck with the manual controls. */
  searching?: boolean;
}

export interface StackItem {
  id: string;
  kind: "card" | "ability" | "duplicate";
  controller: PlayerId;
  /** For "card": the card being deployed. For "ability"/"duplicate": the source card. */
  iid: string;
  /** Rule index in the source definition (ability, or the play rule for duplicates). */
  rule?: number;
  ctx: string;
  label: string;
  /** "Your opponent cannot respond to this card." */
  noResponse?: boolean;
  /** "The ability has no effect." */
  nullified?: boolean;
  /** Characters picked while paying its costs (for Mistaken Identity and friends). */
  pickedInCost?: string[];
}

/** Variable bindings for one cost+effect run. Child contexts share their root's vars. */
export interface Ctx {
  id: string;
  /** "You" in card text: the controller of the card or ability. */
  controller: PlayerId;
  /** Player making the choices and paying (differs only for borrowed abilities). */
  actor: PlayerId;
  source: string;
  vars: Record<string, any>;
  parent?: string;
  pay: number;
  costOverride?: number;
  free?: boolean;
  ignoreThreshold?: boolean;
  via?: "flip_up" | "normal" | "effect";
  /** Stack item this was deployed in response to. */
  responding?: string;
  /** Result of the last optional step ("If you do"). */
  did?: boolean;
  /** Characters picked while paying costs. */
  picked?: string[];
  /** What each of those was picked from, and by whom (Mistaken Identity). */
  pickedFrom?: { iid: string; from: any; zone?: string; chooser: PlayerId }[];
}

export interface Task {
  t: string;
  [k: string]: any;
}

/**
 * A continuous effect created by a resolved card ("this turn", "for the rest of
 * the game"). It carries modifiers and/or rules (triggers, replacements) and
 * acts as their source.
 */
export interface Effect {
  id: string;
  source: string;
  controller: PlayerId;
  vars: Record<string, any>;
  mods?: any[];
  rules?: Rule[];
  /** Removed at the start of turn `expires + 1`... see game.expireEffects. */
  duration: "turn" | "game" | "until_your_next_turn" | "next";
  turn: number;
  /** For "next" durations: removed after being used once. */
  used?: boolean;
  /** Lets the creating card clear some of its effects (`clear_effects: { tag }`). */
  tag?: string;
  /** "The next X damage": how much is still to be redirected. */
  left?: number;
}

export interface BattleState {
  attacker: PlayerId;
  defender: PlayerId;
  /** "faction" or a location iid. */
  target: string;
  attackers: string[];
  blockers: string[];
  covert: boolean;
  done: string[];
  speed: number | null;
  /** Locked damage: key is a card iid or "target"; sources recorded for triggers. */
  locked: Record<string, number>;
  sources: Record<string, string[]>;
  step: string;
}

export interface Window {
  kind: "battle" | "endturn";
  current: PlayerId;
  passes: number;
  /** Battle step to continue with when the window closes. */
  next?: string;
}

export interface Option {
  id: string;
  label: string;
  iid?: string;
}

export type Decision =
  | { type: "main"; player: PlayerId }
  | { type: "priority"; player: PlayerId }
  | { type: "window"; player: PlayerId; label: string }
  | { type: "endturn"; player: PlayerId }
  | {
      type: "choose";
      player: PlayerId;
      prompt: string;
      options: Option[];
      min: number;
      max: number;
      cancellable?: boolean;
      /** Cards shown in a list (deck search etc.) rather than highlighted on the board. */
      list?: boolean;
    }
  | { type: "order"; player: PlayerId; prompt: string; options: Option[] }
  | { type: "name"; player: PlayerId; prompt: string; kind: "card" | "subtype"; options: Option[] }
  | { type: "number"; player: PlayerId; prompt: string; min: number; max: number; cancellable?: boolean }
  | { type: "blockers"; player: PlayerId; candidates: string[] }
  | {
      type: "assign";
      player: PlayerId;
      prompt: string;
      total: number;
      min?: number;
      targets: string[];
      perTarget?: number;
      /** Display names for targets that aren't cards ("target": the attack's target). */
      labels?: Record<string, string>;
      /** Most that may go to a target. */
      caps?: Record<string, number>;
    }
  | { type: "play_resource"; player: PlayerId; optional: boolean };

export interface LogEntry {
  n: number;
  text: string;
  /** Private entries are only shown to this player. */
  to?: PlayerId;
  manual?: boolean;
  /** Written while costs were being paid; public only once the action commits. */
  held?: boolean;
}

export interface TurnLog {
  played: { iid: string; defId: string; player: PlayerId; types: CardType[]; cost: number }[];
  attacks: Record<string, number>;
  /** "iid:index" of abilities used this turn (for once-per-turn abilities). */
  abilities?: Record<string, boolean>;
  /** Characters that assigned battle damage this turn. */
  assigned?: Record<string, boolean>;
  /** Cards that inflicted damage to each card this turn (by damaged card). */
  hits?: Record<string, string[]>;
  /** Cards that inflicted damage to each player's faction this turn. */
  factionHits?: Partial<Record<PlayerId, string[]>>;
}

export interface GameState {
  /** Format id the room plays under (see engine/formats.ts). */
  format: string;
  rng: number;
  turn: number;
  active: PlayerId;
  first: PlayerId | null;
  phase: "setup" | "play" | "ended";
  winner: PlayerId | "draw" | null;
  cards: Record<string, CardInst>;
  players: Record<PlayerId, PlayerState>;
  stack: StackItem[];
  priority: PlayerId | null;
  window: Window | null;
  endTurn: boolean;
  battle: BattleState | null;
  tasks: Task[];
  ctxs: Record<string, Ctx>;
  effects: Effect[];
  events: GameEvent[];
  turnLog: TurnLog;
  pending: Decision | null;
  /** The task waiting for the pending decision's answer. */
  waiting: Task | null;
  /** Serialized state taken before paying costs, for rollback. */
  snapshot: string | null;
  /** Player whose costs are being paid while `snapshot` is set. */
  costActor?: PlayerId | null;
  log: LogEntry[];
}

export interface GameEvent {
  e: string;
  iid?: string;
  player?: PlayerId;
  [k: string]: any;
}

// ---------------------------------------------------------------------------
// Player input

export type Action =
  // free actions (main / priority / windows)
  | { type: "deploy"; iid: string }
  | { type: "ability"; iid: string; index: number }
  | { type: "flip_up"; iid: string }
  | { type: "attack"; target: string; attackers: string[] }
  | { type: "pass" }
  | { type: "end_turn" }
  // answers to sub-decisions
  | { type: "answer"; ids?: string[]; value?: number; assign?: Record<string, number>; iid?: string; faceDown?: boolean }
  | { type: "cancel" }
  // always available
  | { type: "manual"; op: ManualOp }
  | { type: "concede" };

export type ManualOp =
  | { op: "move"; iid: string; zone: Zone; faceDown?: boolean }
  | { op: "flip"; iid: string }
  | { op: "deplete"; iid: string }
  | { op: "attach"; iid: string }
  | { op: "damage"; iid: string; delta: number }
  | { op: "tokens"; iid: string; delta: number }
  | { op: "influence"; delta: number }
  | { op: "draw" }
  | { op: "shuffle" }
  | { op: "search_deck" }
  | { op: "end_search"; shuffle?: boolean };
