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
  "destroy_resource", "terminate", "nullify", "cancel_end_turn", "duplicate", "coin_flip", "transform",
  "create_token", "remove_from_battle", "add_to_battle", "divide_damage", "retarget_attack",
]);

const RULE_KEYS = new Set(["play", "ability", "trigger", "replace", "static", "unique", "provides", "flip_up", "script", "coin_reflip"]);

export const MOD_KINDS = new Set([
  "stat", "set_stats", "add_type", "remove_type", "keyword", "provides", "player_icons", "cost", "cost_min",
  "threshold_reduce", "cannot", "must_pick", "pick_tax", "play_from", "tactical", "grant_rules", "damage",
  "influence_loss", "attack_limit", "redirect", "reveal_hand", "use_opponent_abilities", "lose_when_deck_empty", "no_rules",
  "cannot_be_blocked", "lose_keyword", "must_attack", "must_block", "party", "reveal_top", "no_deplete_on_attack",
  "covert_blockable", "redirect_damage", "attack_cost", "draw_bonus", "destroy_self",
  "party_covert", "assign_to_target", "must_be_assigned", "search_tax", "battle_damage_to_self", "stays_in_play", "damage_as_tokens",
]);

export const EVENTS = new Set([
  "played", "ability_used", "enters_play", "leaves_play", "destroyed", "attacks", "blocks", "blocked", "damage",
  "influence_lost", "start_of_turn", "end_of_turn", "draw", "picked", "discarded",
  "restored", "depleted", "moved", "battle_end", "coin_flipped", "party_formed",
]);

/**
 * Card numbers live in cards/<id>.json, everything else in cards/<id>.yaml.
 * These are the only keys allowed in the JSON file, and they're rejected in YAML.
 */
export const NUMBER_KEYS = ["cost", "threshold", "stats", "structure", "gear", "provides", "influence", "starting_resources", "starting_draw", "min_deck"] as const;

const ICON_NAMES = ["obsession", "greed", "elitism", "deception", "rage", "volition"];

/** Check a card's numbers file: known keys, whole numbers >= 0, known icon and stat names. */
export function validateNumbers(n: any): string[] {
  const errs: string[] = [];
  if (!n || typeof n !== "object" || Array.isArray(n)) return ["must be a JSON object"];
  const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  const map = (k: string, allowed: string[]) => {
    const v = n[k];
    if (v === undefined) return;
    if (!v || typeof v !== "object") return errs.push(`${k} must be an object`);
    for (const [kk, vv] of Object.entries(v)) {
      if (!allowed.includes(kk)) errs.push(`${k}.${kk} is not one of ${allowed.join(", ")}`);
      if (!whole(vv)) errs.push(`${k}.${kk} must be a whole number >= 0`);
    }
  };
  for (const k of Object.keys(n)) if (!(NUMBER_KEYS as readonly string[]).includes(k)) errs.push(`unknown key "${k}" (allowed: ${NUMBER_KEYS.join(", ")})`);
  for (const k of ["cost", "structure", "influence", "min_deck"]) if (n[k] !== undefined && !whole(n[k])) errs.push(`${k} must be a whole number >= 0`);
  map("threshold", ICON_NAMES);
  map("provides", ICON_NAMES);
  map("stats", ["str", "life", "spd"]);
  map("gear", ["str", "life", "spd"]);
  const sr = n.starting_resources;
  if (sr !== undefined) {
    const counts = ["any_staples", "different_staples", "any_resources", "any_cards_face_down", "choose_staples"];
    for (const [k, v] of Object.entries(sr)) {
      if (k === "specific" || k === "face_down") {
        for (const [ic, c] of Object.entries(v as object)) {
          if (!ICON_NAMES.includes(ic)) errs.push(`starting_resources.${k}.${ic} is not an icon`);
          if (!whole(c)) errs.push(`starting_resources.${k}.${ic} must be a whole number >= 0`);
        }
      } else if (!counts.includes(k)) errs.push(`starting_resources.${k} is not one of ${[...counts, "specific", "face_down"].join(", ")}`);
      else if (!whole(v)) errs.push(`starting_resources.${k} must be a whole number >= 0`);
    }
  }
  map("starting_draw", ["first", "second"]);
  return errs;
}

export function loadLibrary(dir: string): CardLibrary {
  const lib: CardLibrary = {};
  const errors: string[] = [];
  const files = readdirSync(dir);
  for (const file of files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()) {
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
    // Numbers come from the matching JSON file.
    const jsonFile = file.replace(/\.ya?ml$/, ".json");
    for (const k of NUMBER_KEYS) {
      const v = (def as any)[k];
      if (v === undefined) continue;
      // Factions keep their starting-draw steps (`before`) in YAML.
      if (k === "starting_draw" && Object.keys(v).every((x) => x === "before")) continue;
      errors.push(`${file}: "${k}" is a number and belongs in ${jsonFile}`);
    }
    let numbers: any;
    try {
      numbers = JSON.parse(readFileSync(join(dir, jsonFile), "utf8"));
    } catch (e) {
      errors.push(`${jsonFile}: ${(e as NodeJS.ErrnoException).code === "ENOENT" ? "missing (every card needs a numbers file, even if it is just {})" : (e as Error).message}`);
      continue;
    }
    for (const e of validateNumbers(numbers)) errors.push(`${jsonFile}: ${e}`);
    def = mergeNumbers(def, numbers);
    if (lib[def.id]) errors.push(`${file}: duplicate id "${def.id}"`);
    for (const e of validate(def)) errors.push(`${file}: ${e}`);
    lib[def.id] = def;
  }
  const yamls = new Set(files);
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    if (!yamls.has(file.replace(/\.json$/, ".yaml"))) errors.push(`${file}: no matching .yaml file`);
  }
  if (errors.length) throw new Error("Card data errors:\n  " + errors.join("\n  "));
  return lib;
}

/** Formats from formats/*.json, keyed by file name. */
export function loadFormats(dir: string): Record<string, import("../engine/formats.ts").Format> {
  const out: Record<string, any> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const id = f.replace(/\.json$/, "");
    out[id] = { id, ...JSON.parse(readFileSync(join(dir, f), "utf8")) };
  }
  if (!out.casual) throw new Error("formats/casual.json is required");
  return out;
}

/** Card definition = YAML (text and rules) + JSON (numbers). */
export function mergeNumbers(def: CardDef, numbers: Record<string, any>): CardDef {
  const out: any = { ...def, ...numbers };
  if (def.starting_draw || numbers.starting_draw) out.starting_draw = { ...(def.starting_draw ?? {}), ...(numbers.starting_draw ?? {}) };
  return out;
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
