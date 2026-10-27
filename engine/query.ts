// Read-only questions about a game state: selectors, values, conditions, and the
// modifier system (continuous effects). Nothing here mutates state, except that
// "next use" effects are marked used by the game when it applies them.
//
// Every derived property (stats, types, keywords, icons, costs, permissions) is
// recomputed from printed values plus the modifiers active right now, so effects
// switch on and off by themselves when their source or condition changes.

import { evaluate } from "./expr.ts";
import type { CardDef, CardInst, CardLibrary, CardType, Effect, GameState, Icon, Icons, PlayerId, Rule, Stat } from "./types.ts";
import { CARD_TYPES, ICONS, STAPLE_ICONS, other } from "./types.ts";

/** What "you", "self" and variables mean while evaluating card data. */
export interface Scope {
  controller: PlayerId;
  source: string;
  vars: Record<string, any>;
  actor?: PlayerId;
  via?: string;
  responding?: string;
  did?: boolean;
}

/** How much a threshold is reduced: by any icons, and by specific icons. */
export interface ThresholdReduction {
  any: number;
  icons: Icons;
}

/** An active modifier with the context it came from. */
export interface ActiveMod {
  kind: string;
  value: any;
  mod: any;
  source: string;
  controller: PlayerId;
  scope: Scope;
  effect?: Effect;
}

const MOD_KINDS = [
  "stat",
  "set_stats",
  "add_type",
  "remove_type",
  "keyword",
  "provides",
  "attack_ready",
  "player_icons",
  "cost",
  "cost_min",
  "threshold_reduce",
  "cannot",
  "must_pick",
  "pick_tax",
  "play_from",
  "tactical",
  "grant_rules",
  "damage",
  "influence_loss",
  "attack_limit",
  "redirect",
  "reveal_hand",
  "use_opponent_abilities",
  "lose_when_deck_empty",
  "no_rules",
  "cannot_be_blocked",
  "lose_keyword",
  "must_attack",
  "must_block",
  "party",
  "reveal_top",
  "no_deplete_on_attack",
  "covert_blockable",
  "redirect_damage",
  "attack_cost",
  "draw_bonus",
  "first_resource_attached",
  "grant_flip_up",
  "damage_to_hand",
  "destroy_self",
  "party_covert",
  "assign_to_target",
  "must_be_assigned",
  "search_tax",
  "battle_damage_to_self",
  "stays_in_play",
  "damage_as_tokens",
  "blocks_any",
  "numeric_cost",
  "attack_declarations",
  "assign_cost",
  "may_reduce_damage",
  "swap_seats",
  "all_unique",
];

export class Q {
  private inMods = 0;
  /** Modifier cache, only used inside frozen(): read-only work where state can't change. */
  private cache: ActiveMod[] | null = null;
  private frozenDepth = 0;

  constructor(
    public lib: CardLibrary,
    public s: GameState,
  ) {}

  // -------------------------------------------------------------------------
  // Basics

  card(iid: string): CardInst {
    const c = this.s.cards[iid];
    if (!c) throw new Error(`No card ${iid}`);
    return c;
  }

  def(iid: string): CardDef {
    return this.lib[this.card(iid).defId];
  }

  name(iid: string): string {
    return this.def(iid).name;
  }

  isFaction(iid: string): boolean {
    return this.def(iid).types.includes("faction");
  }

  inPlay(iid: string): boolean {
    return this.s.cards[iid]?.zone === "play";
  }

  /** Face-up, non-resource card in play (or a faction): its rules text is active. */
  active(iid: string): boolean {
    const c = this.s.cards[iid];
    if (!c || c.zone !== "play" || c.faceDown) return false;
    return !c.isResource || this.lib[c.defId].types.includes("resource");
  }

  allInPlay(): string[] {
    return Object.values(this.s.cards)
      .filter((c) => c.zone === "play")
      .map((c) => c.iid);
  }

  scopeOf(iid: string): Scope {
    const c = this.card(iid);
    return { controller: c.controller, source: iid, vars: (c as any).notes ?? {} };
  }

  // -------------------------------------------------------------------------
  // Rules: printed rules plus rules granted by modifiers

  baseRules(iid: string): Rule[] {
    return this.def(iid).rules ?? [];
  }

  /** "Treat the card as though it has no rules text" (Inhibit, Mittens of Muffled Thought). */
  silenced(iid: string): boolean {
    return this.s.cards[iid]?.zone === "play" && this.modsFor("no_rules", iid).length > 0;
  }

  rules(iid: string): Rule[] {
    const base = this.baseRules(iid);
    if (!this.active(iid)) return base;
    if (this.silenced(iid)) return [];
    const granted = this.modsFor("grant_rules", iid).flatMap((m) => m.value as Rule[]);
    return granted.length ? [...base, ...granted] : base;
  }

  /**
   * The UNIQUE names a card has: its printed one, plus its own name while
   * `all_unique` applies to it (God's Autograph: "all non-resource cards gain the
   * rules text Unique X, where X is the card's name").
   */
  uniqueNames(iid: string): string[] {
    const out: string[] = [];
    const printed = this.ruleOf(iid, "unique");
    if (printed) out.push(printed);
    if (!this.card(iid).isResource && this.modsFor("all_unique", iid).length && !out.includes(this.name(iid))) out.push(this.name(iid));
    return out;
  }

