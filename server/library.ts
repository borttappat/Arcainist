// Loads card definitions from cards/*.yaml and checks them for mistakes (unknown
// instructions, rule types or modifiers, duplicate ids) so typos fail at startup,
// not mid-game. The card language is documented in docs/CARDS.md.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { CardDef, CardLibrary } from "../engine/types.ts";

/** Every instruction the engine implements (op_* in engine/game.ts). */
export const KNOWN_OPS = new Set([
  // control flow
  "if", "let", "repeat", "as", "each_player", "may", "may_pay", "choose_one", "script", "require", "remember",
  // costs and choices
  "pay", "pick", "choose_number", "name",
  // card operations
  "destroy", "discard", "reveal", "reveal_hand", "reveal_top", "void", "deplete", "restore", "draw", "damage", "heal",
  "markers", "lose_influence", "gain_influence", "modify", "create_effect", "clear_effects", "flip_face_down",
  "flip_face_up", "put_into_play", "move", "shuffle", "take_control", "attach", "tokens", "distribute_tokens",
  "search", "mill", "look", "play_card", "play_resource", "restore_all_depleted", "detach_all_resources", "detach",
  "destroy_resource", "terminate", "nullify", "cancel_end_turn", "duplicate",
]);

const RULE_KEYS = new Set(["play", "ability", "trigger", "replace", "static", "unique", "provides", "flip_up", "script"]);

export const MOD_KINDS = new Set([
  "stat", "set_stats", "add_type", "remove_type", "keyword", "provides", "player_icons", "cost", "cost_min",
  "threshold_reduce", "cannot", "must_pick", "pick_tax", "play_from", "tactical", "grant_rules", "damage",
  "influence_loss", "attack_limit", "redirect", "reveal_hand", "use_opponent_abilities", "lose_when_deck_empty",
]);

export const EVENTS = new Set([
  "played", "ability_used", "enters_play", "leaves_play", "destroyed", "attacks", "blocks", "blocked", "damage",
  "influence_lost", "start_of_turn", "end_of_turn", "draw", "picked", "discarded",
]);

export function loadLibrary(dir: string): CardLibrary {
  const lib: CardLibrary = {};
  const errors: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()) {
    let def: CardDef;
    try {
      def = parse(readFileSync(join(dir, file), "utf8")) as CardDef;
    } catch (e) {
      errors.push(`${file}: YAML error: ${(e as Error).message}`);
      continue;
    }
    if (def && typeof def === "object") {
      // Unquoted YAML like `id: 1337` parses as a number.
      def.id = def.id === undefined ? def.id : String(def.id);
      def.name = def.name === undefined ? def.name : String(def.name);
    }
    if (!def?.id || !def.name || !Array.isArray(def.types)) {
      errors.push(`${file}: needs id, name and types`);
      continue;
    }
    if (lib[def.id]) errors.push(`${file}: duplicate id "${def.id}"`);
    for (const e of validate(def)) errors.push(`${file}: ${e}`);
    lib[def.id] = def;
  }
  if (errors.length) throw new Error("Card data errors:\n  " + errors.join("\n  "));
  return lib;
}

export function validate(def: CardDef): string[] {
  const errs: string[] = [];

  const steps = (list: unknown, path: string): void => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) {
      errs.push(`${path} must be a list`);
      return;
    }
    list.forEach((st, i) => step(st, `${path}[${i}]`));
  };

  const step = (st: any, path: string): void => {
    const op = st && typeof st === "object" ? Object.keys(st)[0] : undefined;
    if (!op || !KNOWN_OPS.has(op)) {
      errs.push(`${path}: unknown instruction "${op}"`);
      return;
    }
    const a = st[op];
    const at = `${path}.${op}`;
    switch (op) {
      case "if":
        if (a?.cond === undefined) errs.push(`${at}: needs cond`);
        steps(a?.then, `${at}.then`);
        steps(a?.else, `${at}.else`);
        break;
      case "may":
        if (Array.isArray(a)) steps(a, at);
        else {
          steps(a?.steps, `${at}.steps`);
          steps(a?.else, `${at}.else`);
        }
        break;
      case "may_pay":
        steps(a?.then, `${at}.then`);
        steps(a?.else, `${at}.else`);
        break;
      case "choose_one": {
        const opts = Array.isArray(a) ? a : a?.options;
        if (!Array.isArray(opts)) errs.push(`${at}: needs options`);
        else opts.forEach((o: any, j: number) => (o?.steps ? steps(o.steps, `${at}[${j}].steps`) : step(o, `${at}[${j}]`)));
        break;
      }
      case "as":
      case "repeat":
        steps(a?.steps, `${at}.steps`);
        break;
      case "each_player":
        steps(Array.isArray(a) ? a : a?.steps, at);
        break;
      case "create_effect":
        (a?.mods ?? []).forEach((m: any, j: number) => mod(m, `${at}.mods[${j}]`));
        (a?.rules ?? []).forEach((r: any, j: number) => rule(r, `${at}.rules[${j}]`));
        break;
    }
  };

  const mod = (m: any, path: string): void => {
    const k = m && typeof m === "object" ? Object.keys(m).find((x) => MOD_KINDS.has(x)) : undefined;
    if (!k) errs.push(`${path}: unknown modifier (${m && typeof m === "object" ? Object.keys(m).join(", ") : m})`);
    if (k === "grant_rules") (m.grant_rules ?? []).forEach((r: any, j: number) => rule(r, `${path}.grant_rules[${j}]`));
  };

  const rule = (r: any, path: string): void => {
    const key = r && typeof r === "object" ? Object.keys(r).find((k) => RULE_KEYS.has(k)) : undefined;
    if (!key) {
      errs.push(`${path}: unknown rule type (${r && typeof r === "object" ? Object.keys(r).join(", ") : r})`);
      return;
    }
    const at = `${path}.${key}`;
    switch (key) {
      case "play":
      case "ability":
        steps(r[key].cost, `${at}.cost`);
        steps(r[key].effect, `${at}.effect`);
        if (key === "ability" && !r[key].name) errs.push(`${at}: abilities need a name`);
        break;
      case "trigger":
        if (!EVENTS.has(r.trigger?.on)) errs.push(`${at}: unknown event "${r.trigger?.on}"`);
        steps(r.effect, `${path}.effect`);
        break;
      case "replace":
        steps(r.instead, `${path}.instead`);
        break;
      case "static":
        (r.static?.mods ?? []).forEach((m: any, j: number) => mod(m, `${at}.mods[${j}]`));
        break;
      case "flip_up":
        steps(r.flip_up?.cost, `${at}.cost`);
        break;
    }
  };

  steps(def.restore_rule, "restore_rule");
  steps(def.develop_rule, "develop_rule");
  steps(def.starting_draw?.before, "starting_draw.before");
  (def.rules ?? []).forEach((r, i) => rule(r, `rules[${i}]`));
  return errs;
}
