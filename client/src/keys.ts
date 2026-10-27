// Keyboard play. Two groups:
//   Space: the highlighted (primary) action. E: end your turn (Space never does).
//   Arrow keys: move the cursor between choices. Enter: click the choice under it.
// Escape cancels, closes or goes back a step. A few letters jump somewhere: F your
// faction, B hand or battlefield, D deck, X discard pile, V void.

import { useEffect, useRef } from "react";
import { store } from "./net.ts";

export interface KeyHandlers {
  space?: () => void;
  enter?: () => void;
  escape?: () => void;
  up?: () => void;
  down?: () => void;
  left?: () => void;
  right?: () => void;
  /** Letter keys, by lower-case letter: e (end turn), f (faction), b, d, x, v. */
  letters?: Record<string, () => void>;
}

const KEYS: Record<string, Exclude<keyof KeyHandlers, "letters">> = {
  Space: "space",
  Enter: "enter",
  NumpadEnter: "enter",
  Escape: "escape",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Layers: the board (0), a window over it such as a pile or Settings (1), a card's
 * menu (2). Only the top layer gets keys; among equals, the newest.
 */
export const LAYER = { board: 0, window: 1, menu: 2 } as const;

interface Layer {
  z: number;
  ref: { current: KeyHandlers };
  inInputs: string[];
}
const layers: Layer[] = [];

function onKey(ev: KeyboardEvent) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const top = layers.reduce<Layer | null>((t, l) => (!t || l.z >= t.z ? l : t), null);
  if (!top) return;
  const h = top.ref.current;
  const name = KEYS[ev.code] ?? (ev.code.startsWith("Key") ? ev.code.slice(3).toLowerCase() : undefined);
  if (!name) return;
  const fn = name.length === 1 ? h.letters?.[name] : h[name as Exclude<keyof KeyHandlers, "letters">];
  // Space and Enter are always ours, even with nothing to do: a button left focused
  // by a click must not be pressed by them (Space must never end the turn).
  if (!fn && name !== "space" && name !== "enter") return;
  // Arrows may repeat while held; actions may not.
  if (ev.repeat && !["up", "down", "left", "right"].includes(name)) return;
  const t = ev.target;
  if (t instanceof Element && t.closest("input, textarea, select, [contenteditable]") && !top.inInputs.includes(name)) return;
  ev.preventDefault();
  // A button focused by an earlier click would otherwise be clicked too.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  if (fn) fn();
}

/**
 * Listen for keys while `active`, on layer `z`. Keys typed into a text field are left
 * alone, except those listed in `inInputs` (the arrow keys and Enter of a search box).
 */
export function useKeys(handlers: KeyHandlers, active = true, z: number = LAYER.board, inInputs: string[] = []): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!active) return;
    const layer: Layer = { z, ref, inInputs };
    if (!layers.length) window.addEventListener("keydown", onKey);
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) window.removeEventListener("keydown", onKey);
    };
  }, [active, z]);
}

/** Step through `items` from `current`, wrapping around. */
export function step(items: string[], current: string | null, by: number): string | null {
  if (!items.length) return null;
  const i = current === null ? -1 : items.indexOf(current);
  if (i < 0) return items[by > 0 ? 0 : items.length - 1];
  return items[(i + by + items.length) % items.length];
}

// The option a player picked last time for the same question, so it starts selected
// (the Develop Rule's "play a resource" for a player who usually plays one).
const memoKey = (prompt: string, labels: string[]) => `arcainist.last:${prompt}|${[...labels].sort().join("|")}`;

export function rememberChoice(prompt: string, labels: string[], chosen: string): void {
  store(memoKey(prompt, labels), chosen);
}

export function recallChoice(prompt: string, labels: string[]): string | null {
  return store(memoKey(prompt, labels));
}
