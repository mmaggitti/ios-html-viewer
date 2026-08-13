import React, { useState, useMemo, useCallback } from "react";

/**
 * LONGHAND — a sketch
 * Two queens. No other pieces. Your queen walks as far as the word you spell,
 * and the word is written into the squares she walks over.
 *
 * This is a feel-sketch, not a rules document. See WORKING_RULES at the bottom
 * of the UI for the assumptions baked in, all of which are cheap to change.
 */

/* ── palette: antique games table ───────────────────────────────── */
const C = {
  night: "#0C141E",
  frame: "#152232",
  sqA: "#1A2939",
  sqB: "#213348",
  line: "#2C4055",
  bone: "#E7DCC2",
  boneEdge: "#B9AA88",
  brass: "#C8A45C",
  claret: "#A33A4E",
  text: "#E6EDF5",
  dim: "#7F94AA",
  paper: "#EAE3D2",
  paperLine: "#CFC5AE",
};

const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif";
const MONO = "'SF Mono',ui-monospace,Menlo,Consolas,monospace";

const PLAYERS = [
  { name: "Bone", tint: C.bone, ink: "#1A2939" },
  { name: "Claret", tint: C.claret, ink: "#F6EDE2" },
];

/* ── board maths ────────────────────────────────────────────────── */
const N = 8;
const FILES = "abcdefgh";
const at = (r, c) => r * N + c;
const sq = (r, c) => FILES[c] + (N - r);
const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

const DIRS = [
  { dr: -1, dc: 0, rot: 0 },
  { dr: -1, dc: 1, rot: 45 },
  { dr: 0, dc: 1, rot: 90 },
  { dr: 1, dc: 1, rot: 135 },
  { dr: 1, dc: 0, rot: 180 },
  { dr: 1, dc: -1, rot: 225 },
  { dr: 0, dc: -1, rot: 270 },
  { dr: -1, dc: -1, rot: 315 },
];

const BAG =
  "AAAAAAAAABBCCDDDDEEEEEEEEEEEEFFGGGHHIIIIIIIIIJKLLLLMMNNNNNNOOOOOOOOPPQRRRRRRSSSSTTTTTTUUUUVVWWXYYZ".split(
    ""
  );

const draw = (bag) => {
  const b = [...bag];
  const i = Math.floor(Math.random() * b.length);
  return [b.splice(i, 1)[0], b];
};

function freshGame() {
  let bag = [...BAG];
  const board = Array.from({ length: N * N }, () => null);
  const queens = [
    { r: 7, c: 3 },
    { r: 0, c: 4 },
  ];
  // scatter loose letters — the ones already lying on the board
  let placed = 0;
  while (placed < 11) {
    const r = Math.floor(Math.random() * N);
    const c = Math.floor(Math.random() * N);
    const onQueen = queens.some((q) => q.r === r && q.c === c);
    if (board[at(r, c)] || onQueen) continue;
    const [ltr, rest] = draw(bag);
    bag = rest;
    board[at(r, c)] = { letter: ltr, kind: "loose", owner: null };
    placed++;
  }
  const racks = [[], []];
  for (const rack of racks) {
    while (rack.length < 7) {
      const [ltr, rest] = draw(bag);
      bag = rest;
      rack.push(ltr);
    }
  }
  return { board, queens, racks, bag, turn: 0, log: [], winner: null };
}

/* the ray the queen would walk, one square at a time */
function rayFor(g, player, dirIdx) {
  if (dirIdx == null) return [];
  const me = g.queens[player];
  const opp = g.queens[1 - player];
  const d = DIRS[dirIdx];
  const out = [];
  let r = me.r + d.dr;
  let c = me.c + d.dc;
  while (inside(r, c)) {
    const capture = r === opp.r && c === opp.c;
    const cell = g.board[at(r, c)];
    out.push({ r, c, fixed: capture ? null : cell ? cell.letter : null, capture });
    if (capture) break;
    r += d.dr;
    c += d.dc;
  }
  return out;
}

