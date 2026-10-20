// Game server: one WebSocket endpoint (/ws) for lobby and games, plus static
// hosting of the built client in production. All state is in memory.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Game, GameError, parseDeck, validateDeck, viewFor, type Action, type Format, type PlayerId } from "../engine/index.ts";
import { loadFormats, loadLibrary } from "./library.ts";

const ROOT = join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 8080);
const lib = loadLibrary(join(ROOT, "cards"));
const formats: Record<string, Format> = loadFormats(join(ROOT, "formats"));
console.log(`Loaded ${Object.keys(lib).length} cards and ${Object.keys(formats).length} formats.`);

// ---------------------------------------------------------------------------
// Identity: no accounts. The client keeps a random secret; its hash is the user id.

interface User {
  id: string;
  name: string;
  tag: string;
}

function identify(secret: unknown, name: unknown): User {
  if (typeof secret !== "string" || secret.length < 16 || secret.length > 128) throw new GameError("Invalid identity.");
  const clean = typeof name === "string" ? name.trim().replace(/[^\w .-]/g, "").slice(0, 24) : "";
  const id = createHash("sha256").update(secret).digest("hex").slice(0, 16);
  return { id, name: clean || "Player", tag: id.slice(0, 4) };
}

const display = (u: User) => `${u.name}#${u.tag}`;

// ---------------------------------------------------------------------------
// Rooms

interface Seat {
  user: User;
  faction: string;
  cards: string[];
}

interface Room {
  id: string;
  name: string;
  seats: Partial<Record<PlayerId, Seat>>;
  game: Game | null;
  touched: number;
  /** Who goes first, as set by the room's creator. */
  first: "random" | "creator" | "joiner";
  creator: string;
  /** Format id (formats/*.json). */
  format: string;
}

const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, { user: User | null; room: string | null }>();

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roomList() {
  return [...rooms.values()].map((r) => ({
    id: r.id,
    name: r.name,
    players: (["A", "B"] as PlayerId[]).filter((p) => r.seats[p]).map((p) => display(r.seats[p]!.user)),
    started: !!r.game,
    first: r.first,
    format: formats[r.format]?.name ?? r.format,
    ended: r.game?.s.phase === "ended",
  }));
}

function broadcastLobby(): void {
  const msg = { t: "rooms", rooms: roomList() };
  for (const ws of clients.keys()) send(ws, msg);
}

function seatOf(room: Room, user: User): PlayerId | null {
  if (room.seats.A?.user.id === user.id) return "A";
  if (room.seats.B?.user.id === user.id) return "B";
  return null;
}

function pushRoom(room: Room): void {
  for (const [ws, c] of clients) {
    if (c.room !== room.id || !c.user) continue;
    const seat = seatOf(room, c.user);
    if (!seat) continue;
    send(ws, {
      t: "room",
      room: { id: room.id, name: room.name, seat, players: roomList().find((r) => r.id === room.id)?.players ?? [] },
      view: room.game ? viewFor(room.game, seat) : null,
    });
  }
}

/** Parse and check a decklist against the room's format. Warnings go back to the player. */
function deckFrom(text: unknown, format: Format, ws: WebSocket): { faction: string; cards: string[] } {
  if (typeof text !== "string" || text.length > 20000) throw new GameError("Paste a decklist.");
  const d = parseDeck(text, lib);
  const check = validateDeck(d, lib, format);
  if (check.errors.length) throw new GameError(check.errors.join("\n"));
  if (check.warnings.length) send(ws, { t: "notice", message: check.warnings.join("\n") });
  return { faction: d.faction!, cards: d.cards };
}

function startIfReady(room: Room): void {
  const { A, B } = room.seats;
  if (room.game || !A || !B) return;
  const creatorSeat: PlayerId = A.user.id === room.creator ? "A" : "B";
  const first = room.first === "random" ? undefined : room.first === "creator" ? creatorSeat : creatorSeat === "A" ? "B" : "A";
  room.game = Game.create(
    lib,
    randomInt(0, 2 ** 32),
    {
      A: { name: display(A.user), faction: A.faction, cards: A.cards },
      B: { name: display(B.user), faction: B.faction, cards: B.cards },
    },
    { first, format: room.format },
  );
}

