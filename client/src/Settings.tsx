import { useState } from "react";
import type { CardLibrary } from "../../engine/index.ts";
import { clearImages, importImages, useCardImages } from "./images.ts";
import { LAYER, useKeys } from "./keys.ts";
import { setSettings, THEMES, useSettings, type ImageMode } from "./prefs.ts";
import { SourceNote } from "./SourceNote.tsx";

const label = (theme: string) => theme[0].toUpperCase() + theme.slice(1);

export function Settings({ cards, close }: { cards: CardLibrary | null; close: () => void }) {
  const settings = useSettings();
  const stored = Object.keys(useCardImages()).length;
  const [status, setStatus] = useState<string | null>(null);
  // Over the board: Esc closes, and the game's keys wait.
  useKeys({ escape: close }, true, LAYER.window);

  const pick = async (list: FileList | null) => {
    if (!list?.length || !cards) return;
    setStatus(`Reading ${list.length} files…`);
    try {
      const r = await importImages(Array.from(list), cards);
      setStatus(`Stored ${r.stored} card images.` + (r.unmatched ? ` ${r.unmatched} images matched no card.` : ""));
    } catch (e) {
      setStatus(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="panel settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Colours
          <select value={settings.theme} onChange={(e) => setSettings({ theme: e.target.value })}>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>

        <h3>Card images</h3>
        <p className="muted">
          Images stay in this browser. Pick a folder of card scans named after the cards ("A Blazing Zero.jpg" or "ABlazingZero.jpg"), or the sets folder of the
          spoilstoolbox.com dump, whose set.json files name each printing. {stored ? `${stored} cards have an image.` : "No images yet."}
        </p>
        <label>
          Show images
          <select value={settings.images} onChange={(e) => setSettings({ images: e.target.value as ImageMode })}>
            <option value="all">On cards and in the preview</option>
            <option value="preview">In the preview only</option>
            <option value="off">Off</option>
          </select>
        </label>
        <div className="row wrap">
          <label className="file-button">
            <input type="file" {...{ webkitdirectory: "" }} onChange={(e) => pick(e.target.files)} disabled={!cards} />
            <span>Import a folder</span>
          </label>
          <label className="file-button">
            <input type="file" accept="image/*,.json" multiple onChange={(e) => pick(e.target.files)} disabled={!cards} />
            <span>Import files</span>
          </label>
          {stored > 0 && (
            <button onClick={() => clearImages().then(() => setStatus("Images removed."))}>Remove all images</button>
          )}
        </div>
        {status && <p className="muted">{status}</p>}
        <SourceNote />
        <div className="row">
          <span className="spacer" />
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
