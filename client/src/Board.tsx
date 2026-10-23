import { useEffect, useMemo, useRef, useState } from "react";
import type { Action, CardDef, CardLibrary, CardView, GameView, ManualOp, PlayerId, PlayerView } from "../../engine/index.ts";
import { Pips, Preview, ResourceChip, Tile } from "./Card.tsx";

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
  const d = view.pending;

  // Reset local selections whenever the decision changes.
  const decisionKey = JSON.stringify(d);
  useEffect(() => {
    setSel([]);
    setMenu(null);
    if (d?.type !== "main") setAttack(null);
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
      toggle(iid);
      return;
    }
    // Spectators can look, not act.
    if (!view.spectator) setMenu({ iid, x: e.clientX, y: e.clientY });
  };

  const classFor = (iid: string) => {
    const b = view.battle;
    return [
      selectable.has(iid) ? "selectable" : "",
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
        <Side p={view.players[opp]} me={false} view={view} cards={cards} renderCard={renderCard} clickCard={clickCard} classFor={classFor} setHover={setHover} setPile={setPile} send={send} attack={attack} />

        <div className="midline">
          <Stack view={view} cards={cards} setHover={setHover} />
          <BattleBar view={view} cards={cards} defOf={defOf} />
          <Prompt view={view} cards={cards} send={send} sel={sel} setSel={setSel} defOf={defOf} attack={attack} setAttack={setAttack} setHover={setHover} />
        </div>

        <Side p={view.players[me]} me view={view} cards={cards} renderCard={renderCard} clickCard={clickCard} classFor={classFor} setHover={setHover} setPile={setPile} send={send} attack={attack} />

        <div className="hand">
          {(view.players[me].hand ?? []).map(renderCard)}
          {!view.players[me].hand?.length && <span className="muted">Your hand is empty.</span>}
        </div>
      </div>

      <aside className="sidebar">
        <Preview def={hover} />
        <Log view={view} />
      </aside>

      {menu && <CardMenu menu={menu} view={view} card={all.get(menu.iid)!} def={defOf(menu.iid)} send={send} close={() => setMenu(null)} />}
      {pile && <PileViewer view={view} cards={cards} pile={pile} close={() => setPile(null)} clickCard={clickCard} classFor={classFor} setHover={setHover} />}
      {view.players[me].deck && (
        <DeckViewer view={view} cards={cards} done={(shuffle) => send({ type: "manual", op: { op: "end_search", shuffle } })} clickCard={clickCard} classFor={classFor} setHover={setHover} />
      )}
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
}

function Side({ p, me, view, cards, renderCard, clickCard, classFor, setHover, setPile, send, attack }: SideProps) {
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
      <div className={`faction ${targeted ? "selected" : ""}`} onClick={(e) => clickCard(p.faction.iid, e)} onMouseEnter={() => setHover(cards[p.factionId])} onMouseLeave={() => setHover(null)}>
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
          <button className="small" title="Look through your deck (manual)" onClick={() => manual({ op: "search_deck" })}>
            Deck {p.deckCount}
          </button>
        ) : (
          <span title="Cards in deck">Deck {p.deckCount}</span>
        )}
        <span title="Cards in hand">Hand {p.handCount}</span>
        <button className="small" onClick={() => setPile({ p: p.id, zone: "discard" })}>
          Discard {p.discard.length}
        </button>
        <button className="small" onClick={() => setPile({ p: p.id, zone: "void" })}>
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
        <span className="muted">{p.unattached} available</span>
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
  const fieldRow = (
    <div className="field">
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
}