/* letters already on the ray are picked up free, in order */
function absorb(list, ray) {
  const out = [...list];
  while (out.length < ray.length && ray[out.length].fixed) {
    out.push({ from: "board", letter: ray[out.length].fixed });
  }
  return out;
}

/* ── the sketch ─────────────────────────────────────────────────── */
export default function Longhand() {
  const [g, setG] = useState(freshGame);
  const [dir, setDir] = useState(null);
  const [spelled, setSpelled] = useState([]);
  const [sealed, setSealed] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const me = g.turn;
  const ray = useMemo(() => rayFor(g, me, dir), [g, me, dir]);
  const dest = spelled.length ? ray[spelled.length - 1] : null;
  const word = spelled.map((p) => p.letter).join("");
  const usedRack = new Set(
    spelled.filter((p) => p.from === "rack").map((p) => p.rackIdx)
  );
  const legal =
    spelled.some((p) => p.from === "rack") && dest && spelled.length <= ray.length;

  const openDirs = useMemo(
    () =>
      DIRS.map((_, i) => (rayFor(g, me, i).length ? i : null)).filter(
        (i) => i !== null
      ),
    [g, me]
  );

  const pickDir = useCallback(
    (i) => {
      setDir(i);
      setSpelled(absorb([], rayFor(g, me, i)));
    },
    [g, me]
  );

  const addLetter = useCallback(
    (rackIdx) => {
      if (dir == null || usedRack.has(rackIdx)) return;
      const next = absorb(spelled, ray);
      if (next.length >= ray.length) return; // ran off the board
      next.push({ from: "rack", letter: g.racks[me][rackIdx], rackIdx });
      setSpelled(next);
    },
    [dir, ray, spelled, usedRack, g, me]
  );

  const takeBack = useCallback(() => {
    const next = [...spelled];
    while (next.length && next[next.length - 1].from === "board") next.pop();
    if (next.length) next.pop();
    setSpelled(next.length ? next : absorb([], ray));
  }, [spelled, ray]);

  const reset = useCallback(() => {
    setDir(null);
    setSpelled([]);
  }, []);

  const send = useCallback(() => {
    if (!legal) return;
    const board = [...g.board];
    spelled.forEach((p, i) => {
      const cell = ray[i];
      if (p.from === "rack")
        board[at(cell.r, cell.c)] = { letter: p.letter, kind: "laid", owner: me };
    });
    let bag = [...g.bag];
    const rack = g.racks[me].filter((_, i) => !usedRack.has(i));
    while (rack.length < 7 && bag.length) {
      const [ltr, rest] = draw(bag);
      bag = rest;
      rack.push(ltr);
    }
    const racks = me === 0 ? [rack, g.racks[1]] : [g.racks[0], rack];
    const queens = [...g.queens];
    const from = sq(queens[me].r, queens[me].c);
    queens[me] = { r: dest.r, c: dest.c };
    setG({
      ...g,
      board,
      racks,
      bag,
      queens,
      turn: 1 - me,
      winner: dest.capture ? me : null,
      log: [
        ...g.log,
        { player: me, word, from, to: sq(dest.r, dest.c), capture: dest.capture },
      ],
    });
    setDir(null);
    setSpelled([]);
    if (!dest.capture) setSealed(true);
  }, [legal, g, spelled, ray, me, usedRack, dest, word]);

  const newGame = () => {
    setG(freshGame());
    setDir(null);
    setSpelled([]);
    setSealed(false);
  };

  /* preview letters keyed by square */
  const preview = {};
  spelled.forEach((p, i) => {
    if (ray[i]) preview[at(ray[i].r, ray[i].c)] = p;
  });
  const rayIdx = {};
  ray.forEach((cell, i) => (rayIdx[at(cell.r, cell.c)] = i));

  return (
    <div
      className="min-h-screen w-full px-4 py-6 sm:px-8 sm:py-10"
      style={{ background: C.night, color: C.text, fontFamily: SERIF }}
    >
      <style>{`
        @keyframes stamp { from { transform: scale(1.5); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes rise { from { transform: translateY(6px); opacity: 0 } to { transform: none; opacity: 1 } }
        .stamp { animation: stamp .18s cubic-bezier(.2,.9,.3,1.4) both }
        .rise { animation: rise .25s ease-out both }
        @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation: none !important; transition: none !important } }
      `}</style>

      <div className="mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row lg:gap-10">
        {/* ── left: board ── */}
        <div className="flex-1">
          <header className="mb-5">
            <p
              className="mb-2 text-xs uppercase"
              style={{ fontFamily: MONO, color: C.dim, letterSpacing: "0.22em" }}
            >
              correspondence · one piece each
            </p>
            <h1
              className="text-4xl sm:text-5xl"
              style={{ letterSpacing: "0.06em", fontWeight: 500 }}
            >
              Longhand
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: C.dim }}>
              Your queen walks as far as the word you can spell — and the word is
              written into the squares she crosses.
            </p>
          </header>

          <div
            className="relative rounded-sm p-2 sm:p-3"
            style={{ background: C.frame, boxShadow: "inset 0 0 0 1px " + C.line }}
          >
            <div className="grid grid-cols-8" style={{ gap: 1 }}>
              {Array.from({ length: N * N }, (_, i) => {
                const r = Math.floor(i / N);
                const c = i % N;
                const cell = g.board[i];
                const queenIdx = g.queens.findIndex((q) => q.r === r && q.c === c);
                const pv = preview[i];
                const onRay = rayIdx[i] != null;
                const spentRay = onRay && rayIdx[i] < spelled.length;

                // direction chooser: the eight neighbours of my queen
                let arrow = null;
                if (dir == null && !sealed && !g.winner) {
                  const q = g.queens[me];
                  const di = DIRS.findIndex(
                    (d) => q.r + d.dr === r && q.c + d.dc === c
                  );
                  if (di >= 0 && openDirs.includes(di)) arrow = di;
                }

                return (
                  <button
                    key={i}
                    disabled={arrow == null}
                    onClick={() => arrow != null && pickDir(arrow)}
                    className="relative flex aspect-square items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    style={{
                      background: (r + c) % 2 ? C.sqA : C.sqB,
                      cursor: arrow != null ? "pointer" : "default",
                    }}
                  >
                    {/* remaining reach, dotted */}
                    {onRay && !spentRay && (
                      <span
                        className="absolute inset-1 rounded-sm"
                        style={{ border: `1px dashed ${C.line}` }}
                      />
                    )}

                    {/* letters already on the board */}
                    {cell && !pv && queenIdx < 0 && (
                      <span
                        style={{
                          fontSize: "min(4.2vw,1.35rem)",
                          color: cell.kind === "loose" ? C.brass : C.bone,
                          opacity: cell.kind === "loose" ? 1 : 0.55,
                          fontVariant: "small-caps",
                        }}
                      >
                        {cell.letter}
                      </span>
                    )}

                    {/* the word being written */}
                    {pv && queenIdx < 0 && (
                      <span
                        className="stamp absolute inset-1 flex items-center justify-center rounded-sm"
                        style={{
                          background: pv.from === "board" ? "transparent" : C.bone,
                          border:
                            pv.from === "board" ? `1px solid ${C.brass}` : "none",
                          color: pv.from === "board" ? C.brass : C.sqA,
                          fontSize: "min(4.4vw,1.4rem)",
                        }}
                      >
                        {pv.letter}
                      </span>
                    )}

                    {/* queens */}
                    {queenIdx >= 0 && (
                      <span
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                          color: PLAYERS[queenIdx].tint,
                          fontSize: "min(6.5vw,2.1rem)",
                          textShadow: "0 1px 2px rgba(0,0,0,.6)",
                        }}
                      >
                        ♛
                      </span>
                    )}

                    {/* direction spokes */}
                    {arrow != null && (
                      <span
                        className="absolute inset-0 flex items-center justify-center"
                        style={{
                          color: C.brass,
                          opacity: 0.75,
                          fontSize: "1rem",
                          transform: `rotate(${DIRS[arrow].rot}deg)`,
                        }}
                      >
                        ▲
                      </span>
                    )}

                    {/* coordinates, quietly */}
                    {c === 0 && (
                      <span
                        className="absolute left-0.5 top-0.5 text-[8px]"
                        style={{ fontFamily: MONO, color: C.line }}
                      >
                        {N - r}
                      </span>
                    )}
                    {r === N - 1 && (
                      <span
                        className="absolute bottom-0.5 right-0.5 text-[8px]"
                        style={{ fontFamily: MONO, color: C.line }}
                      >
                        {FILES[c]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* sealed envelope between turns */}
            {sealed && !g.winner && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center rounded-sm px-6 text-center"
                style={{ background: "rgba(12,20,30,.94)" }}
              >
                <p
                  className="mb-1 text-xs uppercase"
                  style={{ fontFamily: MONO, color: C.dim, letterSpacing: "0.2em" }}
                >
                  move sent
                </p>
                <p className="mb-6 text-2xl">Sealed for {PLAYERS[g.turn].name}</p>
                <button
                  onClick={() => setSealed(false)}
                  className="rounded-sm px-6 py-3 text-sm uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  style={{
                    fontFamily: MONO,
                    letterSpacing: "0.18em",
                    background: C.brass,
                    color: C.night,
                  }}
                >
                  Open
                </button>
              </div>
            )}
          </div>

          <p className="mt-3 text-xs" style={{ fontFamily: MONO, color: C.dim }}>
            <span style={{ color: C.brass }}>gold</span> = loose letters ·{" "}
            <span style={{ color: C.bone }}>pale</span> = words already written ·
            tiles left in bag: {g.bag.length}
          </p>
        </div>

        {/* ── right: the move slip ── */}
        <div className="w-full lg:w-80">
          <div className="rounded-sm" style={{ background: C.paper, color: "#20303F" }}>
            <div
              style={{
                height: 10,
                backgroundImage: `radial-gradient(circle at 6px 0, ${C.night} 3px, ${C.paper} 3.5px)`,
                backgroundSize: "12px 10px",
              }}
            />
            <div className="px-5 pb-5 pt-3">
              <div className="mb-4 flex items-baseline justify-between">
                <p
                  className="text-xs uppercase"
                  style={{ fontFamily: MONO, letterSpacing: "0.2em", opacity: 0.55 }}
                >
                  move slip
                </p>
                <p
                  className="text-xs"
                  style={{ fontFamily: MONO, opacity: 0.55 }}
                >
                  no. {g.log.length + 1}
                </p>
              </div>

              <div className="mb-4 flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{
                    background: PLAYERS[me].tint,
                    boxShadow: "0 0 0 1px rgba(0,0,0,.25)",
                  }}
                />
                <span className="text-lg">{PLAYERS[me].name} to move</span>
              </div>

              {g.winner != null ? (
                <div className="rise">
                  <p className="mb-1 text-2xl">{PLAYERS[g.winner].name} wins.</p>
                  <p className="mb-4 text-sm" style={{ opacity: 0.65 }}>
                    The queen was taken on the last letter.
                  </p>
                </div>
              ) : (
                <>
                  {/* the word, in letterpress boxes */}
                  <div className="mb-3 flex min-h-[3rem] flex-wrap items-center gap-1">
                    {spelled.length === 0 && (
                      <p className="text-sm leading-relaxed" style={{ opacity: 0.6 }}>
                        {dir == null
                          ? "Tap an arrow around your queen to choose a heading."
                          : "Now spell. Each letter is one square travelled."}
                      </p>
                    )}
                    {spelled.map((p, i) => (
                      <span
                        key={i}
                        className="stamp flex h-10 w-9 items-center justify-center rounded-sm text-xl"
                        style={{
                          background: p.from === "board" ? "transparent" : "#20303F",
                          color: p.from === "board" ? "#8A6E2F" : C.paper,
                          border:
                            p.from === "board" ? "1px solid #8A6E2F" : "none",
                        }}
                      >
                        {p.letter}
                      </span>
                    ))}
                  </div>

                  <p
                    className="mb-4 text-xs"
                    style={{ fontFamily: MONO, opacity: 0.6 }}
                  >
                    {dest
                      ? `${word.length} squares · ${sq(
                          g.queens[me].r,
                          g.queens[me].c
                        )} → ${sq(dest.r, dest.c)}${
                          dest.capture ? " · takes the queen" : ""
                        }`
                      : `heading open · ${ray.length || 0} squares of room`}
                  </p>

                  {/* rack */}
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {g.racks[me].map((ltr, i) => {
                      const spent = usedRack.has(i);
                      return (
                        <button
                          key={i}
                          onClick={() => addLetter(i)}
                          disabled={spent || dir == null}
                          className="flex h-11 w-10 items-center justify-center rounded-sm text-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                          style={{
                            background: spent ? "transparent" : "#FBF7EC",
                            border: `1px solid ${spent ? C.paperLine : "#B9AA88"}`,
                            color: spent ? C.paperLine : "#20303F",
                            opacity: dir == null && !spent ? 0.45 : 1,
                            boxShadow: spent ? "none" : "0 1px 0 #B9AA88",
                          }}
                        >
                          {ltr}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={send}
                      disabled={!legal}
                      className="flex-1 rounded-sm px-4 py-3 text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      style={{
                        fontFamily: MONO,
                        letterSpacing: "0.18em",
                        background: legal ? "#20303F" : "transparent",
                        color: legal ? C.paper : C.paperLine,
                        border: `1px solid ${legal ? "#20303F" : C.paperLine}`,
                      }}
                    >
                      Send move
                    </button>
                    <button
                      onClick={takeBack}
                      disabled={!spelled.length}
                      className="rounded-sm px-3 py-3 text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      style={{
                        fontFamily: MONO,
                        letterSpacing: "0.14em",
                        border: `1px solid ${C.paperLine}`,
                        opacity: spelled.length ? 1 : 0.4,
                      }}
                    >
                      Back
                    </button>
                    <button
                      onClick={reset}
                      className="rounded-sm px-3 py-3 text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                      style={{
                        fontFamily: MONO,
                        letterSpacing: "0.14em",
                        border: `1px solid ${C.paperLine}`,
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* log, in correspondence notation */}
          <div className="mt-5">
            <p
              className="mb-2 text-xs uppercase"
              style={{ fontFamily: MONO, color: C.dim, letterSpacing: "0.2em" }}
            >
              record
            </p>
            {g.log.length === 0 && (
              <p className="text-sm" style={{ color: C.dim }}>
                Nothing posted yet.
              </p>
            )}
            <ol className="space-y-1">
              {g.log.map((m, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 text-sm"
                  style={{ fontFamily: MONO, color: C.dim }}
                >
                  <span style={{ width: 22, textAlign: "right", opacity: 0.6 }}>
                    {i + 1}.
                  </span>
                  <span style={{ color: PLAYERS[m.player].tint }}>♛</span>
                  <span>
                    {m.from}→{m.to}
                  </span>
                  <span style={{ color: C.bone, letterSpacing: "0.08em" }}>
                    {m.word}
                  </span>
                  {m.capture && <span style={{ color: C.claret }}>×</span>}
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => setShowRules((s) => !s)}
              className="self-start text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              style={{ fontFamily: MONO, color: C.brass, letterSpacing: "0.16em" }}
            >
              {showRules ? "Hide" : "What I assumed"}
            </button>
            {showRules && (
              <ul
                className="rise space-y-2 text-xs leading-relaxed"
                style={{ color: C.dim }}
              >
                <li>The word is spelled along the path — one letter per square.</li>
                <li>
                  Word length = distance. There is no other way to move, and no
                  passing.
                </li>
                <li>
                  Letters already lying on a square get picked up free, in order,
                  and count toward the length — so the board's litter both helps
                  and steers you.
                </li>
                <li>At least one tile must come off your own rack.</li>
                <li>
                  Landing on the enemy queen takes her. You can't travel past her.
                </li>
                <li>
                  Words are not checked against a dictionary yet — anything goes.
                </li>
              </ul>
            )}
            <button
              onClick={newGame}
              className="self-start text-xs uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              style={{ fontFamily: MONO, color: C.dim, letterSpacing: "0.16em" }}
            >
              New board
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
