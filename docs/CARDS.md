# The card language

Every card is two files in `cards/` with the same name:

- **`<id>.json`: the numbers.** Cost, threshold, stats, structure, gear bonus,
  provided icons, and for factions influence and starting resources and draw. This
  is the file to edit when rebalancing.
- **`<id>.yaml`: everything else.** Name, type line, printed `text` (display only)
  and `rules`, the behaviour, written with the building blocks below.

The server loads and validates both at startup, so a typo (an unknown instruction,
modifier, event or number key, a number left in the YAML, a missing JSON file) is
reported immediately with the file and path. Restart the server after editing a
card.

A card with no `rules` (or an instruction the engine doesn't know) is still
playable: players use the manual controls, as on Jinteki. `rules: []` marks a card
whose text needs no automation (Crow With Fists' deckbuilding rule).

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

`cards/fired-hand.json`, the numbers:

```json
{
  "cost": 6,
  "threshold": { "deception": 1 },
  "stats": { "str": 5, "life": 4, "spd": 3 }
}
```

| Key | Meaning |
|---|---|
| `cost` | Cost number. |
| `threshold` | Icons: `obsession`, `greed`, `elitism`, `deception`, `rage`, `volition`. |
| `stats` | `str`, `life`, `spd` (characters). |
| `structure` | Locations. |
| `gear` | `str`, `life`, `spd` bonus a gear item gives the character it's attached to. |
| `provides` | Icons a face-up non-staple resource provides (Violence: `{ "rage": 2 }`), or a permanent with PROVIDES (the Banners). |
| `influence`, `starting_draw` | Factions: `{ "first": 8, "second": 9 }`. |
| `starting_resources` | Factions, any combination of: `specific: { "rage": 2 }` (these staples), `face_down: { "obsession": 1 }`, `any_staples: N`, `different_staples: N`, `any_resources: N` (non-staple too), `any_cards_face_down: N`, `choose_staples: 10` (choose X from 1 to 10, then X staples). |

Every value is a whole number of 0 or more. A card with no numbers (a staple)
still has a JSON file, containing `{}`. Numbers written inside `rules` ("Pay 3",
"draw 2") stay in the YAML, because they're part of the effect.

`cards/fired-hand.yaml`, everything else:

```yaml
id: fired-hand              # unique, used in code and tests (quote it if it looks like a number)
name: Fired Hand            # what decklists use
flavor_title: '"I''m finished!"'
trade: rogue                # arcanist | banker | gearsmith | rogue | warlord | universal | staple
types: [character]          # character | tactic | item | location | resource | faction
subtypes: [miner]
text: |
  Printed rules text, shown on hover.
rules: [ ... ]
```

Other optional YAML fields:

| Field | Meaning |
|---|---|
| `attach_to: character` | "Attach to Character": picking the host is part of the cost. A selector also works: `attach_to: { character: { controller: you } }`. `attach_to: item` for "Attach to Item" (iDumb De-Itemizer); the card is destroyed when its host stops being that type. A tactic with `attach_to` (the God's Blessings) stays in play attached instead of going to the discard pile. |
| `keywords: [covert, aggro, tactical]` | Built-in keywords (section 6 can grant them too). |
| `staple: true`, `icon: rage` | Staple resources. |
| `face_down_only: true` | Resource that may only be played face-down. |
| `enters_with_tokens: 3` | Tokens when entering play. A value, so `{ cost: d }` works. |
| `enters_under: opponent` | Hollow Moose. |
| `deck_limit: null` | Any number of copies (Party Clowns). |

Factions also have `restore_rule` / `develop_rule` in YAML: lists of steps run at
the start of each of the owner's turns (an empty list means none). Other faction
fields:

| Field | Meaning |
|---|---|
| `opponent_rules: { starting_draw: this, develop_rule: none }` | The Knitting Coalition: the opponent uses this faction's starting draw and has no develop rule. |
| `opponent_rules: { equalize_starting_resources: true }` | Money for Nothing: the opponent gets staples until both have as many starting resources. |
| `back_of: imperial-army` | The back side of a double-sided faction; not allowed in decklists. |
| `incomplete: true`, `incomplete_reason` | Not playable (the Showdown multiplayer factions). |

Abilities with `both_players: true` can be used by either player ("Both players may use
this ability", "Any player may use this ability"), on factions and on any card in play;
the player using it is "you". A faction's extra starting-draw steps
(Unlikely Heroes' search) go in YAML as `starting_draw: { before: [ ... ] }`; the
draw counts are in the JSON. See `cards/tournament-faction.*`.

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
| `opponent_turn: true` | "Deploy this only during an opponent's turn" (Counter Attack). |
| `after_end_turn: true` | Only after you declared the end of your turn (Lost on Floor 3). |
| `response_to: { deploying: <selector> }` | Only in response to a matching card being deployed. Add `via: flip_up` for "a card being deployed using FLIP UP". |
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
`once_per_turn: true` limits it to one use each turn; `uses_per_turn: 5` to that many
("Use this only 5 times each turn", Vast Mastabatorium).
`both_players: true` lets either player use the ability; `both_players: opponent`
means only an opponent may use it (iDumb De-Itemizer).

### `trigger`: "if", "when", "at"

```yaml
- trigger: { on: enters_play, card: self }
  effect: [ draw: 1 ]
```

Trigger filters, all optional:

| Filter | Meaning |
|---|---|
| `card: <selector>` | The card the event is about. `self` for "this card". |
| `had_tokens: true` | For `leaves_play`: the card had a token on it when it left. |
| `by: opponent \| you` | For `destroyed`: whose card or rule destroyed it ("destroyed by an opposing card"; destruction by damage counts the damaging card's controller). |
| `player: you \| opponent \| any` | Whose event it is ("at the start of your turn"). |
| `source: <selector>` | For `damage` events: what inflicted it. |
| `faction: true` | For `damage` events: damage to a faction. |
| `battle: true` | Battle damage only. On `destroyed` (and destroy replacements): destroyed by battle damage, the last damage it took being from a battle's damage step. |
| `zone: discard` | Where the card must be for the trigger to work (default: in play). |
| `requires: { greed: 2 }` | Threshold icons printed next to the text. |
| `deployed_from: hand` | For `enters_play`: the card was deployed (not put into play by an effect) from that zone ("if it was deployed from your hand"). |
| `while: <condition>` | Only while the condition holds. |

"When this card is destroyed / leaves play" works: with `card: self` the engine
looks back at the card after it left. "When the attached character leaves play"
(`on: leaves_play, card: host`) works the same way, although the attachment leaves
with it (Key to the City). Triggers can't be responded to. When
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

Static rules are only active while the card is face-up in play, or in `zone` (`hand`,
`stack` for a card reducing its own cost while it is being deployed, or `any` for
"from anywhere", which still excludes face-down cards).

### `replace`: "instead"

```yaml
- replace: { event: destroy, card: self }
  instead: [ flip_face_down: { card: self, controller: owner } ]
```

| Event | Meaning |
|---|---|
| `destroy` | A matching card would be destroyed. In `instead`, `it` is that card. |
| `tactic_to_discard` | A tactic you deployed would go to the discard pile (`by: you`); `it` is the tactic. If the `instead` steps don't move it, it goes to the discard pile as normal (Thabbash). |
| `faction_damage` | Damage to a faction (`by: you`, `to: opponent`, `label`). The controller chooses how much is replaced. `amount` and `player` are set (Trickster's Globe). |
| `discard` | A card would be discarded from a hand (Arcane Escrow: "if you would discard a card, you may put it in the void face-down instead"). |
| `to_hand` | A card would be put into a hand from play (Geiseric: "if a character would be put into an opponent's hand from play, you may pay 1"). Tokens are skipped; they go to the void anyway. |
| `to_void` | A card would be removed from the game (put into the void) from play (Goutflame Talonclaw). Tokens are skipped. |
| `enter_play` | A card would enter play: deployed, or put into play by an effect (Phantasmagoric Tollbooth). When a deployed card doesn't enter, the rest of its effect is skipped. |
| `develop_draw` | Each card the Develop Rule would draw may instead be a card matching `choose_from`, put into its owner's hand; the player picks card by card (Arcane Escrow, `choose_from: { card: { zone: void, tagged_by: self } }`). No `instead`. |

`discard`, `to_hand`, `to_void` and `enter_play` share these fields (plus `always: true` for a replacement that isn't optional, so nobody is asked): `card` (a selector for the
card), `player` (whom it happens to: the discarding player, the owner of the card going
to hand, or the player it would enter play under; `you` or `opponent`), `requires`
(icons), `who` (who decides; default the replacing card's controller; `player` names
the player it happens to), `prompt`, and one of:

- nothing, or `pay: N`: optional, offered only when that player can pay; "yes" pays and
  replaces;
- `unless_pay: N`: it happens unless that player pays ("they may pay 1. If they don't,
  put that character into its owner's discard pile instead"); when they can't pay, it
  happens without asking.

A replacement with `cause: damage` only applies when the card would be destroyed by damage (`cost`, `effect` and `rule` are the other causes). A replacement with `while: <condition>` only applies while it holds ("If there are no
tokens on this card and it would be destroyed"). A replacement runs to the end before
the same card can be destroyed again. A `destroy` replacement with `optional: true` ("its owner may ... instead") asks the
destroyed card's owner first, with `prompt` as the question; on "no" the card is
destroyed as normal (Adriel, Supreme General). With `pay: N` ("you may pay 1 to flip it
face-down instead") it is only offered when the owner can pay, and "yes" pays it
(Node-in-a-Box). With `who: opponent` the opponent decides, and pays (Unloyal Necromorph: "any
opponent may pay 2. If they do, that player takes control of this card instead").

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
of the same card resolution, from cost through effect. "Pick a player" is written as
picking their faction (`pick: { as: f, from: { faction: any }, choose: true }`), and
`{ controller_of: f }` then names that player wherever a player is expected
(`who`, `discard: { who: ... }`, `lose_influence: { who: ... }`). `{ owner_of: c }` names a
card's owner ("the attached item's owner takes control of the item").

### Control flow

| Step | Example | Meaning |
|---|---|---|
| `if` | `if: { cond: <condition>, then: [..], else: [..] }` | |
| `may` | `may: [ ..steps.. ]`, or `may: { steps, else, who, prompt }` | "You may". Sets "did" for "If you do". |
| `may_pay` | `may_pay: { amount: 2, who: opponent, then: [..], else: [..] }` | "You may pay N. If you do…" |
| `choose_one` | `choose_one: { who: opponent, options: [ { label, steps, when } ] }` | OPTION 1 / OPTION 2. An option with `when: <condition>` is only offered while it holds. |
| `as` | `as: { who: opponent, steps: [..] }` | Run steps as another player. |
| `each_player` | `each_player: [ ..steps.. ]` | Active player first. |
| `repeat` | `repeat: { times: X, steps: [..] }`, `repeat: { while: <condition>, steps: [..] }` | `while` checks before each pass ("repeat this cost until you or that player does not pay"). |
| `let` | `let: { X: { cost: c }, who: { card: it }, n: { name_of: m }, others: { cards: <selector> } }` | Set variables. `cards` keeps the list of cards matching now ("they cannot be restored": the characters it depleted, not later ones). |
| `require` | `require: <condition>` | "Play this only if…". |
| `remember` | `remember: { picked_opponent: true }`, `remember: { picked: { var: t } }` | Store a value (or a variable's value) on the card while it's in play; its static rules can use it. |

### Paying and choosing

| Step | Example |
|---|---|
| `pay` | `pay: 3`, `pay: "X + X"`, `pay: { cost: c }` |
| `pick` | `pick: { as: c, from: <selector>, count: 2, up_to: true, optional: true, who: opponent, choose: true, random: true, exactly: true, prompt: "…" }` |
| `choose_number` | `choose_number: { as: X, min: 0, max: 5 }` |
| `name` | `name: { as: n, kind: card \| subtype \| icon \| trade, not_type: resource, remember: true }` |

`different_trades: true` on `pick` requires the picked cards not to share a trade.
`like: responded` (instead of `from`) offers the characters the card or ability being
responded to could have picked as a cost, other than the one it picked (Mistaken Identity).
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
| `put_into_play` | `put_into_play: { card: c, controller: you \| opponent \| owner, as: face_down_resource \| resource, attach_to: self, attached: true }` (`attached`: a resource enters attached to the faction) |
| `flip_face_down` | `flip_face_down: { card: c, controller: owner \| you \| opponent }` (`opponent`: its controller's opponent) |
| `flip_face_up` | `flip_face_up: self` (stays a resource) |
| `take_control` | `take_control: { card: c, who: opponent }` |
| `attach` | `attach: { card: g, to: c }` |
| `deplete` / `restore` | `deplete: self`, `deplete: d` (a list), `deplete: { character: { not_trade: rogue } }` (all matching). As a cost it fails if any can't be depleted; as an effect it depletes those it can. |
| `reveal` | `reveal: c` |
| `reveal_hand` | `reveal_hand: opponent` |
| `tokens` | `tokens: { card: self, add: 1 }`, `{ remove: 2 }`, `{ remove: all, as: X }`, `{ set: 0 }` |
| `distribute_tokens` | `distribute_tokens: { total: 3, from: <selector> }` |
| `play_card` | `play_card: { card: c, free: true, ignore_threshold: true }` |
| `play_resource` | `play_resource: 1`, `play_resource: { who: opponent, count: 2, optional: true }`; `face_down: true`: "play a card as a face-down resource" |
| `attach_resource` | `attach_resource: r`: attach that resource to its controller's faction (Swindle) |
| `terminate` | `terminate: responded` (the card or ability responded to), `terminate: { card: responded, to: hand }` (into its owner's hand instead of the discard pile), `terminate: self` (stop resolving this card), `terminate: all` (every other unresolved card and ability) |
| `nullify` | `nullify: responded` ("the ability has no effect") |
| `duplicate` | `duplicate: last_tactic`, `duplicate: responded` (the tactic this card responds to) |
| `cancel_end_turn` | `cancel_end_turn: true` |
| `coin_flip` | `coin_flip: { as: won }`, then `if: { cond: { did: true } ... }`. Two-Headed Coin (`coin_reflip`) is offered automatically. |
| `transform` | `transform: counter-imperial-army` (turn a double-sided faction over) |
| `retarget_attack` | `retarget_attack: l` (the current attack now targets that location of the defender) |
| `peek` | `peek: { who: opponent, hand: true, top: 2, face_down: true }`: "look at" hidden cards; only the looking player sees them in the log |
| `attack` | `attack: { then: [ draw: 1 ] }`: "attack that player" (Counter Attack). You choose a target and the attacking party now, even during an opponent's turn and with cards on the stack; that battle is resolved before anything below it, then `then` runs. Choosing no attackers skips the attack. The window the attack interrupted (such as the end of turn) comes back afterwards. |
| `use_ability` | `use_ability: { card: c, twice: true, optional: true }`: "you may use one of the card's abilities" (Notion Sickness). Costs are paid as usual and it goes on the stack; timing restrictions are ignored, thresholds and per-turn limits are not. `twice`: its effect happens twice. |
| `steal_deploy` | `steal_deploy: responded`: the card being deployed enters play under your control (Forced Recruitment) |

### Decks and hands

| Step | Example |
|---|---|
| `draw` | `draw: 2`, `draw: { who: opponent, count: X }` |
| `search` | `search: { deck: you \| opponent, for: <selector>, count: 1 \| any, to: hand \| discard \| play \| void \| deck_top \| keep, reveal: true, attach_to: self, different_names: true, face_down: true, tag: true, as: found }` |
| `look` | `look: { deck: you \| opponent \| choose, count: 3, to_hand: 1, bottom: any \| rest \| 1 }` (a number: exactly that many go to the bottom; the rest go back on top, in an order the player chooses). `keep_top: 1`: "you may put one of those cards on the top of your deck; put the rest on the bottom" |
| `mill` | `mill: { who: opponent, count: 4, to: discard \| hand \| void, face_down: true, tag: true, as: x }` (top N cards) |
| `reveal_top` | `reveal_top: { who: opponent, count: 7, as: rev }` (they stay on the deck) |
| `shuffle` | `shuffle: you` |

### Damage, influence, resources

| Step | Example |
|---|---|
| `damage` | `damage: { card: c, amount: 2 }`, `damage: { faction: opponent, amount: 1 }` |
| `divide_damage` | `divide_damage: { amount: X, from: { character: { attacking: true } } }` ("X damage divided however you want"); `up_to: true` for "up to X" |
| `heal` | `heal: { card: l, amount: 2 }`, `heal: { card: it, all: true }` |
| `markers` | `markers: { card: loc, add: 3 }` (damage markers that aren't damage) |
| `lose_influence` / `gain_influence` | `lose_influence: { who: you, amount: 5 }` |
| `detach` | `detach: { count: 9 }`, or specific resources: `detach: { card: r }` |
| `destroy_resource` | `destroy_resource: { who: opponent, face_down: true }` (that player picks) |
| `restore_all_depleted`, `detach_all_resources` | Faction restore rules. |

### Continuous effects from a resolved card

```yaml
- modify: { card: c, stat: life, lose: 1 }          # "This turn, the character loses 1 life."
- create_effect:
    duration: turn | game | until_your_next_turn | next | battle | next_restore
    # battle: "during this battle"; next_restore: until the RESTORE RULE of `who`
    # (default you) has run once ("does not restore during its controller's next RESTORE RULE")
    mods: [ <modifier>, ... ]                         # section 6
    rules: [ <trigger or replace rule>, ... ]         # delayed triggers ("at the start of your next turn")
- clear_effects: self                                 # remove effects this card created
```

A modifier `target` that names a variable (`target: c`) is fixed to those cards
when the effect is created. A selector target changing cards' characteristics
(`stat`, `set_stats`, `add_type`, `remove_type`, `keyword`) is also fixed to the
cards matching now: "this turn, all your characters gain 1 strength" doesn't reach
characters that arrive later. Add `live: true` to a modifier to keep it live. Other
selector targets (costs, prohibitions, play permissions) always stay live.

`create_effect` takes a `tag`, and `clear_effects: { tag: form }` removes only the
card's effects with that tag (`clear_effects: self` removes all of them). `next` effects end
after their first use (1337!, Escrow Office) or at the start of the next turn.
A delayed trigger with `once: true` removes its effect after firing. A `next` effect with a
`damage` modifier is used up by the first damage it changes ("reduce the next damage
inflicted to this card this turn by 1").

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
| `unique` | `true`: a UNIQUE keyword in its text; a name (`unique: Jo`): that UNIQUE line |
| `not_subtype`, `not_trade` | |
| `token` | `token: false`: not a token (non-"micromajig") |
| `str_gte` | Strength at least (current in play, printed elsewhere) |
| `strongest` | The character with the highest strength in play; `strongest: controller`: the highest among its controller's characters |
| `costliest` | The character with the highest numeric cost its controller controls |
| `cheapest` | The character with the lowest numeric cost its controller controls; `cheapest: all`: the lowest among all characters in play |
| `keyword` | `keyword: covert`: has the keyword now |
| `equipped` | Has an item attached |
| `text_has` | `text_has: "[V]"`: the printed text contains it |
| `damaged_faction` | `damaged_faction: you`: inflicted damage to that player's faction this turn |
| `damaged_by` | `damaged_by: self`: this card inflicted damage to it this turn |
| `damaged_this_turn` | true / false: it received damage this turn |
| `spent` | A resource attached to its faction |
| `has_tokens` | true / false |
| `type`, `not_type`, `not_types: [..]`, `printed_type` | `printed_type` ignores face-down status |
| `subtype` | `gear`, or a variable holding a named subtype |
| `trade`, `name`, `name_not` | `name` can be a variable holding a named card |
| `name_not_among: <selector>` | No other card matching the selector has its name ("a resource with a name you don't control") |
| `cost_lte`, `cost_gte` | Numeric cost, any value |
| `str_lte`, `life_lte`, `spd_lte` | Current strength, life or speed in play, printed values elsewhere |
| `top` | `top: 8`: among the top 8 cards of a deck ("look at the top 8 cards") |
| `trade_not_among: <selector>` | Doesn't share a trade with any card matching the selector |
| `face_down`, `depleted`, `staple` | true / false |
| `not_self`, `not: c`, `not: [x, y]`, `among: list` | |
| `host_of: self` | The character this card is attached to |
| `host` (a reference) | The card this card is attached to; after this card left play, the card it was attached to then |
| `attached_to: self` | Cards attached to this one |
| `tagged_by: self` | Cards this card put where they are (`tag: true`) |
| `has_ability` | true / false: it has an ability (Notion Sickness: "a card you control with an ability in its rules text") |
| `attacking`, `blocking` | In the current battle |
| `party_with: self` | In the same party as that card in the current battle (itself included) |
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
| `{ different_trades: you }` | Different trades among face-up cards you control, staple resources included (Wary Reunion) |
| `{ hand_size: opponent }` | |
| `{ printed: [ c, str ] }` | A card's printed stat |
| `{ last_known: [ c, str ] }` | Its current stat in play; after it left play, the stat it had (modifiers included) as it left. For "when destroyed, X is its strength". |
| `{ threshold: c }` | Total icons in a card's threshold |
| `{ influence: you }` | A player's influence |
| `{ len: list }` | Size of a list variable |
| `{ half_up: <value> }`, `{ sum: [..] }`, `{ neg: <value> }`, `{ max: [..] }` | |
| `{ max_stat: [ <selector>, spd ] }` | The highest stat among matching cards (0 if none) |
| `{ total_str: <selector> }` | Total strength of matching cards ("the total strength of the opposing party") |
| `{ total_cost: <selector> }` | Total numeric cost of matching cards (Reality Shift) |
| `{ played_this_turn: { by: you, type: tactic, not_type: resource } }` | Cards played this turn; with `same_name: true`, the most played with one name |
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
| `{ your_turn: true }`, `{ attacking: self }`, `{ blocking: self }`, `{ in_battle: true }` | "While you are being attacked": `{ all: [ { in_battle: true }, { your_turn: false } ] }` |
| `{ assigned_damage: self }` | The card assigned battle damage this turn |
| `{ attacked_this_turn: self }` | The card attacked this turn |
| `{ battle_damage: false }` | No damage has been assigned yet in the current battle |
| `{ even: { hand_size: you } }` | The value is even |
| `{ covert_party: true }` | The attacking party in the current battle is COVERT |
| `{ since_turn_start: self }` | The card has been in play under its controller since the start of the turn |
| `{ attack_target: faction }` | The current attack targets the defender's faction (or a named location) |
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
| `provides` | `{ provides: { obsession: 2 } }` | Icons for threshold (Crest). On a face-down resource it adds only icons it doesn't already provide (Thabbashite Chemist). |
| `player_icons` | `{ player_icons: { elitism: 4 }, target: none }` | Icons not tied to a card (31337!). |
| `cost` | `{ cost: -4, by: you, target: { card: { zone: stack } } }` | Cost increase or reduction. `applies: any` also covers ability costs (the target is the ability's card); `applies: ability` only abilities; `applies: flip_up` only deploys using FLIP UP. `floor: 1`: "to a minimum of 1". |
| `cost_min` | `{ cost_min: 3, by: opponent, target: { tactic: { zone: stack } } }` | Canny Bailiff. |
| `threshold_reduce` | `{ threshold_reduce: 3 }`, `{ threshold_reduce: { icon: I, amount: 1 }, by: you, target: all }` | Ignore that many missing icons, or that many of a named icon (`I` from `name: { as: I, kind: icon }`). In a `next` effect it is used up by the next card that player deploys (Clockman Skydocks). |
| `cannot` | `{ cannot: play \| pick \| attack \| block \| restore \| restore_by_rule \| draw \| take_control \| lose_game \| destroy_except_cost \| attack_faction \| flip_up \| destroy }` | Prohibitions. "Cannot" beats "can". `{ cannot: { action: pick, unless: { item: any } } }` exempts sources matching `unless` ("cannot be picked by non-item cards"); `from` limits it to matching sources (`{ cannot: { action: destroy, from: { card: { subtype: node, zone: any } } } }`, "cannot be destroyed by the effects of node cards"). |
| `must_pick` | `{ must_pick: true }` | Ferrous Ferret. |
| `pick_tax` | `{ pick_tax: 1, by: opponent, target: { character: { controller: you } } }` | Lucky Charm. |
| `play_from` | `{ play_from: { ignore_threshold: true }, target: { card: { zone: void, tagged_by: self } } }` | Play cards from other zones. |
| `tactical` | `{ tactical: true }` | May be played whenever a tactic could. |
| `grant_rules` | `{ grant_rules: [ <rules> ], target: { character: any } }` | Lodge Dock Florist. Granted triggers, abilities and static rules all work; "you" is the target's controller. |
| `damage` | `{ damage: { set: 0, battle: true }, while: { blocking: self } }` | Change damage taken. `over: 4` only changes amounts greater than 4; `from: <selector>` only damage from matching sources. |
| `influence_loss` | `{ influence_loss: { player: opponent, delta: 1 }, target: all }` | Gideon. |
| `attack_limit` | `{ attack_limit: 1 }` | "Can attack only once each turn." |
| `redirect` | `{ redirect: { from: play, to: discard, instead: hand } }` | "Would go to X; instead Y". Without `to`, any zone ("if it would leave play, remove it from the game instead"). `instead: deck_shuffle` shuffles it into its owner's deck; `instead: stay` stops the move ("cannot be put into your opponents' hands"). |
| `reveal_hand` | `{ reveal_hand: opponent, target: none }` | Odious Diva. |
| `use_opponent_abilities` | `{ use_opponent_abilities: true }` | The Billionaire. |
| `lose_when_deck_empty` | `{ lose_when_deck_empty: true }` | Trickster's Globe. |
| `redirect_damage` | `{ redirect_damage: { to: self, amount: 1 }, target: c }` | Damage to the target is inflicted to `to` instead (all of it, or the first `amount`; a `next` effect ends after one use). |
| `covert_blockable` | `{ covert_blockable: true, target: all }` | COVERT parties can be blocked by characters without COVERT. |
| `attack_cost` | `{ attack_cost: 3, target: host }` | Its controller must pay that much to attack with it. |
| `draw_bonus` | `{ draw_bonus: 1, by: you, target: none }` | Each time the player draws, they draw that many more. `{ cannot: draw, by: you, target: all }` stops draws. |
| `destroy_self` | `{ destroy_self: true }` with `requires` | "[R][R][R]: Destroy this card." |
| `party_covert` | `{ party_covert: true }` | Its attacking party is COVERT. |
| `party` | `{ party: { side: attacking \| blocking \| both, min: 2, max: 1, even: true, including: self } }` | Party size rules ("must have only 1 member"); `including` limits it to parties with a matching member. |
| `no_rules` | `{ no_rules: true, target: host }` | The target is treated as having no rules text. |
| `attack_declarations` | `{ attack_declarations: 1, target: none }` | Players can attack only that many times each turn (Narrow Passage). |
| `assign_to_target` | `{ assign_to_target: true }`, `{ assign_to_target: { must: true } }` | While attacking, its battle damage may go to the attack's target instead of the blockers; with `must`, it always does (Penetrate). |
| `assign_cost` | `{ assign_cost: true, target: host }` | It assigns battle damage equal to its numeric cost instead of its strength (Ocular Dispersal). |
| `must_be_assigned` | `{ must_be_assigned: true }` | Battle damage that could be assigned to it must be. |
| `search_tax` | `{ search_tax: 2, by: opponent, target: none }` | Searching your own deck costs that much. |
| `battle_damage_to_self` | `{ battle_damage_to_self: true, target: c }` | Its battle damage is inflicted to itself (Don't Trip). |
| `stays_in_play` | `{ stays_in_play: true }` | An attached card that doesn't leave play with its host. |
| `damage_as_tokens` | `{ damage_as_tokens: { battle: true }, while: { blocking: self } }` | Damage becomes that many tokens instead (Expert Debater). |
| `blocks_any` | `{ blocks_any: true }` | Can block COVERT and non-COVERT parties. |
| `numeric_cost` | `{ numeric_cost: 1, target: c }` | Changes a card's numeric cost in play (cost filters and values use it). |
| `add_subtype` | `{ add_subtype: sarcophyle, target: it }` | It gains a subtype. Only in `create_effect`, aimed at specific cards. |
| `attack_ready` | `{ attack_ready: true, target: { character: { controller: you } } }` | Can attack even if it hasn't been in play under its controller since the start of the turn (Testudine Autoframe). |
| `first_resource_attached` | `{ first_resource_attached: true, by: opponent, target: none }` | The first resource that player plays each turn enters play attached to their faction (Vilghame). |
| `damage_to_hand` | `{ damage_to_hand: { battle: true, from: self }, target: { character: any } }` | Damage to the target is replaced: it goes to its owner's hand instead (Vexing Nullifier). `from` limits the sources. |
| `may_reduce_damage` | `{ may_reduce_damage: { amount: 1, lose_influence: 1 }, target: { location: { controller: you } } }` | When damage is inflicted to the target, after other modifiers, its controller may reduce it by `amount`; if they do, their faction loses `lose_influence` (Cathédrale de Mau). |
| `swap_seats` | `{ swap_seats: true }` | "Each player moves 1 seat to the left": with two players, each plays the other's side while an odd number of these are active (Emergency Obfuscation). The game only knows sides; the winning side's deck owner wins. |
| `all_unique` | `{ all_unique: true, target: all }` | Non-resource cards gain "Unique X", X being the card's name (God's Autograph). It doesn't change the `unique` selector filter, which reads printed text. |
| `grant_flip_up` | `{ grant_flip_up: true, target: { resource: { controller: you, face_down: true, printed_type: tactic } } }` | The target gains FLIP UP with its regular numeric cost and threshold, unless it has its own (Woadenworm). |

Derived values are recomputed from scratch, so modifiers switch on and off by
themselves when their source leaves play or their condition changes. Increases
apply before reductions, and numbers never go below 0.

## 7. Events

`party_formed` (once per attacking or blocking party; filter with `side: attacking | blocking`), `search` (a player is about to search a deck), `played`, `ability_used`, `enters_play`, `leaves_play`, `destroyed`, `attacks`,
`blocks`, `blocked` (each attacker, when blockers are declared), `damage`,
`influence_lost`, `start_of_turn`, `end_of_turn`, `draw`, `picked`, `discarded`.

`tokens_changed`: the number of tokens on a card in play changed through an effect
or cost (not a manual change). With `while`, for "when this card has no tokens on
it" (Corrosive Waste Dispenser).

`flipped_down`: a card in play was flipped face-down, by any effect, replacement or
manual flip. With `card: self` the card still triggers although it is face-down
(Stuttershy); `player` is who controlled it before the flip.

`discarded` takes `by: opponent` for "when an effect controlled by an opponent causes
you to discard" (Phalludrix); `it` is the discarded card.

Resources entering play fire `enters_play` too, which is how "When a card that
provides at least [D] enters play under your control" works:

```yaml
- trigger: { on: enters_play, card: { controller: you, provides_at_least: { deception: 1 } } }
```

## 8. Scripts

When a card doesn't fit the language, write a small TypeScript function in
`engine/scripts.ts` and call it with `- script: name`. Current scripts:
`auction_house`, `mistaken_identity`, `mustache_showdown`, `skin_suit`, `spatchcocking`,
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

**Finding what to automate next:** `npm run patterns` writes `docs/PATTERNS.md`, which
lists every rule pattern in the printed texts, how many cards use it, and whether the
engine supports it.

**Testing a new card:** add a scenario to `engine/test/cards.test.ts` (see the
existing ones), then run `npm test`. The fuzz test plays random games with every
card and catches engine crashes.

## 10. Interpretations and cards to verify

**Card data source:** numbers and printed texts are checked against the
spoilstoolbox.com card database (`content/cards/` in its source archive), which
holds the most recent wordings. All cards match it.

**Interpretations:** places where the printed text left room, and the reading
implemented. Mistaken Identity only offers characters the original card could have
picked. Every row is a user ruling (all confirmed 2026-10-27).

**General ruling:** when a card reads a stat because something happens ("X is its
strength"), it uses the current stat, modifiers included, not the printed one. A card
that has left play uses the stat it had as it left (`last_known`). Only a card that
says "printed" (Fornicaves) reads printed numbers.

| Card | Implemented as |
|---|---|
| Trickster's Globe | The controller chooses how many points of the damage become milled cards instead (0 to all). |
| Ecto-Conduit (Harness) | The voided tactic may be deployed immediately, not later. |
| Eldridge Gosche | Up to 3 tokens divided among any of your non-resource cards. |
| Cantankerous Claywork | only characters already in play when it attacks. |
| Auction House | If nobody bids, the character is shuffled back with the other revealed cards. |
| Free Trade Agreement (option 3) | Each player chooses how many cards (0 to 2) to draw. |
| Meat of the Mountain | an effect needs a real token change; "remove" isn't offered at 0 tokens. |
| One-Legged Hopping Pogo-Bear | HIDE! removes the character type but the card keeps Covert. |
| Hidden Sandwich | Protects the host from any destruction, including costs. |
| Quotidian Misfire | every card going to a hand, drawn, searched or returned. |
| Two-Headed Coin | Not automated: coins are only flipped at setup. |
| Lost on Floor 3 | Playable whenever you have priority after declaring the end of your turn. |
| 6r4wny 60dy9u4rd5 | "Leaves play in that way instead" covers destruction only; other ways of leaving play aren't redirected. |
| Banana Peel | "You may pay 1. If you don't, terminate it": deployed during an opponent's turn, it simply costs 1 more. |
| Akashic Notes | "Play a face-down resource attached to your faction": choose a card from hand; it enters face-down and attached. |
| Bewilderbeast | Gains 1 strength and 1 life per card discarded, one trigger per card. |
| Carnival Funhouse | Swaps printed stats; each character keeps its own other modifiers. |
| Cicibeo the Implicator / the Swift | Only another cicibeo deployed from your hand (`deployed_from: hand`) counts, not one put into play by an effect. |
| Community Chest | The mulligan clause (reveal it to draw at the start of your turn) is resolved by hand. |
| Corrosive Waste Dispenser | Flips face-down whenever an effect or cost removes its last token (`tokens_changed`). |
| Department of Rejections | The search tax is paid when the search resolves; if it can't be paid, there is no search. |
| Draconarius Slitherform | "When destroyed, X is this card's strength": its strength as it was destroyed, modifiers included. |
| Downsizing | X counts the characters in play before the destruction, including any that a replacement saves. |
| Essence of Deception (option 3) | "Damage has been inflicted this turn": the character has damage on it. |
| Direstock Stronghold | "When you deploy a character" triggers when it is deployed (put on the stack). |
| Goutflame Talonclaw | Destroyed or removed from the game, it flips face-down instead (`to_void`). |
| Golden Charm | The draw happens when the search starts, before the searching player chooses. |
| Gideon's Legacy (Hide) | Any card in a discard pile; the players other than that card's owner gain X influence. |
| Gore Engine | Tokens equal to the destroyed character's strength as it was destroyed, modifiers included. |
| Flaming Cube, Framptle | Their token counts are checked right after the rules that change them. |
| Fornicaves | two in play both apply, so every character with printed life 4 or more is destroyed. |
| Rudo Mangod, Dragonweight Champion | The characters it depletes can't be restored by the RESTORE RULE for the rest of the game (other effects still restore them). |
| Rune of Concealment | Only destruction by battle damage (the last damage came from a battle's damage step). |
| Reality Shift | You deploy the returned cards (or any other cards in your hand) one at a time, each costing nothing, while their numeric costs fit in what is left of X. |
| Stuttershy | "When this card is flipped down": any flip by an effect or replacement (`flipped_down`); manual flips don't fire triggers. |
| Swinish Elder | "When an opponent plays a resource": any resource entering play under an opponent. |
| Subsection 5, Paragraph 12 | "It cannot be used again this turn": none of that card's abilities can be used this turn. |
| The Stone of Shame | A character that would go to a hand (from anywhere, including draws) goes to its owner's discard pile instead; this isn't a destruction, so "when destroyed" doesn't trigger. |
| The Poshernacle | "At the start of your turn, you may use an ability" is left to the players. |
| Spurious Anthropologist | The recruited character and the Anthropologist go to the void instead of leaving play any other way this turn, and when either leaves, the other is voided too. |
| Theological Theft | X is 0, 1 or 2: with two players, X = 2 means both players. |
| Tumescent Guilt Bladder | The tokens are removed only when it changes control (otherwise it could never reach 3). |
| Torchlight District | The 3-speed check happens when the character attacks. |
| Totally Random Kid | X is the battle damage it inflicted to that faction in that one hit. |
| Underhanded Gamer | "Cannot be blocked by those players": it can't be blocked this turn. |
| Unstable Modification | The chosen text applies to the character it is attached to when the choice is made. |
| Unwise Encirclement | Listed as a character with no stats, though its text reads like a tactic. Its effect runs when deployed; afterwards it is destroyed with 0 life. To verify. |
| Venomous Sacspider | "Destroyed by battle damage": the last damage came from a battle's damage step, not a tactic played during the battle. |
| Vast Mastabatorium | Each use adds its own end-of-turn token and control change. |
| Voidal Tactician | Tactics in either player's void. |
| Wasteland | "Void all non-resource cards" includes itself, but not factions. |
| Witty Worm | Offered from your hand whenever a resource enters play under your control; you still need its threshold. |
| Workshop | "A card of the same type": its printed type. |
| Wyrmfang Deathskull | If the defender picks no characters, nobody can block. |
| Arcane Escrow | Each discarded card is asked about separately, including discards an opponent's effect forces. |
| Cathédrale de Mau | Asked once for each instance of damage, after other damage modifiers. |
| Clockman Skydocks | The reduction is used up by the next card you deploy, including through FLIP UP, even if that card didn't need it. "Up to 6" is a reduction of 6. |
| Counter Attack | When it resolves with cards still on the stack below it, the battle is resolved first, then those cards. |
| Emergency Obfuscation | With two players the sides swap: each player sees and decides for the other side, including its hand. The log names the sides, not the people playing them. |
| Geiseric, the Souleater | "An opponent's hand": a character an opponent owns. |
| Mustache Aficionado | The players divide and choose one after the other; the piles stay hidden until both are chosen. |
| Notion Sickness | The card is destroyed right after the ability goes on the stack; the ability still resolves. |
| Phantasmagoric Tollbooth | The player whose character it is decides whether to pay. A deployed character that goes to the discard pile skips the rest of its effect. Moving from the stack to a discard pile now counts as "put into their discard pile from anywhere". |
| Crests and Banners | "When a card that provides at least [R] enters play under your control" doesn't count the Crest or Banner itself entering play (`not_self`). |
| FLIP UP payment | an unattached face-down card pays 1 of its own FLIP UP cost (it is attached to pay, then flips up). An attached one doesn't. |
| Limited Liability | it also stops the unique rule, so duplicates (several Gideons) stay in play that turn. When it ends, the unique rule applies again and their controller keeps one. |
