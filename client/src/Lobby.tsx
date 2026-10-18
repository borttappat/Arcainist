import { useMemo, useState } from "react";
import { parseDeck } from "../../engine/deck.ts";
import type { Net } from "./net.ts";
import { savedIdentity, store } from "./net.ts";

const DECK_KEY = "arcainist.deck";
// Every decklist in decks/ becomes a sample button.
const SAMPLES = Object.entries(import.meta.glob("../../decks/*.txt", { query: "?raw", import: "default", eager: true }) as Record<string, string>)
  .map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.txt$/, "").replace(/-/g, " "), text }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function Lobby({ net }: { net: Net }) {
  const [deck, setDeck] = useState(() => store(DECK_KEY) ?? SAMPLES[0]?.text ?? "");
  const [roomName, setRoomName] = useState("");
  const [showKey, setShowKey] = useState(false);
  const parsed = useMemo(() => parseDeck(deck, net.cards!), [deck, net.cards]);

  const update = (text: string) => {
    setDeck(text);
    store(DECK_KEY, text);
  };
  const secret = savedIdentity().secret;

  return (
    <div className="lobby">
      <section className="panel">
        <h2>Your deck</h2>
        <div className="row wrap">
          {SAMPLES.map((s) => (
            <button key={s.name} className="small" onClick={() => update(s.text)}>
              {s.name}
            </button>
          ))}
        </div>
        <textarea value={deck} onChange={(e) => update(e.target.value)} spellCheck={false} rows={16} />
        {parsed.errors.length ? (
          <ul className="errors">
            {parsed.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {net.cards![parsed.faction!].name} · {parsed.cards.length} cards
          </p>
        )}
        <details>
          <summary>Card pool ({Object.keys(net.cards!).length})</summary>
          <ul className="pool">
            {Object.values(net.cards!)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <li key={c.id}>
                  <b>{c.name}</b> <span className="muted">{c.types.join(" ")}</span>
                </li>
              ))}
          </ul>
        </details>
      </section>

      <section className="panel">
        <h2>Games</h2>
        <div className="row">
          <input value={roomName} placeholder="Room name (optional)" onChange={(e) => setRoomName(e.target.value)} />
          <button className="primary" disabled={!!parsed.errors.length} onClick={() => net.send({ t: "create", name: roomName, deck })}>
            Create game
          </button>
        </div>
        {net.rooms.length === 0 && <p className="muted">No open games. Create one and share this server's address with a friend.</p>}
        <ul className="rooms">
          {net.rooms.map((r) => {
            const mine = r.players.some((p) => p === `${net.user!.name}#${net.user!.tag}`);
            const open = !r.started && r.players.length < 2;
            return (
              <li key={r.id}>
                <div>
                  <b>{r.name}</b>
                  <div className="muted">
                    {r.players.join(" vs ") || "empty"} · {r.ended ? "finished" : r.started ? "in progress" : "waiting"}
                  </div>
                </div>
                {(open || mine) && (
                  <button disabled={!mine && !!parsed.errors.length} onClick={() => net.send({ t: "join", room: r.id, deck })}>
                    {mine ? "Rejoin" : "Join"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {secret && (
          <div className="identity">
            <button className="link" onClick={() => setShowKey(!showKey)}>
              {showKey ? "Hide" : "Show"} identity key
            </button>
            {showKey && (
              <>
                <code>{secret}</code>
                <p className="muted">Paste this on another device to play as the same identity. Anyone with this key can use your name.</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
