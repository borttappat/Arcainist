import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Action, CardDef, CardLibrary, CardView, GameView, ManualOp, PlayerId, PlayerView } from "../../engine/index.ts";
import { Pips, Preview, ResourceChip, Tile } from "./Card.tsx";
import { LAYER, recallChoice, rememberChoice, step, useKeys, type KeyHandlers } from "./keys.ts";

type Send = (a: Action) => void;

interface Menu {
  iid: string;
  x: number;
  y: number;
}

const other = (p: PlayerId): PlayerId => (p === "A" ? "B" : "A");

export function Board({ view, cards, send }: { view: GameView; cards: CardLibrary; send: Send }) {
  const me = view.you;
  const opp = other(me);
  const [hover, setHover] = useState<CardDef | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [attack, setAttack] = useState<{ attackers: string[]; target: string } | null>(null);
  const [pile, setPile] = useState<{ p: PlayerId; zone: "discard" | "void" } | null>(null);
  // The keyboard cursor: the choice the arrow keys are on (an option id or a card iid).
  const [cursor, setCursor] = useState<string | null>(null);
  // Free play with the keyboard: the arrows move over your hand or the battlefield (B switches).
  const [area, setArea] = useState<"hand" | "field">("hand");
  const [deckView, setDeckView] = useState<"choose" | "list" | null>(null);
  const d = view.pending;

  // Reset local selections whenever the decision changes.
  const decisionKey = JSON.stringify(d);
  useEffect(() => {
    setSel([]);
    setMenu(null);
    if (d?.type !== "main") setAttack(null);
    // Your turn starts with the cursor on a card you can play. (This runs after the
    // prompt's own reset, so it wins.)
    if (d?.type === "main") {
      const hand = view.players[me].hand ?? [];
      setArea("hand");
      setCursor((hand.find((c) => view.legal?.deploy.includes(c.iid) || view.legal?.flipUp.includes(c.iid)) ?? hand[0])?.iid ?? null);
    }
  }, [decisionKey]);

  const all = useMemo(() => {
    const m = new Map<string, CardView>();
    for (const p of [view.players.A, view.players.B]) {
      for (const c of [p.faction, ...(p.hand ?? []), ...(p.deck ?? []), ...p.play, ...p.discard, ...p.void]) m.set(c.iid, c);
    }
    for (const s of view.stack) m.set(s.card.iid, s.card);
    return m;
  }, [view]);
  const defOf = (iid: string): CardDef | null => {
    const c = all.get(iid);
    const id = c?.defId ?? (d && "optionDefs" in d ? d.optionDefs?.[iid] : null);
    return id ? cards[id] : null;
  };

  // Keyboard: the cards the arrows move over when no question is being asked.
  const free = !!d && ["main", "priority", "window", "endturn"].includes(d.type) && !attack && !view.spectator;
  const mine = view.players[me];
  const usable = new Set(view.legal?.abilities.map((a) => a.iid) ?? []);
  const fieldCards = [
    ...mine.play.filter((c) => !c.isResource),
    ...mine.play.filter((c) => c.isResource),
    // Cards you don't control but may use (an ability any player can use).
    ...view.players[opp].play.filter((c) => usable.has(c.iid)),
  ].map((c) => c.iid);
  const areaItems = area === "hand" ? (mine.hand ?? []).map((c) => c.iid) : fieldCards;
  /** Open a card's menu next to it, as a click would. */
  const openMenu = (iid: string) => {
    const r = document.querySelector(`[data-iid="${iid}"]`)?.getBoundingClientRect();
    setMenu({ iid, x: r ? r.left : window.innerWidth / 2, y: r ? r.bottom : window.innerHeight / 2 });
  };
  const switchArea = (to: "hand" | "field") => {
    setArea(to);
    const list = to === "hand" ? (mine.hand ?? []).map((c) => c.iid) : fieldCards;
    setCursor(list[0] ?? null);
  };
  const boardKeys: KeyHandlers = {
    letters: {
      d: () => setDeckView("choose"),
      x: () => setPile({ p: me, zone: "discard" }),
      v: () => setPile({ p: me, zone: "void" }),
    },
  };
  if (d?.type === "main" && !view.spectator) {
    if (!attack && view.legal?.attackers.length)
      boardKeys.letters!.a = () => {
        setAttack({ attackers: [], target: "faction" });
        setCursor(view.legal!.attackers[0]);
      };
    // Attacking: the arrows move over your possible attackers and enemy locations, Enter
    // adds or removes one (or picks the location to attack), Space attacks.
    if (attack && view.legal) {
      const targets = view.legal.targets.filter((t) => t !== "faction");
      const list = [...view.legal.attackers, ...targets];
      const move = (by: number) => setCursor(step(list, list.includes(cursor ?? "") ? cursor : null, by));
      Object.assign(boardKeys, {
        up: () => move(-1),
        left: () => move(-1),
        down: () => move(1),
        right: () => move(1),
        enter: () => {
          if (!cursor) return;
          if (view.legal!.attackers.includes(cursor)) setAttack({ ...attack, attackers: attack.attackers.includes(cursor) ? attack.attackers.filter((x) => x !== cursor) : [...attack.attackers, cursor] });
          else if (targets.includes(cursor)) setAttack({ ...attack, target: attack.target === cursor ? "faction" : cursor });
        },
      });
    }
  }
  if (free) {
    const move = (by: number) => setCursor(step(areaItems, areaItems.includes(cursor ?? "") ? cursor : null, by));
    Object.assign(boardKeys, { up: () => move(-1), left: () => move(-1), down: () => move(1), right: () => move(1) });
    Object.assign(boardKeys.letters!, {
      b: () => switchArea(area === "hand" ? "field" : "hand"),
      f: () => {
        setCursor(mine.faction.iid);
        openMenu(mine.faction.iid);
      },
    });
    // Space opens the card's menu; with no card under the cursor it does the prompt's
    // highlighted action (pass). Esc puts the cursor away while responding.
    if (cursor && (areaItems.includes(cursor) || cursor === mine.faction.iid)) {
      boardKeys.space = () => openMenu(cursor);
      if (d!.type !== "main") boardKeys.escape = () => setCursor(null);
    }
  }

  // Selectable cards for the current decision.
  const selectable = new Set<string>();
  if (d?.type === "choose") for (const o of d.options) if (o.iid) selectable.add(o.iid);
  if (d?.type === "blockers") d.candidates.forEach((i) => selectable.add(i));
  if (attack && view.legal) {
    view.legal.attackers.forEach((i) => selectable.add(i));
    view.legal.targets.filter((t) => t !== "faction").forEach((i) => selectable.add(i));
  }
  const maxSel = d?.type === "choose" ? d.max : d?.type === "blockers" ? 99 : 0;

  const toggle = (iid: string) => {
    setSel((s) => (s.includes(iid) ? s.filter((x) => x !== iid) : maxSel === 1 ? [iid] : s.length < maxSel ? [...s, iid] : s));
  };

  const clickCard = (iid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (attack) {
      if (view.legal?.attackers.includes(iid)) {
        setAttack({ ...attack, attackers: attack.attackers.includes(iid) ? attack.attackers.filter((x) => x !== iid) : [...attack.attackers, iid] });
        return;
      }
      if (view.legal?.targets.includes(iid)) {
        setAttack({ ...attack, target: attack.target === iid ? "faction" : iid });
        return;
      }
    }
    if (selectable.has(iid) && (d?.type === "choose" || d?.type === "blockers")) {
      const id = d.type === "choose" ? (d.options.find((o) => o.iid === iid)?.id ?? iid) : iid;
      setCursor(id);
      // A required single answer is given by the click; otherwise cards are marked, then confirmed.
      if (d.type === "choose" && d.min === 1 && d.max === 1) return send({ type: "answer", ids: [id] });
      toggle(iid);
      return;
    }
    // Spectators can look, not act.
    if (!view.spectator) setMenu({ iid, x: e.clientX, y: e.clientY });
  };

  const cursorIid = d?.type === "choose" ? d.options.find((o) => o.id === cursor)?.iid : cursor;
  const classFor = (iid: string) => {
    const b = view.battle;
    return [
      selectable.has(iid) ? "selectable" : "",
      iid === cursorIid ? "cursor" : "",
      sel.includes(iid) || attack?.attackers.includes(iid) || attack?.target === iid ? "selected" : "",
      view.legal?.deploy.includes(iid) || view.legal?.flipUp.includes(iid) || view.legal?.abilities.some((a) => a.iid === iid) ? "playable" : "",
      b?.attackers.includes(iid) ? "attacking" : "",
      b?.blockers.includes(iid) ? "blocking" : "",
    ].join(" ");
  };
  const tagFor = (iid: string) => {
    const b = view.battle;
    if (!b) return undefined;
    const locked = b.locked[iid] ? ` ${b.locked[iid]}✶` : "";
    if (b.attackers.includes(iid)) return "ATK" + locked;
    if (b.blockers.includes(iid)) return "BLK" + locked;
    return undefined;
  };

  const renderCard = (c: CardView) => (
    <Tile key={c.iid} def={c.defId ? cards[c.defId] : null} card={c} className={classFor(c.iid)} tag={tagFor(c.iid)} onClick={(e) => clickCard(c.iid, e)} onHover={setHover} />
  );

  return (
    <div className="board" onClick={() => setMenu(null)}>
      <div className="table">
        <Side p={view.players[opp]} me={false} view={view} cards={cards} renderCard={renderCard} clickCard={clickCard} classFor={classFor} setHover={setHover} setPile={setPile} send={send} attack={attack} cursor={cursor} openDeck={() => setDeckView("choose")} />

        <div className="midline">
          <Stack view={view} cards={cards} setHover={setHover} />
          <BattleBar view={view} cards={cards} defOf={defOf} />
          <Prompt view={view} cards={cards} send={send} sel={sel} setSel={setSel} defOf={defOf} attack={attack} setAttack={setAttack} setHover={setHover} cursor={cursor} setCursor={setCursor} boardKeys={boardKeys} />
        </div>

        <Side p={view.players[me]} me view={view} cards={cards} renderCard={renderCard} clickCard={clickCard} classFor={classFor} setHover={setHover} setPile={setPile} send={send} attack={attack} cursor={cursor} openDeck={() => setDeckView("choose")} />

        <div className={`hand ${free && area === "hand" ? "kb-area" : ""}`}>
          {(view.players[me].hand ?? []).map(renderCard)}
          {!view.players[me].hand?.length && <span className="muted">Your hand is empty.</span>}
        </div>
      </div>

      <aside className="sidebar">
        <Preview def={hover} />
        <Log view={view} />
      </aside>

      {menu && <CardMenu menu={menu} view={view} card={all.get(menu.iid)!} def={defOf(menu.iid)} send={send} close={() => setMenu(null)} />}
      {pile && <PileViewer view={view} cards={cards} pile={pile} close={() => setPile(null)} clickCard={clickCard} classFor={classFor} setHover={setHover} cursor={cursor} setCursor={setCursor} openMenu={openMenu} />}
      {view.players[me].deck && (
        <DeckViewer view={view} cards={cards} done={(shuffle) => send({ type: "manual", op: { op: "end_search", shuffle } })} clickCard={clickCard} classFor={classFor} setHover={setHover} cursor={cursor} setCursor={setCursor} openMenu={openMenu} />
      )}
      {deckView === "choose" && !view.spectator && (
        <DeckChoice
          close={() => setDeckView(null)}
          list={() => setDeckView("list")}
          search={() => {
            setDeckView(null);
            send({ type: "manual", op: { op: "search_deck" } });
          }}
        />
      )}
      {deckView === "list" && mine.decklist && <Decklist list={mine.decklist} cards={cards} close={() => setDeckView(null)} setHover={setHover} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SideProps {
  p: PlayerView;
  me: boolean;
  view: GameView;
  cards: CardLibrary;
  renderCard: (c: CardView) => React.ReactNode;
  clickCard: (iid: string, e: React.MouseEvent) => void;
  classFor: (iid: string) => string;
  setHover: (d: CardDef | null) => void;
  setPile: (p: { p: PlayerId; zone: "discard" | "void" }) => void;
  send: Send;
  attack: { attackers: string[]; target: string } | null;
  cursor: string | null;
  openDeck: () => void;
}

function Side({ p, me, view, cards, renderCard, clickCard, classFor, setHover, setPile, send, attack, cursor, openDeck }: SideProps) {
  const field = p.play.filter((c) => !c.isResource && !c.host);
  // Gear can be attached to a character on either side of the table.
  const all = [...view.players.A.play, ...view.players.B.play];
  const attachedTo = (iid: string) => all.filter((c) => c.host === iid);
  const res = p.play.filter((c) => c.isResource);
  const active = view.active === p.id;
  const manual = (op: ManualOp) => send({ type: "manual", op });
  const targeted = attack && !me && attack.target === "faction";

  const strip = (
    <div className={`strip ${active ? "active" : ""}`}>
      <div data-iid={p.faction.iid} className={`faction ${targeted ? "selected" : ""} ${cursor === p.faction.iid ? "cursor" : ""}`} onClick={(e) => clickCard(p.faction.iid, e)} onMouseEnter={() => setHover(cards[p.factionId])} onMouseLeave={() => setHover(null)}>
        <div className="faction-name">{cards[p.factionId].name}</div>
        <div className="player-name">{p.name}</div>
      </div>
      <div className="influence" title="Influence">
        {me && (
          <button className="tiny" onClick={() => manual({ op: "influence", delta: -1 })}>
            −
          </button>
        )}
        <span>{p.influence}</span>
        {me && (
          <button className="tiny" onClick={() => manual({ op: "influence", delta: 1 })}>
            +
          </button>
        )}
      </div>
      <div className="counts">
        {me ? (
          <button className="small" title="Your decklist, or search the deck (D)" onClick={openDeck}>
            Deck {p.deckCount}
          </button>
        ) : (
          <span title="Cards in deck">Deck {p.deckCount}</span>
        )}
        <span title="Cards in hand">Hand {p.handCount}</span>
        <button className="small" title={me ? "X" : undefined} onClick={() => setPile({ p: p.id, zone: "discard" })}>
          Discard {p.discard.length}
        </button>
        <button className="small" title={me ? "V" : undefined} onClick={() => setPile({ p: p.id, zone: "void" })}>
          Void {p.void.length}
        </button>
        {me && (
          <>
            <button className="small ghost" title="Manual: draw a card" onClick={() => manual({ op: "draw" })}>
              Draw
            </button>
            <button className="small ghost" title="Manual: shuffle deck" onClick={() => manual({ op: "shuffle" })}>
              Shuffle
            </button>
          </>
        )}
      </div>
      <div className="icons" title="Threshold icons you control">
        <Pips icons={p.icons} />
        <span className="muted" title="Unattached resources / all resources">
          {p.unattached}/{p.resources} available
        </span>
        {me && !view.spectator && (
          <label className="autopay" title="On: costs are paid without asking, using face-down resources first (cheapest FLIP UP first). Off: you choose when it matters.">
            <input type="checkbox" checked={view.players[view.seat].autoPay} onChange={(e) => send({ type: "auto_pay", on: e.target.checked })} />
            Auto-pay
          </label>
        )}
      </div>
    </div>
  );
  const resRow = (
    <div className="resources">
      {res.map((c) => (
        <ResourceChip key={c.iid} def={c.defId ? cards[c.defId] : null} card={c} className={classFor(c.iid)} onClick={(e) => clickCard(c.iid, e)} onHover={setHover} />
      ))}
    </div>
  );
  // Attached gear sits behind its character, offset up and to the right.
  const withGear = (c: CardView) => {
    const gear = attachedTo(c.iid);
    if (!gear.length) return renderCard(c);
    return (
      <div key={c.iid} className="hosted" style={{ marginRight: gear.length * 22 }}>
        {gear.map((g, i) => (
          <div key={g.iid} className="gear-slot" style={{ left: (i + 1) * 22, top: 0, zIndex: gear.length - i }}>
            {renderCard(g)}
          </div>
        ))}
        <div className="host-slot">{renderCard(c)}</div>
      </div>
    );
  };
  const kind = (c: CardView) => (c.types?.includes("character") ? "character" : c.types?.includes("location") ? "location" : "item");
  const region = (k: string, title: string) => {
    const list = field.filter((c) => kind(c) === k);
    return (
      <div className={`region region-${k} ${list.length ? "" : "collapsed"}`}>
        <div className="region-title">
          {title}
          {list.length ? ` (${list.length})` : ""}
        </div>
        {list.length > 0 && <div className="region-cards">{list.map(withGear)}</div>}
      </div>
    );
  };
  const kbField = me && cursor !== null && [...field, ...res].some((c) => c.iid === cursor);
  const fieldRow = (
    <div className={`field ${kbField ? "kb-area" : ""}`}>
      {region("character", "Characters")}
      {region("item", "Items")}
      {region("location", "Locations")}
    </div>
  );
  const revealedHand = !me && p.hand ? (
    <div className="hand revealed-hand">
      <span className="muted">Revealed hand:</span>
      {p.hand.map(renderCard)}
    </div>
  ) : null;

  const rows = me ? [fieldRow, resRow, strip] : [strip, revealedHand, resRow, fieldRow];
  return (
    <div className={`side ${me ? "mine" : "theirs"}`}>
      {rows.map((x, i) => (
        <div key={i}>{x}</div>
      ))}
    </div>
  );
}

/** Cards and abilities waiting to resolve, newest (resolves first) on the left. */
function Stack({ view, cards, setHover }: { view: GameView; cards: CardLibrary; setHover: (d: CardDef | null) => void }) {
  if (!view.stack.length) return null;
  return (
    <div className="stack">
      <div className="region-title">Stack: resolves left to right</div>
      <div className="stack-cards">
        {[...view.stack].reverse().map((s, i) => (
          <div key={s.id} className={`stack-entry ${s.controller === view.you ? "mine" : "theirs"} ${i === 0 ? "top" : ""}`}>
            <Tile def={s.card.defId ? cards[s.card.defId] : null} card={{ ...s.card, depleted: false }} onHover={setHover} />
            <div className="stack-caption">
              {i === 0 && <b>Next: </b>}
              {s.kind === "card" ? "" : s.kind === "duplicate" ? "Duplicate: " : "Ability: "}
              {s.label}
              <div className="muted">{s.controller === view.you ? "yours" : view.players[s.controller].name}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BattleBar({ view, cards, defOf }: { view: GameView; cards: CardLibrary; defOf: (iid: string) => CardDef | null }) {
  const b = view.battle;
  if (!b) return null;
  void cards;
  const target = b.target === "faction" ? `${view.players[b.defender].name}'s faction` : (defOf(b.target)?.name ?? "a location");
  return (
    <div className="battlebar">
      ⚔ {view.players[b.attacker].name} attacks {target}
      {b.covert && " (Covert)"}
      {b.speed !== null && <> · speed {b.speed}</>}
      {b.locked.target ? <> · {b.locked.target} damage locked on target</> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PromptProps {
  view: GameView;
  cards: CardLibrary;
  send: Send;
  sel: string[];
  setSel: (s: string[]) => void;
  defOf: (iid: string) => CardDef | null;
  attack: { attackers: string[]; target: string } | null;
  setAttack: (a: { attackers: string[]; target: string } | null) => void;
  setHover: (d: CardDef | null) => void;
  cursor: string | null;
  setCursor: (c: string | null) => void;
  /** The board's own keys (free play, F, B, D, X, V), merged with the prompt's. */
  boardKeys: KeyHandlers;
}

function Prompt({ view, cards, send, sel, setSel, defOf, attack, setAttack, setHover, cursor, setCursor, boardKeys }: PromptProps) {
  const d = view.pending;
  const [num, setNum] = useState(0);
  const [assign, setAssign] = useState<Record<string, number>>({});
  // Playing a resource takes two steps: the card, then face-up or face-down (`face`).
  const [face, setFace] = useState<"up" | "down" | null>(null);
  const hand = view.players[view.you].hand ?? [];

  // The choices the arrow keys move between.
  const items: string[] =
    d?.type === "choose" ? d.options.map((o) => o.id) : d?.type === "blockers" ? d.candidates : d?.type === "assign" ? d.targets : d?.type === "play_resource" ? hand.map((c) => c.iid) : [];

  // A new decision: the cursor starts on something, the last choice made for the same
  // question if there was one.
  useEffect(() => {
    setNum(d?.type === "number" ? d.min : 0);
    setAssign({});
    setFace(null);
    let first = items[0] ?? null;
    if (d?.type === "choose") {
      const last = recallChoice(d.prompt, d.options.map((o) => o.label));
      first = d.options.find((o) => o.label === last)?.id ?? first;
    }
    if (d?.type === "play_resource") first = hand.find((c) => cards[c.defId!]?.types.includes("resource") && !cards[c.defId!]?.face_down_only)?.iid ?? first;
    setCursor(first);
  }, [JSON.stringify(d)]);

  // The card under the cursor shows in the preview.
  const cursorIid = d?.type === "choose" ? d.options.find((o) => o.id === cursor)?.iid : cursor;
  useEffect(() => {
    if (cursorIid) setHover(defOf(cursorIid));
  }, [cursorIid]);

  const move = (by: number) => setCursor(step(items, cursor, by));
  const arrows: KeyHandlers = { up: () => move(-1), left: () => move(-1), down: () => move(1), right: () => move(1) };

  const choose = d?.type === "choose" ? d : null;
  // Everywhere: Enter marks, Space confirms what's marked (nothing marked, where that's
  // allowed: none), Esc goes back. Only when exactly one answer is required is the
  // cursor itself the answer, so Space confirms it at once.
  const instant = !!choose && choose.min === 1 && choose.max === 1;
  const answer = (ids: string[]) => {
    const o = ids.length === 1 ? choose?.options.find((x) => x.id === ids[0]) : undefined;
    if (choose && o) rememberChoice(choose.prompt, choose.options.map((x) => x.label), o.label);
    send({ type: "answer", ids });
  };
  const toggleOpt = (id: string) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : choose!.max === 1 ? [id] : sel.length < choose!.max ? [...sel, id] : sel);
  const pickOpt = (id: string) => {
    setCursor(id);
    if (instant) answer([id]);
    else toggleOpt(id);
  };
  const canConfirm = !!choose && sel.length >= choose.min && sel.length <= choose.max;

  const used = Object.values(assign).reduce((a, b) => a + b, 0);
  const setAmt = (iid: string, v: number) => d?.type === "assign" && setAssign({ ...assign, [iid]: Math.max(0, Math.min(v, (assign[iid] ?? 0) + d.total - used)) });
  const assignOk = d?.type === "assign" && (d.min === undefined ? used === d.total : used >= d.min && used <= d.total);

  const pickedDef = d?.type === "play_resource" && cursor ? defOf(cursor) : null;
  const faceUpOk = d?.type === "play_resource" && !!pickedDef?.types.includes("resource") && !pickedDef.face_down_only && !d.faceDown;
  const playRes = (faceDown: boolean) => cursor && send({ type: "answer", iid: cursor, faceDown });
  const pickRes = (iid: string) => {
    setCursor(iid);
    const def = defOf(iid);
    const up = d?.type === "play_resource" && !!def?.types.includes("resource") && !def.face_down_only && !d.faceDown;
    setFace(up ? "up" : "down");
  };

  const keys: KeyHandlers = {};
  if (d && "cancellable" in d && d.cancellable) keys.escape = () => send({ type: "cancel" });
  switch (d?.type) {
    case "main":
      // Space never ends the turn: that takes E.
      if (attack) {
        if (attack.attackers.length) keys.space = () => send({ type: "attack", target: attack.target, attackers: attack.attackers });
        keys.escape = () => setAttack(null);
      } else keys.letters = { e: () => send({ type: "end_turn" }) };
      break;
    case "priority":
    case "window":
    case "endturn":
      keys.space = () => send({ type: "pass" });
      break;
    case "choose":
      Object.assign(keys, arrows, {
        enter: () => cursor && pickOpt(cursor),
        space: () => (instant ? cursor && answer([cursor]) : canConfirm && answer(sel)),
      });
      // Optional choices: Esc picks nothing too (or cancels, where that's possible).
      if (d.min === 0 && !keys.escape) keys.escape = () => answer([]);
      break;
    case "blockers":
      Object.assign(keys, arrows, {
        enter: () => cursor && setSel(sel.includes(cursor) ? sel.filter((x) => x !== cursor) : [...sel, cursor]),
        space: () => send({ type: "answer", ids: sel }),
      });
      break;
    case "assign":
      Object.assign(keys, {
        up: () => move(-1),
        down: () => move(1),
        left: () => cursor && setAmt(cursor, (assign[cursor] ?? 0) - 1),
        right: () => cursor && setAmt(cursor, (assign[cursor] ?? 0) + 1),
        enter: () => cursor && setAmt(cursor, (assign[cursor] ?? 0) + 1),
        space: () => assignOk && send({ type: "answer", assign }),
      });
      break;
    case "play_resource":
      if (!face) {
        const pick = () => cursor && pickRes(cursor);
        Object.assign(keys, arrows, { space: pick, enter: pick });
      } else {
        // Face-down is always possible; face-up only for a resource that may be played face-up.
        const flip = () => faceUpOk && setFace(face === "up" ? "down" : "up");
        const play = () => playRes(face === "down");
        Object.assign(keys, { up: flip, down: flip, left: flip, right: flip, space: play, enter: play, escape: () => setFace(null) });
      }
      break;
    case "number": {
      const nd = d;
      const by = (k: number) => setNum((n) => Math.max(nd.min, Math.min(nd.max, n + k)));
      Object.assign(keys, { up: () => by(1), right: () => by(1), down: () => by(-1), left: () => by(-1), space: () => send({ type: "answer", value: num }) });
      break;
    }
  }
  // Order and name prompts handle their own keys. The board's keys win where both have one
  // (Space on a card opens its menu instead of passing).
  useKeys({ ...keys, ...boardKeys, letters: { ...keys.letters, ...boardKeys.letters } }, d?.type !== "order" && d?.type !== "name");

  if (view.phase === "ended") {
    const w = view.winner;
    return <div className="prompt end">{w === "draw" ? "The game is a draw." : !view.spectator && w === (view.seat ?? view.you) ? "You win!" : `${view.players[w!].name} wins.`}</div>;
  }
  if (!d) {
    const w = view.waiting;
    return (
      <div className="prompt waiting">
        {view.spectator && <b>Spectating. </b>}
        {w ? (
          <>
            Waiting for <b>{view.players[w.player].name}</b> {describeWaiting(w.type)}…
          </>
        ) : (
          "…"
        )}
      </div>
    );
  }

  const cancel =
    "cancellable" in d && d.cancellable ? (
      <button onClick={() => send({ type: "cancel" })}>
        Cancel <K k="Esc" />
      </button>
    ) : null;
  const top = view.stack[view.stack.length - 1];
  // Responding: Space passes, unless the arrows have put the cursor on a card.
  const onCard = !!cursor && !!boardKeys.space;
  const respondHint = (
    <span className="muted hint">
      {onCard ? (
        <>
          <K k="Space" /> {defOf(cursor!)?.name ?? "card"}'s actions, <K k="Esc" /> back to passing
        </>
      ) : (
        <>
          <K k="←→" /> pick a card to respond with, <K k="B" /> hand or battlefield
        </>
      )}
    </span>
  );
  const optionProps = (id: string, iid?: string) => ({
    className: `option ${sel.includes(id) ? "selected" : ""} ${cursor === id ? "cursor" : ""}`,
    onMouseEnter: () => iid && setHover(defOf(iid)),
    onMouseLeave: () => setHover(null),
  });

  switch (d.type) {
    case "main":
      if (attack) {
        const targetName = attack.target === "faction" ? "their faction" : defOf(attack.target)?.name;
        return (
          <div className="prompt">
            <b>Attack:</b> click your characters to add them, click an enemy location to target it (default: {targetName}).
            <div className="muted hint">
              <K k="←→" /> move, <K k="Enter" /> add or remove (or target a location), <K k="Space" /> attack, <K k="Esc" /> cancel
            </div>
            <div className="row">
              <button className="primary" disabled={!attack.attackers.length} onClick={() => send({ type: "attack", target: attack.target, attackers: attack.attackers })}>
                Attack with {attack.attackers.length} <K k="Space" />
              </button>
              <button onClick={() => setAttack(null)}>
                Cancel <K k="Esc" />
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="prompt mine">
          <b>Your turn.</b> Click cards in your hand, your faction or your cards in play to act.
          <div className="muted hint">
            <K k="←→" /> card, <K k="Space" /> its actions, <K k="A" /> attack, <K k="B" /> hand or battlefield, <K k="F" /> faction, <K k="D" /> deck, <K k="X" /> discard, <K k="V" /> void
          </div>
          <div className="row">
            <button disabled={!view.legal?.attackers.length} onClick={() => setAttack({ attackers: [], target: "faction" })}>
              Attack… <K k="A" />
            </button>
            <button className="primary" onClick={() => send({ type: "end_turn" })}>
              End turn <K k="E" />
            </button>
          </div>
        </div>
      );
    case "priority":
      return (
        <div className="prompt mine">
          <b>{top?.controller === view.you ? "Your" : "Opponent's"} {top?.label}</b> is waiting to resolve. Respond with a tactic or ability, or pass.
          <div className="row">
            <button className={onCard ? "" : "primary"} onClick={() => send({ type: "pass" })}>
              Pass {!onCard && <K k="Space" />}
            </button>
            {respondHint}
          </div>
        </div>
      );
    case "window":
      return (
        <div className="prompt mine">
          <b>{d.label}.</b> You may play tactics or use abilities.
          <div className="row">
            <button className={onCard ? "" : "primary"} onClick={() => send({ type: "pass" })}>
              Pass {!onCard && <K k="Space" />}
            </button>
            {respondHint}
          </div>
        </div>
      );
    case "endturn":
      return (
        <div className="prompt mine">
          <b>{view.players[view.active].name} is ending their turn.</b> Respond, or let the turn end.
          <div className="row">
            <button className={onCard ? "" : "primary"} onClick={() => send({ type: "pass" })}>
              Let it end {!onCard && <K k="Space" />}
            </button>
            {respondHint}
          </div>
        </div>
      );
    case "choose":
      return (
        <div className="prompt mine">
          <b>{d.prompt}</b>
          {!instant && <span className="muted"> ({d.min === d.max ? d.min : `${d.min}-${d.max}`})</span>}
          <div className={`options ${d.list ? "list" : ""}`}>
            {d.options.map((o) => (
              <button key={o.id} {...optionProps(o.id, o.iid)} onClick={() => pickOpt(o.id)}>
                {o.label}
              </button>
            ))}
            {!d.options.length && <span className="muted">Nothing to choose.</span>}
          </div>
          <div className="row">
            {instant ? (
              <span className="muted hint">
                <K k="←→" /> move, <K k="Space" /> choose
              </span>
            ) : (
              <>
                <button className="primary" disabled={!canConfirm} onClick={() => answer(sel)}>
                  {sel.length || d.min > 0 ? "Confirm" : "Choose none"} <K k="Space" />
                </button>
                <span className="muted hint">
                  <K k="←→" /> move, <K k="Enter" /> mark, <K k="Space" /> confirm{d.min === 0 ? " (nothing marked: none)" : ""}
                </span>
              </>
            )}
            {cancel}
          </div>
        </div>
      );
    case "order":
      return <OrderPrompt key={decisionKeyOf(d)} d={d} send={send} defOf={defOf} setHover={setHover} />;
    case "name":
      return <NamePrompt key={decisionKeyOf(d)} d={d} send={send} cards={cards} setHover={setHover} />;
    case "number":
      return (
        <div className="prompt mine">
          <b>{d.prompt}</b>
          <div className="row">
            <input type="number" min={d.min} max={d.max} value={num} onChange={(e) => setNum(Number(e.target.value))} />
            <button className="primary" onClick={() => send({ type: "answer", value: num })}>
              Confirm <K k="Space" />
            </button>
            {cancel}
            <span className="muted hint">
              <K k="←→" /> change
            </span>
          </div>
        </div>
      );
    case "blockers":
      return (
        <div className="prompt mine">
          <b>Choose blockers</b> (click your characters, or the buttons).
          <div className="options">
            {d.candidates.map((iid) => (
              <button
                key={iid}
                {...optionProps(iid, iid)}
                onClick={() => {
                  setCursor(iid);
                  setSel(sel.includes(iid) ? sel.filter((x) => x !== iid) : [...sel, iid]);
                }}
              >
                {defOf(iid)?.name}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary" onClick={() => send({ type: "answer", ids: sel })}>
              {sel.length ? `Block with ${sel.length}` : "Don't block"} <K k="Space" />
            </button>
            <span className="muted hint">
              <K k="←→" /> move, <K k="Enter" /> select
            </span>
          </div>
        </div>
      );
    case "assign":
      return (
        <div className="prompt mine">
          <b>{d.prompt}</b> <span className="muted">({d.total - used} left{d.min !== undefined ? ", you may leave some" : ""})</span>
          <div className="assign">
            {d.targets.map((iid) => (
              <div key={iid} className={`assign-row ${cursor === iid ? "cursor" : ""}`} onClick={() => setCursor(iid)} onMouseEnter={() => setHover(defOf(iid))} onMouseLeave={() => setHover(null)}>
                <span>{d.labels?.[iid] ?? defOf(iid)?.name}</span>
                <button className="tiny" onClick={() => setAmt(iid, (assign[iid] ?? 0) - 1)}>
                  −
                </button>
                <b>{assign[iid] ?? 0}</b>
                <button className="tiny" disabled={used >= d.total} onClick={() => setAmt(iid, (assign[iid] ?? 0) + 1)}>
                  +
                </button>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="primary" disabled={!assignOk} onClick={() => send({ type: "answer", assign })}>
              Confirm <K k="Space" />
            </button>
            <span className="muted hint">
              <K k="↑↓" /> move, <K k="←→" /> or <K k="Enter" /> change
            </span>
          </div>
        </div>
      );
    case "play_resource":
      return (
        <div className="prompt mine">
          <b>Play a resource:</b> choose a card from your hand. Resource cards can be played face-up; any card can be played face-down.
          <div className="options">
            {hand.map((c) => (
              <button key={c.iid} {...optionProps(c.iid, c.iid)} className={`option ${cursor === c.iid ? (face ? "selected" : "cursor") : ""}`} onClick={() => pickRes(c.iid)}>
                {cards[c.defId!].name}
              </button>
            ))}
          </div>
          <div className="row">
            <button className={`${face === "up" ? "primary cursor" : ""}`} disabled={!faceUpOk || !face} onClick={() => playRes(false)}>
              Face-up
            </button>
            <button className={`${face === "down" ? "primary cursor" : ""}`} disabled={!face} onClick={() => playRes(true)}>
              Face-down
            </button>
            {d.optional && <button onClick={() => send({ type: "answer" })}>Skip</button>}
            <span className="muted hint">
              {face ? (
                <>
                  <K k="←→" /> face-up or face-down, <K k="Space" /> play, <K k="Esc" /> back
                </>
              ) : (
                <>
                  <K k="←→" /> move, <K k="Space" /> choose
                </>
              )}
            </span>
          </div>
        </div>
      );
  }
}

/** A key hint on a button. */
function K({ k }: { k: string }) {
  return <kbd>{k}</kbd>;
}

const decisionKeyOf = (d: unknown) => JSON.stringify(d);

function OrderPrompt({ d, send, defOf, setHover }: { d: Extract<GameView["pending"] & object, { type: "order" }>; send: Send; defOf: (iid: string) => CardDef | null; setHover: (d: CardDef | null) => void }) {
  const [order, setOrder] = useState(d.options.map((o) => o.id));
  // The cursor, and whether Enter has picked its card up (the arrows then move the card).
  const [cur, setCur] = useState(0);
  const [held, setHeld] = useState(false);
  const label = (id: string) => d.options.find((o) => o.id === id)?.label ?? id;
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const go = (by: number) => {
    const j = cur + by;
    if (held) {
      if (j < 0 || j >= order.length) return;
      swap(cur, j);
      setCur(j);
    } else setCur((j + order.length) % order.length);
  };
  useEffect(() => {
    setHover(defOf(order[cur]));
  }, [cur, order]);
  useKeys({ up: () => go(-1), left: () => go(-1), down: () => go(1), right: () => go(1), enter: () => setHeld(!held), space: () => send({ type: "answer", ids: order }) });
  return (
    <div className="prompt mine">
      <b>{d.prompt}</b>
      <ol className="order">
        {order.map((id, i) => (
          <li key={id} className={`${i === cur ? "cursor" : ""} ${i === cur && held ? "held" : ""}`} onClick={() => setCur(i)} onMouseEnter={() => setHover(defOf(id))} onMouseLeave={() => setHover(null)}>
            <span>{label(id)}</span>
            <button className="tiny" onClick={() => swap(i, i - 1)} disabled={i === 0}>
              ↑
            </button>
            <button className="tiny" onClick={() => swap(i, i + 1)} disabled={i === order.length - 1}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      <div className="row">
        <button className="primary" onClick={() => send({ type: "answer", ids: order })}>
          Confirm order <K k="Space" />
        </button>
        <span className="muted hint">
          <K k="↑↓" /> move, <K k="Enter" /> pick up / put down
        </span>
      </div>
    </div>
  );
}

function NamePrompt({ d, send, cards, setHover }: { d: Extract<GameView["pending"] & object, { type: "name" }>; send: Send; cards: CardLibrary; setHover: (d: CardDef | null) => void }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const shown = d.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const at = shown[Math.min(cur, shown.length - 1)];
  useEffect(() => setCur(0), [q]);
  useEffect(() => {
    if (at && d.kind === "card") setHover(cards[at.id] ?? null);
  }, [at?.id]);
  // Typing goes to the search box; the arrows and Enter still work from it.
  const by = (k: number) => shown.length && setCur((Math.min(cur, shown.length - 1) + k + shown.length) % shown.length);
  useKeys({ up: () => by(-1), down: () => by(1), enter: () => at && send({ type: "answer", ids: [at.id] }) }, true, LAYER.board, ["up", "down", "enter"]);
  return (
    <div className="prompt mine">
      <b>{d.prompt}</b>
      <div className="row">
        <input autoFocus placeholder={`Search ${d.kind}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted hint">
          <K k="↑↓" /> move, <K k="Enter" /> choose
        </span>
      </div>
      <div className="options list">
        {shown.map((o) => (
          <button key={o.id} className={`option ${o === at ? "cursor" : ""}`} onClick={() => send({ type: "answer", ids: [o.id] })} onMouseEnter={() => d.kind === "card" && setHover(cards[o.id] ?? null)} onMouseLeave={() => setHover(null)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function describeWaiting(type: string): string {
  switch (type) {
    case "main":
      return "to take their turn";
    case "priority":
      return "to respond";
    case "window":
      return "to act in the battle";
    case "endturn":
      return "to respond to the end of turn";
    case "blockers":
      return "to choose blockers";
    case "assign":
      return "to assign damage";
    case "play_resource":
      return "to play a resource";
    case "order":
      return "to order cards";
    case "name":
      return "to name something";
    default:
      return "to decide";
  }
}

// ---------------------------------------------------------------------------

function CardMenu({ menu, view, card, def, send, close }: { menu: Menu; view: GameView; card: CardView; def: CardDef | null; send: Send; close: () => void }) {
  const me = view.you;
  const legal = view.legal;
  const iid = menu.iid;
  const items: { label: string; act: Action; manual?: boolean }[] = [];
  if (legal?.deploy.includes(iid)) items.push({ label: "Play", act: { type: "deploy", iid } });
  if (legal?.flipUp.includes(iid)) items.push({ label: "Flip up and play", act: { type: "flip_up", iid } });
  for (const a of legal?.abilities.filter((x) => x.iid === iid) ?? []) items.push({ label: `Use: ${a.name}`, act: { type: "ability", iid, index: a.index } });

  const isFaction = def?.types.includes("faction");
  const mine = card.owner === me || card.controller === me;
  if (mine && !isFaction) {
    const m = (label: string, op: ManualOp) => items.push({ label, act: { type: "manual", op }, manual: true });
    if (card.zone === "play") {
      if (!card.isResource) {
        m(card.depleted ? "Restore" : "Deplete", { op: "deplete", iid });
        m("+1 damage", { op: "damage", iid, delta: 1 });
        m("+1 token", { op: "tokens", iid, delta: 1 });
        if (card.tokens > 0) m("−1 token", { op: "tokens", iid, delta: -1 });
        if (card.damage > 0 || card.markers > 0) m("−1 damage", { op: "damage", iid, delta: -1 });
      } else m(card.attached ? "Detach from faction" : "Attach to faction", { op: "attach", iid });
      m(card.faceDown ? "Flip face-up" : "Flip face-down", { op: "flip", iid });
    }
    if (card.zone !== "hand") m("Move to hand", { op: "move", iid, zone: "hand" });
    if (card.zone !== "play") {
      m("Put into play", { op: "move", iid, zone: "play" });
      m("Put into play face-down (resource)", { op: "move", iid, zone: "play", faceDown: true });
    }
    if (card.zone !== "discard") m("Move to discard", { op: "move", iid, zone: "discard" });
    if (card.zone !== "void") m("Move to void", { op: "move", iid, zone: "void" });
    if (card.zone !== "deck") m("Put on top of deck", { op: "move", iid, zone: "deck" });
    else m("Move to top of deck", { op: "move", iid, zone: "deck" });
  }

  // The cursor starts on the first action (playing the card or using an ability come first).
  const [cur, setCur] = useState(0);
  const run = (i: number) => {
    const it = items[i];
    if (!it) return;
    send(it.act);
    close();
  };
  const by = (k: number) => items.length && setCur((cur + k + items.length) % items.length);
  useKeys({ up: () => by(-1), down: () => by(1), left: () => by(-1), right: () => by(1), space: () => run(cur), enter: () => run(cur), escape: close }, true, LAYER.menu);

  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - 40 - items.length * 30);
  return (
    <div className="menu" style={{ left: x, top: Math.max(8, y) }} onClick={(e) => e.stopPropagation()}>
      <div className="menu-title">{def?.name ?? "Hidden card"}</div>
      {items.length === 0 && <div className="muted menu-empty">No actions available.</div>}
      {items.map((it, i) => (
        <button key={i} className={`menu-item ${it.manual ? "manual" : ""} ${i > 0 && it.manual && !items[i - 1].manual ? "sep" : ""} ${i === cur ? "cursor" : ""}`} onMouseEnter={() => setCur(i)} onClick={() => run(i)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

interface ViewerKeys {
  cursor: string | null;
  setCursor: (c: string | null) => void;
  openMenu: (iid: string) => void;
}

/** Arrows over a window's cards, Space for a card's menu, Esc to close. */
function useViewerKeys(list: string[], close: () => void, { cursor, setCursor, openMenu }: ViewerKeys) {
  useEffect(() => {
    setCursor(list[0] ?? null);
  }, []);
  const at = cursor && list.includes(cursor) ? cursor : null;
  const move = (k: number) => setCursor(step(list, at, k));
  useKeys({ up: () => move(-1), left: () => move(-1), down: () => move(1), right: () => move(1), space: () => at && openMenu(at), escape: close }, true, LAYER.window);
}

function PileViewer({
  view,
  cards,
  pile,
  close,
  clickCard,
  classFor,
  setHover,
  ...kb
}: {
  view: GameView;
  cards: CardLibrary;
  pile: { p: PlayerId; zone: "discard" | "void" };
  close: () => void;
  clickCard: (iid: string, e: React.MouseEvent) => void;
  classFor: (iid: string) => string;
  setHover: (d: CardDef | null) => void;
} & ViewerKeys) {
  const list = [...view.players[pile.p][pile.zone]].reverse();
  useViewerKeys(
    list.map((c) => c.iid),
    close,
    kb,
  );
  return (
    <div className="overlay" onClick={close}>
      <div className="panel pile" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>
            {view.players[pile.p].name}: {pile.zone} ({list.length})
          </h3>
          <span className="spacer" />
          <button onClick={close}>
            Close <K k="Esc" />
          </button>
        </div>
        <div className="pile-cards">
          {list.map((c) => (
            <Tile key={c.iid} def={c.defId ? cards[c.defId] : null} card={c} className={classFor(c.iid)} onClick={(e) => clickCard(c.iid, e)} onHover={setHover} />
          ))}
          {!list.length && <span className="muted">Empty.</span>}
        </div>
      </div>
    </div>
  );
}

/** Your deck while searching it with the manual controls. Click a card for its manual moves. */
function DeckViewer({
  view,
  cards,
  done,
  clickCard,
  classFor,
  setHover,
  ...kb
}: {
  view: GameView;
  cards: CardLibrary;
  done: (shuffle: boolean) => void;
  clickCard: (iid: string, e: React.MouseEvent) => void;
  classFor: (iid: string) => string;
  setHover: (d: CardDef | null) => void;
} & ViewerKeys) {
  const deck = view.players[view.you].deck ?? [];
  useViewerKeys(
    deck.map((c) => c.iid),
    () => done(false),
    kb,
  );
  return (
    <div className="overlay">
      <div className="panel pile" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>Your deck ({deck.length}), top first</h3>
          <span className="spacer" />
          <button onClick={() => done(false)}>
            Close <K k="Esc" />
          </button>
          <button className="primary" onClick={() => done(true)}>
            Close and shuffle
          </button>
        </div>
        <p className="muted">Click a card to move it. Your opponent sees that you searched, not what you took.</p>
        <div className="pile-cards">
          {deck.map((c) => (
            <Tile key={c.iid} def={c.defId ? cards[c.defId] : null} card={c} className={classFor(c.iid)} onClick={(e) => clickCard(c.iid, e)} onHover={setHover} />
          ))}
          {!deck.length && <span className="muted">Empty.</span>}
        </div>
      </div>
    </div>
  );
}

/** "Deck": your decklist (private, nothing is logged), or searching the deck itself (logged). */
function DeckChoice({ close, list, search }: { close: () => void; list: () => void; search: () => void }) {
  const options = [
    { label: "View your decklist", hint: "The cards your deck started with. Private: nothing is logged.", act: list },
    { label: "Search your deck", hint: "Look through the deck itself. Your opponent sees that you searched.", act: search },
  ];
  const [cur, setCur] = useState(0);
  const by = () => setCur(1 - cur);
  useKeys({ up: by, down: by, left: by, right: by, space: () => options[cur].act(), enter: () => options[cur].act(), escape: close }, true, LAYER.window);
  return (
    <div className="overlay" onClick={close}>
      <div className="panel deck-choice" onClick={(e) => e.stopPropagation()}>
        <h3>Deck</h3>
        {options.map((o, i) => (
          <button key={o.label} className={`option ${i === cur ? "cursor" : ""}`} onMouseEnter={() => setCur(i)} onClick={o.act}>
            <b>{o.label}</b>
            <span className="muted">{o.hint}</span>
          </button>
        ))}
        <div className="row">
          <span className="spacer" />
          <button onClick={close}>
            Close <K k="Esc" />
          </button>
        </div>
      </div>
    </div>
  );
}

const TYPE_ORDER: CardDef["types"][number][] = ["character", "item", "location", "tactic", "resource"];

/** Your registered decklist, grouped by type. */
function Decklist({ list, cards, close, setHover }: { list: Record<string, number>; cards: CardLibrary; close: () => void; setHover: (d: CardDef | null) => void }) {
  const ids = Object.keys(list)
    .filter((id) => cards[id])
    .sort((a, b) => {
      const ta = TYPE_ORDER.findIndex((t) => cards[a].types.includes(t));
      const tb = TYPE_ORDER.findIndex((t) => cards[b].types.includes(t));
      return ta - tb || cards[a].name.localeCompare(cards[b].name);
    });
  const [cur, setCur] = useState(0);
  useEffect(() => {
    if (ids[cur]) setHover(cards[ids[cur]]);
  }, [cur]);
  const by = (k: number) => ids.length && setCur((cur + k + ids.length) % ids.length);
  useKeys({ up: () => by(-1), down: () => by(1), left: () => by(-1), right: () => by(1), escape: close }, true, LAYER.window);
  const total = Object.values(list).reduce((a, b) => a + b, 0);
  let lastType = "";
  return (
    <div className="overlay" onClick={close}>
      <div className="panel pile decklist" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>Your decklist ({total})</h3>
          <span className="spacer" />
          <button onClick={close}>
            Close <K k="Esc" />
          </button>
        </div>
        <ul>
          {ids.map((id, i) => {
            const type = TYPE_ORDER.find((t) => cards[id].types.includes(t)) ?? "other";
            const header = type !== lastType ? <li className="decklist-type">{type}s</li> : null;
            lastType = type;
            return (
              <Fragment key={id}>
                {header}
                <li className={i === cur ? "cursor" : ""} onMouseEnter={() => (setCur(i), setHover(cards[id]))}>
                  <b>{list[id]}</b> {cards[id].name}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Log({ view }: { view: GameView }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [view.log.length]);
  return (
    <div className="log" ref={ref}>
      {view.log.map((e) => (
        <div key={e.n} className={`log-line ${e.manual ? "manual" : ""} ${e.to ? "private" : ""} ${e.text.startsWith("---") ? "turn" : ""}`}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
