// WebSocket connection with automatic reconnect, and the no-account identity:
// a random secret kept in localStorage whose hash (computed by the server) is
// the user id.

import { useEffect, useRef, useState } from "react";
import type { CardLibrary, Format, GameView } from "../../engine/index.ts";

export interface User {
  id: string;
  name: string;
  tag: string;
}
export interface RoomInfo {
  id: string;
  name: string;
  players: string[];
  started: boolean;
  ended: boolean;
  first?: "random" | "creator" | "joiner";
  format?: string;
}
export interface CurrentRoom {
  id: string;
  name: string;
  seat: "A" | "B";
  players: string[];
}

const SECRET_KEY = "arcainist.secret";
const NAME_KEY = "arcainist.name";

export function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: identity just won't persist */
  }
  return value ?? null;
}

export function newSecret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const savedIdentity = () => ({ secret: store(SECRET_KEY), name: store(NAME_KEY) ?? "" });
export const saveIdentity = (secret: string, name: string) => {
  store(SECRET_KEY, secret);
  store(NAME_KEY, name);
};

export interface Net {
  connected: boolean;
  user: User | null;
  cards: CardLibrary | null;
  formats: Record<string, Format>;
  /** Non-blocking messages from the server (deck warnings). */
  notice: string | null;
  rooms: RoomInfo[];
  room: CurrentRoom | null;
  view: GameView | null;
  error: string | null;
  clearError: () => void;
  send: (msg: unknown) => void;
}

export function useNet(identity: { secret: string; name: string } | null): Net {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [cards, setCards] = useState<CardLibrary | null>(null);
  const [formats, setFormats] = useState<Record<string, Format>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [room, setRoom] = useState<CurrentRoom | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!identity) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ t: "hello", secret: identity.secret, name: identity.name }));
      };
      sock.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.t) {
          case "welcome":
            setUser(msg.user);
            setCards(msg.cards);
            setFormats(msg.formats ?? {});
            break;
          case "rooms":
            setRooms(msg.rooms);
            break;
          case "room":
            setRoom(msg.room);
            setView(msg.view);
            break;
          case "left":
            setRoom(null);
            setView(null);
            break;
          case "error":
            setError(msg.message);
            break;
          case "notice":
            setNotice(msg.message);
            break;
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws.current?.close();
    };
  }, [identity?.secret, identity?.name]);

  return {
    connected,
    user,
    cards,
    formats,
    notice,
    rooms,
    room,
    view,
    error,
    clearError: () => {
      setError(null);
      setNotice(null);
    },
    send: (msg) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg)),
  };
}
