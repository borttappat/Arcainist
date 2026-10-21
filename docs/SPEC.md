# Arcainist: Rules Engine Specification

Working spec for a 2-player online client for The Spoils card game. It turns the
rulebooks into a state model the engine can implement, and records every ruling
and assumption made where the rulebooks are silent.

Status: draft for review. Items marked **[ASSUMPTION]** need confirmation.

## 1. Sources and precedence

When sources disagree, the higher entry wins:

1. **The card.** "If a card contradicts the rules, the card is always right."
2. **User rulings** (section 13). Authoritative where no official text exists.
3. **`RULES.pdf`**: 2016 Deckade of Decadence Official Rule Book (quick start).
4. **`RULES.txt`**: Rulebook v2.2 (Tenacious Games). Older, but more detailed on
   triggers, replacements, requirements, numbers and loops; used wherever the
   2016 book is silent.

The 2016 book defers to a "Comprehensive Rules" document that is not available.

## 2. Glossary of engine terms

| Term | Meaning |
|---|---|
| Card instance | One physical card in a game: unique `iid`, a `defId` pointing at its card definition, owner, controller. |
| Player | Seat `A` or `B`. Has a faction, influence and zones. |
| Active player | The player whose turn it is. |
| Stack | The "being deployed" area: cards and abilities waiting to resolve. Last in, first out ("the zipper"). |
| Window | A point where a player may act or pass. |
| Decision | Anything the engine is waiting on a player for: a choice, a target, a pass. The engine is always either resolving or waiting on exactly one decision from exactly one player. |
| Event | An atomic thing that happened (card moved, damage inflicted, card depleted). Triggers listen to events. |

## 3. Game state

### 3.1 Zones (per player)

| Zone | Visibility | Notes |
|---|---|---|
| `deck` | hidden, order secret | Shuffled; searchable only when a rule says so. |
| `hand` | owner only | No size limit. |
| `stack` | public (shared, not per player) | Cards being deployed and abilities being used. |
| `play` | public, except face-down cards | Characters, items, locations, resources. |
| `discard` | public | Ordered, top is most recent. |
| `void` | public (face-up unless stated) | Removed from the game. |

The faction card is not in any zone. It sits beside the player, always in play,
and cannot be moved, destroyed or picked unless a card says "pick a faction".

### 3.2 Card instance fields

```
iid            unique id within the game
defId          card definition id
owner          A | B                  never changes
controller     A | B                  last "take control" effect wins
zone           deck | hand | stack | play | discard | void
faceDown       bool                   only meaningful in play
isResource     bool                   true for any card in the resource row
attachedTo     iid | "faction" | null "faction" = spent resource
depleted       bool
damage         int                    characters: reset at start of each turn
damageMarkers  int                    locations: never reset
tokens         map<string,int>        meaning defined by card text
enteredPlayAt  turn number            for the "started the turn in play" check
controlSince   turn number            control changes also reset attack eligibility
revealedTo     set of players         for "reveal" without flipping
```

### 3.3 Resources

- A resource is any card in play with `isResource = true`. That is either a
  resource card played face-up, or **any** card played face-down.
- Face-up staple resources provide one icon of their type.
- Face-down resources provide one **Volition** icon.
- Resources never deplete. Paying N means attaching N unattached resources to
  your faction (`attachedTo = "faction"`). Face-up resources are attached first,
  automatically, since which one is attached never matters. The player is only
  asked when some but not all of their face-down resources must be used, because
  face-down cards can have abilities that care.
- **Attached resources still count towards threshold.** Threshold is never "spent".

### 3.4 Threshold and icons

Icons: `obsession` (Arcanist), `greed` (Banker), `elitism` (Gearsmith),
`deception` (Rogue), `rage` (Warlord), `volition` (face-down).

A player's icon count for each type is the sum of:

- one icon per face-up resource card of that type in play under their control
- one `volition` per face-down resource they control
- every **PROVIDES** entry on non-resource cards they control in play

A threshold requirement is met when every listed icon count is at least the
required number. Threshold is checked:

- when deploying a card (its printed threshold)
- when using an ability that has its own threshold icons (for example RECUR)
- continuously, for rules text printed with icons beside it: that text is only
  active while the threshold is met

