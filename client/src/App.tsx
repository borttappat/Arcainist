import { useEffect, useState } from "react";
import { Board } from "./Board.tsx";
import { Lobby, savedDeck } from "./Lobby.tsx";
import { newSecret, savedIdentity, saveIdentity, useNet, type Net } from "./net.ts";

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
        {net.room && <LeaveButton net={net} />}
      </header>
      {net.room && net.view && <SeatBar net={net} />}
      {(net.error || net.notice) && (
        <div className={`toast ${net.error ? "" : "notice"}`} onClick={net.clearError}>
          <pre>{net.error ?? net.notice}</pre>
          <span className="muted">click to dismiss</span>
        </div>
      )}
      {!net.user || !net.cards ? (
        <div className="center muted">Connecting…</div>
      ) : net.room && net.view ? (
        <Board view={net.view} cards={net.cards} send={(action) => net.send({ t: "action", action })} />
      ) : net.room ? (
        <WaitingRoom net={net} />
      ) : (
        <Lobby net={net} />
      )}
    </div>
  );
}

/**
 * Leaving a running game you play in: concede, or give up your seat so a spectator
 * can take over. Spectators and finished games just leave.
 */
function LeaveButton({ net }: { net: Net }) {
  const [asking, setAsking] = useState(false);
  const playing = !!net.room?.seat && !!net.view && net.view.phase !== "ended";
  if (!playing) {
    return (
      <button className="ghost" onClick={() => net.send({ t: "leave" })}>
        Leave
      </button>
    );
  }
  if (!asking) {
    return (
      <button className="ghost" onClick={() => setAsking(true)}>
        Leave…
      </button>
    );
  }
  return (
    <span className="row">
      <button onClick={() => net.send({ t: "leave", mode: "open_seat" })} title="The game goes on; a spectator can take your seat">
        Give up my seat
      </button>
      <button onClick={() => confirm("Concede this game?") && net.send({ t: "leave" })}>Concede</button>
      <button className="ghost" onClick={() => setAsking(false)}>
        Stay
      </button>
    </span>
  );
}

/** Who sits where, who is connected, and the seat actions: take an open seat, or open a long-disconnected opponent's. */
function SeatBar({ net }: { net: Net }) {
  const room = net.room!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const running = net.view!.phase !== "ended";
  return (
    <div className="seatbar">
      {room.seats.map((s) => {
        const mine = room.seat === s.seat;
        const opponentGone = !!room.seat && !mine && !s.connected && !s.open && s.openableAt !== null;
        return (
          <span key={s.seat} className="seat">
            <span className={`dot ${s.open ? "open" : s.connected ? "on" : "off"}`} />
            {s.player ?? "empty"}
            {s.open ? <span className="muted"> (seat open)</span> : !s.connected && <span className="muted"> (disconnected)</span>}
            {running && s.open && !room.seat && (
              <button className="small" onClick={() => net.send({ t: "take_seat", seat: s.seat })}>
                Take seat
              </button>
            )}
            {running && opponentGone && (
              <button className="small" disabled={now < s.openableAt!} onClick={() => net.send({ t: "open_seat" })} title="Let a spectator take over for them">
                {now < s.openableAt! ? `Open seat in ${Math.ceil((s.openableAt! - now) / 1000)}s` : "Open their seat"}
              </button>
            )}
          </span>
        );
      })}
      <span className="spacer" />
      <span className="muted">
        {room.seat ? "" : "Spectating · "}
        {room.spectators.length ? `Watching: ${room.spectators.join(", ")}` : "No spectators"}
      </span>
    </div>
  );
}

/**
 * Before the game: players take and leave seats, spectators wait, and the owner
 * starts the game once both seats are filled.
 */
function WaitingRoom({ net }: { net: Net }) {
  const room = net.room!;
  const full = room.seats.every((s) => s.player);
  const first = room.first === "random" ? "die roll" : room.first === "creator" ? `${room.owner} goes first` : `${room.owner}'s opponent goes first`;
  return (
    <div className="center">
      <div className="panel waiting-room">
        <h2>{room.name}</h2>
        <p className="muted">
          {room.format} · {first} · owner {room.owner}
        </p>
        <ul className="seats">
          {room.seats.map((s) => (
            <li key={s.seat}>
              <span className={`dot ${s.player ? (s.connected ? "on" : "off") : "open"}`} />
              <span className="grow">
                {s.player ?? <span className="muted">empty seat</span>}
                {s.player === room.owner && <span className="muted"> (owner)</span>}
                {s.player && !s.connected && <span className="muted"> (disconnected)</span>}
              </span>
              {room.seat === s.seat ? (
                <button className="small" onClick={() => net.send({ t: "stand" })} title="Watch instead; someone else can sit here">
                  Leave seat
                </button>
              ) : (
                !s.player &&
                !room.seat && (
                  <button className="small" onClick={() => net.send({ t: "sit", seat: s.seat, deck: savedDeck() })} title="Sit down with the deck from the lobby">
                    Take seat
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
        <p className="muted">{room.spectators.length ? `Watching: ${room.spectators.join(", ")}` : "No spectators"}</p>
        {room.isOwner ? (
          <button className="primary" disabled={!full} onClick={() => net.send({ t: "start" })}>
            {full ? "Start game" : "Waiting for players…"}
          </button>
        ) : (
          <p>Waiting for {room.owner} to start the game…</p>
        )}
        <p className="muted">Anyone connected to this server will see the room in their lobby.</p>
      </div>
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