function leave(room: Room, user: User): void {
  const seat = seatOf(room, user);
  if (!seat) return;
  if (room.game && room.game.s.phase !== "ended") room.game.act(seat, { type: "concede" });
  if (!room.game) delete room.seats[seat];
  if (!room.seats.A && !room.seats.B) rooms.delete(room.id);
  else if (room.game && room.game.s.phase === "ended") {
    // Keep finished games around briefly so the other player can see the result.
    room.touched = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Messages

function handle(ws: WebSocket, msg: any): void {
  const c = clients.get(ws)!;
  if (msg.t === "hello") {
    c.user = identify(msg.secret, msg.name);
    send(ws, { t: "welcome", user: { id: c.user.id, name: c.user.name, tag: c.user.tag }, cards: lib, formats });
    send(ws, { t: "rooms", rooms: roomList() });
    // Reconnect to a room this identity is seated in.
    for (const room of rooms.values()) {
      if (seatOf(room, c.user)) {
        c.room = room.id;
        pushRoom(room);
        break;
      }
    }
    return;
  }
  const user = c.user;
  if (!user) throw new GameError("Say hello first.");

  switch (msg.t) {
    case "create": {
      const format = formats[msg.format] ?? formats.casual;
      const deck = deckFrom(msg.deck, format, ws);
      const name = typeof msg.name === "string" && msg.name.trim() ? msg.name.trim().slice(0, 40) : `${display(user)}'s game`;
      const id = randomBytes(4).toString("hex");
      const first = msg.first === "me" ? "creator" : msg.first === "opponent" ? "joiner" : "random";
      const room: Room = { id, name, seats: { A: { user, ...deck } }, game: null, touched: Date.now(), first, creator: user.id, format: format.id };
      rooms.set(id, room);
      c.room = id;
      pushRoom(room);
      broadcastLobby();
      return;
    }
    case "join": {
      const room = rooms.get(msg.room);
      if (!room) throw new GameError("That room no longer exists.");
      if (!seatOf(room, user)) {
        if (room.seats.A && room.seats.B) throw new GameError("That room is full.");
        const deck = deckFrom(msg.deck, formats[room.format] ?? formats.casual, ws);
        room.seats[room.seats.A ? "B" : "A"] = { user, ...deck };
        startIfReady(room);
      }
      c.room = room.id;
      room.touched = Date.now();
      pushRoom(room);
      broadcastLobby();
      return;
    }
    case "leave": {
      const room = c.room ? rooms.get(c.room) : undefined;
      c.room = null;
      if (room) {
        leave(room, user);
        pushRoom(room);
      }
      send(ws, { t: "left" });
      broadcastLobby();
      return;
    }
    case "action": {
      const room = c.room ? rooms.get(c.room) : undefined;
      if (!room?.game) throw new GameError("No game in progress.");
      const seat = seatOf(room, user);
      if (!seat) throw new GameError("You are not playing in this room.");
      // An unexpected engine error must not leave the game half-updated: restore it.
      const before = JSON.stringify(room.game.s);
      try {
        room.game.act(seat, msg.action as Action);
      } catch (e) {
        if (!(e instanceof GameError)) {
          const restored = JSON.parse(before);
          for (const k of Object.keys(room.game.s)) delete (room.game.s as any)[k];
          Object.assign(room.game.s, restored);
          room.game.log(`[engine] Internal error; the action was undone. Use manual controls to continue. (${(e as Error).message})`);
          pushRoom(room);
        }
        throw e;
      }
      room.touched = Date.now();
      pushRoom(room);
      if (room.game.s.phase === "ended") broadcastLobby();
      return;
    }
    default:
      throw new GameError(`Unknown message ${msg.t}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP (static client in production) and WebSocket

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const DIST = join(ROOT, "dist");

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end("Client not built. Run `npm run build`, or use `npm run dev`.");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

// Compression matters: every client receives the whole card library (about 0.5 MB) on connect.
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 64 * 1024, perMessageDeflate: true });
wss.on("connection", (ws) => {
  clients.set(ws, { user: null, room: null });
  ws.on("message", (data) => {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: "error", message: e.message });
      else {
        console.error(e);
        send(ws, { t: "error", message: "Server error: " + (e as Error).message });
      }
    }
  });
  ws.on("close", () => clients.delete(ws));
});

// Drop rooms nobody has touched for an hour.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let changed = false;
  for (const [id, r] of rooms) {
    if (r.touched < cutoff) {
      rooms.delete(id);
      changed = true;
    }
  }
  if (changed) broadcastLobby();
}, 60 * 1000).unref();

http.listen(PORT, () => console.log(`Arcainist server on http://localhost:${PORT}`));
