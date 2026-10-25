# LukeChess — first forest milestone

LukeChess extends Quiet Chess with a living visualization of real JavaScript
chess search. Stockfish 18 remains the playing opponent. Desktop dragging and
tap-to-move both remain enabled.

Serve this directory with `python3 -m http.server 8123`. No build or backend is
required. The opening forest starts on load; select a piece to highlight its
paths. Expand the Living forest tuning groups to adjust:

- Growth: paint rate, fade speed, explorer depth, search burst and rest time.
- Geometry: curvature, bend variation, perpendicular scatter, depth taper,
  stroke width in CSS pixels, tip-width ratio, lookahead fading, capture-circle
  size, and curve smoothness.
- Independent forest/selected layers: canvas opacity, stroke opacity, fade
  multiplier.
- Colours: capture colours for White and Black. Ordinary paths stay monochrome,
  with separate brightness faders (White 80%, Black 20%).

Every fader displays its value. Changes affect new strokes while existing
feedback fades naturally; canvas opacity and fading affect existing marks too.
Settings persist in localStorage and Reset tuning restores the defaults.
Selected canvas opacity defaults to 100%, unselected to 75%. Default fading
has a roughly 69-second half-life (selected about 50 seconds); setting fade
speed or a layer's fade multiplier to zero retains that layer indefinitely.
WebGL2 is required for the forest; chess remains playable without it.

## Implementation

- `explorer-worker.js` instruments Garbochess-JS's successful legal make/unmake
  traversal. Events contain actual explored sequences, not principal variations.
  Null-move pruning is disabled in the vendored engine. Rejected branches are
  included. Each burst restarts from the current FEN, defaults to searching up to five plies
  (plus check extensions/quiescence), and is bounded by a time/node/depth budget.
  A bounded sample of visited paths is sent to the renderer. Worker errors are
  reported without stopping chess. Checkmate metadata is reserved as unknown;
  capture/check flags are independent.
- `forest.js` tracks piece identities from the root position through each legal
  variation, including promotions, captures, en passant, and castling. A piece's
  successive visited squares form connected quadratic segments. Only curvature,
  depth-tapered perpendicular scatter are artistic. Ordinary paths are grayscale;
  capture prefixes and markers use the capturing side's colour.
- Two layers each use ping-pong WebGL2 feedback textures. Each frame fades the
  previous image and adds a limited number of complete paths. Stroke opacity is
  separate from compositing opacity. `forest-tuning.js` defines the controls,
  validated local settings, live values, and reset behavior. Search tuning is
  debounced and generation-tagged; safety caps still bound node/path work.
- Curvature direction is deterministic: even `(x+y)` squares bend one way,
  odd squares the other, using zero-based source-square coordinates. A stable
  source/destination/piece/depth hash varies bend magnitude, independently of
  search cycle and board orientation. Scatter can vary between bursts; setting
  scatter to zero makes repeated move paths geometrically identical.
- Strokes taper along the direction of travel, wide at the origin and narrow
  at the tip. Scatter spreads the source and decreases toward a fixed final
  destination, so accumulated strokes also point in the direction of travel.
  Alpha is multiplied by exp(-lookaheadFading * (ply - 1)), using
  actual search ply rather than the number of times that piece moved. Width
  and scatter also taper with actual search depth.
- The prefix of a piece journey through its last capture uses the capturing
  side's colour: orange for White, purple for Black. The capturing piece gets
  a 2:1 ellipse at its current root square, centred 75% down the square. An
  outlined five-pointed star, 50% larger than the original, marks the future
  capture landing square,
  including en passant. Path and both markers use the same colour regardless
  of selection. Marker stroke width defaults to 24 CSS pixels divided by ply;
  both star and ellipse outlines thin by the same lookahead rule. Width, depth
  thinning, radius and capture colours have controls. Every visited
  capture remains represented even if followed by a quiet move in the branch.
