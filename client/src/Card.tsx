import type { CardDef, CardView, Icon, Icons } from "../../engine/index.ts";
import { useCardImages } from "./images.ts";
import { useSettings } from "./prefs.ts";

export const ICON_LETTER: Record<Icon, string> = {
  obsession: "O",
  greed: "G",
  elitism: "E",
  deception: "D",
  rage: "R",
  volition: "V",
};

export function Pips({ icons, size = "sm" }: { icons?: Icons; size?: "sm" | "md" }) {
  if (!icons) return null;
  const list = Object.entries(icons).flatMap(([k, n]) => Array.from({ length: n ?? 0 }, () => k as Icon));
  if (!list.length) return null;
  return (
    <span className={`pips ${size}`}>
      {list.map((k, i) => (
        <span key={i} className={`pip icon-${k}`} title={k}>
          {ICON_LETTER[k]}
        </span>
      ))}
    </span>
  );
}

export function typeLine(d: CardDef): string {
  const trade = d.trade && d.trade !== "staple" && d.trade !== "none" ? d.trade[0].toUpperCase() + d.trade.slice(1) + " " : "";
  const types = d.types.map((t) => t[0].toUpperCase() + t.slice(1)).join(" ");
  const sub = d.subtypes?.length ? ` - ${d.subtypes.join(", ")}` : "";
  return `${d.staple ? "Staple " : trade}${types}${sub}`;
}

interface TileProps {
  def: CardDef | null;
  card?: CardView;
  className?: string;
  tag?: string;
  onClick?: (e: React.MouseEvent) => void;
  onHover?: (def: CardDef | null) => void;
}

/** A card on the table or in hand. Face-down / hidden cards render as a card back. */
export function Tile({ def, card, className = "", tag, onClick, onHover }: TileProps) {
  const hidden = !def;
  const faceDown = card?.faceDown;
  const images = useCardImages();
  const mode = useSettings().images;
  const art = !hidden && mode === "all" ? images[def!.id] : undefined;
  const cls = [
    "tile",
    hidden ? "back" : `trade-${def!.trade}`,
    art ? "has-art" : "",
    card?.depleted ? "depleted" : "",
    faceDown && !hidden ? "facedown-own" : "",
    className,
  ].join(" ");
  const stat = (k: "str" | "life" | "spd") => {
    const now = card?.[k];
    const printed = def?.stats?.[k] ?? now;
    if (printed === undefined) return null;
    const v = now ?? printed;
    return <span className={`stat stat-${k} ${v > printed ? "up" : v < printed ? "down" : ""}`}>{v}</span>;
  };
  return (
    <div data-iid={card?.iid} className={cls} onClick={onClick} onMouseEnter={() => onHover?.(def)} onMouseLeave={() => onHover?.(null)}>
      {hidden ? (
        <div className="back-face">{card?.isResource ? "V" : "?"}</div>
      ) : (
        <>
          {art && <img className="art" src={art} alt={def!.name} draggable={false} />}
          <div className="tile-head">
            {def!.cost !== undefined && <span className="cost">{def!.cost}</span>}
            <span className="tile-name">{def!.name}</span>
          </div>
          <Pips icons={def!.threshold} />
          <div className="tile-type">{typeLine(def!)}</div>
          {faceDown && <div className="fd-label">face-down</div>}
          {!!card?.keywords?.length && <div className="kw">{card.keywords.join(" · ")}</div>}
          {card?.notes && Object.keys(card.notes).length > 0 && (
            <div className="notes" title="Remembered choice">
              {Object.values(card.notes)
                .filter((v) => typeof v === "string")
                .join(", ")}
            </div>
          )}
          {(def!.stats || card?.str !== undefined) && !faceDown && (
            <div className="stats">
              {stat("str")}
              {stat("life")}
              {stat("spd")}
            </div>
          )}
          {def!.structure !== undefined && !faceDown && (
            <div className="stats">
              <span className="stat stat-structure">{card?.structure ?? def!.structure}</span>
            </div>
          )}
        </>
      )}
      {card && card.damage > 0 && <span className="dmg">{card.damage}</span>}
      {card && card.markers > 0 && <span className="dmg">{card.markers}</span>}
      {card?.revealed && <span className="revealed" title="Revealed">👁</span>}
      {!!card?.tokens && (
        <span className="tokens" title="Tokens">
          ◆{card.tokens}
        </span>
      )}
      {tag && <span className="tag">{tag}</span>}
      {def && def.text && !def.rules && !def.staple && !def.types.includes("faction") && (
        <span className="manual-badge" title="Not automated yet: resolve its text with the manual controls">
          manual
        </span>
      )}
    </div>
  );
}

/** Compact chip for resources in the resource row. */
export function ResourceChip({ def, card, onClick, onHover, className = "" }: TileProps) {
  const icon: Icon | undefined = card?.faceDown ? "volition" : (def?.icon ?? (Object.keys(def?.provides ?? {})[0] as Icon | undefined));
  return (
    <div
      data-iid={card?.iid}
      className={`res ${card?.attached ? "spent" : ""} ${className}`}
      onClick={onClick}
      onMouseEnter={() => onHover?.(def)}
      onMouseLeave={() => onHover?.(null)}
      title={card?.attached ? "Attached to faction (spent)" : "Available"}
    >
      <span className={`pip icon-${icon ?? "volition"}`}>{ICON_LETTER[icon ?? "volition"]}</span>
      <span className="res-name">{card?.faceDown ? (def ? def.name : "Face-down") : (def?.name ?? "?")}</span>
    </div>
  );
}

export function Preview({ def }: { def: CardDef | null }) {
  const images = useCardImages();
  const showArt = useSettings().images !== "off";
  if (!def) return <div className="preview empty muted">Hover a card to read it.</div>;
  const art = showArt ? images[def.id] : undefined;
  return (
    <div className={`preview trade-${def.trade}`}>
      {art && <img className="preview-art" src={art} alt={def.name} />}
      <div className="preview-head">
        {def.cost !== undefined && <span className="cost big">{def.cost}</span>}
        <div>
          <div className="preview-name">{def.name}</div>
          {def.flavor_title && <div className="flavor">{def.flavor_title}</div>}
        </div>
      </div>
      <Pips icons={def.threshold} size="md" />
      <div className="preview-type">{typeLine(def)}</div>
      {def.influence !== undefined && <div className="preview-stats">Influence {def.influence}</div>}
      {def.stats && (
        <div className="preview-stats">
          STR {def.stats.str} · LIFE {def.stats.life} · SPD {def.stats.spd}
        </div>
      )}
      {def.structure !== undefined && <div className="preview-stats">Structure {def.structure}</div>}
      {def.text && <div className="preview-text">{def.text}</div>}
    </div>
  );
}