  ruleOf(iid: string, key: string): any | undefined {
    const r = this.baseRules(iid).find((r) => key in r);
    return r ? r[key] : undefined;
  }

  /**
   * A card's FLIP UP: its own, or one granted by `grant_flip_up` ("your face-down tactics
   * gain FLIP UP with numeric cost and threshold equal to their regular ones", Woadenworm).
   */
  flipUpRule(iid: string): any | undefined {
    const own = this.ruleOf(iid, "flip_up");
    if (own) return own;
    if (!this.modsFor("grant_flip_up", iid).length) return undefined;
    const d = this.def(iid);
    return { pay: d.cost ?? 0, threshold: d.threshold ?? {} };
  }

  abilities(iid: string): { index: number; rule: any }[] {
    return this.rules(iid)
      .map((r, index) => ({ index, r }))
      .filter((x) => "ability" in x.r)
      .map((x) => ({ index: x.index, rule: x.r.ability }));
  }

  // -------------------------------------------------------------------------
  // Modifiers

  /**
   * Run read-only work (views, legality hints, trigger collection) with modifiers
   * computed once. Never mutate state inside.
   */
  frozen<T>(fn: () => T): T {
    this.frozenDepth++;
    try {
      return fn();
    } finally {
      if (--this.frozenDepth === 0) this.cache = null;
    }
  }

  /** All active modifiers, optionally of one kind. */
  mods(kind?: string): ActiveMod[] {
    if (this.inMods) return [];
    if (this.frozenDepth) {
      this.cache ??= this.computeMods();
      return kind ? this.cache.filter((m) => m.kind === kind) : this.cache;
    }
    return kind ? this.computeMods().filter((m) => m.kind === kind) : this.computeMods();
  }

  private computeMods(): ActiveMod[] {
    if (this.inMods) return [];
    this.inMods++;
    try {
      const out: ActiveMod[] = [];
      const push = (m: any, source: string, controller: PlayerId, scope: Scope, effect?: Effect) => {
        const k = MOD_KINDS.find((x) => x in m);
        if (!k) return;
        if (m.while && !this.cond(m.while, scope)) return;
        out.push({ kind: k, value: m[k], mod: m, source, controller, scope, effect });
      };
      // First pass: which cards in play have no rules text right now.
      const silenced = new Set<string>();
      const silencers: { m: any; scope: Scope }[] = [];
      for (const e of this.s.effects) for (const m of e.mods ?? []) if ("no_rules" in m && !e.used) silencers.push({ m, scope: { controller: e.controller, source: e.source, vars: e.vars } });
      for (const c of Object.values(this.s.cards)) {
        if (c.zone !== "play" || !this.active(c.iid)) continue;
        for (const r of this.lib[c.defId].rules ?? []) for (const m of r.static?.mods ?? []) if ("no_rules" in m) silencers.push({ m, scope: { controller: c.controller, source: c.iid, vars: c.notes ?? {} } });
      }
      for (const { m, scope } of silencers) {
        if (m.while && !this.cond(m.while, scope)) continue;
        const t = m.target ?? "self";
        for (const c of Object.values(this.s.cards)) {
          if (c.zone !== "play") continue;
          if (t === "all" || (t?.iids ? t.iids.includes(c.iid) : this.matches(t, c.iid, scope, null))) silenced.add(c.iid);
        }
      }
      for (const c of Object.values(this.s.cards)) {
        const def = this.lib[c.defId];
        if (!def.rules || silenced.has(c.iid)) continue;
        for (const r of def.rules) {
          if (!r.static) continue;
          const st = r.static;
          const zone = st.zone ?? "play";
          // `zone: any`: "from anywhere" (Marauding Madster), except while face-down.
          if (zone === "any" ? c.faceDown : c.zone !== zone) continue;
          if (zone === "play" && !this.active(c.iid)) continue;
          const scope: Scope = { controller: zone === "play" ? c.controller : c.owner, source: c.iid, vars: (c as any).notes ?? {} };
          if (st.requires && !this.meetsBase(scope.controller, st.requires)) continue;
          if (st.while && !this.cond(st.while, scope)) continue;
          for (const m of st.mods ?? []) push(m, c.iid, scope.controller, scope);
        }
      }
      for (const e of this.s.effects) {
        if (!e.mods || e.used) continue;
        const scope: Scope = { controller: e.controller, source: e.source, vars: e.vars };
        for (const m of e.mods) push(m, e.source, e.controller, scope, e);
      }
      // Static rules granted to cards ("the attached character gains the following rules text").
      for (const g of out.filter((m) => m.kind === "grant_rules")) {
        const statics = (g.value as Rule[]).filter((r) => r.static);
        if (!statics.length) continue;
        for (const c of Object.values(this.s.cards)) {
          if (c.zone !== "play" || !this.active(c.iid) || silenced.has(c.iid) || !this.targets(g, c.iid)) continue;
          const scope: Scope = { controller: c.controller, source: c.iid, vars: (c as any).notes ?? {} };
          for (const r of statics) {
            if (r.static.requires && !this.meetsBase(scope.controller, r.static.requires)) continue;
            if (r.static.while && !this.cond(r.static.while, scope)) continue;
            for (const m of r.static.mods ?? []) push(m, c.iid, scope.controller, scope);
          }
        }
      }
      return out;
    } finally {
      this.inMods--;
    }
  }

