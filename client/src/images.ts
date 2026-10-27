// Card images, supplied by the player: the server never ships card art. Imported
// files are kept in this browser's IndexedDB, keyed by card id.
//
// A file matches a card by name ("A Blazing Zero.jpg", "ABlazingZero.jpg",
// "a-blazing-zero.png"), or by printing id when the selection includes a set list
// naming its printings (the spoilstoolbox.com dump: sets/<Set>/set.json next to
// <printing-uuid>.jpg). With several printings, the latest set wins.

import { useSyncExternalStore } from "react";
import type { CardLibrary } from "../../engine/index.ts";

const DB = "arcainist";
const STORE = "images";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

// Object URLs by card id; replaced as a whole on every change.
let urls: Record<string, string> = {};
const listeners = new Set<() => void>();

function publish(next: Record<string, string>) {
  for (const u of Object.values(urls)) URL.revokeObjectURL(u);
  urls = next;
  listeners.forEach((l) => l());
}

async function load() {
  const db = await open();
  const tx = db.transaction(STORE);
  const keys = tx.objectStore(STORE).getAllKeys();
  const blobs = tx.objectStore(STORE).getAll();
  await done(tx);
  const next: Record<string, string> = {};
  keys.result.forEach((k, i) => (next[String(k)] = URL.createObjectURL(blobs.result[i] as Blob)));
  publish(next);
}

load().catch(() => {
  /* no IndexedDB (private window): images just aren't available */
});

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i;

export interface ImportResult {
  stored: number;
  unmatched: number;
}

/** Import image files (and any set lists among them) for the cards in `cards`. */
export async function importImages(files: File[], cards: CardLibrary): Promise<ImportResult> {
  const byName = new Map<string, string>();
  for (const def of Object.values(cards)) {
    byName.set(norm(def.name), def.id);
    byName.set(norm(def.id), def.id);
  }

  // Printing ids from set lists: uuid -> card name, ranked by set order.
  const printings = new Map<string, { name: string; rank: number }>();
  for (const f of files.filter((f) => f.name.endsWith(".json"))) {
    try {
      const set = JSON.parse(await f.text());
      if (!Array.isArray(set?.cards)) continue;
      for (const c of set.cards) if (c?.id && c?.name) printings.set(String(c.id).toLowerCase(), { name: c.name, rank: Number(set.order) || 0 });
    } catch {
      /* not a set list */
    }
  }

  // Best file per card. A file named after the card outranks every set printing.
  const best = new Map<string, { file: File; rank: number }>();
  let unmatched = 0;
  for (const file of files.filter((f) => IMAGE.test(f.name))) {
    const base = file.name.replace(IMAGE, "");
    const printing = printings.get(base.toLowerCase());
    const id = byName.get(norm(printing ? printing.name : base));
    if (!id) {
      unmatched++;
      continue;
    }
    const rank = printing ? printing.rank : Infinity;
    if (!best.has(id) || rank >= best.get(id)!.rank) best.set(id, { file, rank });
  }

  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  for (const [id, { file }] of best) tx.objectStore(STORE).put(file, id);
  await done(tx);
  await load();
  return { stored: best.size, unmatched };
}

export async function clearImages() {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await done(tx);
  publish({});
}

/** Object URLs of the stored images, by card id. */
export function useCardImages(): Record<string, string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => urls,
  );
}