### 3.5 Derived values

Strength, life, speed, structure, cost and keywords are **never stored**. They are
computed on demand from:

1. printed value
2. "set to" effects (latest wins)
3. all increases
4. all reductions
5. floor at 0, whole numbers only

Per v2.2 "Numbers": all increases apply before all reductions. Recomputing from
scratch every time means "while" conditionals and static effects switch on and off
correctly with no cleanup code.

"Printed" values (Fornicaves: "their printed life") always read the definition, never
the derived value.

## 4. Game setup

1. Both factions start in play. Influence is set from the faction card.
2. Decide the first player at random. The winner of the random choice picks first
   or second. **[ASSUMPTION]** For the PoC the room creator's seat goes first, or
   it is a coin flip with the winner choosing.
3. Each player follows their faction's **Starting Resources** line, searching
   their deck and putting the cards into play, then shuffles.
4. Each player draws their faction's **Starting Draw** (first or second value).
   Faction-specific setup steps (Unlikely Heroes' staple search) run here.
5. Mulligan, once each, first player then second player: put any number of cards
   from hand on the bottom of the deck in any order, then draw that many.
6. The first player takes their first turn.

Deck legality (enforced only when the room's format is set):

| Format | Minimum (excluding faction) | Copy limit |
|---|---|---|
| Limited (draft/sealed) | 40 | none |
| Constructed | 75 | 4 per card, staples unlimited |
| Casual (PoC default) | none | none |

## 5. Turn structure

The 2016 book: "there are no phases". The engine still needs named states:

```
START_OF_TURN
  1. Reset damage on all characters to 0 (location markers stay).
  2. Faction RESTORE RULE (e.g. restore all your depleted cards, detach all
     resources from your faction).
  3. Faction DEVELOP RULE (e.g. choose: draw a card OR play a resource).
  4. "At the start of your turn" triggers. [ASSUMPTION: these run after the
     faction rules, ordered by the active player.]

MAIN (active player has free action)
  - deploy a card from hand
  - use an ability (cards in play, faction abilities, abilities usable from
    other zones such as RECUR and FLIP UP)
  - attack (enters BATTLE)
  - end turn

END_TURN_REQUESTED
  - Opponent gets a response window. Responses resolve normally.
  - [ASSUMPTION] After responses, the turn ends; ending the turn is not cancelled.
  - "At the end of turn" triggers.
  - Next player's START_OF_TURN.
```

The restore and develop rules are defined in the **faction's card data**, not in
the engine, so a faction with different rules needs no engine change.

The inactive player can only act inside windows (responses and battle windows),
and only with tactics, abilities, and cards that say otherwise (TACTICAL).

## 6. The stack and responses

### 6.1 Deploying a card

1. Choose a card in hand. Check the timing (characters, items and locations only
   on your own turn with an empty stack; tactics also as responses) and its threshold.
2. Move it to the stack.
3. Pay all costs **in written order**, numeric cost last (6.3). If any cost
   cannot be paid, **roll back the whole action** to the state before step 1.
4. The card counts as "played" now: "when played" triggers fire.
5. Response window for the opponent (6.4).
6. Resolve: characters, items and locations go into play; tactics follow their
   effect, then go to the discard pile.

### 6.2 Using an ability

Same as deploying, except no card moves: an ability object goes on the stack. It
resolves using the text as it was when used, even if the source has left play or
changed. An ability without "Pay N" has no numeric cost.

### 6.3 Costs

- Costs are an ordered list of instructions. All must be completed, or the action
  is illegal and rolled back.
- Numeric cost = Cost Number + every "Pay N" in the cost, then increases, then
  reductions. Paid last, by attaching that many unattached resources.
- "Free" skips the numeric cost only. Threshold and other costs still apply, and a
  variable X that is also paid must be 0.
- EXTRA COST is treated exactly like COST (2016 book: "any extra costs listed").

**Implementation:** the engine runs the cost steps against a working copy of the
state and only commits it on success. That gives rollback for free.

### 6.4 Priority ("the zipper")

You cannot respond to your own actions. So:

- Whenever a player puts an item on the stack, their **opponent** gets priority.
- A player with priority either responds (puts a tactic or ability on the stack,
  and priority passes to the other player) or passes.
- When the player with priority passes, the **top item resolves**.
- After it resolves, if the stack is not empty, priority goes to the opponent of
  the new top item's controller. They may respond to it again or pass.
- When the stack empties, control returns to whatever was happening (MAIN, a
  battle step, the end of the turn).

This means each player can respond to the other's action any number of times, and
the last response always resolves first.

**Terminate:** removes the item from the stack without resolving it. A terminated
card goes to its owner's discard pile.

### 6.5 Open windows (battle steps)

Battle steps say "the attacking player may deploy tactics and use abilities, then
the defending player". These are **open windows**, not responses:

- The attacker may act or pass, then the defender may act or pass.
- Anything played goes on the stack and is responded to as normal (6.4).
- **[RULING]** The window closes only when both players pass in a row with an
  empty stack. If either player acts, both get another chance.

### 6.6 Triggers

- Text starting "if", "when" or "at" followed by a condition.
- Triggers **do not use the stack and cannot be responded to**. They resolve
  immediately, even mid-way through another effect, using the text as it was when
  they fired, even if the source has left play.
- If several fire at once: if all come from one player's cards, that player orders
  them; otherwise the active player does. Ordering is one at a time (pick one,
  resolve it, pick the next).
- "You may" triggers ask their controller for a yes/no decision.

**Implementation:** events are queued; after each atomic step the engine collects
matching triggers, asks for an order if there are several, and resolves them before
continuing.

### 6.7 Replacements, requirements, can/cannot

- **Replacements** ("instead") intercept an event before it happens. If several
  apply, the controller (or the active player when mixed or rule-created) picks one
  and the rest are ignored, except delayed ("the next") replacements, which keep
  waiting.
- **Requirements** ("must") are checked as legality constraints on actions. If
  several apply, satisfy as many as possible.
- **"Cannot" beats "can"** whenever both apply.

### 6.8 State-based checks

Run after every atomic step, before triggers are collected:

1. A character with damage ≥ derived life is destroyed.
2. A location with damage markers ≥ derived structure is destroyed.
3. Unique: a player controlling two cards with the same `Unique X` picks one to keep
   and destroys the rest.
4. A card attached to something that is no longer a legal host (gone, or no longer
   a character for "Attach to Character") is destroyed / discarded.
5. A faction at 0 influence loses. Both at 0 at the same time: draw.

## 7. Battles

### 7.1 Declaring an attack

1. The active player picks a target: the opponent's faction (default) or one of
   the opponent's locations.
2. They choose one or more non-depleted characters they control that are eligible
   to attack (in play under their control since the start of the turn, or AGGRO),
   and deplete them. This is the attacking party; these characters "attack" now.
3. Open window (6.5): attacker, then defender.
4. The defender may choose any number of non-depleted characters to form the
   blocking party (subject to COVERT). Blockers are not depleted when they block.
   They "block" now.
5. Resolve the battle (7.2).

Multiple attacks per turn are allowed, each a separate battle.

### 7.2 Resolving the battle

```
loop:
  1. X = highest derived speed among characters still in the battle that have
     not assigned damage yet. None left -> go to 7.
  2. Open window (attacker first, then defender), closing on two passes.
  3. Attackers with speed X divide their strength among the blocking party, as
     the attacking player chooses. If no blockers remain, the damage goes to the
     attack's target instead.
  4. Blockers with speed X divide their strength among the attacking party, as
     the defending player chooses.
  5. All assigned damage is locked in. It will be inflicted even if its source
     leaves play.
  6. Open window (attacker first, then defender), closing on two passes.
  7. All locked damage is inflicted at once (as battle damage). Damage from
     several sources to the same thing is summed and inflicted as one amount.
     State-based checks run; destroyed characters leave the battle and will not
     assign damage.
  repeat
7. End the battle: deplete all surviving characters in the battle.
```

Speed is recomputed at each loop, so effects played during the battle can move a
character into a different speed group, as long as it has not assigned damage yet.

A character that changes controller, or stops being a character, is removed from
the battle immediately.

**[ASSUMPTION]** Attackers must assign all their strength, and can only split it
among living blockers. If an attacker's strength is 0, it assigns nothing.

### 7.3 Damage

| Recipient | Effect |
|---|---|
| Character | `damage += n`; destroyed when damage ≥ life; reset at start of each turn |
| Location | `damageMarkers += n`; destroyed when markers ≥ structure; never reset |
| Faction | Influence decreases by n |

Damage of 0 is "no damage" and does not trigger damage effects. Losing influence is
not damage.

## 8. Keywords and terms

| Keyword | Definition used by the engine |
|---|---|
| **Aggro** | Can attack the turn it entered play. |
| **Tactical** | Can be deployed any time a tactic could. |
| **Covert** | A party is Covert if all its members have Covert. A Covert party can only be blocked by Covert characters, and Covert characters can only block a Covert party. Checked once, when blockers are declared. |
| **Unique X** | You cannot control more than one card with "Unique X". See 6.8. Your opponent may control their own. |
| **Can attack only once each turn** | Counted per card per turn, even if it is restored. |
| **Attach to X** | Pick an X as part of the cost; the card enters play attached to it. Leaves play together with its host. |
| **Provides** | **[RULING]** The listed icons count towards the controller's threshold while the card is in play. |
| **Flip Up - N [icons]** | **[RULING]** While this card is a face-down resource you control, you may play it: turn it face up, meet the listed threshold, pay N instead of the cost number, and resolve it as if deployed. After use it goes to the discard pile. See section 13 for the open details. |
| **Recur** | **[RULING]** An ability usable only while the card is in your discard pile. Its cost voids the card (removes it from the game); the effect still resolves. Any icons next to "RECUR" are the ability's threshold. |
| **Extra cost** | Same as a cost. |
| **Void** | The removed-from-game zone. Face-up unless stated. |
| **Terminate** | Remove from the stack without resolving; a card goes to its owner's discard pile. |
| **Duplicate** | Create a copy of the tactic/ability with the same rules text. Its written costs must be paid (2016 book). If they can't be, the duplicate does nothing. The duplicate cannot be responded to. |
| **Deplete / Restore** | Mark as used / unmark. A depleted card cannot be depleted again. Resources never deplete. |
| **Destroy** | Move a card in play to its owner's discard pile. Attached cards follow. |
| **Discard** | Move a card from your hand to your discard pile. |
| **Draw** | Move the top card of the deck to hand. Empty deck: nothing happens, no loss. "Draw N" is a single event. |
| **Search** | Look through a deck for matching cards; may fail to find; the owner then shuffles. |
| **Reveal** | Show a card to the opponent. A revealed face-down card stays face down. |
| **Micromajig token** | Gearsmith character, 1 STR / 1 LIFE / 3 SPD, cost 0. Voided instead of leaving play. |
| **Demon token** | Stats and abilities defined by the card that creates it. Voided instead of leaving play. |

General clarifications (v2.2):

- A card that doesn't name a zone only affects cards in play, including picking.
- "Pick" never picks a faction unless it says "pick a faction".
- Putting a card into play is not playing it; "when played" does not trigger.
- When both players must do something at once, the active player goes first.
- A card that changes zone forgets everything that applied to it in the old zone.
- A card that stops being a character forgets its damage.

## 9. Hidden information

The server holds the full state. Each client receives a filtered view:

| Information | Owner/controller sees | Opponent sees |
|---|---|---|
| Hand | cards | count |
| Deck | count (contents only while searching) | count |
| Face-down resource | the card | a card back, plus whether it is attached |
| Revealed face-down card | the card | the card, until it changes zone |
| Discard, void, play (face-up), stack | everything | everything |

Card instance ids for hidden cards are re-mapped per viewer so the opponent cannot
track a card from hand into a face-down resource by its id.

## 10. Card definition format

Cards are YAML files in `cards/`, written in the card language documented in
[`docs/CARDS.md`](CARDS.md): printed data plus `rules` built from steps, selectors,
values, conditions, modifiers and events, with a TypeScript escape hatch
(`engine/scripts.ts`) for the few cards that don't fit. `docs/CARDS.md` also lists
how ambiguous card texts were interpreted and which scans need checking.

## 11. Manual controls

As on Jinteki, every player always has manual actions available, so cards the
engine can't handle yet are still playable:

- move any card they own between zones; flip; deplete/restore; attach/detach
- add/remove damage, damage markers and tokens
- adjust their own influence
- draw, shuffle, reveal the top card, look at their deck

Every manual action appears in the game log, flagged as manual. Manual actions
are only available while the engine is not waiting on the opponent.

## 12. Architecture (PoC)

- **TypeScript monorepo**: `engine/` (pure, no I/O), `server/` (Node + WebSocket),
  `client/` (React).
- **Engine API:** `apply(state, playerAction) -> { state, events, pendingDecision }`.
  Deterministic with a seeded RNG, so a game is fully reproducible from
  `seed + action log`. Bugs are reported as a replay file.
- **Server:** authoritative. Rooms in memory. Sends each client its filtered view
  (section 9) after every action.
- **Identity:** the browser generates a random secret and keeps it in local
  storage. The display name is `name#xxxx`, the first characters of a hash of the
  secret. Pasting the secret on another device restores the identity. Guests get a
  throwaway secret.
- **Decks:** pasted text, one `N Card Name` line each, plus a faction line.
- **Dev:** a Nix flake `devShell` with Node; `npm run dev` starts server and client.

## 13. Rulings and open questions

### Rulings (confirmed by the user)

1. **Battle response windows** stay open until no player wishes to respond; then
   the speed group's damage resolves. (6.5, 7.2)
2. **Flip Up:** play the card from its face-down resource state; it goes to the
   discard pile after use. "FLIP UP: 2 [R]" means pay 2 and have 1 Rage icon. A
   face-down resource can be flipped up even while attached to the faction (spent).
   Timing is the card's normal timing: a tactic whenever a tactic could be played,
   a character, item or location only as a free action on your turn (unless
   TACTICAL); those enter play normally.
3. **Recur:** an ability used from a card in the discard pile; the card is then
   voided.
4. **Provides:** adds to the controller's threshold for as long as the card is in play.
5. **End of turn:** responses to "end turn" resolve, then the turn always ends. Only
   cards that say so (Lost on Floor 3) cancel it.
6. **Start of turn:** after damage resets, the faction's restore and develop rules
   and every "at the start of your turn" trigger become available together, and the
   turn player orders them. (When only the faction's own rules are there, they run
   in printed order without a prompt.)
7. **Triggers and the stack:** triggers just happen and can't be responded to, even
   mid-resolution. If a trigger lets a player use an ability or deploy a card, that
   goes on the stack and can be responded to. Costs are paid without a response
   window; the opponent responds once the card or ability is on the stack. The stack
   builds up and resolves like a zipper and can build up again while resolving.
8. **First player:** set by the room creator: random, or a chosen player.
9. **Blockers** are not depleted by blocking, only at the end of the battle (as for
   all surviving participants).
10. **Battle damage:** attackers must divide all their strength among living
    blockers; nothing carries over to the attacked faction or location while any
    blocker remains.
11. **Characters, items and locations** are deployed only as a free action on your
    own turn with an empty stack, never as a response, unless they have TACTICAL.
12. **Card readings** confirmed: see `docs/CARDS.md` section 10.
13. **"This card inflicts damage"** covers any damage the card inflicts, through its
    own rules text as well as in battle (Sadistic Colonel's trigger damage sets off
    an attached Dethmurderbludgeon).

### Assumptions (still unconfirmed)

1. **Universal** is a trade with no staple of its own, with no extra rules.
2. **Infinite loops** are left to the players (manual draw / concede).
3. **Formats:** `formats/*.json` define deck rules (minimum size, copy limit,
   bans, tournament legality, allowed sets) and `engine/formats.ts` checks decks
   against them. Rooms choose a format; Casual (the default) enforces nothing and
   only warns when a deck lacks its faction's starting staples. Constructed uses the
   database's "Current" ban list. The "Block" and "Chronicles" formats from the
   database are not defined yet (their legal sets are unknown).
