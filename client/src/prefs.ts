// Per-browser display settings, kept in localStorage: the colour theme and where
// card images show.

import { useSyncExternalStore } from "react";
import { store } from "./net.ts";

// Every themes/<name>.css is a theme; "arcainist" is the default in styles.css.
const themeFiles = import.meta.glob("./themes/*.css", { eager: true });
export const THEMES = ["arcainist", ...Object.keys(themeFiles).map((p) => p.split("/").pop()!.replace(/\.css$/, "")).sort()];

/** off: text only. preview: the hovered card's image in the sidebar. all: cards on the table too. */
export type ImageMode = "off" | "preview" | "all";

export interface Settings {
  theme: string;
  images: ImageMode;
}

const THEME_KEY = "arcainist.theme";
const IMAGES_KEY = "arcainist.images";

let current: Settings = {
  theme: THEMES.includes(store(THEME_KEY) ?? "") ? store(THEME_KEY)! : "arcainist",
  images: (["off", "preview", "all"] as const).find((m) => m === store(IMAGES_KEY)) ?? "all",
};
const listeners = new Set<() => void>();

export function applyTheme() {
  document.documentElement.dataset.theme = current.theme;
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  store(THEME_KEY, current.theme);
  store(IMAGES_KEY, current.images);
  applyTheme();
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