function Prompt({ view, cards, send, sel, setSel, defOf, attack, setAttack, setHover }: PromptProps) {
  const d = view.pending;
  const [num, setNum] = useState(0);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [resPick, setResPick] = useState<string | null>(null);
  useEffect(() => {
    setNum(d?.type === "number" ? d.min : 0);
    setAssign({});
    setResPick(null);
  }, [JSON.stringify(d)]);

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

  const cancel = "cancellable" in d && d.cancellable ? <button onClick={() => send({ type: "cancel" })}>Cancel</button> : null;
  const top = view.stack[view.stack.length - 1];

  switch (d.type) {
    case "main":
      if (attack) {
        const targetName = attack.target === "faction" ? "their faction" : defOf(attack.target)?.name;
        return (
          <div className="prompt">
            <b>Attack:</b> click your characters to add them, click an enemy location to target it (default: {targetName}).
            <div className="row">
              <button className="primary" disabled={!attack.attackers.length} onClick={() => send({ type: "attack", target: attack.target, attackers: attack.attackers })}>
                Attack with {attack.attackers.length}
              </button>
              <button onClick={() => setAttack(null)}>Cancel</button>
            </div>
          </div>
        );
      }
      return (
        <div className="prompt mine">
          <b>Your turn.</b> Click cards in your hand, your faction or your cards in play to act.
          <div className="row">
            <button disabled={!view.legal?.attackers.length} onClick={() => setAttack({ attackers: [], target: "faction" })}>
              Attack…
            </button>
            <button className="primary" onClick={() => send({ type: "end_turn" })}>
              End turn
            </button>
          </div>
        </div>
      );
    case "priority":
      return (
        <div className="prompt mine">
          <b>{top?.controller === view.you ? "Your" : "Opponent's"} {top?.label}</b> is waiting to resolve. Respond with a tactic or ability, or pass.
          <div className="row">
            <button className="primary" onClick={() => send({ type: "pass" })}>
              Pass
            </button>
          </div>
        </div>
      );
    case "window":
      return (
        <div className="prompt mine">
          <b>{d.label}.</b> You may play tactics or use abilities.
          <div className="row">
            <button className="primary" onClick={() => send({ type: "pass" })}>
              Pass
            </button>
          </div>
        </div>
      );
    case "endturn":
      return (
        <div className="prompt mine">
          <b>{view.players[view.active].name} is ending their turn.</b> Respond, or let the turn end.
          <div className="row">
            <button className="primary" onClick={() => send({ type: "pass" })}>
              Let it end
            </button>
          </div>
        </div>
      );
    case "choose": {
      const instant = d.min === 1 && d.max === 1;
      const pick = (id: string) => (instant ? send({ type: "answer", ids: [id] }) : setSel(sel.includes(id) ? sel.filter((x) => x !== id) : d.max === 1 ? [id] : sel.length < d.max ? [...sel, id] : sel));
      return (
        <div className="prompt mine">
          <b>{d.prompt}</b>
          {!instant && <span className="muted"> ({d.min === d.max ? d.min : `${d.min}-${d.max}`})</span>}
          <div className={`options ${d.list ? "list" : ""}`}>
            {d.options.map((o) => (
              <button
                key={o.id}
                className={`option ${sel.includes(o.id) ? "selected" : ""}`}
                onClick={() => pick(o.id)}
                onMouseEnter={() => o.iid && setHover(defOf(o.iid))}
                onMouseLeave={() => setHover(null)}
              >
                {o.label}
              </button>
            ))}
            {!d.options.length && <span className="muted">Nothing to choose.</span>}
          </div>
          <div className="row">
            {!instant && (
              <button className="primary" disabled={sel.length < d.min || sel.length > d.max} onClick={() => send({ type: "answer", ids: sel })}>
                Confirm
              </button>
            )}
            {cancel}
          </div>
        </div>
      );
    }
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
              Confirm
            </button>
            {cancel}
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
                className={`option ${sel.includes(iid) ? "selected" : ""}`}
                onClick={() => setSel(sel.includes(iid) ? sel.filter((x) => x !== iid) : [...sel, iid])}
                onMouseEnter={() => setHover(defOf(iid))}
                onMouseLeave={() => setHover(null)}
              >
                {defOf(iid)?.name}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary" onClick={() => send({ type: "answer", ids: sel })}>
              {sel.length ? `Block with ${sel.length}` : "Don't block"}
            </button>
          </div>
        </div>
      );
    case "assign": {
      const used = Object.values(assign).reduce((a, b) => a + b, 0);
      const set = (iid: string, v: number) => setAssign({ ...assign, [iid]: Math.max(0, v) });
      return (
        <div className="prompt mine">
          <b>{d.prompt}</b> <span className="muted">({d.total - used} left{d.min !== undefined ? ", you may leave some" : ""})</span>
          <div className="assign">
            {d.targets.map((iid) => (
              <div key={iid} className="assign-row" onMouseEnter={() => setHover(defOf(iid))} onMouseLeave={() => setHover(null)}>
                <span>{d.labels?.[iid] ?? defOf(iid)?.name}</span>
                <button className="tiny" onClick={() => set(iid, (assign[iid] ?? 0) - 1)}>
                  −
                </button>
                <b>{assign[iid] ?? 0}</b>
                <button className="tiny" disabled={used >= d.total} onClick={() => set(iid, (assign[iid] ?? 0) + 1)}>
                  +
                </button>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="primary" disabled={d.min === undefined ? used !== d.total : used < d.min || used > d.total} onClick={() => send({ type: "answer", assign })}>
              Confirm
            </button>
          </div>
        </div>
      );
    }
    case "play_resource": {
      const hand = view.players[view.you].hand ?? [];
      const pickedDef = resPick ? defOf(resPick) : null;
      return (
        <div className="prompt mine">
          <b>Play a resource:</b> choose a card from your hand. Resource cards can be played face-up; any card can be played face-down.
          <div className="options">
            {hand.map((c) => (
              <button
                key={c.iid}
                className={`option ${resPick === c.iid ? "selected" : ""}`}
                onClick={() => setResPick(c.iid)}
                onMouseEnter={() => setHover(cards[c.defId!])}
                onMouseLeave={() => setHover(null)}
              >
                {cards[c.defId!].name}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary" disabled={!pickedDef?.types.includes("resource") || !!pickedDef?.face_down_only || !!d.faceDown} onClick={() => send({ type: "answer", iid: resPick!, faceDown: false })}>
              Face-up
            </button>
            <button disabled={!resPick} onClick={() => send({ type: "answer", iid: resPick!, faceDown: true })}>
              Face-down
            </button>
            {d.optional && <button onClick={() => send({ type: "answer" })}>Skip</button>}
          </div>
        </div>
      );
    }
  }
}

const decisionKeyOf = (d: unknown) => JSON.stringify(d);

function OrderPrompt({ d, send, defOf, setHover }: { d: Extract<GameView["pending"] & object, { type: "order" }>; send: Send; defOf: (iid: string) => CardDef | null; setHover: (d: CardDef | null) => void }) {
  const [order, setOrder] = useState(d.options.map((o) => o.id));
  const label = (id: string) => d.options.find((o) => o.id === id)?.label ?? id;
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  return (
    <div className="prompt mine">
      <b>{d.prompt}</b>
      <ol className="order">
        {order.map((id, i) => (
          <li key={id} onMouseEnter={() => setHover(defOf(id))} onMouseLeave={() => setHover(null)}>
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
          Confirm order
        </button>
      </div>
    </div>
  );
}

function NamePrompt({ d, send, cards, setHover }: { d: Extract<GameView["pending"] & object, { type: "name" }>; send: Send; cards: CardLibrary; setHover: (d: CardDef | null) => void }) {
  const [q, setQ] = useState("");
  const shown = d.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <div className="prompt mine">
      <b>{d.prompt}</b>
      <div className="row">
        <input autoFocus placeholder={`Search ${d.kind}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="options list">
        {shown.map((o) => (
          <button key={o.id} className="option" onClick={() => send({ type: "answer", ids: [o.id] })} onMouseEnter={() => d.kind === "card" && setHover(cards[o.id] ?? null)} onMouseLeave={() => setHover(null)}>
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

  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - 40 - items.length * 30);
  return (
    <div className="menu" style={{ left: x, top: Math.max(8, y) }} onClick={(e) => e.stopPropagation()}>
      <div className="menu-title">{def?.name ?? "Hidden card"}</div>
      {items.length === 0 && <div className="muted menu-empty">No actions available.</div>}
      {items.map((it, i) => (
        <button
          key={i}
          className={`menu-item ${it.manual ? "manual" : ""} ${i > 0 && it.manual && !items[i - 1].manual ? "sep" : ""}`}
          onClick={() => {
            send(it.act);
            close();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PileViewer({
  view,
  cards,
  pile,
  close,
  clickCard,
  classFor,
  setHover,
}: {
  view: GameView;
  cards: CardLibrary;
  pile: { p: PlayerId; zone: "discard" | "void" };
  close: () => void;
  clickCard: (iid: string, e: React.MouseEvent) => void;
  classFor: (iid: string) => string;
  setHover: (d: CardDef | null) => void;
}) {
  const list = view.players[pile.p][pile.zone];
  return (
    <div className="overlay" onClick={close}>
      <div className="panel pile" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>
            {view.players[pile.p].name}: {pile.zone} ({list.length})
          </h3>
          <span className="spacer" />
          <button onClick={close}>Close</button>
        </div>
        <div className="pile-cards">
          {[...list].reverse().map((c) => (
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
}: {
  view: GameView;
  cards: CardLibrary;
  done: (shuffle: boolean) => void;
  clickCard: (iid: string, e: React.MouseEvent) => void;
  classFor: (iid: string) => string;
  setHover: (d: CardDef | null) => void;
}) {
  const deck = view.players[view.you].deck ?? [];
  return (
    <div className="overlay">
      <div className="panel pile" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>Your deck ({deck.length}), top first</h3>
          <span className="spacer" />
          <button onClick={() => done(false)}>Close</button>
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
