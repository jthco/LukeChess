/* Actual Garbochess traversal, independent of the Stockfish opponent. */
importScripts("vendor/garbochess/garbochess.js");
g_hashSize = 1 << 16;
g_hashMask = g_hashSize - 1;
const make = MakeMove,
  unmake = UnmakeMove;
let stack = [],
  making = false,
  running = false,
  batch = [],
  visited = 0;
let position = null,
  timer,
  cycle = 0,
  rng = 1;
const LIMIT = {};
function random() {
  rng ^= rng << 13;
  rng ^= rng >>> 17;
  rng ^= rng << 5;
  return (rng >>> 0) / 4294967296;
}
function square(s) {
  return String.fromCharCode(97 + (s & 15) - 4) + (10 - (s >> 4));
}
MakeMove = function (move) {
  if (!running) return make(move);
  if (++visited > 12000 || stack.length >= 16) throw LIMIT;
  const from = move & 255,
    to = (move >> 8) & 255;
  const event = {
    from: square(from),
    to: square(to),
    piece: ["", "p", "n", "b", "r", "q", "k"][g_board[from] & 7],
    color: g_toMove === colorWhite ? "w" : "b",
    capture: !!g_board[to] || !!(move & moveflagEPC),
    castle: !!(move & (moveflagCastleKing | moveflagCastleQueen)),
    promotion: move & moveflagPromotion ? FormatMove(move).slice(4) : undefined,
  };
  making = true;
  let legal;
  try {
    legal = make(move);
  } finally {
    making = false;
  }
  if (!legal) return false;
  event.check = g_inCheck;
  // Mate is optional/unknown here, never inferred just from a check.
  event.mate = null;
  stack.push(event);
  if (stack.length >= 3) {
    const path = stack.slice();
    if (batch.length < 96) batch.push(path);
    else {
      const i = Math.floor(random() * visited);
      if (i < 96) batch[i] = path;
    }
  }
  return true;
};
UnmakeMove = function (move) {
  unmake(move);
  if (running && !making) stack.pop();
};
function explore() {
  if (!position) return;
  stack = [];
  batch = [];
  visited = 0;
  ResetGame();
  const error = InitializeFromFen(position.fen);
  if (error) {
    postMessage({ id: position.id, error });
    return;
  }
  g_timeout = 65;
  running = true;
  try {
    Search(null, 5, null);
  } catch (e) {
    if (e !== LIMIT) {
      postMessage({ id: position.id, error: String(e) });
      return;
    }
  } finally {
    running = false;
  }
  postMessage({
    id: position.id,
    fen: position.fen,
    cycle: cycle++,
    visited,
    paths: batch,
  });
  // Yield for cancellation/position messages and keep CPU use bounded.
  timer = setTimeout(explore, 90);
}
self.onmessage = ({ data }) => {
  clearTimeout(timer);
  position = data;
  cycle = 0;
  rng =
    [...data.fen].reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
      2166136261,
    ) || 1;
  explore();
};