- Position changes clear old feedback/queues and invalidate messages by position
  generation. Board flips clear orientation-dependent feedback. Selection routes
  new strokes without restarting search; old strokes fade naturally. Playback
  of past game positions also updates the explorer. The overlay cannot receive
  pointer input and sits below the pieces.

The engine uses bounded synchronous bursts in a dedicated worker, yielding
between bursts. This first version deliberately re-explores a shallow tree;
search strength, art quality, CPU use, and device performance need further
iteration. No mobile/90 Hz hardware performance claim has been made. Tentative
moves, Commit, check/mate effects, presets, and Hashtag64 are later phases.

## Validation

Run `npm ci`, start the static server in the repository root, then run
`node tools/test-forest.cjs`. This uses puppeteer-core and Chromium (default
`/usr/bin/chromium`, override with `CHROME_PATH`). It checks painted opening
pixels, sampled legal search paths in special-move positions, selected-tree
routing, tap and drag gameplay with Stockfish replies, Undo, board flipping,
resize, real feedback fading, tuning effects/persistence/reset, deterministic
curvature, source-to-tip taper, generation opacity, capture-path colour, capturer ellipse and five-point capture-star
placement, and gameplay without WebGL2.

## Explorer attribution

Garbochess-JS by Gary Linscott is vendored in `vendor/garbochess/` under its BSD
3-Clause licence; its notice is retained there. The sole engine source change
is disabling the null-move/razoring block. Instrumentation lives in the separate
worker adapter. LukeChess retains Quiet Chess's GPLv3 licence and existing
component credits below.

---

# Quiet Chess

**Analyse your games with no account, no upload, and no record.**

*(A "quiet move" improves your position without fanfare. So does this app.)*

A lichess-style web chess game against Stockfish 18, running entirely in the
browser — no backend. The engine is the official Stockfish WASM build (lite,
single-threaded) executing in a Web Worker, so the whole thing is static files
and can be hosted on GitHub Pages. Games you paste or play never leave your
machine: the engine runs locally, shared games travel as plain PGN in the URL,
and nothing is stored anywhere.

## Run locally

Any static file server works:

```sh
python3 -m http.server 8123
# then open http://localhost:8123/
```

## Features