  /** Modifiers of a kind whose target includes this card. */
  modsFor(kind: string, iid: string): ActiveMod[] {
    return this.mods(kind).filter((m) => this.targets(m, iid));
  }

  targets(m: ActiveMod, iid: string): boolean {
    const t = m.mod.target ?? "self";
    if (t === "all") return true;
    if (t && typeof t === "object" && Array.isArray(t.iids)) return t.iids.includes(iid);
    return this.matches(t, iid, m.scope, null);
  }

  /** Does a modifier with a `by` field apply to actions by player p? */
  by(m: ActiveMod, p: PlayerId): boolean {
    const b = m.mod.by ?? "any";
    return b === "any" || (b === "you" ? p === m.controller : b === "opponent" ? p !== m.controller : true);
  }

  // -------------------------------------------------------------------------
  // Types, keywords, stats, icons

  types(iid: string): CardType[] {
    const c = this.card(iid);
    if (c.zone === "play" && c.isResource) return ["resource"];
    let t = [...this.def(iid).types];
    if (c.zone === "play") {
      for (const m of this.modsFor("add_type", iid)) if (!t.includes(m.value)) t.push(m.value);
      for (const m of this.modsFor("remove_type", iid)) t = t.filter((x) => x !== m.value);
    }
    return t;
  }

  is(iid: string, t: CardType): boolean {
    return this.types(iid).includes(t);
  }

  isCharacter(iid: string): boolean {
    return this.inPlay(iid) && !this.card(iid).isResource && this.is(iid, "character");
  }

  /** Can this card be attached to that one? "ATTACH TO ITEM" cards take items; the rest take characters. */
  canHost(iid: string, host: string): boolean {
    const a = this.def(iid).attach_to;
    const t = (typeof a === "string" ? a : a && typeof a === "object" ? Object.keys(a)[0] : "character") as CardType;
    return this.inPlay(host) && !this.card(host).isResource && this.is(host, t);
  }

  keyword(iid: string, kw: string): boolean {
    if (!this.active(iid) || this.silenced(iid)) return false;
    if (this.modsFor("lose_keyword", iid).some((m) => String(m.value).toLowerCase() === kw)) return false;
    if ((this.def(iid).keywords ?? []).some((k) => k.toLowerCase() === kw)) return true;
    return this.modsFor("keyword", iid).some((m) => String(m.value).toLowerCase() === kw);
  }

  printed(iid: string, stat: Stat): number {
    const d = this.def(iid);
    if (stat === "structure") return d.structure ?? 0;
    return d.stats?.[stat] ?? 0;
  }

  /** Derived stat: base, then all increases, then all reductions, floored at 0. */
  stat(iid: string, stat: Stat): number {
    const c = this.card(iid);
    let base = this.printed(iid, stat);
    const set = this.modsFor("set_stats", iid).pop();
    if (set && set.value[stat] !== undefined) base = this.value(set.value[stat], set.scope);
    let gain = 0;
    let lose = 0;
    const add = (n: number) => (n > 0 ? (gain += n) : (lose -= n));
    if (c.zone === "play") {
      for (const g of Object.values(this.s.cards)) {
        if (g.attachedTo === iid && g.zone === "play" && stat !== "structure") add(this.lib[g.defId].gear?.[stat] ?? 0);
      }
      const printed = { str: this.printed(iid, "str"), life: this.printed(iid, "life"), spd: this.printed(iid, "spd"), structure: this.printed(iid, "structure") };
      for (const m of this.modsFor("stat", iid)) {
        if (m.value[stat] === undefined) continue;
        add(this.value(m.value[stat], { ...m.scope, vars: { ...m.scope.vars, printed, it: iid } }));
      }
    }
    return Math.max(0, base + gain - lose);
  }

  /** Icons this card currently provides to its controller. */
  provided(iid: string): Icons {
    const c = this.card(iid);
    if (c.zone !== "play") return {};
    if (c.isResource) {
      if (c.faceDown) {
        // "Each face-down resource that doesn't have PROVIDES X gains PROVIDES X" (Thabbashite Chemist).
        const out: Icons = { volition: 1 };
        for (const m of this.modsFor("provides", iid)) for (const [k, v] of Object.entries(m.value as Icons)) if (!out[k as Icon]) out[k as Icon] = v ?? 0;
        return out;
      }
      const d = this.def(iid);
      if (d.provides) return d.provides;
      return d.icon ? { [d.icon]: 1 } : {};
    }
    if (!this.active(iid)) return {};
    // PROVIDES on a permanent: the `provides` number in its JSON.
    const out: Icons = this.silenced(iid) ? {} : { ...(this.ruleOf(iid, "provides") ?? this.def(iid).provides ?? {}) };
    for (const m of this.modsFor("provides", iid)) {
      for (const [k, v] of Object.entries(m.value as Icons)) out[k as Icon] = (out[k as Icon] ?? 0) + (v ?? 0);
    }
    return out;
  }

  icons(p: PlayerId): Record<Icon, number> {
    const out = Object.fromEntries(ICONS.map((i) => [i, 0])) as Record<Icon, number>;
    for (const iid of this.allInPlay()) {
      if (this.card(iid).controller !== p) continue;
      for (const [k, v] of Object.entries(this.provided(iid))) out[k as Icon] += v ?? 0;
    }
    for (const m of this.mods("player_icons")) {
      if (m.controller !== p) continue;
      for (const [k, v] of Object.entries(m.value as Icons)) out[k as Icon] += v ?? 0;
    }
    return out;
  }

