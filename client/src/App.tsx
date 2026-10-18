import { useState } from "react";
import { Board } from "./Board.tsx";
import { Lobby } from "./Lobby.tsx";
import { newSecret, savedIdentity, saveIdentity, useNet } from "./net.ts";

export function App() {
  const [identity, setIdentity] = useState<{ secret: string; name: string } | null>(null);
  const net = useNet(identity);

  if (!identity) return <Login onLogin={setIdentity} />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Arcainist</span>
        {net.room && (
          <span className="room-name">
            {net.room.name} <span className="muted">· {net.room.players.join(" vs ")}</span>
          </span>
        )}
        <span className="spacer" />
        {!net.connected && <span className="badge warn">Reconnecting…</span>}
        {net.user && (
          <span className="who">
            {net.user.name}
            <span className="muted">#{net.user.tag}</span>
          </span>
        )}
        {net.room && (
          <button className="ghost" onClick={() => (!net.view || net.view.phase === "ended" || confirm("Leave and concede this game?")) && net.send({ t: "leave" })}>
            Leave
          </button>
        )}
      </header>
      {net.error && (
        <div className="toast" onClick={net.clearError}>
          <pre>{net.error}</pre>
          <span className="muted">click to dismiss</span>
        </div>
      )}
      {!net.user || !net.cards ? (
        <div className="center muted">Connecting…</div>
      ) : net.room && net.view ? (
        <Board view={net.view} cards={net.cards} send={(action) => net.send({ t: "action", action })} />
      ) : net.room ? (
        <div className="center">
          <div className="panel waiting-room">
            <h2>{net.room.name}</h2>
            <p>Waiting for an opponent to join…</p>
            <p className="muted">Anyone connected to this server will see the room in their lobby.</p>
          </div>
        </div>
      ) : (
        <Lobby net={net} />
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (id: { secret: string; name: string }) => void }) {
  const saved = savedIdentity();
  const [name, setName] = useState(saved.name);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState("");

  const go = (guest: boolean) => {
    const n = name.trim() || (guest ? "Guest" : "Player");
    if (guest) return onLogin({ secret: newSecret(), name: n });
    const secret = importing && imported.trim().length >= 16 ? imported.trim() : (saved.secret ?? newSecret());
    saveIdentity(secret, n);
    onLogin({ secret, name: n });
  };

  return (
    <div className="center login">
      <div className="panel">
        <h1 className="brand big">Arcainist</h1>
        <p className="muted">Play The Spoils online. No account: your identity is a secret key stored in this browser.</p>
        <label>
          Name
          <input value={name} maxLength={24} placeholder="Your name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(false)} autoFocus />
        </label>
        {importing && (
          <label>
            Identity key from another device
            <input value={imported} onChange={(e) => setImported(e.target.value)} placeholder="paste key" />
          </label>
        )}
        <div className="row">
          <button className="primary" onClick={() => go(false)}>
            {saved.secret ? "Continue" : "Create identity"}
          </button>
          <button onClick={() => go(true)}>Play as guest</button>
        </div>
        <button className="link" onClick={() => setImporting(!importing)}>
          {importing ? "Use this browser's identity" : "Use an identity from another device"}
        </button>
      </div>
    </div>
  );
}
