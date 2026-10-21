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

- [ ] Write `rules` for every card without them, in alphabetical batches of about 25
  (about 540 of 1,230 done; 655 cards with text remain):
  - list the batch's cards with their text and numbers;
  - write the rules;
  - append them to the YAML files;
  - run `npm test` (the validator, smoke test and fuzz test).
- [ ] Cards that don't fit the language get a small script in `engine/scripts.ts`. If
  a pattern repeats, promote it into the language instead.
- [ ] Skipped cards, each needing a new building block (see the progress log):
  Arcane Escrow, Cathedrale de Mau, Clockman Skydocks, Counter-Attack, Emergency
  Obfuscation, Geiseric the Souleater, God's Autograph.
- [ ] Gear bonuses: the database has no gear stats. Read "The attached character
  gains N strength..." from each gear card's text into `gear` in its JSON.
- [ ] When done, add a **coverage test** that fails if any playable card (not a
  token, not marked `incomplete`) lacks `rules`.
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
- Test decks with only automated cards: `decks/test-warlord-rogue.txt`,
  `decks/test-banker-gearsmith.txt`.