  /** Icons from resource cards only, without modifiers (used inside modifier conditions). */
  private meetsBase(p: PlayerId, threshold: Icons): boolean {
    const have: Record<string, number> = {};
    for (const iid of this.allInPlay()) {
      if (this.card(iid).controller !== p) continue;
      for (const [k, v] of Object.entries(this.provided(iid))) have[k] = (have[k] ?? 0) + (v ?? 0);
    }
    return Object.entries(threshold).every(([k, v]) => (have[k] ?? 0) >= (v ?? 0));
  }

  /** `reduceBy`: any icons (a number), or that plus reductions of named icons. */
  meets(p: PlayerId, threshold: Icons | undefined, reduceBy: number | ThresholdReduction = 0): boolean {
    if (!threshold) return true;
    const r = typeof reduceBy === "number" ? { any: reduceBy, icons: {} as Icons } : reduceBy;
    const have = this.icons(p);
    let missing = 0;
    for (const [k, v] of Object.entries(threshold)) missing += Math.max(0, (v ?? 0) - (r.icons[k as Icon] ?? 0) - have[k as Icon]);
    return missing <= r.any;
  }

  /**
   * Threshold reduction for deploying this card: by any icons (Rudo Mangod's Fealty,
   * `threshold_reduce: 3`) or by a named icon (Clockman Skydocks,
   * `threshold_reduce: { icon, amount }`). `p`: the deploying player, for `by`.
   */
  thresholdReduction(iid: string, p?: PlayerId): ThresholdReduction {
    const out: ThresholdReduction = { any: 0, icons: {} };
    for (const m of this.modsFor("threshold_reduce", iid)) {
      if (p && !this.by(m, p)) continue;
      const v = m.value;
      if (v && typeof v === "object") out.icons[v.icon as Icon] = (out.icons[v.icon as Icon] ?? 0) + this.value(v.amount ?? 1, m.scope);
      else out.any += this.value(v, m.scope);
    }
    return out;
  }

  resources(p: PlayerId): string[] {
    return this.s.players[p].play.filter((iid) => this.card(iid).isResource);
  }

  unattached(p: PlayerId): string[] {
    return this.resources(p).filter((iid) => this.card(iid).attachedTo === null);
  }

  characters(p: PlayerId): string[] {
    return this.s.players[p].play.filter((iid) => this.isCharacter(iid));
  }

  attachments(iid: string): string[] {
    return Object.values(this.s.cards)
      .filter((c) => c.zone === "play" && c.attachedTo === iid)
      .map((c) => c.iid);
  }

  /** Numeric cost, with "this turn, the character gains/loses 1 numeric cost" for cards in play. */
  /**
   * Printed subtypes plus those gained from effects ("it gains the sarcophyle subtype").
   * Only effects aimed at fixed cards count, so matching a subtype never recurses.
   */
  subtypes(iid: string): string[] {
    const out = (this.def(iid).subtypes ?? []).map((x) => x.toLowerCase());
    for (const e of this.s.effects)
      for (const m of e.mods ?? []) if (m.add_subtype && m.target?.iids?.includes(iid)) out.push(String(m.add_subtype).toLowerCase());
    return out;
  }

  numericCost(iid: string): number {
    const base = this.def(iid).cost ?? 0;
    if (this.card(iid).zone !== "play") return base;
    return Math.max(0, base + this.modsFor("numeric_cost", iid).reduce((n, m) => n + this.value(m.value, m.scope), 0));
  }

  /** Different trades among face-up cards a player controls (Wary Reunion). */
  differentTrades(p: PlayerId): number {
    const real = ["arcanist", "banker", "gearsmith", "rogue", "warlord"];
    const trades = new Set<string>();
    for (const iid of this.s.players[p].play) {
      const t = this.def(iid).trade;
      if (!this.card(iid).faceDown && real.includes(t)) trades.add(t);
    }
    return trades.size;
  }

  differentStaples(p: PlayerId): number {
    const kinds = new Set<string>();
    for (const r of this.resources(p)) {
      const c = this.card(r);
      const d = this.def(r);
      if (!c.faceDown && d.staple) kinds.add(d.id);
    }
    return kinds.size;
  }

  // -------------------------------------------------------------------------
  // Permissions

  /** Is there a "cannot <action>" modifier covering this card and player? */
  /** `source`: the card doing it, for prohibitions with `unless` ("cannot be picked by non-item cards"). */
  cannot(action: string, iid: string | null, p: PlayerId, source?: string): boolean {
    return this.mods("cannot").some((m) => {
      const act = typeof m.value === "string" ? m.value : m.value.action;
      if (act !== action || !this.by(m, p)) return false;
      if (m.value?.unless && source && this.matches(m.value.unless, source, m.scope, null)) return false;
      // Only against matching sources: { cannot: { action: destroy, from: { card: { subtype: node } } } }
      if (m.value?.from && (!source || !this.matches(m.value.from, source, m.scope, null))) return false;
      return iid === null ? m.mod.target === "all" : this.targets(m, iid);
    });
  }

