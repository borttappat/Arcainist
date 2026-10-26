# TODO

Where things stand and what's left. Update this as work lands.

## Progress log

- **2026-10-21 (second session):** 105 more cards automated, alphabetically from
  0p3r4710n 1337 h4x0rz to Boilstorm (scenario tests in
  `engine/test/cards-a.test.ts`). New building blocks, documented in
  `docs/CARDS.md`: `divide_damage`, `retarget_attack`, optional `destroy`
  replacements, the `redirect_damage`, `covert_blockable`, `attack_cost` and
  `draw_bonus` modifiers, `cannot: draw`, `deplete` on lists, the `unique`,
  `life_lte` and `top` filters (`str_lte` now reads printed strength outside play),
  `{ controller_of: f }` for "pick a player", the `assigned_damage` condition,
  `attach_to` selectors, and PROVIDES numbers on permanents read from JSON.
  Data fixes: `attach_to` added to 58 gear cards that lacked it, and
  printed COVERT / AGGRO / TACTICAL added as `keywords` to 71 cards. 370 tests pass.
  **Skipped for now:** Arcane Escrow (needs "if you would discard, void face-down
  instead" and a develop-rule draw replacement). Next card in order: Boorish Boar.

- **2026-10-21 (third session):** 101 more cards, Boorish Boar to Derelict Seafarer
  (scenario tests in `engine/test/cards-b.test.ts`). New building blocks, documented
  in `docs/CARDS.md`: the `party_formed` event, `divide_damage` with `up_to`,
  "next X damage" redirects spread over several hits and onto factions, `deplete` on
  selectors, `flip_face_down` under the opponent, `detach` of specific resources,
  attached resources from `put_into_play`, the `destroy_self`, `party_covert`,
  `assign_to_target` (with labels and caps on the damage prompt),
  `must_be_assigned` and `search_tax` modifiers, `applies: ability` costs (also
  charged on abilities with no numeric cost), `damage` with `over`, the
  `not_subtype`, `not_trade`, `token`, `spent` and `has_tokens` filters, the
  `printed` value, the `battle_damage` and `even` conditions, the
  `responded_pick` reference, and `rules: []` for cards with nothing to automate.
  491 tests pass. **Skipped:** Cathedrale de Mau (an optional "reduce the damage
  by 1" choice), Clockman Skydocks (threshold reduction of a named icon for the
  next card), Counter-Attack (attacking during the opponent's turn). Next card in
  order: Desolate.

- **2026-10-22 (fourth session):** 101 more cards, Desolate to Fanatical Shriever
  (scenario tests in `engine/test/cards-d.test.ts`). New building blocks: the
  destroying player on `destroyed` (`by: opponent`, which finishes Ecneret),
  faction-damage tracking (`damaged_faction`), the `threshold` value, the
  `str_gte`, `strongest`, `costliest`, `keyword`, `equipped` and `text_has`
  filters, the `attack_target` condition, damage modifiers limited by source
  (`from`), cost reductions with a `floor`, and the `battle_damage_to_self`,
  `stays_in_play` and `damage_as_tokens` modifiers. 607 tests pass. **Skipped:**
  Emergency Obfuscation (players swap sides). Next card in order: Fat Pants.

- **2026-10-22 (fifth session):** 101 more cards, Fantastic Uber Kool Creator
  Majig to Hammer Smash. New building blocks: `peek` (private looks),
  `steal_deploy`, the `search` event, `had_tokens` on `leaves_play`, tactics with
  `attach_to` staying in play (God's Blessings), granted static rules, `both_players`
  abilities on any card, `cannot` with `unless` and `take_control`/`restore`
  prohibitions, `name` of a trade, `by` on `destroy` replacements, the
  `damaged_by` filter, the `influence` value, and the `blocks_any` and
  `numeric_cost` modifiers. 723 tests pass. **Skipped:** Geiseric the Souleater
  (an optional paid replacement of a card going to the opponent's hand) and God's
  Autograph (every card gains "Unique <its name>"). Next card in order: Hangdog Alley.

- **2026-10-22 (sixth session):** 100 more cards, Hangdog Alley to Last-Minute
  Weaponization. Limited Liability now also stops the unique rule (several copies of
  a UNIQUE card stay until it ends). New building blocks: `cannot: attack_faction`,
  `terminate: all`, `played_this_turn` with `same_name`, the `covert_party` and
  `since_turn_start` conditions, `both_players: opponent` abilities, the `battle`
  effect duration, `look` with an exact bottom count, `strongest: controller`,
  `name_not_among`, and `card: host` triggers on `leaves_play` firing although the
  attachment leaves too. The all-cards smoke test now has a 30s timeout (it scales
  with the card count). 841 tests pass. Next card in order: Lead the Assault.

- **2026-10-22 (seventh session):** 100 more cards, Lead the Assault to Nearby
  Serpent. New building blocks: the `next_restore` effect duration ("does not
  restore during its controller's next RESTORE RULE"; Numba 1 Stunna and Wily
  Circumvention can use it next), `cannot: flip_up`, `cannot: destroy` with `from`,
  `redirect` to `deck_shuffle` or `stay`, static rules in `zone: any`, conditional
  replacements (`while`), `remember` of a variable, `duplicate: responded`, the
  `attack_declarations` modifier, `not` with several variables, and the `max`,
  `max_stat` and `total_str` values. `choose_one` with nothing to offer now fails as
  a cost. Engine fix: a destroy replacement that queues steps (an `if`) could be
  replaced again by the state checks before it finished, looping forever (Lucky
  Bastard). 959 tests pass. **Skipped:** Mustache Aficionado (both players split
  their top 3 cards into piles). The dump script now starts at index 8. Next card in
  order: Necromantic Healer.

- **2026-10-22 (eighth session):** 100 more cards, Necromantic Healer to Randolph von
  Macovawitz. New building blocks: the `party_with` filter, the `assign_cost` modifier
  (battle damage equal to numeric cost), `assign_to_target` with `must`,
  `repeat` with `while` (Negotiation Ceremonies), optional destroy replacements with
  `pay` (Node-in-a-Box), and `by` on `discarded` triggers (Phalludrix). A `next`
  effect with a damage modifier is now used up by the first damage it changes
  (Pride of Goru-Goru Gidea). Approximation: Parkour Hoodlum ignores locations by
  not being pickable by them and taking no damage from them; location static
  modifiers still apply. 1,069 tests pass. **Skipped:** Notion Sickness (use a card's
  ability with the effect happening twice), Phantasmagoric Tollbooth (replaces a
  character entering play). The dump script now starts at index 10. Next card in
  order: Rapacious Soldier.

- **2026-10-22 (ninth session):** 125 more cards, Rapacious Soldier to Sneaker Attack.
  New building blocks: the `total_cost` value, the `attacked_this_turn` condition, the
  `damaged_this_turn` filter, `let` with `cards` (a fixed list of matching cards),
  `response_to` with `via: flip_up` (Ritual of the Sucking Skull), `cause: damage` on
  destroy replacements (Rune of Concealment), and the `add_subtype` modifier
  (Sarcophyle Matriculation). Interpretations added to `docs/CARDS.md` for Rudo Mangod,
  Dragonweight Champion, Rune of Concealment and Reality Shift. 1,200 tests pass. No
  cards skipped. The dump script still starts at index 10. Next card in order:
  Sneaking Spitspider.

- **2026-10-22 (tenth session):** 100 more cards, Sneaking Spitspider to Theocratic Senate
  of Marduun. New building blocks: ATTACH TO ITEM (`attach_to: item`, which also makes
  iDumb De-Itemizer work), `host` remembered after the card leaves play, `{ owner_of: c }`
  for players, `redirect` without `to` (leaving play to anywhere), the `attach_resource`
  step, `play_resource` with `face_down`, the `cheapest` filter, the `attack_ready`
  modifier, and `provides` on face-down resources (Thabbashite Chemist). New
  interpretation rows for Stuttershy, Swinish Elder, Subsection 5 Paragraph 12, The Stone
  of Shame, The Poshernacle and Spurious Anthropologist. 1,299 tests pass. No cards
  skipped. The dump script still starts at index 10. Next card in order: Theological
  Opportunist.

- **2026-10-22 (eleventh session):** the last 122 cards, Theological Opportunist to
  Zigalburgonglgr. Only the 10 skipped cards still lack rules. New building blocks:
  `who` on optional destroy replacements (the opponent decides and pays), `uses_per_turn`
  on abilities, `cheapest: all`, the `spd_lte` filter, the `different_trades` value,
  `look` with `keep_top`, `terminate` into the owner's hand, and the
  `first_resource_attached`, `damage_to_hand` and `grant_flip_up` modifiers. Data fixes:
  `attach_to: character` on Unstable Modification, gear bonuses for Vorpal Sword and
  Waylay Blade. 14 new interpretation rows (Theological Theft to Wyrmfang Deathskull),
  including Unwise Encirclement, which is listed as a character but reads like a
  tactic. 1,431 tests pass.

- **2026-10-22 (twelfth session):** the 10 skipped cards. Every non-faction card now
  has rules, and a coverage test keeps it that way. New building blocks: replacements
  for `discard`, `to_hand`, `enter_play` (with `pay` or `unless_pay`) and
  `develop_draw`; the `attack` step (attacking during an opponent's turn, the battle
  resolved before the stack below it); `use_ability` with `twice`; the
  `opponent_turn` timing; `threshold_reduce` of a named icon, used up by the next
  deploy; the `may_reduce_damage`, `swap_seats` and `all_unique` modifiers; the
  `has_ability` filter; and the `mustache_showdown` script. Engine changes: deployed
  permanents enter play through a task (so a replacement can ask first), battle damage
  waiting on a choice is dealt before the battle moves on, and a card moving from the
  stack to a discard pile now fires `moved`. Views carry `seat` next to `you` (the side
  played), for Emergency Obfuscation. 1,452 tests pass.

- **2026-10-22 (rules fixes):** without a room choice, both players roll a die and the
  winner chooses to go first or second. Each player's starting resources are logged
  (revealed) when they finish choosing, the first player before the second. The turn
  player now orders the Restore and Develop rules every turn, so a resource can be
  played before resources are detached. Cards that can't be responded to resolve
  without giving the opponent priority (Tactician Vacation). Cards attached to a
  destroyed card are destroyed right after it, so their replacements apply (Super
  Shiny Caltrops of DOOM!). 1,454 tests pass.

- **2026-10-23 (spectators and seats):** anyone can watch a running game from the
  lobby. Spectators get a public-only view (no hands, decks, face-down cards, private
  log lines or prompts) and can't act. Leaving a running game now offers "Give up my
  seat" next to "Concede": the seat stays in the game, open for a spectator to take
  over (the original player can also take it back). A seat bar shows who is connected;
  after an opponent has been disconnected for 2 minutes, you can open their seat.
  1,455 tests pass.

- **2026-10-26 (waiting room):** a room no longer starts when the second player joins.
  Before the game, anyone can enter a room from the lobby; players take and leave seats
  (sitting down uses the lobby's deck), and the rest wait as spectators. Only the room's
  owner can start the game, once both seats are filled. If the owner leaves, the room
  passes to a seated player, else a spectator. An owner who isn't seated can still start
  the game ("owner goes first" then becomes a die roll).

## State at the end of the first session (2026-10-21)

- **Cards:** 1,230 cards from the spoilstoolbox.com database, plus a Micromajig token card.
  About 135 have automated `rules` (including all 16 playable factions); the rest
  are text only and show a "manual" tag in the client.
- **Engine:** the card language covers everything in `docs/CARDS.md`, plus the
  building blocks added last session (listed under "Document" below).
- **Tests:** 243, all passing (`npm test`). These include `smoke.test.ts`, which
  runs every automated card on a busy table, and `blocks.test.ts`, which tests each
  new building block with test-only cards.
- **Uncommitted at the end of the session:** the building blocks, Inhibit and Karmic
  Cake, the Obsessive Compulsion fix, manual deck search with Close / Close and
  shuffle, the field regions and gear and stack layout, the responsive layout, the
  smoke and blocks tests, and the two test decks.

## 1. Finish the building blocks (small)

- [ ] **Document** the new building blocks in `docs/CARDS.md`:
  - `create_token`, `remove_from_battle`, `add_to_battle`;
  - `take_control` with `duration: turn`, `mill` with `to: deck_bottom`;
  - the `enters_depleted` field, and `once_per_turn` and `timing: { in_battle | not_in_battle }` on abilities;
  - the modifiers `cannot_be_blocked` (`by`), `lose_keyword`, `must_attack`, `must_block`, `party`, `reveal_top`, `no_deplete_on_attack`, `no_rules`, and `cannot: use_ability | restore`;
  - the events `restored`, `depleted`, `moved` (`from` / `to` filters), `battle_end`, `coin_flipped`;
  - the refs `top_of_you` and `top_of_opponent`.
- [ ] **Update `tools/patterns.ts`**: set the `engine` field for the patterns these now
  cover (tokens, coin flips, revealed top card, unblockable, losing a keyword, no
  rules text, zone/restore/deplete/battle-end triggers, must attack/block, party
  rules, remove from battle, top card to bottom, once per turn, temporary control,
  in-battle timing, enters depleted, abilities can't be used). The report still
  says 144 cards are blocked only because of this.
- [ ] **Client:** show `topCard` (top card revealed at all times) next to the deck
  counter in `Board.tsx`. The view already sends it.
- [x] **Ecneret and Candy Skull Commander:** both automated (third and fourth sessions).

## 2. Automate every card (the main job)

- [x] Write `rules` for every card without them, in alphabetical batches of about 25
  (all done; the two multiplayer Evil Alliance factions are left for multiplayer):
  - list the batch's cards with their text and numbers;
  - write the rules;
  - append them to the YAML files;
  - run `npm test` (the validator, smoke test and fuzz test).
- [ ] Cards that don't fit the language get a small script in `engine/scripts.ts`. If
  a pattern repeats, promote it into the language instead.
- [x] Skipped cards, each needing a new building block: Arcane Escrow, Cathedrale de
  Mau, Clockman Skydocks, Counter-Attack, Emergency Obfuscation, Geiseric the
  Souleater, God's Autograph, Mustache Aficionado, Notion Sickness, Phantasmagoric
  Tollbooth (twelfth session).
- [ ] Gear bonuses: the database has no gear stats. Read "The attached character
  gains N strength..." from each gear card's text into `gear` in its JSON.
- [x] **Coverage test** (`engine/test/smoke.test.ts`): fails if a non-faction card
  with rules text lacks `rules`.
- [ ] Re-run `npm run patterns` after each batch to track progress.

## 3. Open questions for the user

- [ ] **"Cannot be blocked" in a party:** implemented like COVERT (a party is
  unblockable only if all its members are). Confirm, or should one unblockable
  member make the whole party unblockable?
- [ ] **Block and Chronicles formats:** which sets or rules? (Only their ban lists are
  known; Constructed uses the "Current" list.)
- [ ] Earlier defaults, still unconfirmed:
  - Free Trade Agreement option 3 lets each player choose to draw 0 to 2 cards;
  - Eldridge Gosche spreads up to 3 tokens among any of your non-resource cards;
  - Lost on Floor 3 is playable whenever you have priority after declaring the end of your turn;
  - Universal cards have no special rules;
  - infinite loops are left to the players.

## 4. Features

- [ ] **Before hosting publicly:** save rooms to SQLite after every action and restore
  them on startup (games currently end on every restart or deploy); an
  allowed-origin check on the WebSocket. Per-connection message limits and room caps
  are in. Host on something with
  long-lived WebSockets and a persistent disk (Fly.io, Railway, Render, a VPS), one
  instance only.

- [ ] **Custom game mode (rulesets):** JSON files overriding per-card numbers
  (`cards/*.json` keys), chosen per room next to the format. Show what changed from
  the original in the card preview.
- [ ] **Format enforcement in practice:** Constructed and Limited exist
  (`formats/*.json`). Decide when to offer them by default; add Block/Chronicles
  once known.
- [ ] **Deckbuilder:** search and filter the 1,230 cards, build a deck, and check it
  against the chosen format (the lobby only has a text box now).
- [ ] **Card art (deferred):** players load their own images in the browser, matched
  to cards by name, never uploaded.
- [ ] **Hide the card being paid for:** while a player chooses how to pay, the
  opponent sees their hand count drop by one.
- [ ] **Open R&D faction:** its "invent an ability" rule is manual.
- [ ] **Showdown variant** (The Evil Alliance, Slightly Less Evil Alliance):
  multiplayer, out of scope unless wanted.
- [ ] **10 promo or epic cards** with text but no numbers in the database aren't
  imported.
- [ ] **Hosting online:** the user handles this. `npm run build` then `npm start`
  serves everything on one port.

## 5. Check in a browser

- [ ] The latest layout changes: collapsed empty regions, smaller screens, gear
  behind its character, the stack zone, the "manual" tag, and the deck viewer.

## Reference

- Rules model and rulings: `docs/SPEC.md` (section 13).
- Card language: `docs/CARDS.md`.
- Pattern report: `docs/PATTERNS.md` (`npm run patterns`).
- Card database source: `~/Downloads/spoilstoolbox.com-master/spoilstoolbox.com-master/content/cards/`
  (`card-texts.json` for latest wordings; faction data had to be read from the card
  images there).
- Sample decks in `decks/`: AWR Fornicaves Control, Monty and Meat (every card in
  them is automated). Meat's list had no faction, so it uses The Tournament Faction.
