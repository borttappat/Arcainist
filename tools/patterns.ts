// Rule-pattern analysis of every card's printed text.
//
//   npm run patterns
//
// Splits each card's text into clauses and matches them against a catalogue of
// rule patterns (keywords, timing restrictions, trigger events, effects,
// modifiers). Each pattern is marked with the engine feature that implements it,
// or as missing. Writes docs/PATTERNS.md (report) and docs/patterns.json (data).
//
// The matching is regex-based and approximate: it's a map for planning the
// keyword engine, not a parser. Update a pattern's `engine` field when the
// engine gains the feature.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadLibrary } from "../server/library.ts";
import type { CardDef } from "../engine/types.ts";

const ROOT = join(import.meta.dirname, "..");

interface Pattern {
  id: string;
  category: string;
  label: string;
  re: RegExp;
  /** Engine feature implementing it (see docs/CARDS.md), or null if missing. */
  engine: string | null;
}

const P = (category: string, id: string, label: string, re: RegExp, engine: string | null): Pattern => ({ id, category, label, re, engine });

// Order matters only for the report; a clause can match several patterns.
const PATTERNS: Pattern[] = [
  // --- Keywords and card structure -------------------------------------------------
  P("Keywords", "ability", "Named ability (COST / EFFECT)", /^COST:/, "ability"),
  P("Keywords", "extra_cost", "EXTRA COST", /^EXTRA COST:/, "play.cost"),
  P("Keywords", "flip_up", "FLIP UP", /^FLIP UP:/, "flip_up"),
  P("Keywords", "recur", "RECUR", /^RECUR:/, "ability from: discard"),
  P("Keywords", "attach", "ATTACH TO CHARACTER", /ATTACH TO CHARACTER/, "attach_to"),
  P("Keywords", "covert", "COVERT", /\bCOVERT\b/, "keyword covert"),
  P("Keywords", "tactical", "TACTICAL", /\bTACTICAL\b/, "keyword tactical"),
  P("Keywords", "aggro", "Can attack the turn it enters play", /can attack even if it has not been in play|\bAGGRO\b/, "keyword aggro"),
  P("Keywords", "provides", "PROVIDES", /^PROVIDES:/, "provides"),
  P("Keywords", "unique", "UNIQUE X", /\bUNIQUE [A-Z]/, "unique"),
  P("Keywords", "option", "OPTION choices", /^OPTION \d/, "choose_one"),
  P("Keywords", "gated", "Text active with threshold icons ([X][X]: ...)", /^(\[[OGEDRV]\])+:/, "requires"),
  P("Keywords", "token_menu", "Effects by number of tokens (N TOKENS: ...)", /^(\d+|AT LEAST \d+) TOKENS?:/, "if + tokens"),
  P("Keywords", "fealty", "FEALTY (threshold reduction in hand)", /^FEALTY:/, "threshold_reduce"),
  P("Keywords", "epic", "Epic card (tournament rules)", /rules for epic cards/, null),

  // --- Timing and use restrictions ---------------------------------------------------
  P("Timing", "your_turn", "Only during your turn", /only during your turn/i, "timing your_turn"),
  P("Timing", "resp_deploy", "Only in response to a card being deployed", /only in response to (a|an|any) [^.]*being (deployed|played)/i, "response_to deploying"),
  P("Timing", "resp_ability", "Only in response to an ability", /only in response to (an?|any) [^.]*ability/i, "response_to ability"),
  P("Timing", "resp_pick", "Only in response to a pick made as a cost", /picked a character as (an extra )?cost/i, "response_to picked_character_as_cost"),
  P("Timing", "after_end", "After declaring the end of your turn", /declared the end of your turn/i, "timing after_end_turn"),
  P("Timing", "from_discard", "Use from the discard pile", /only if this card is in your discard pile/i, "from: discard"),
  P("Timing", "from_facedown", "Use while a face-down resource", /while this card is a face-down resource/i, "from: face_down_resource"),
  P("Timing", "not_battle", "Only outside battle", /not (during|in) (a )?battle|that is not in (a )?battle/i, "cond not attacking/blocking"),
  P("Timing", "in_battle", "Only during a battle", /only during (a|the) battle|only while (this card is )?in (a )?battle/i, null),
  P("Timing", "no_response", "Opponent cannot respond", /cannot respond to this card/i, "no_response"),
  P("Timing", "use_only_if", "Other 'use/deploy this only if' conditions", /(use|deploy|play) this only if/i, "require"),
  P("Timing", "once_per_turn", "Only once each turn (abilities, effects)", /(?<!attack )only once (each|per) turn/i, null),

  // --- Costs and choices -----------------------------------------------------------
  P("Costs and choices", "pick", "Pick a card", /^(you may )?pick (a|an|another|up to|\d+|X|N|two|three|any number of)\b[^.]*\.$/i, "pick"),
  P("Costs and choices", "pay", "Pay N", /^(you may )?pay \S+\.$/i, "pay"),
  P("Costs and choices", "x_is", "X is a card's cost / strength / count", /^(if you do, )?[XYZ] is (its|the|that|twice|this|half|the number)/i, "let"),
  P("Costs and choices", "pick_player", "Pick a player / an opponent", /^pick (a player|an opponent|a faction)\.?$/i, "choose_one / faction selector"),
  P("Costs and choices", "reveal_self", "Reveal this card", /^reveal this card\.$/i, "reveal"),
  P("Costs and choices", "if_you_do", "If you do / otherwise", /^(if you do|if they do|otherwise)\b/i, "may / did / else"),
  P("Costs and choices", "mode_text", "Choose this card's rules text from options", /as this card's rules text/i, "choose_one + remember + static while"),
  P("Costs and choices", "copies", "Any number of copies in a deck", /as many copies of this card/i, "deck_limit"),
  P("Costs and choices", "face_down_only", "Resource played face-down only", /may only be played from your hand face-down/i, "face_down_only"),

  // --- Trigger events ----------------------------------------------------------------
  P("Triggers", "t_enters", "When ... enters play", /\b(when|if)\b[^.]*enters? play/i, "event enters_play"),
  P("Triggers", "t_destroyed", "When ... is destroyed", /\b(when|if)\b[^.]*(is|are) destroyed/i, "event destroyed"),
  P("Triggers", "t_leaves", "When ... leaves play", /\b(when|if)\b[^.]*leaves? play/i, "event leaves_play"),
  P("Triggers", "t_attacks", "When ... attacks", /\bwhen\b[^.]*\battacks\b/i, "event attacks"),
  P("Triggers", "t_blocks", "When ... blocks", /\bwhen\b[^.]*\bblocks\b/i, "event blocks"),
  P("Triggers", "t_blocked", "When ... is blocked", /\b(when|if)\b[^.]*is blocked/i, "event blocked"),
  P("Triggers", "t_dmg_faction", "When ... inflicts damage to a faction", /\b(when|if)\b[^.]*inflicts? [^.]*damage to (a|an|your|an opponent's|that) faction/i, "event damage faction"),
  P("Triggers", "t_dmg", "When damage / battle damage is inflicted", /\b(when|if)\b[^.]*(inflicts?|is inflicted|receives?|takes?) [^.]*damage/i, "event damage"),
  P("Triggers", "t_start_you", "At the start of your turn", /at the start of your turn/i, "event start_of_turn"),
  P("Triggers", "t_start_each", "At the start of each player's turn", /at the start of each (player's )?turn/i, "event start_of_turn any"),
  P("Triggers", "t_end", "At the end of a turn", /at the end of (your|each|the) turn/i, "event end_of_turn"),
  P("Triggers", "t_provides", "When a card that provides [X] enters play", /card that provides at least/i, "provides_at_least"),
  P("Triggers", "t_deploys", "When a player deploys / plays a card", /\bwhen\b[^.]*\b(deploys?|plays?)\b (a|an|any)\b/i, "event played"),
  P("Triggers", "t_draws", "When a player draws", /\bwhen\b[^.]*\bdraws?\b/i, "event draw"),
  P("Triggers", "t_picked", "When ... is picked", /\b(when|if)\b[^.]*is picked/i, "event picked"),
  P("Triggers", "t_discards", "When ... discards", /\bwhen\b[^.]*\bdiscards?\b/i, "event discarded"),
  P("Triggers", "t_influence", "When a faction loses influence", /\b(when|if)\b[^.]*loses? [^.]*influence/i, "event influence_lost"),
  P("Triggers", "t_ability", "When an ability is used", /\bwhen\b[^.]*uses? an ability/i, "event ability_used"),
  P("Triggers", "t_restores", "When ... restores / is restored", /\bwhen\b[^.]*\b(restores|is restored)\b/i, null),
  P("Triggers", "t_depleted", "When ... is depleted", /\bwhen\b[^.]*is depleted/i, null),
  P("Triggers", "t_battle_end", "When a battle ends / after battle", /\bwhen (a|the|this) battle ends|at the end of (a|the|this) battle/i, null),
  P("Triggers", "t_party", "When an attacking / blocking party is formed", /\bwhen\b[^.]*(attacking|blocking) party is formed/i, null),
  P("Triggers", "t_flipped", "When ... is flipped / turned face-down", /\bwhen\b[^.]*(flipped|turned) face-(down|up)/i, null),
  P("Triggers", "t_zone", "When a card is put into a zone (hand, discard, void)", /\bwhen\b[^.]*(is|are) put into (a|an|its|your|their) (hand|discard pile|deck|void)/i, null),

  // --- Effects -----------------------------------------------------------------------
  P("Effects", "draw", "Draw cards", /\bdraws? (a|\d+|X|that many|[a-z]+) cards?/i, "draw"),
  P("Effects", "discard", "Discard cards", /\bdiscards? (a |\d+ |X |[a-z]+ )?cards?|discards? (it|them|that|those)\b/i, "discard"),
  P("Effects", "discard_random", "Discard at random", /at random/i, "discard random"),
  P("Effects", "destroy", "Destroy", /\bdestroy (it|that|the|a|an|this|all|each|up to)\b/i, "destroy"),
  P("Effects", "inflict", "Inflict damage", /\binflict \S+ damage/i, "damage"),
  P("Effects", "heal", "Remove damage", /remove [^.]*damage|reduce the amount of damage already/i, "heal"),
  P("Effects", "markers", "Add damage markers", /damage markers?/i, "markers"),
  P("Effects", "lose_infl", "Faction loses influence", /faction loses \S+ influence/i, "lose_influence"),
  P("Effects", "gain_infl", "Faction gains influence", /gains? \S+ influence/i, "gain_influence"),
  P("Effects", "search", "Search a deck", /search (your|an opponent's|that player's|their) deck/i, "search"),
  P("Effects", "look", "Look at the top of a deck", /look at (up to )?the top/i, "look"),
  P("Effects", "reveal_top", "Reveal from the top of a deck", /reveal (up to )?the top|reveals? cards from the top/i, "reveal_top"),
  P("Effects", "look_hand", "Look at / reveal a hand", /look at (an opponent's|your opponent's|that player's) hand|reveals? (their|your) hand/i, "reveal_hand"),
  P("Effects", "to_hand", "Return a card to its owner's hand", /into (its|their) owner's hand|into your hand|into their hand/i, "move to: hand"),
  P("Effects", "to_deck", "Put a card on top / bottom of a deck", /on (the )?(top|bottom) of (its owner's|your|their|that player's|an opponent's) deck/i, "move deck_top / deck_bottom"),
  P("Effects", "shuffle_into", "Shuffle a card into a deck", /shuffle [^.]*into (its owner's|your|their|that player's) deck/i, "move deck_shuffle"),
  P("Effects", "into_play", "Put a card into play", /put [^.]*into play/i, "put_into_play"),
  P("Effects", "face_down", "Put into play / flip as a face-down resource", /face-down resource/i, "flip_face_down / put_into_play"),
  P("Effects", "control", "Take control", /take[s]? control/i, "take_control"),
  P("Effects", "control_temp", "Take control this turn (temporary)", /take[s]? control of [^.]* this turn|control [^.]* until/i, null),
  P("Effects", "deplete", "Deplete a card", /\bdeplete (it|that|the|a|an|this|all|each|X|up to)\b/i, "deplete"),
  P("Effects", "restore", "Restore a card", /\brestore (it|that|the|a|an|this|all|each|up to)\b/i, "restore"),
  P("Effects", "tokens", "Put / remove tokens on cards", /\btokens? (on|from) /i, "tokens"),
  P("Effects", "micromajig", "Create Micromajig (or other majig) tokens", /majig tokens? into play|put \S+ \w+majig tokens?/i, null),
  P("Effects", "terminate", "Terminate a card or ability", /\bterminate\b/i, "terminate"),
  P("Effects", "duplicate", "Duplicate a tactic or ability", /\bduplicate\b/i, "duplicate"),
  P("Effects", "play_resource", "Play a resource", /play (a|up to \S+) resources?/i, "play_resource"),
  P("Effects", "detach", "Detach resources from a faction", /detach [^.]*resources?/i, "detach"),
  P("Effects", "attach_effect", "Attach a card to a character", /attach (this card|it|the [^.]*) to/i, "attach"),
  P("Effects", "void", "Remove from the game / put into the void", /remove [^.]*from the game|into the void/i, "void / move to: void"),
  P("Effects", "deploy_free", "Deploy a card for free / from elsewhere", /deploy [^.]*for free|you may deploy (it|the \w+|that \w+)|as though (it was|they were) in your hand/i, "play_card / play_from"),
  P("Effects", "choose_x", "Choose a number for X", /choose a number for [XYZ]/i, "choose_number"),
  P("Effects", "name_card", "Name a card / subtype / icon", /\bname a\b/i, "name"),
  P("Effects", "pay_x", "Pay a variable amount", /pay [^.]*\b[XYZ]\b/i, "pay expression"),
  P("Effects", "copy_text", "Gain another card's rules text", /gains? (all )?(the )?rules text/i, "grant_rules"),
  P("Effects", "no_text", "Treat as having no rules text", /no rules text/i, null),
  P("Effects", "extra_attack", "Attack again / extra attack", /attack again|may attack (an additional|one more)|form (an|another) attacking party/i, null),
  P("Effects", "swap", "Swap / exchange", /\b(swap|exchange)\b/i, null),
  P("Effects", "coin", "Coin flip", /coin|if you win\b/i, null),
  P("Effects", "mill", "Put the top cards of a deck into a discard pile", /put the top \S+ cards? of [^.]*into (their|your|its owner's) discard pile/i, "mill"),
  P("Effects", "reorder", "Put cards back in any order", /put them back in any order/i, "look"),
  P("Effects", "shuffle", "Shuffle a deck", /^shuffle (your|their|that player's) deck\.$/i, "shuffle"),
  P("Effects", "next_cost", "Reduce the next numeric cost", /reduce the next [^.]*numeric cost/i, "create_effect duration next + cost"),
  P("Effects", "opp_may_pay", "An opponent may pay", /(any|an) opponent may pay/i, "may_pay who: opponent"),
  P("Effects", "top_to_bottom", "Put the top card of a deck on the bottom", /put the top card of [^.]*deck on the bottom/i, null),
  P("Effects", "leave_battle", "Remove a character from the battle", /from the battle/i, null),
  P("Effects", "flip_down_effect", "Flip a card face-down under its owner's control", /flip [^.]*face-down under its owner's control/i, "flip_face_down"),
  P("Effects", "steal_resource", "Take control of resources", /control of [^.]*resources?/i, null),

  // --- Continuous effects (modifiers) --------------------------------------------------
  P("Modifiers", "stat_this_turn", "Gains / loses stats this turn", /this turn, [^.]*(gains?|loses?) \S+ (strength|life|speed)|(gains?|loses?) \S+ (strength|life|speed)[^.]* this turn/i, "modify / create_effect stat"),
  P("Modifiers", "stat_static", "Gains / loses stats (continuous)", /(gains?|loses?) \S+ (strength|life|speed|structure)/i, "stat"),
  P("Modifiers", "stat_per", "Stats per token / per card count", /for each/i, "stat with value {count}/{tokens}"),
  P("Modifiers", "gear_bonus", "The attached character gains stats", /the attached character gains? \S+ (strength|life|speed)/i, "gear"),
  P("Modifiers", "while", "While ... (conditional)", /^while\b/i, "while"),
  P("Modifiers", "gains_kw", "Gains a keyword", /gains? (COVERT|TACTICAL|AGGRO|the "?\w+"? (type|subtype))/, "keyword / add_type"),
  P("Modifiers", "loses_kw", "Loses a keyword", /loses? (COVERT|TACTICAL)/, null),
  P("Modifiers", "type_change", "Gains / loses a card type", /(gains?|loses?) the "?(character|item|location|tactic)"? type/i, "add_type / remove_type"),
  P("Modifiers", "cost_mod", "Numeric cost increased / reduced", /(numeric cost|costs?) [^.]*(increased|reduced|more|less)|reduce the numeric cost|pay \S+ more/i, "cost / cost_min"),
  P("Modifiers", "threshold_mod", "Threshold changed", /threshold requirement|ignore [^.]*threshold|without (meeting|having) [^.]*threshold|even if you cannot meet its threshold/i, "threshold_reduce / ignore_threshold"),
  P("Modifiers", "cannot_attack", "Cannot attack / block", /cannot (attack|block)/i, "cannot attack / block"),
  P("Modifiers", "must_attack", "Must attack / must block", /must (attack|block)/i, null),
  P("Modifiers", "cannot_pick", "Cannot be picked", /cannot pick|cannot be picked/i, "cannot pick"),
  P("Modifiers", "must_pick", "Must be picked", /must pick (it|this card)/i, "must_pick"),
  P("Modifiers", "pick_tax", "Must pay to pick", /must pay \S+ to pick/i, "pick_tax"),
  P("Modifiers", "cannot_deploy", "Cards cannot be deployed / played", /cannot be (deployed|played)|cannot (deploy|play)/i, "cannot play"),
  P("Modifiers", "cannot_destroy", "Cannot be destroyed", /cannot be destroyed|can only be destroyed by/i, "cannot destroy_except_cost (partial)"),
  P("Modifiers", "no_abilities", "Abilities cannot be used", /abilities[^.]*cannot be used|cannot use abilities/i, null),
  P("Modifiers", "no_deplete", "Does not deplete (when attacking)", /(does not|doesn't) deplete/i, null),
  P("Modifiers", "no_restore", "Does not restore normally", /cannot be restored|(does not|doesn't) restore/i, "cannot restore_by_rule"),
  P("Modifiers", "enters_depleted", "Enters play depleted", /enters play depleted/i, null),
  P("Modifiers", "enters_tokens", "Enters play with tokens", /enters play with \S+ tokens?/i, "enters_with_tokens"),
  P("Modifiers", "reveal_hand", "Hand revealed", /hand is revealed/i, "reveal_hand"),
  P("Modifiers", "reveal_top", "Top card of a deck revealed at all times", /top card of [^.]*deck is revealed/i, null),
  P("Modifiers", "unblockable", "Cannot be blocked", /cannot be blocked/i, null),
  P("Modifiers", "gain_provides", "Gains PROVIDES", /gains PROVIDES/i, "provides"),
  P("Modifiers", "lose_game", "Changes to losing / winning", /lose the game|win the game|do not lose the game/i, "cannot lose_game / lose_when_deck_empty"),
  P("Modifiers", "opp_abilities", "Use the opponent's abilities", /use abilities on (your opponent's|an opponent's|opponents') cards/i, "use_opponent_abilities"),
  P("Modifiers", "redirect", "Would be put into X, instead Y", /would (be put|go) into [^.]*instead/i, "redirect"),
  P("Modifiers", "replace_destroy", "Would be destroyed, instead", /would be destroyed[^.]*instead|instead[^.]*would be destroyed/i, "replace destroy"),
  P("Modifiers", "replace_damage", "Damage reduced / prevented", /reduce the amount to|damage [^.]*(is )?reduced to|prevent/i, "damage set / delta"),
  P("Modifiers", "replace_other", "Other replacements (instead)", /\binstead\b/i, "partial"),
  P("Modifiers", "influence_mod", "Influence loss increased / reduced", /loses influence, (increase|reduce) the amount/i, "influence_loss"),
  P("Modifiers", "attack_limit", "Can attack only once each turn", /can attack only once/i, "attack_limit"),
  P("Modifiers", "grant_text", "Cards gain rules text", /gain the rules text/i, "grant_rules"),
];

interface Hit {
  card: string;
  clause: string;
}

/** Split printed text into clauses: lines, then sentences, minus reminder text. */
function clauses(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\([^)]*\)/g, "").trim();
    if (!line) continue;
    // Keep labelled lines whole (EXTRA COST:, COST:, FLIP UP: ...), split sentences otherwise.
    const parts = line.split(/(?<=[.!])\s+(?=[A-Z[])/);
    for (const p of parts) if (p.trim()) out.push(p.trim());
  }
  return out;
}

/** Normalise a clause into a template for grouping unrecognised text. */
function template(c: string): string {
  return c
    .replace(/(\[[OGEDRV]\])+/g, "[ICONS]")
    .replace(/"[^"]*"/g, '"Q"')
    .replace(/\bUNIQUE [A-Z][A-Z' -]*/g, "UNIQUE NAME")
    .replace(/\b\d+\b/g, "N");
}

const lib = loadLibrary(join(ROOT, "cards"));
const cards = Object.values(lib).filter((d) => !d.types.includes("faction") || d.text);
const hits = new Map<string, Hit[]>(PATTERNS.map((p) => [p.id, []]));
const perCard = new Map<string, { patterns: Set<string>; unknown: string[] }>();
const unknown = new Map<string, { count: number; cards: Set<string> }>();
// Lines that are just ability names or keyword lists carry no rule of their own.
const isHeader = (c: string) => /^[A-Z0-9][A-Z0-9 '!?.,&-]*$/.test(c) || /^[A-Z0-9][A-Z0-9 '!?.,&-]*: (\[[OGEDRV]\])+$/.test(c) || c === "Staple resource.";

for (const d of cards) {
  const info = { patterns: new Set<string>(), unknown: [] as string[] };
  perCard.set(d.name, info);
  for (const c of clauses(d.text ?? "")) {
    const body = c.replace(/^(EXTRA COST|COST|EFFECT|OPTION \d+|AT LEAST \d+ TOKENS|\d+ TOKENS?):\s*/, "");
    let matched = false;
    for (const p of PATTERNS) {
      if (p.re.test(c) || p.re.test(body)) {
        hits.get(p.id)!.push({ card: d.name, clause: c });
        info.patterns.add(p.id);
        matched = true;
      }
    }
    if (!matched && !isHeader(c) && !/^(EFFECT|COST):?$/.test(c)) {
      info.unknown.push(c);
      const t = template(body);
      const u = unknown.get(t) ?? { count: 0, cards: new Set<string>() };
      u.count++;
      u.cards.add(d.name);
      unknown.set(t, u);
    }
  }
}

// Coverage: does every pattern a card uses exist in the engine?
const byId = new Map(PATTERNS.map((p) => [p.id, p]));
let automated = 0;
let ready = 0;
let needsNew = 0;
let unclear = 0;
const blockers = new Map<string, number>();
for (const d of cards) {
  const info = perCard.get(d.name)!;
  if (d.rules) {
    automated++;
    continue;
  }
  const missing = [...info.patterns].filter((id) => !byId.get(id)!.engine);
  if (missing.length) {
    needsNew++;
    for (const m of missing) blockers.set(m, (blockers.get(m) ?? 0) + 1);
  } else if (info.unknown.length) unclear++;
  else ready++;
}

// ---------------------------------------------------------------------------------
// Report

const cardCount = (id: string) => new Set(hits.get(id)!.map((h) => h.card)).size;
const examples = (id: string) => [...new Set(hits.get(id)!.map((h) => h.card))].slice(0, 3).join(", ");
const lines: string[] = [];
const total = cards.length;
lines.push("# Rule patterns across all cards", "");
lines.push("Generated by `npm run patterns` from the printed text of every card in `cards/`. Matching is");
lines.push("regex-based and approximate: use it as a map for building the keyword engine, not as a parser.", "");
lines.push("## Summary", "");
lines.push(`| | Cards |`, `|---|---|`);
lines.push(`| Cards analysed (with text) | ${total} |`);
lines.push(`| Already automated (have \`rules\`) | ${automated} |`);
lines.push(`| Only use patterns the engine supports: ready to write rules for | ${ready} |`);
lines.push(`| Use at least one pattern the engine doesn't support yet | ${needsNew} |`);
lines.push(`| Use only supported patterns, but have text no pattern recognises | ${unclear} |`);
lines.push("");
lines.push("A card counted as ready still needs its `rules` written; the engine just has every building block it needs.", "");
lines.push("## Missing building blocks, by cards blocked", "");
lines.push("Each card that isn't automated yet and uses a pattern the engine lacks, counted per missing pattern.", "");
lines.push("| Pattern | Cards blocked | Examples |", "|---|---|---|");
for (const [id, n] of [...blockers].sort((a, b) => b[1] - a[1])) lines.push(`| ${byId.get(id)!.label} | ${n} | ${examples(id)} |`);
lines.push("");
for (const cat of [...new Set(PATTERNS.map((p) => p.category))]) {
  lines.push(`## ${cat}`, "", "| Pattern | Cards | Engine | Examples |", "|---|---|---|---|");
  for (const p of PATTERNS.filter((x) => x.category === cat).sort((a, b) => cardCount(b.id) - cardCount(a.id))) {
    lines.push(`| ${p.label} | ${cardCount(p.id)} | ${p.engine ? "`" + p.engine + "`" : "**missing**"} | ${examples(p.id)} |`);
  }
  lines.push("");
}
lines.push("## Unrecognised text, most common templates", "");
lines.push("Clauses no pattern matched, grouped after replacing numbers with N, icon runs with [ICONS] and quoted names with \"Q\". These are the next candidates for patterns.", "");
lines.push("| Times | Template | Example cards |", "|---|---|---|");
for (const [t, u] of [...unknown].sort((a, b) => b[1].count - a[1].count).slice(0, 60)) {
  lines.push(`| ${u.count} | ${t.replace(/\|/g, "\\|")} | ${[...u.cards].slice(0, 3).join(", ")} |`);
}
lines.push("", `${unknown.size} distinct unrecognised templates in total.`, "");
writeFileSync(join(ROOT, "docs/PATTERNS.md"), lines.join("\n"));

const data = {
  summary: { total, automated, ready, needsNew, unclear },
  patterns: PATTERNS.map((p) => ({ id: p.id, category: p.category, label: p.label, engine: p.engine, cards: [...new Set(hits.get(p.id)!.map((h) => h.card))] })),
  cards: Object.fromEntries([...perCard].map(([name, i]) => [name, { patterns: [...i.patterns], unrecognised: i.unknown, automated: !!(lib[Object.keys(lib).find((k) => lib[k].name === name)!] as CardDef).rules }])),
};
writeFileSync(join(ROOT, "docs/patterns.json"), JSON.stringify(data, null, 1) + "\n");
console.log(`Analysed ${total} cards: ${automated} automated, ${ready} ready, ${needsNew} need new building blocks, ${unclear} unclear.`);
console.log(`${unknown.size} unrecognised clause templates. Wrote docs/PATTERNS.md and docs/patterns.json.`);