  /** `p`: the attacking player, the turn player unless an effect attacks (Counter Attack). */
  canAttack(iid: string, p: PlayerId = this.s.active): boolean {
    const c = this.card(iid);
    if (!this.isCharacter(iid) || c.depleted || c.controller !== p) return false;
    if (!(c.controlSince < this.s.turn || this.keyword(iid, "aggro") || this.modsFor("attack_ready", iid).length)) return false;
    if (this.cannot("attack", iid, c.controller)) return false;
    const limit = this.modsFor("attack_limit", iid).map((m) => this.value(m.value, m.scope));
    if (limit.length && (this.s.turnLog.attacks[iid] ?? 0) >= Math.min(...limit)) return false;
    return true;
  }

  /** Cards a player may deploy from outside their hand, and how. */
  playGrant(iid: string, p: PlayerId): { ignoreThreshold: boolean } | null {
    for (const m of this.mods("play_from")) {
      if (m.controller !== p || !this.targets(m, iid)) continue;
      return { ignoreThreshold: !!m.value?.ignore_threshold };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Values and conditions

  /** Resolve a card reference: "self", "responded", "host", a variable, or an iid. */
  ref(x: any, scope: Scope): string | undefined {
    if (x === "self") return scope.source;
    // The top card of a deck: "top_of_you" / "top_of_opponent".
    if (x === "top_of_you" || x === "top_of_opponent") return this.s.players[x === "top_of_you" ? scope.controller : other(scope.controller)].deck[0];
    if (x === "host") {
      const c = this.s.cards[scope.source];
      // After it left play, the card it was attached to (Sticky Stealy Hand).
      return c ? (c.zone === "play" ? (c.attachedTo ?? undefined) : c.lastHost) : undefined;
    }
    if (x === "responded") {
      const item = this.s.stack.find((i) => i.id === scope.responding);
      return item?.iid;
    }
    // The character the card or ability being responded to picked as a cost.
    if (x === "responded_pick") {
      const item = this.s.stack.find((i) => i.id === scope.responding);
      return item?.pickedInCost?.[0];
    }
    if (typeof x === "string") {
      const v = scope.vars[x];
      if (typeof v === "string") return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
      if (this.s.cards[x]) return x;
    }
    return undefined;
  }

  /** Resolve a reference that may be a list of cards. */
  refs(x: any, scope: Scope): string[] {
    if (Array.isArray(x) || (x && typeof x === "object")) return this.find(x, scope);
    if (typeof x === "string" && Array.isArray(scope.vars[x])) return scope.vars[x];
    const one = this.ref(x, scope);
    return one ? [one] : [];
  }

  value(x: any, scope: Scope): number {
    if (x === undefined || x === null) return 0;
    if (typeof x === "number") return x;
    if (typeof x === "string") return evaluate(x, scope.vars);
    if (typeof x !== "object") return 0;
    if ("count" in x) return this.find(x.count, scope).length;
    if ("tokens" in x) {
      const r = this.ref(x.tokens, scope);
      return r ? this.card(r).tokens : 0;
    }
    if ("stat" in x) {
      const [ref, st] = x.stat;
      const r = this.ref(ref, scope);
      return r && this.inPlay(r) ? this.stat(r, st) : 0;
    }
    if ("cost" in x) {
      const r = this.ref(x.cost, scope);
      return r ? this.numericCost(r) : 0;
    }
    if ("icons" in x) return this.icons(this.who(x.player ?? "you", scope))[x.icons as Icon] ?? 0;
    if ("different_staples" in x) return this.differentStaples(this.who(x.different_staples, scope));
    if ("different_trades" in x) return this.differentTrades(this.who(x.different_trades, scope));
    if ("hand_size" in x) return this.s.players[this.who(x.hand_size, scope)].hand.length;
    if ("half_up" in x) return Math.ceil(this.value(x.half_up, scope) / 2);
    if ("sum" in x) return (x.sum as any[]).reduce((n, v) => n + this.value(v, scope), 0);
    if ("neg" in x) return -this.value(x.neg, scope);
    if ("var" in x) return Number(scope.vars[x.var] ?? 0);
    // The highest of several values, and the highest stat among cards: { max_stat: [ <selector>, spd ] }
    if ("max" in x) return Math.max(...(x.max as any[]).map((v) => this.value(v, scope)));
    if ("max_stat" in x) return Math.max(0, ...this.find(x.max_stat[0], scope).map((i) => this.stat(i, x.max_stat[1])));
    // "the total strength of the opposing party"
    if ("total_str" in x) return this.find(x.total_str, scope).reduce((n, i) => n + this.stat(i, "str"), 0);
    // "the total numeric cost of all non-resource cards you control"
    if ("total_cost" in x) return this.find(x.total_cost, scope).reduce((n, i) => n + this.numericCost(i), 0);
    if ("len" in x) {
      const v = scope.vars[x.len];
      return Array.isArray(v) ? v.length : v ? 1 : 0;
    }
    if ("played_this_turn" in x) {
      const f = x.played_this_turn ?? {};
      const list = this.s.turnLog.played.filter(
        (e) =>
          (f.by === undefined || f.by === "any" || e.player === this.who(f.by, scope)) &&
          (!f.type || e.types.includes(f.type)) &&
          (!f.not_type || !e.types.includes(f.not_type)) &&
          (!f.not_self || e.iid !== scope.source),
      );
      if (!f.same_name) return list.length;
      // The most cards with one name ("deployed at least 2 cards with the same name").
      const n: Record<string, number> = {};
      for (const e of list) n[this.lib[e.defId].name] = (n[this.lib[e.defId].name] ?? 0) + 1;
      return Math.max(0, ...Object.values(n));
    }
    if ("last_played_cost" in x) {
      const f = x.last_played_cost ?? {};
      const list = this.s.turnLog.played.filter((e) => !f.type || e.types.includes(f.type));
      return list.length ? list[list.length - 1].cost : 0;
    }
    if ("influence" in x) return this.s.players[this.who(x.influence, scope)].influence;
    if ("threshold" in x) {
      // Total icons in a card's threshold.
      const r = this.ref(x.threshold, scope);
      return r ? Object.values(this.def(r).threshold ?? {}).reduce((n: number, v) => n + (v ?? 0), 0) : 0;
    }
    if ("last_known" in x) {
      // Current stat in play; once it has left play, the stat it had as it left.
      const [ref, st] = x.last_known;
      const r = this.ref(ref, scope);
      if (!r) return 0;
      if (this.inPlay(r)) return this.stat(r, st);
      return this.card(r).lastStats?.[st as "str" | "life" | "spd"] ?? this.printed(r, st);
    }
    if ("printed" in x) {
      const [ref, st] = x.printed;
      const r = this.ref(ref, scope);
      return r ? this.printed(r, st) : 0;
    }
    if ("damage" in x) {
      const r = this.ref(x.damage, scope);
      return r ? this.card(r).damage + this.card(r).markers : 0;
    }
    throw new Error(`Unknown value ${JSON.stringify(x)}`);
  }

  who(x: any, scope: Scope): PlayerId {
    if (x === "opponent") return other(scope.controller);
    if (x === "active") return this.s.active;
    if (x === "A" || x === "B") return x;
    if (typeof x === "string" && (scope.vars[x] === "A" || scope.vars[x] === "B")) return scope.vars[x];
    if (x && typeof x === "object" && "opponent_of" in x) return other(this.who(x.opponent_of, scope));
    // "Pick a player" is written as picking their faction: { controller_of: f }.
    if (x && typeof x === "object" && "controller_of" in x) {
      const r = this.ref(x.controller_of, scope);
      return r ? this.card(r).controller : scope.controller;
    }
    if (x && typeof x === "object" && "owner_of" in x) {
      const r = this.ref(x.owner_of, scope);
      return r ? this.card(r).owner : scope.controller;
    }
    return scope.controller;
  }

  cond(c: any, scope: Scope): boolean {
    if (c === undefined || c === null || c === true) return true;
    if (c === false) return false;
    if (Array.isArray(c)) return c.every((x) => this.cond(x, scope));
    const k = Object.keys(c)[0];
    const v = c[k];
    switch (k) {
      case "all":
        return (v as any[]).every((x) => this.cond(x, scope));
      case "any":
        return (v as any[]).some((x) => this.cond(x, scope));
      case "not":
        return !this.cond(v, scope);
      case "icons":
        return this.meets(this.who(c.player ?? "you", scope), v);
      case "did":
        return !!scope.did === !!v;
      case "defined":
        return scope.vars[v] !== undefined && scope.vars[v] !== null && !(Array.isArray(scope.vars[v]) && !scope.vars[v].length);
      case "gte":
        return this.value(v[0], scope) >= this.value(v[1], scope);
      case "gt":
        return this.value(v[0], scope) > this.value(v[1], scope);
      case "lte":
        return this.value(v[0], scope) <= this.value(v[1], scope);
      case "lt":
        return this.value(v[0], scope) < this.value(v[1], scope);
      case "eq":
        return this.value(v[0], scope) === this.value(v[1], scope);
      case "in_play": {
        const r = this.ref(v, scope);
        return !!r && this.inPlay(r);
      }
      case "destroyed": {
        const r = this.ref(v, scope);
        return !!r && !this.inPlay(r);
      }
      case "in_zone": {
        const r = this.ref(v[0], scope);
        return !!r && this.card(r).zone === v[1];
      }
      case "matches": {
        const r = this.ref(v[0], scope);
        return !!r && this.matches(v[1], r, scope, null);
      }
      case "exists":
        return this.find(v, scope).length > 0;
      case "via":
        return scope.via === v;
      case "in_battle":
        return !!this.s.battle === !!v;
      case "attacked_this_turn": {
        const r = this.ref(v, scope);
        return !!r && (this.s.turnLog.attacks[r] ?? 0) > 0;
      }
      case "assigned_damage": {
        const r = this.ref(v, scope);
        return !!r && !!this.s.turnLog.assigned?.[r];
      }
      case "attack_target":
        // { attack_target: faction } or a location reference
        return !!this.s.battle && (v === "faction" ? this.s.battle.target === "faction" : this.s.battle.target === this.ref(v, scope));
      case "since_turn_start": {
        // "Use this only if this card has been in play since the start of the turn."
        const r = this.ref(v, scope);
        return !!r && this.s.cards[r].zone === "play" && this.s.cards[r].controlSince < this.s.turn;
      }
      case "covert_party":
        // The attacking party in the current battle is COVERT.
        return !!this.s.battle?.covert === !!v;
      case "battle_damage":
        // Has any damage been assigned in the current battle?
        return !!this.s.battle?.done.length === !!v;
      case "even":
        return this.value(v, scope) % 2 === 0;
      case "your_turn":
        return (this.s.active === scope.controller) === !!v;
      case "attacking": {
        const r = this.ref(v, scope);
        return !!r && !!this.s.battle?.attackers.includes(r);
      }
      case "blocking": {
        const r = this.ref(v, scope);
        return !!r && !!this.s.battle?.blockers.includes(r);
      }
      default:
        throw new Error(`Unknown condition ${k}`);
    }
  }

  // -------------------------------------------------------------------------
  // Selectors

  /**
   * Does a card match a selector from card data? See docs/CARDS.md, "Selectors".
   *   "self" | "host" | "responded" | variable name
   *   { character: any } | { item: { controller: you } } | { card: { zone: discard } }
   *   [ selector, selector ]   (either)
   * Zone defaults to play unless the selector names one or `defaultZone` is given.
   */
  matches(sel: any, iid: string, scope: Scope, defaultZone: string | null = "play"): boolean {
    if (Array.isArray(sel)) return sel.some((x) => this.matches(x, iid, scope, defaultZone));
    if (typeof sel === "string" && sel !== "any") {
      if (Array.isArray(scope.vars[sel])) return scope.vars[sel].includes(iid);
      return this.ref(sel, scope) === iid;
    }
    if (sel === "any" || sel === undefined || sel === null) sel = {};
    const typeKey = [...CARD_TYPES, "card"].find((k) => k in sel);
    let f = typeKey ? sel[typeKey] : sel;
    if (f === "any" || f === null || f === undefined) f = {};
    const c = this.s.cards[iid];
    if (!c) return false;
    const types = this.types(iid);

    const wantType = typeKey && typeKey !== "card" ? typeKey : f.type;
    if (wantType && !types.includes(wantType)) return false;
    if (types.includes("faction") && wantType !== "faction") return false;
    if (f.not_type && types.includes(f.not_type)) return false;

    const zone = f.zone ?? defaultZone;
    if (zone && zone !== "any" && c.zone !== zone) return false;

    const rel = (v: string, p: PlayerId) => (v === "you" ? p === scope.controller : v === "opponent" ? p !== scope.controller : true);
    if (f.owner && !rel(f.owner, c.owner)) return false;
    if (f.controller && !rel(f.controller, c.controller)) return false;
    const d = this.lib[c.defId];
    if (f.subtype && !this.subtypes(iid).includes(this.str(f.subtype, scope).toLowerCase())) return false;
    if (f.not_subtype && this.subtypes(iid).includes(this.str(f.not_subtype, scope).toLowerCase())) return false;
    if (f.token !== undefined && !!d.token !== !!f.token) return false;
    if (f.trade && d.trade !== this.str(f.trade, scope)) return false;
    if (f.not_trade && d.trade === f.not_trade) return false;
    // "inflicted damage to your faction this turn": damaged_faction: you
    if (f.damaged_faction !== undefined && !(this.s.turnLog.factionHits?.[this.who(f.damaged_faction, scope)] ?? []).includes(iid)) return false;
    if (f.keyword !== undefined && !this.keyword(iid, String(f.keyword).toLowerCase())) return false;
    // "the character an opponent controls with the highest numeric cost" (among its controller's characters)
    if (f.costliest && (c.zone !== "play" || this.numericCost(iid) < Math.max(...this.characters(c.controller).map((i) => this.numericCost(i))))) return false;
    // `cheapest: all`: the lowest among every character in play (Verrucose Brains).
    if (f.cheapest && (c.zone !== "play" || this.numericCost(iid) > Math.min(...(f.cheapest === "all" ? [...this.characters("A"), ...this.characters("B")] : this.characters(c.controller)).map((i) => this.numericCost(i))))) return false;
    // "characters with items attached to them"
    if (f.equipped !== undefined && this.attachments(iid).some((a) => this.is(a, "item")) !== !!f.equipped) return false;
    // "a character this card damaged this turn": damaged_by: self
    // "has received damage this turn"
    if (f.damaged_this_turn !== undefined && !!this.s.turnLog.hits?.[iid] !== !!f.damaged_this_turn) return false;
    if (f.damaged_by !== undefined && !(this.s.turnLog.hits?.[iid] ?? []).includes(this.ref(f.damaged_by, scope) ?? "")) return false;
    if (f.has_tokens !== undefined && (c.tokens > 0) !== !!f.has_tokens) return false;
    if (f.printed_type && !d.types.includes(f.printed_type)) return false;
    if (f.not_types && (f.not_types as string[]).some((t) => types.includes(t as CardType))) return false;
    if (f.among !== undefined) {
      const list = scope.vars[f.among];
      if (!(Array.isArray(list) ? list.includes(iid) : list === iid)) return false;
    }
    if (f.name && d.name !== this.str(f.name, scope) && d.id !== this.str(f.name, scope)) return false;
    if (f.name_not && (d.name === this.str(f.name_not, scope) || d.id === this.str(f.name_not, scope))) return false;
    // "a resource with a name you don't control": no card matching the selector shares its name.
    if (f.name_not_among !== undefined && this.find(f.name_not_among, scope).some((x) => x !== iid && this.def(x).name === d.name)) return false;
    if (f.cost_lte !== undefined && this.numericCost(iid) > this.value(f.cost_lte, scope)) return false;
    if (f.cost_gte !== undefined && this.numericCost(iid) < this.value(f.cost_gte, scope)) return false;
    // Strength and life: current values in play, printed values elsewhere.
    const statNow = (st: Stat) => (c.zone === "play" ? this.stat(iid, st) : this.printed(iid, st));
    if (f.str_lte !== undefined && statNow("str") > this.value(f.str_lte, scope)) return false;
    if (f.life_lte !== undefined && statNow("life") > this.value(f.life_lte, scope)) return false;
    if (f.str_gte !== undefined && statNow("str") < this.value(f.str_gte, scope)) return false;
    if (f.spd_lte !== undefined && statNow("spd") > this.value(f.spd_lte, scope)) return false;
    // "the character with the highest strength"
    // `strongest: controller`: the highest among its controller's characters ("an opponent's character with the highest strength").
    if (f.strongest && (c.zone !== "play" || this.stat(iid, "str") < Math.max(...(f.strongest === "controller" ? this.characters(c.controller) : this.allInPlay().filter((i) => this.isCharacter(i))).map((i) => this.stat(i, "str"))))) return false;
    // Printed text contains this ("has a [V] icon in its rules text").
    if (f.text_has !== undefined && !(d.text ?? "").includes(String(f.text_has))) return false;
    // "the top N cards of your deck"
    if (f.top !== undefined && (c.zone !== "deck" || this.s.players[c.owner].deck.indexOf(iid) >= this.value(f.top, scope))) return false;
    if (f.trade_not_among !== undefined) {
      // "doesn't share a trade with any characters you control"
      const trades = new Set(this.find(f.trade_not_among, scope).filter((x) => x !== iid).map((x) => this.lib[this.s.cards[x].defId].trade));
      if (trades.has(d.trade)) return false;
    }
    // "a character with the UNIQUE keyword in its rules text" (`unique: true`), or a
    // specific one ("cards with 'UNIQUE JO'": `unique: Jo`).
    if (f.unique !== undefined) {
      const names = [...(d.text ?? "").matchAll(/(?:^|\n|, )UNIQUE ([^\n,]+)/g)].map((m) => m[1].trim().toLowerCase());
      const ok = typeof f.unique === "string" ? names.includes(f.unique.toLowerCase()) : names.length > 0;
      if (ok !== (f.unique !== false)) return false;
    }
    if (f.face_down !== undefined && c.faceDown !== f.face_down) return false;
    // A resource attached to its controller's faction (spent paying costs).
    if (f.spent !== undefined && (c.attachedTo === "faction") !== !!f.spent) return false;
    if (f.depleted !== undefined && c.depleted !== f.depleted) return false;
    if (f.staple && !d.staple) return false;
    if (f.not_self && iid === scope.source) return false;
    // `not: c`, or several variables: `not: [x, y]`
    if (f.not && (Array.isArray(f.not) && f.not.every((n: any) => typeof n === "string") ? f.not.flatMap((n: string) => this.refs(n, scope)) : this.refs(f.not, scope)).includes(iid)) return false;
    if (f.host_of && this.ref(f.host_of, scope) && this.card(this.ref(f.host_of, scope)!).attachedTo !== iid) return false;
    if (f.host_of && !this.ref(f.host_of, scope)) return false;
    if (f.attached_to && c.attachedTo !== this.ref(f.attached_to, scope)) return false;
    // "a card with an ability in its rules text" (Notion Sickness)
    if (f.has_ability !== undefined && this.abilities(iid).length > 0 !== !!f.has_ability) return false;
    if (f.tagged_by && !(c.tags ?? []).includes(this.ref(f.tagged_by, scope) ?? "")) return false;
    if (f.attacking !== undefined && !!this.s.battle?.attackers.includes(iid) !== f.attacking) return false;
    if (f.blocking !== undefined && !!this.s.battle?.blockers.includes(iid) !== f.blocking) return false;
    // `party_with: self`: in the same party as that card in the current battle (itself included).
    if (f.party_with) {
      const b = this.s.battle;
      const o = this.ref(f.party_with, scope);
      if (!b || !o || !([b.attackers, b.blockers].some((side) => side.includes(o) && side.includes(iid)))) return false;
    }
    if (f.provides_at_least) {
      const prov = this.provided(iid);
      for (const [k, v] of Object.entries(f.provides_at_least as Icons)) if ((prov[k as Icon] ?? 0) < (v ?? 0)) return false;
    }
    if (f.staple_not_among === "starting_resources") {
      if (!d.staple) return false;
      if (this.resources(scope.controller).some((r) => this.card(r).defId === d.id)) return false;
    }
    return true;
  }

  private str(x: any, scope: Scope): string {
    if (typeof x === "string" && scope.vars[x] !== undefined) return String(scope.vars[x]);
    return String(x);
  }

  find(sel: any, scope: Scope, defaultZone: string | null = "play"): string[] {
    return Object.keys(this.s.cards).filter((iid) => this.matches(sel, iid, scope, defaultZone));
  }

  /** Staple icon types, for "name a resource icon". */
  stapleIcons(): Icon[] {
    return STAPLE_ICONS;
  }
}