- Drag-and-drop board (chessground — lichess's own board UI), legal-move
  hints, last-move and check highlights, premoves
- Play as White, Black, or random side — or "Both" for pass-and-play with a
  friend on one device (the engine sits out; undo takes back one move)
- Engine strength slider: 1320–3190 Elo (`UCI_LimitStrength` / `UCI_Elo`)
- Move list, undo, flip board, promotion picker
- Checkmate / stalemate / draw detection (chess.js)
- Sounds from lichess's standard set (move, capture, game end) with a
  persistent mute toggle
- "Get a hint" — a full-strength MultiPV search shows the best move as a
  green arrow and the runner-up as a second arrow coloured by how much
  win probability it gives away (blue &lt;5%, yellow &lt;15%, red beyond),
  each labelled with its eval; the status line spells out the comparison
  (works even when the opponent is strength-limited)
- Eval bar — score lines from engine searches, mapped to win probability
  (lichess's sigmoid); fresh games and undos get a quick full-strength eval,
  mates show `#N`, finished games show `1-0` / `0-1` / `½`
- Post-game analysis graph — when a game ends, every position is re-evaluated
  at full strength and drawn as a win-probability chart (lichess-style).
  Moves that lose ≥10/20/30% win probability are marked as
  inaccuracies / mistakes / blunders; click the graph, click a move in the
  move list, or use ←/→ to step through the game on the board.
- Full review: per-player accuracy scores (lichess's formula), `?!`/`?`/`??`
  glyphs on the marked moves in the move list, and a green best-move arrow
  on every reviewed position showing what the engine would have played.
- Shareable games — finished games write themselves into the URL as standard
  PGN (`?pgn=…`), and a small box at the bottom of the panel accepts any
  pasted PGN. Opening a link (or pasting) replays the game and runs the
  analysis graph, even for unfinished games; games from custom positions
  round-trip via PGN's `[FEN]` header, and you can keep playing against the
  engine from where a loaded game left off.
- Position links — "Copy position link" puts the current position (or the one
  you're reviewing) in the URL as `?fen=…` and copies the link. Bookmark it
  like an opening-trainer card: opening the link drops you straight into the
  position against the engine, playing the side to move, and "New game"
  retries it. No storage anywhere — the URL is the save file.
- Opening book (`openings.html`) — a standalone page listing all 3,733 named
  ECO openings (data: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
  CC0, converted once to `openings.json`), with a live filter. Every line
  links to the app as a `?pgn=` URI: the opening appears on the board, ready
  to step through or play out against the engine.
- Endgame trainer: 270 positions from
  [melvincarvalho/endgames](https://github.com/melvincarvalho/endgames), each
  with a goal (convert the win / hold the draw). The engine defends at full
  strength; the app detects success or failure and "New game" retries the
  position.

## How it works

| Piece | Role |
|---|---|
| `vendor/chessground.min.js` | board rendering and interaction |
| `vendor/chess.js` | rules, legality, game-over detection |
| `vendor/stockfish-18-lite-single.js` + `.wasm` | the engine, spoken to over UCI text protocol |
| `app.js` | glue: user move → chess.js → `position fen` / `go movetime` → `bestmove` → board |

The single-threaded engine build is used deliberately: multi-threaded WASM
needs `SharedArrayBuffer`, which requires cross-origin-isolation headers that
GitHub Pages can't send. Single-threaded is plenty strong for play.

A debug handle is exposed in the browser console: `game.chess`, `game.engine`,
`game.move('e2', 'e4')`, `game.newGame()`.

## Updating vendored libraries

Vendored files come from npm (`chessground`, `chess.js`, `stockfish`):

```sh
npm install
cp node_modules/chessground/dist/chessground.min.js vendor/
cp node_modules/chessground/assets/chessground.*.css vendor/
cp node_modules/chess.js/dist/esm/chess.js vendor/
cp node_modules/stockfish/bin/stockfish-18-lite-single.{js,wasm} vendor/
```

`positions.json` is generated by `tools/extract-positions.js` from a clone of
the endgames repo (`node tools/extract-positions.js /path/to/endgames/docs`;
needs native stockfish at `/usr/games/stockfish`): every `fen="…"` in its docs
is extracted (labelled by nearest heading and doc directory), validated
with chess.js, then classified by native Stockfish (~250 ms/position) —
decisive evals become "win" goals for the better side, near-zero evals become
"draw" goals defended from the side to move, ambiguous evals (50–200 cp) are
dropped.

Sound files in `sounds/` are the "standard" sound set from
[lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/sound/standard)
(AGPL-3.0). In that set the check sound is silence and the victory/defeat/draw
sounds all alias `GenericNotify`, so only `Move`, `Capture`, and
`GenericNotify` are vendored.

## Credits and licences

This app is [GPL-3.0](LICENSE). It stands on excellent open-source work:

| Component | Author / project | Licence |
|---|---|---|
| [Stockfish](https://github.com/official-stockfish/Stockfish) 18 (official WASM build via [stockfish npm](https://www.npmjs.com/package/stockfish)) | The Stockfish developers | GPL-3.0 |
| [chessground](https://github.com/lichess-org/chessground) board UI | lichess.org | GPL-3.0 |
| [chess.js](https://github.com/jhlywa/chess.js) rules engine | Jeff Hlywa | BSD-2-Clause |
| cburnett piece set (via chessground assets) | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | CC-BY-SA 3.0 / GFDL |
| Board sounds (standard set) | [lichess-org/lila](https://github.com/lichess-org/lila) | AGPL-3.0 |
| Endgame positions | [melvincarvalho/endgames](https://github.com/melvincarvalho/endgames) | see repo |

The win-probability sigmoid, judgement thresholds (inaccuracy / mistake /
blunder), and accuracy formula follow lichess's published approach.
