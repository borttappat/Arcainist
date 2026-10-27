// Turns a pywal colour scheme into a client theme: client/src/themes/<name>.css.
//
//   npm run theme -- <name> [path/to/colors.json]
//
// The path defaults to ~/.cache/wal/colors.json. Only the neutrals and the accent
// come from the scheme; semantic colours (damage red, life green, icons, trades)
// keep the defaults, since a monochrome scheme has nothing to tell them apart with.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [name, path = join(homedir(), ".cache/wal/colors.json")] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("usage: npm run theme -- <name> [colors.json]   (name: lowercase letters, digits, dashes)");
  process.exit(1);
}

const wal = JSON.parse(readFileSync(path, "utf8"));
const bg: string = wal.special.background;
const fg: string = wal.special.foreground;
const accent: string = wal.colors.color4;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
/** `t` of the way from a to b. */
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};
const luma = (c: string) => {
  const [r, g, b] = rgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const vars: Record<string, string> = {
  bg,
  "bg-2": mix(bg, fg, 0.04),
  panel: mix(bg, fg, 0.08),
  "panel-2": mix(bg, fg, 0.13),
  line: mix(bg, fg, 0.24),
  text: fg,
  muted: mix(bg, fg, 0.55),
  accent,
  "accent-ink": luma(accent) > 128 ? mix(bg, "#000000", 0.5) : "#ffffff",
  "bg-glow": mix(bg, accent, 0.08),
  "back-1": mix(bg, fg, 0.1),
  "back-2": mix(bg, fg, 0.15),
};

const css = `/* Generated from ${path.replace(homedir(), "~")} by \`npm run theme -- ${name}\`. Edit the scheme and regenerate. */
:root[data-theme="${name}"] {
${Object.entries(vars)
  .map(([k, v]) => `  --${k}: ${v};`)
  .join("\n")}
  color-scheme: ${luma(bg) > 128 ? "light" : "dark"};
}
`;
const out = new URL(`../client/src/themes/${name}.css`, import.meta.url);
writeFileSync(out, css);
console.log(`wrote ${out.pathname}`);
