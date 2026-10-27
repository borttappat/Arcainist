<pre>
    ___                    _       _      __
   /   |  ______________ _(_)___  (_)____/ /_
  / /| | / ___/ ___/ __ `/ / __ \/ / ___/ __/
 / ___ |/ /  / /__/ /_/ / / / / / (__  ) /_
/_/  |_/_/   \___/\__,_/_/_/ /_/_/____/\__/
                                
                               Have fun
                               Play Spoils
</pre>

An online two-player client for **The Spoils** card game, in the spirit of
Jinteki.net. No accounts: pick a name, paste a decklist, create or join a game.

Unofficial fan project, not affiliated with or endorsed by the owners of The
Spoils. See [License](#license).

Proof of concept. The rules model and every ruling or assumption are in
[`docs/SPEC.md`](docs/SPEC.md); the card language is in [`docs/CARDS.md`](docs/CARDS.md).




## Running it

Needs Node 22 or newer (`nix develop` provides one).

```sh
npm install
npm run dev        # server on :8080, client on http://localhost:5173
```

Open the client in two browser windows (one normal, one private, or "Play as
guest" in the second) to play against yourself.

For a single-process deployment:

```sh
npm run build      # builds the client into dist/
npm start          # serves dist/ and the game socket on $PORT (default 8080)
```

### Hosting

On a fresh machine with Node 22 or newer (`nix develop` provides one):

```sh
git clone https://github.com/<owner>/Arcainist && cd Arcainist
npm ci             # exact versions from package-lock.json
npm run build
PORT=8080 npm start
```

Expose only this production server, never the development server on :5173,
which can serve source files. If you run a modified version, set `repository` in
`package.json` to where your source is: the client links to it, as the AGPL
requires of a public server. All state is
in memory: restarting the server ends every game in progress. To update, run
`git pull && npm ci && npm run build`, then restart.

Other commands: `npm test` (engine tests), `npm run typecheck`, `npm run patterns` (rule-pattern report over every card, written to `docs/PATTERNS.md`).

## How it works

| Path | What |
|---|---|
| `engine/` | Pure rules engine. No I/O; deterministic from a seed. |
| `engine/game.ts` | Turn flow, the stack, costs and effects (the card language's steps), battles, manual actions. |
| `engine/query.ts` | Selectors, values, conditions, and the modifier system (derived stats, icons, costs, permissions). |
| `engine/scripts.ts` | TypeScript for the few cards that don't fit the card language. |
| `engine/view.ts` | What each player is allowed to see, plus legal-action hints for the UI. |
| `tools/patterns.ts` | Rule-pattern analysis: which rules occur on which cards, and which the engine supports. |
| `engine/test/` | Scenario tests per mechanic, plus a fuzz test that plays random games with every card. |
| `server/` | WebSocket server: identity, rooms, sends each player their view. |
| `client/` | React UI. |
| `cards/` | Two files per card: `<id>.json` (numbers) and `<id>.yaml` (text and rules). All 1,231 cards from the card database; 1,197 have rules the engine runs, the rest are played with manual controls. |
| `formats/` | Deck-building formats (Casual, Constructed, Limited) as JSON; checked by `engine/formats.ts`. |
| `decks/` | Sample decklists; every file here shows up as a sample in the lobby. |

**Identity.** The browser generates a random key and stores it locally. The server
hashes it into your user id; your name shows as `name#abcd`. "Show identity key"
in the lobby lets you copy it to another device. Guests get a throwaway key.

**Hidden information.** The server holds the full game state and only sends
filtered views, so the opponent's hand, both decks and the opponent's face-down
cards never reach your browser.

**Card images.** None are distributed. In Settings, each player can import
their own scans into their browser (matched to cards by file name, or by the
`set.json` files of the spoilstoolbox.com card dump); they never reach the server.

**Themes.** Colour themes are `client/src/themes/<name>.css`. `npm run theme --
<name> [colors.json]` makes one from a pywal scheme.

**Manual controls.** Click any of your cards for manual actions (move, flip,
deplete, damage, attach) and use the influence, Draw and Shuffle buttons. These
are logged in orange and let you play cards the engine doesn't handle yet.

## Adding or changing cards

Each card is `cards/<id>.json` (cost, threshold, stats and other numbers) plus
`cards/<id>.yaml` (name, text and rules). To rebalance a card, edit its JSON. To
add one, create both files and restart the server. The card language is documented
in `docs/CARDS.md`, and the existing files are the best examples. Card files are
validated at startup, so a mistake is reported immediately rather than failing
mid-game.

Decklists reference cards by name:

```
Faction: The Tournament Faction
10 Deception
4 Fired Hand
```

## License

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0-only). If you run a modified version as a public server, you must offer
its source to the players.

The Spoils, its card names, rules text and numbers belong to their owners and are
not covered by that license; see [NOTICE](NOTICE). No card art or rulebooks are
included.
