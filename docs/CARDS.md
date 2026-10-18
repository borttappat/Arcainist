# The card language

Every card is one YAML file in `cards/`. The server loads and validates them at
startup, so a typo (an unknown instruction, modifier or event) is reported
immediately with the file and path. Restart the server after editing a card.

A card has two parts:

- **Printed data**: name, cost, threshold, type line, stats and the printed `text`.
  The text is only for display.
- **`rules`**: what the engine actually does, written with the building blocks
  below.

A card with no `rules` (or an instruction the engine doesn't know) is still
playable: players use the manual controls, as on Jinteki.

## Contents

1. [Printed data](#1-printed-data)
2. [Rules](#2-rules)
3. [Steps (costs and effects)](#3-steps-costs-and-effects)
4. [Selectors](#4-selectors)
5. [Values and conditions](#5-values-and-conditions)
6. [Modifiers](#6-modifiers)
7. [Events](#7-events)
8. [Scripts](#8-scripts)
9. [Recipes](#9-recipes)
10. [Interpretations and cards to verify](#10-interpretations-and-cards-to-verify)

## 1. Printed data

```yaml
id: fired-hand              # unique, used in code and tests (quote it if it looks like a number)
name: Fired Hand            # what decklists use
flavor_title: '"I''m finished!"'
trade: rogue                # arcanist | banker | gearsmith | rogue | warlord | universal | staple
types: [character]          # character | tactic | item | location | resource | faction
subtypes: [miner]
cost: 6
threshold: { deception: 1 } # obsession | greed | elitism | deception | rage | volition
stats: { str: 5, life: 4, spd: 3 }
text: |
  Printed rules text, shown on hover.
```

Other optional fields:

| Field | Meaning |
|---|---|
| `structure: 4` | Locations. |
| `gear: { str: 2, life: 2, spd: 0 }` | Stat bonus a gear item gives the character it's attached to. |
| `attach_to: character` | "Attach to Character": picking the host is part of the cost. |
| `keywords: [covert, aggro, tactical]` | Built-in keywords (section 6 can grant them too). |
| `staple: true`, `icon: rage` | Staple resources. |
| `provides: { rage: 2 }` | Icons a face-up non-staple resource provides (Violence). |
| `face_down_only: true` | Resource that may only be played face-down. |
| `enters_with_tokens: 3` | Tokens when entering play. A value, so `{ cost: d }` works. |
| `enters_under: opponent` | Hollow Moose. |
| `deck_limit: null` | Any number of copies (Party Clowns). |

Factions also have `influence`, `starting_resources`, `starting_draw`, and
`restore_rule` / `develop_rule`, which are lists of steps run at the start of each
of the owner's turns. See `cards/tournament-faction.yaml`.

## 2. Rules

`rules` is a list. Each entry is one of:

### `play`: costs and effects of deploying the card

```yaml
- play:
    timing: { response_to: { deploying: { character: any } } }   # optional
    cost:   [ ...steps... ]     # COST / EXTRA COST, paid in order, numeric cost last
    effect: [ ...steps... ]     # tactics: their effect; permanents: run after entering play
    then: face_down_resource    # tactic goes into play face-down instead of the discard pile
    no_response: true           # "Your opponent cannot respond to this card."
```

If any cost step fails, the whole deployment is undone. Costs run with the card on
the stack, before the opponent can respond.

`timing` options:

| Timing | Meaning |
|---|---|
| `your_turn: true` | "Play this only during your turn." |
| `after_end_turn: true` | Only after you declared the end of your turn (Lost on Floor 3). |
| `response_to: { deploying: <selector> }` | Only in response to a matching card being deployed. |
| `response_to: { ability: true }` | Only in response to an ability. |
| `response_to: { ability: <selector> }` | Only in response to an ability of a matching card ("a character's ability"). |
| `response_to: { picked_character_as_cost: true }` | Mistaken Identity. |

### `ability`: a named ability

```yaml
- ability:
    name: Recur
    threshold: { greed: 1 }   # icons next to the ability name
    from: discard             # play (default) | face_down_resource | discard | hand | faction
    timing: { your_turn: true }
    cost:   [ pay: 2, void: self ]
    effect: [ draw: 1 ]
```

RECUR is just an ability with `from: discard` whose cost voids the card.

### `trigger`: "if", "when", "at"

```yaml
- trigger: { on: enters_play, card: self }
  effect: [ draw: 1 ]
```

Trigger filters, all optional:

| Filter | Meaning |
|---|---|
| `card: <selector>` | The card the event is about. `self` for "this card". |
| `player: you \| opponent \| any` | Whose event it is ("at the start of your turn"). |
| `source: <selector>` | For `damage` events: what inflicted it. |
| `faction: true` | For `damage` events: damage to a faction. |
| `battle: true` | Battle damage only. |
| `zone: discard` | Where the card must be for the trigger to work (default: in play). |
| `requires: { greed: 2 }` | Threshold icons printed next to the text. |
| `while: <condition>` | Only while the condition holds. |

"When this card is destroyed / leaves play" works: with `card: self` the engine
looks back at the card after it left. Triggers can't be responded to. When
several fire at once, the controller (or the active player, if mixed) orders them.

Inside a trigger, these variables are set: `it` (the event's card), `player`,
`amount`, `source`.

### `static`: continuous effects

```yaml
- static:
    while: { eq: [ { count: { character: { controller: you } } }, 1 ] }   # optional
    requires: { greed: 5 }                                                  # optional icons
    zone: hand                                                              # optional (default play)
    mods: [ { keyword: covert } ]
```

Static rules are only active while the card is face-up in play, or in `zone`.

### `replace`: "instead"

```yaml
- replace: { event: destroy, card: self }
  instead: [ flip_face_down: { card: self, controller: owner } ]
```

| Event | Meaning |
|---|---|
| `destroy` | A matching card would be destroyed. In `instead`, `it` is that card. |
| `faction_damage` | Damage to a faction (`by: you`, `to: opponent`, `label`). The controller chooses how much is replaced. `amount` and `player` are set (Trickster's Globe). |

Zone changes ("would be put into X, put it into Y instead") are the `redirect`
modifier. Damage amount changes are the `damage` modifier.

### Others

```yaml
- unique: Adriel                          # Unique X
- flip_up: { pay: 2, threshold: { rage: 1 }, cost: [ discard: 1 ] }   # FLIP UP
- script: name                            # see section 8
```

## 3. Steps (costs and effects)

A step is a one-key object. In costs, a step that can't be done makes the action
illegal (it's undone). In effects, the engine does as much as it can.

**Who is "you"?** The controller of the card or ability. `as` and `each_player`
change it for the steps inside. Variables (`as: name`) are shared by every step
of the same card resolution, from cost through effect.

### Control flow

| Step | Example | Meaning |
|---|---|---|
| `if` | `if: { cond: <condition>, then: [..], else: [..] }` | |
| `may` | `may: [ ..steps.. ]`, or `may: { steps, else, who, prompt }` | "You may". Sets "did" for "If you do". |
| `may_pay` | `may_pay: { amount: 2, who: opponent, then: [..], else: [..] }` | "You may pay N. If you do…" |
| `choose_one` | `choose_one: { who: opponent, options: [ { label, steps } ] }` | OPTION 1 / OPTION 2. |
| `as` | `as: { who: opponent, steps: [..] }` | Run steps as another player. |
| `each_player` | `each_player: [ ..steps.. ]` | Active player first. |
| `repeat` | `repeat: { times: X, steps: [..] }` | |
| `let` | `let: { X: { cost: c }, who: { card: it }, n: { name_of: m } }` | Set variables. |
| `require` | `require: <condition>` | "Play this only if…". |
| `remember` | `remember: { picked_opponent: true }` | Store a value on the card while it's in play. |

### Paying and choosing

| Step | Example |
|---|---|
| `pay` | `pay: 3`, `pay: "X + X"`, `pay: { cost: c }` |
| `pick` | `pick: { as: c, from: <selector>, count: 2, up_to: true, optional: true, who: opponent, choose: true, random: true, exactly: true, prompt: "…" }` |
| `choose_number` | `choose_number: { as: X, min: 0, max: 5 }` |
| `name` | `name: { as: n, kind: card \| subtype \| icon, not_type: resource, remember: true }` |

`pick` follows the picking rules: "cannot pick", "must pick" and pick taxes all
apply. Use `choose: true` for "choose" wording, which isn't picking. Picks made
while paying costs are recorded for Mistaken Identity.

### Cards

| Step | Example |
|---|---|
| `destroy` | `destroy: c`, `destroy: { card: { subtype: node, not_self: true } }`, `destroy: { from: <selector> }` (pick and destroy) |
| `discard` | `discard: 1`, `discard: { who: opponent, count: 2, random: true, chooser: you, filter: <sel>, cards: d, as: d }` |
| `move` | `move: { card: c, to: hand \| discard \| void \| deck_top \| deck_bottom \| deck_shuffle, tag: true }` |
| `void` | `void: self`, `void: { card: x, face_down: true, tag: true }` |
| `put_into_play` | `put_into_play: { card: c, controller: you \| opponent \| owner, as: face_down_resource \| resource, attach_to: self }` |
| `flip_face_down` | `flip_face_down: { card: c, controller: owner }` |
| `flip_face_up` | `flip_face_up: self` (stays a resource) |
| `take_control` | `take_control: { card: c, who: opponent }` |
| `attach` | `attach: { card: g, to: c }` |
| `deplete` / `restore` | `deplete: self` |
| `reveal` | `reveal: c` |
| `reveal_hand` | `reveal_hand: opponent` |
| `tokens` | `tokens: { card: self, add: 1 }`, `{ remove: 2 }`, `{ remove: all, as: X }`, `{ set: 0 }` |
| `distribute_tokens` | `distribute_tokens: { total: 3, from: <selector> }` |
| `play_card` | `play_card: { card: c, free: true, ignore_threshold: true }` |
| `play_resource` | `play_resource: 1`, `play_resource: { who: opponent, count: 2, optional: true }` |
| `terminate` | `terminate: responded` (the card or ability responded to), `terminate: self` (stop resolving this card) |
| `nullify` | `nullify: responded` ("the ability has no effect") |
| `duplicate` | `duplicate: last_tactic` |
| `cancel_end_turn` | `cancel_end_turn: true` |

### Decks and hands

| Step | Example |
|---|---|
| `draw` | `draw: 2`, `draw: { who: opponent, count: X }` |
| `search` | `search: { deck: you \| opponent, for: <selector>, count: 1 \| any, to: hand \| discard \| play \| void \| deck_top \| keep, reveal: true, attach_to: self, different_names: true, face_down: true, tag: true, as: found }` |
| `look` | `look: { deck: you \| opponent \| choose, count: 3, to_hand: 1, bottom: any \| rest }` (the rest go back on top, in an order the player chooses) |
| `mill` | `mill: { who: opponent, count: 4, to: discard \| hand \| void, face_down: true, tag: true, as: x }` (top N cards) |
| `reveal_top` | `reveal_top: { who: opponent, count: 7, as: rev }` (they stay on the deck) |
| `shuffle` | `shuffle: you` |

### Damage, influence, resources

| Step | Example |
|---|---|
| `damage` | `damage: { card: c, amount: 2 }`, `damage: { faction: opponent, amount: 1 }` |
| `heal` | `heal: { card: l, amount: 2 }`, `heal: { card: it, all: true }` |
| `markers` | `markers: { card: loc, add: 3 }` (damage markers that aren't damage) |
| `lose_influence` / `gain_influence` | `lose_influence: { who: you, amount: 5 }` |
| `detach` | `detach: { count: 9 }` |
| `destroy_resource` | `destroy_resource: { who: opponent, face_down: true }` (that player picks) |
| `restore_all_depleted`, `detach_all_resources` | Faction restore rules. |

### Continuous effects from a resolved card

```yaml
- modify: { card: c, stat: life, lose: 1 }          # "This turn, the character loses 1 life."
- create_effect:
    duration: turn | game | until_your_next_turn | next
    mods: [ <modifier>, ... ]                         # section 6
    rules: [ <trigger or replace rule>, ... ]         # delayed triggers ("at the start of your next turn")
- clear_effects: self                                 # remove effects this card created
```

A modifier `target` that names a variable (`target: c`) is fixed to those cards
when the effect is created. A selector target stays live. `next` effects end
after their first use (1337!, Escrow Office) or at the start of the next turn.
A delayed trigger with `once: true` removes its effect after firing.

## 4. Selectors

Selectors pick out cards. They default to cards **in play**.

```yaml
self                                   # this card
host                                   # the character this card is attached to
responded                              # the card or ability this was played in response to
c                                      # a variable set by pick / search / let
{ character: any }                     # any character in play
{ item: { controller: you } }
{ card: { zone: discard, owner: opponent, not_type: tactic } }
[ { character: { zone: discard } }, { tactic: { zone: discard } } ]   # either
```

Type keys: `character`, `item`, `location`, `tactic`, `resource`, `faction`, or
`card` (any type). Factions only match `faction`. Face-down resources only match
`resource`.

| Filter | Meaning |
|---|---|
| `zone` | `play` (default) \| `hand` \| `deck` \| `discard` \| `void` \| `stack` \| `any` |
| `owner`, `controller` | `you` \| `opponent` |
| `type`, `not_type`, `not_types: [..]`, `printed_type` | `printed_type` ignores face-down status |
| `subtype` | `gear`, or a variable holding a named subtype |
| `trade`, `name`, `name_not` | `name` can be a variable holding a named card |
| `cost_lte`, `cost_gte` | Numeric cost, any value |
| `face_down`, `depleted`, `staple` | true / false |
| `not_self`, `not: c`, `among: list` | |
| `host_of: self` | The character this card is attached to |
| `attached_to: self` | Cards attached to this one |
| `tagged_by: self` | Cards this card put where they are (`tag: true`) |
| `attacking`, `blocking` | In the current battle |
| `provides_at_least: { deception: 1 }` | Resource icons it provides |

## 5. Values and conditions

**Values** are numbers, expressions over variables (`"X + X"`, `"2 * X"`,
`"Y - X"`, `"-max(0, printed.life - 2)"`), or objects:

| Value | Meaning |
|---|---|
| `{ count: <selector> }` | Number of matching cards |
| `{ tokens: self }` | Tokens on a card |
| `{ stat: [ c, str ] }` | A card's current stat |
| `{ cost: c }` | Numeric cost |
| `{ icons: greed }` | Your icon count |
| `{ different_staples: you }` | Different staple resources you control |
| `{ hand_size: opponent }` | |
| `{ len: list }` | Size of a list variable |
| `{ half_up: <value> }`, `{ sum: [..] }`, `{ neg: <value> }` | |
| `{ played_this_turn: { by: you, type: tactic, not_type: resource } }` | Cards played this turn |
| `{ last_played_cost: { type: tactic } }` | Ectypal Stave |

Inside a stat modifier, `printed.str`, `printed.life` and so on are the affected
card's printed stats.

**Conditions**:

| Condition | Meaning |
|---|---|
| `{ icons: { obsession: 3 } }` | "If you control [O][O][O]" |
| `{ did: true }` | The last optional step happened ("If you do") |
| `{ defined: c }` | A pick found something |
| `{ eq \| gt \| gte \| lt \| lte: [a, b] }` | Compare values |
| `{ in_play: c }`, `{ destroyed: c }`, `{ in_zone: [c, void] }` | Where a card is |
| `{ matches: [c, <selector>] }`, `{ exists: <selector> }` | |
| `{ via: flip_up }` | "If you deployed this using FLIP UP" |
| `{ your_turn: true }`, `{ attacking: self }`, `{ blocking: self }` | |
| `{ all: [..] }`, `{ any: [..] }`, `{ not: .. }` | |

## 6. Modifiers

Modifiers are continuous effects. They appear in `static` rules and
`create_effect`. Each is one key plus optional `target` (a selector, default
`self`; `all` for everything), `by` (whose actions it affects: `you`, `opponent`,
`any`) and `while` (a condition).

| Modifier | Example | Meaning |
|---|---|---|
| `stat` | `{ stat: { str: 2, life: { tokens: self } } }` | Gain (or lose, if negative) stats. |
| `set_stats` | `{ set_stats: { str: 3, life: 3, spd: 3 } }` | |
| `add_type`, `remove_type` | `{ add_type: character }` | |
| `keyword` | `{ keyword: covert }` | |
| `provides` | `{ provides: { obsession: 2 } }` | Icons for threshold (Crest). |
| `player_icons` | `{ player_icons: { elitism: 4 }, target: none }` | Icons not tied to a card (31337!). |
| `cost` | `{ cost: -4, by: you, target: { card: { zone: stack } } }` | Cost increase or reduction. `applies: any` also covers ability costs. |
| `cost_min` | `{ cost_min: 3, by: opponent, target: { tactic: { zone: stack } } }` | Canny Bailiff. |
| `threshold_reduce` | `{ threshold_reduce: 3 }` | Ignore that many missing icons. |
| `cannot` | `{ cannot: play \| pick \| attack \| block \| restore_by_rule \| lose_game \| destroy_except_cost }` | Prohibitions. "Cannot" beats "can". |
| `must_pick` | `{ must_pick: true }` | Ferrous Ferret. |
| `pick_tax` | `{ pick_tax: 1, by: opponent, target: { character: { controller: you } } }` | Lucky Charm. |
| `play_from` | `{ play_from: { ignore_threshold: true }, target: { card: { zone: void, tagged_by: self } } }` | Play cards from other zones. |
| `tactical` | `{ tactical: true }` | May be played whenever a tactic could. |
| `grant_rules` | `{ grant_rules: [ <rules> ], target: { character: any } }` | Lodge Dock Florist. |
| `damage` | `{ damage: { set: 0, battle: true }, while: { blocking: self } }` | Change damage taken. |
| `influence_loss` | `{ influence_loss: { player: opponent, delta: 1 }, target: all }` | Gideon. |
| `attack_limit` | `{ attack_limit: 1 }` | "Can attack only once each turn." |
| `redirect` | `{ redirect: { from: play, to: discard, instead: hand } }` | "Would go to X; instead Y". |
| `reveal_hand` | `{ reveal_hand: opponent, target: none }` | Odious Diva. |
| `use_opponent_abilities` | `{ use_opponent_abilities: true }` | The Billionaire. |
| `lose_when_deck_empty` | `{ lose_when_deck_empty: true }` | Trickster's Globe. |

Derived values are recomputed from scratch, so modifiers switch on and off by
themselves when their source leaves play or their condition changes. Increases
apply before reductions, and numbers never go below 0.

## 7. Events

`played`, `ability_used`, `enters_play`, `leaves_play`, `destroyed`, `attacks`,
`blocks`, `blocked` (each attacker, when blockers are declared), `damage`,
`influence_lost`, `start_of_turn`, `end_of_turn`, `draw`, `picked`, `discarded`.

Resources entering play fire `enters_play` too, which is how "When a card that
provides at least [D] enters play under your control" works:

```yaml
- trigger: { on: enters_play, card: { controller: you, provides_at_least: { deception: 1 } } }
```

## 8. Scripts

When a card doesn't fit the language, write a small TypeScript function in
`engine/scripts.ts` and call it with `- script: name`. Current scripts:
`auction_house`, `mistaken_identity`, `skin_suit`, `spatchcocking`,
`spatchcocking_recur`, `voidal_poisoning`. If a pattern shows up on several cards,
move it into the language instead.

## 9. Recipes

**A character with an "enters play" search:**

```yaml
- trigger: { on: enters_play, card: self }
  effect:
    - may:
        - search: { deck: you, for: { card: { subtype: node } }, reveal: true, to: hand }
```

**A counter tactic:**

```yaml
- play:
    timing: { response_to: { deploying: { character: any } } }
    effect: [ terminate: responded ]
```

**X costs:**

```yaml
- play:
    cost: [ choose_number: { as: X }, pay: "X + X" ]
    effect: [ draw: "X + 1" ]
```

**"For the rest of the game you may play the removed cards":**

```yaml
- mill: { who: opponent, count: 4, to: void, face_down: true, tag: true }
- create_effect:
    duration: game
    mods: [ { play_from: { ignore_threshold: true }, target: { card: { zone: void, tagged_by: self } } } ]
```

**Testing a new card:** add a scenario to `engine/test/cards.test.ts` (see the
existing ones), then run `npm test`. The fuzz test plays random games with every
card and catches engine crashes.

## 10. Interpretations and cards to verify

**Hard to read on the scans:** please check these against the real cards.

| Card | What to check |
|---|---|
| 31337! | Number of Elitism icons it grants this turn (implemented as 4). |
| Rudo Mangod, Fightful Adonis | Stats (implemented as 1/3/3) and threshold (4 Rage). |
| Unexpected Transformation | Threshold (implemented as 4 Deception). |

**Interpretations:** these are places where the printed text left room, and the
reading implemented.

| Card | Implemented as |
|---|---|
| Trickster's Globe | The controller chooses how many points of the damage become milled cards instead (0 to all). |
| Ecto-Conduit (Harness) | The voided tactic may be deployed immediately, not later. |
| Eldridge Gosche | Up to 3 tokens divided among any of your non-resource cards. |
| Cantankerous Claywork | "All your other characters" includes characters entering later that turn. |
| Auction House | If nobody bids, the character is shuffled back with the other revealed cards. |
| Mistaken Identity | Doesn't check that the new character was a legal pick for the original card. |
| Free Trade Agreement (option 3) | Each player chooses how many cards (0 to 2) to draw. |
| Meat of the Mountain | "Remove a token" at 0 tokens still counts as acting and triggers the 0-token effect. |
| One-Legged Hopping Pogo-Bear | HIDE! also removes Covert gained from SCHPROING!. |
| Hidden Sandwich | Protects the host from any destruction, including costs. |
| Quotidian Misfire | Also catches cards returned to hand by effects. |
| Two-Headed Coin | Not automated: coins are only flipped at setup. |
| Lost on Floor 3 | Playable whenever you have priority after declaring the end of your turn. |
