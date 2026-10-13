// The rules of the game and nothing else: no drawing, no clock, no input.
// The pane's surface module (board.tsx) and the terminal front end
// (cli/main.ts) both play this one game, so it stays free of imports and of
// any syntax Node cannot strip.

export const COLS = 10
export const ROWS = 20

// Rows above the visible field, where a piece spawns.
const HIDDEN = 2
const HEIGHT = ROWS + HIDDEN
// A piece resting on the stack waits a beat of its own fall before it locks,
// within these bounds: slow levels give time to slide it, fast ones still do.
const MIN_LOCK_DELAY_MS = 500
const MAX_LOCK_DELAY_MS = 1000
const MAX_LOCK_RESETS = 15
const BANNER_MS = 1200
// How long the rows just cleared show white before they go, a hard drop's
// trail shows, and the field shakes under garbage that rose.
const FLASH_MS = 120
const TRAIL_MS = 110
const SHAKE_MS = 220

// Points for a lock that clears lines, by how many: plain, with a T-spin,
// with a mini T-spin, and the extra for leaving the field empty (a perfect
// clear), all times the level. A tetris or T-spin straight after another is
// back to back and worth half as much again; each lock of a combo (locks that
// each clear a line, one after another) adds a little more.
const LINE_SCORES = [0, 100, 300, 500, 800]
const SPIN_SCORES = [400, 800, 1200, 1600]
const MINI_SCORES = [100, 200, 400, 400]
const PERFECT_SCORES = [0, 800, 1200, 1800, 2000]
const B2B_SCALE = 1.5
const COMBO_SCORE = 50
const LINE_NAMES = ['', 'Single', 'Double', 'Triple', 'Tetris!']
const SPIN_NAMES = ['T-Spin', 'T-Spin Single', 'T-Spin Double', 'T-Spin Triple']
const MINI_NAMES = ['T-Spin Mini', 'T-Spin Mini Single', 'T-Spin Mini Double', 'T-Spin Mini Triple']

// Garbage lines a clear sends an opponent, Tetris Battle's way: by lines
// cleared, plain, with a T-spin and with a mini; one more when back to back;
// more again by the length of the combo; and ten for a perfect clear. Lines
// sent first cancel garbage waiting here.
const LINE_ATTACK = [0, 0, 1, 2, 4]
const SPIN_ATTACK = [0, 2, 4, 6]
const MINI_ATTACK = [0, 0, 1, 2]
const B2B_ATTACK = 1
const COMBO_ATTACK = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]
const PERFECT_ATTACK = 10
// Garbage waiting rises when a piece locks without clearing a line, this many
// lines at most at once.
const GARBAGE_PER_LOCK = 8

export const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const

// The id of a garbage block, after the seven kinds', and of a cell in a row
// about to go.
export const GARBAGE = KINDS.length + 1
export const FLASH = GARBAGE + 1
// A cell a hard drop fell through is drawn as `-(TRAIL + id)`.
export const TRAIL = 10

export type Kind = (typeof KINDS)[number]

export type Action =
  | 'left'
  | 'right'
  | 'down'
  | 'drop'
  | 'cw'
  | 'ccw'
  | 'hold'
  | 'pause'
  | 'restart'

const ACTIONS: readonly string[] = [
  'left',
  'right',
  'down',
  'drop',
  'cw',
  'ccw',
  'hold',
  'pause',
  'restart',
] satisfies readonly Action[]

// Whether a string that came from outside the game names one of its inputs.
export const isAction = (name: string): name is Action => ACTIONS.includes(name)

// The one keymap both front ends read, by the character typed or a special
// key's name, so a key means the same thing wherever the game is played.
export const KEYS: Readonly<Record<string, Action>> = {
  left: 'left',
  a: 'left',
  h: 'left',
  right: 'right',
  d: 'right',
  l: 'right',
  down: 'down',
  s: 'down',
  j: 'down',
  up: 'cw',
  w: 'cw',
  k: 'cw',
  x: 'cw',
  z: 'ccw',
  ' ': 'drop',
  space: 'drop',
  return: 'drop',
  f: 'drop',
  c: 'hold',
  p: 'pause',
  r: 'restart',
}

export type Status = 'ready' | 'playing' | 'paused' | 'over'

export type Piece = { kind: Kind; rot: number; x: number; y: number }

// How a T locked: not spun, spun into a slot with the corners it points at
// open (a mini), or spun fully.
export type Spin = 'none' | 'mini' | 'full'

export type Game = {
  // HEIGHT rows of COLS cells: 0 is empty, otherwise a kind's id or GARBAGE.
  board: number[][]
  piece: Piece
  hold: Kind | null
  canHold: boolean
  queue: Kind[]
  score: number
  lines: number
  level: number
  status: Status
  // The name of the last line clear, shown for a moment.
  banner: string
  bannerMs: number
  // The run of locks so far that each cleared a line; 0 outside one.
  combo: number
  // Whether the last clear was a tetris or a T-spin: the next is back to back.
  isB2B: boolean
  // Garbage lines waiting to rise, as the column each leaves open.
  pending: number[]
  // Lines sent to opponents so far, after cancelling garbage waiting here.
  sent: number
  seed: number
  fallMs: number
  lockMs: number
  lockResets: number
  // The lowest row the piece has reached: its lock clock starts afresh only
  // when it gets lower still, not when a turn lifts it and it comes back down.
  lowest: number
  // Whether the piece's last move was a turn, and by which of its kicks: a T
  // that locks straight after a turn has spun.
  wasTurned: boolean
  kick: number
  // The field as it looked with the rows just cleared still in it, those
  // rows FLASH, shown for a moment before they go.
  flash: number[][] | null
  flashMs: number
  // The cells a hard drop just fell through, shown for a moment.
  trail: { cells: Point[]; id: number } | null
  trailMs: number
  // Garbage lines that just rose, while the field shakes under them.
  risen: number
  shakeMs: number
}

export type Point = readonly [x: number, y: number]

// Each kind in its spawn orientation, inside the square box it rotates in.
const SPAWN: Record<Kind, { size: number; cells: readonly Point[] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
}

// The four orientations of a kind, each a quarter turn clockwise of the last.
function turns(kind: Kind): readonly (readonly Point[])[] {
  const { size, cells } = SPAWN[kind]
  const states: (readonly Point[])[] = [cells]
  for (let rot = 1; rot < 4; rot++) {
    const previous = states[rot - 1] ?? cells
    states.push(previous.map(([x, y]): Point => [size - 1 - y, x]))
  }

  return states
}

const SHAPES: Record<Kind, readonly (readonly Point[])[]> = {
  I: turns('I'),
  O: turns('O'),
  T: turns('T'),
  S: turns('S'),
  Z: turns('Z'),
  J: turns('J'),
  L: turns('L'),
}

// SRS wall kicks by `${from}${to}` rotation state, y growing downward.
const KICKS: Record<string, readonly Point[]> = {
  '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
}

const KICKS_I: Record<string, readonly Point[]> = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
}

// The kick that lifts a T into a slot from the side: a turn by it is a full
// T-spin whatever the corners say.
const LAST_KICK = 4

// The corners of a T's box, clockwise from the top left. The T points at
// corners `rot` and `rot + 1`.
const CORNERS: readonly Point[] = [[0, 0], [2, 0], [2, 2], [0, 2]]

const idOf = (kind: Kind): number => KINDS.indexOf(kind) + 1

const emptyRow = (): number[] => new Array<number>(COLS).fill(0)

function garbageRow(hole: number): number[] {
  const row = new Array<number>(COLS).fill(GARBAGE)
  row[Math.min(Math.max(hole, 0), COLS - 1)] = 0

  return row
}

// A kind's cells in an orientation, inside the box it rotates in.
export function shapeOf(kind: Kind, rot: number): readonly Point[] {
  return SHAPES[kind][rot & 3] ?? SPAWN[kind].cells
}

function collides(game: Game, kind: Kind, rot: number, x: number, y: number): boolean {
  for (const [dx, dy] of shapeOf(kind, rot)) {
    const cx = x + dx
    const cy = y + dy
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= HEIGHT) return true
    if (game.board[cy]?.[cx] !== 0) return true
  }

  return false
}

function fits(game: Game, dx: number, dy: number, rot = game.piece.rot): boolean {
  const { kind, x, y } = game.piece

  return !collides(game, kind, rot, x + dx, y + dy)
}

// mulberry32: the whole generator is the one number the game carries.
function random(game: Game): number {
  game.seed = (game.seed + 0x6d2b79f5) >>> 0
  let t = game.seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Seven-bag: every kind once per bag, so no drought outlasts twelve pieces.
function refill(game: Game): void {
  while (game.queue.length < 7) {
    const bag: Kind[] = [...KINDS]
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random(game) * (i + 1))
      const swapped = bag[i]
      const other = bag[j]
      if (swapped !== undefined && other !== undefined) {
        bag[i] = other
        bag[j] = swapped
      }
    }
    game.queue.push(...bag)
  }
}

function spawn(game: Game, kind?: Kind): void {
  refill(game)
  const next = kind ?? game.queue.shift() ?? 'T'
  refill(game)
  const x = Math.floor((COLS - SPAWN[next].size) / 2)
  game.piece = { kind: next, rot: 0, x, y: 0 }
  game.fallMs = 0
  game.lockMs = 0
  game.lockResets = 0
  game.lowest = 0
  game.wasTurned = false
  game.kick = 0
  if (collides(game, next, 0, x, 0)) {
    game.status = 'over'

    return
  }
  // Into view at once, whole where the stack leaves room for it.
  while (game.piece.y < HIDDEN && fits(game, 0, 1)) game.piece.y += 1
  game.lowest = game.piece.y
}

// One row down. A row lower than any before gives the piece its whole lock
// delay and all its resets again.
function descend(game: Game): void {
  game.piece.y += 1
  game.wasTurned = false
  if (game.piece.y <= game.lowest) return
  game.lowest = game.piece.y
  game.lockMs = 0
  game.lockResets = 0
}

// Whether a T about to lock has spun: its last move was a turn, and three of
// the four corners around its centre are filled (the walls and floor count).
// Both corners it points at filled, or the last kick, make it a full spin.
function spinOf(game: Game): Spin {
  const { kind, rot, x, y } = game.piece
  if (kind !== 'T' || !game.wasTurned) return 'none'
  const isFilled = ([dx, dy]: Point): boolean => {
    const cx = x + dx
    const cy = y + dy

    return cx < 0 || cx >= COLS || cy >= HEIGHT || (cy >= 0 && game.board[cy]?.[cx] !== 0)
  }
  const filled = CORNERS.map(isFilled)
  if (filled.filter(Boolean).length < 3) return 'none'
  const isFacing = filled[rot & 3] === true && filled[(rot + 1) & 3] === true

  return isFacing || game.kick === LAST_KICK ? 'full' : 'mini'
}

function say(game: Game, banner: string): void {
  game.banner = banner
  game.bannerMs = BANNER_MS
}

// A lock that cleared lines: what it scores, and what it sends.
function clear(game: Game, cleared: number, spin: Spin): void {
  const isPerfect = game.board.every(row => row.every(cell => cell === 0))
  const isHard = cleared === 4 || spin !== 'none'
  const isB2B = isHard && game.isB2B
  game.combo += 1

  const scores = spin === 'full' ? SPIN_SCORES : spin === 'mini' ? MINI_SCORES : LINE_SCORES
  let points = (scores[cleared] ?? 0) * (isB2B ? B2B_SCALE : 1)
  points += COMBO_SCORE * (game.combo - 1)
  if (isPerfect) points += PERFECT_SCORES[cleared] ?? 0
  game.score += points * game.level
  game.lines += cleared
  game.level = 1 + Math.floor(game.lines / 10)

  const attacks = spin === 'full' ? SPIN_ATTACK : spin === 'mini' ? MINI_ATTACK : LINE_ATTACK
  let attack = attacks[cleared] ?? 0
  if (isB2B) attack += B2B_ATTACK
  attack += COMBO_ATTACK[Math.min(game.combo, COMBO_ATTACK.length) - 1] ?? 0
  if (isPerfect) attack += PERFECT_ATTACK
  const cancelled = Math.min(attack, game.pending.length)
  game.pending.splice(0, cancelled)
  game.sent += attack - cancelled

  game.isB2B = isHard
  const names = spin === 'full' ? SPIN_NAMES : spin === 'mini' ? MINI_NAMES : LINE_NAMES
  say(game, isPerfect ? 'Perfect Clear!' : `${isB2B ? 'B2B ' : ''}${names[cleared] ?? ''}`)
}

// A lock that cleared nothing ends a combo, and lets waiting garbage rise:
// the stack moves up, and under it come rows full but for one column. A
// T-spin that clears nothing scores a little, and does not break a chain.
function rest(game: Game, spin: Spin): void {
  game.combo = 0
  if (spin !== 'none') {
    game.score += (spin === 'full' ? SPIN_SCORES[0] ?? 0 : MINI_SCORES[0] ?? 0) * game.level
    say(game, spin === 'full' ? 'T-Spin' : 'T-Spin Mini')
  }
  const rising = game.pending.splice(0, GARBAGE_PER_LOCK)
  for (const hole of rising) {
    game.board.shift()
    game.board.push(garbageRow(hole))
  }
  if (rising.length > 0) {
    game.risen = rising.length
    game.shakeMs = SHAKE_MS
  }
}

function lock(game: Game): void {
  const spin = spinOf(game)
  const id = idOf(game.piece.kind)
  let isInView = false
  for (const [dx, dy] of shapeOf(game.piece.kind, game.piece.rot)) {
    const row = game.board[game.piece.y + dy]
    if (row !== undefined) row[game.piece.x + dx] = id
    if (game.piece.y + dy >= HIDDEN) isInView = true
  }

  const kept = game.board.filter(row => row.includes(0))
  const cleared = HEIGHT - kept.length
  if (cleared > 0) {
    game.flash = game.board
      .slice(HIDDEN)
      .map(row => (row.includes(0) ? [...row] : new Array<number>(COLS).fill(FLASH)))
    game.flashMs = FLASH_MS
    game.trail = null
    game.trailMs = 0
  }
  while (kept.length < HEIGHT) kept.unshift(emptyRow())
  game.board = kept
  if (cleared > 0) clear(game, cleared, spin)
  else rest(game, spin)

  if (!isInView) {
    game.status = 'over'

    return
  }
  game.canHold = true
  spawn(game)
}

// A move or a turn of a piece that was resting on the stack (`wasResting`) or
// rests on it now starts its lock delay over, a bounded number of times: it
// can be slid or turned into place, but not kept in the air by turning it.
function settle(game: Game, wasResting: boolean): void {
  if (!wasResting && fits(game, 0, 1)) return
  if (game.lockResets >= MAX_LOCK_RESETS) return
  game.lockMs = 0
  game.lockResets += 1
}

function shift(game: Game, dx: number): boolean {
  if (!fits(game, dx, 0)) return false
  const wasResting = !fits(game, 0, 1)
  game.piece.x += dx
  game.wasTurned = false
  settle(game, wasResting)

  return true
}

function rotate(game: Game, by: 1 | -1): boolean {
  const { kind, rot } = game.piece
  if (kind === 'O') return false
  const to = (rot + by) & 3
  const kicks = (kind === 'I' ? KICKS_I : KICKS)[`${rot}${to}`] ?? []
  const wasResting = !fits(game, 0, 1)
  for (const [at, [dx, dy]] of kicks.entries()) {
    if (fits(game, dx, dy, to)) {
      game.piece.x += dx
      game.piece.y += dy
      game.piece.rot = to
      game.wasTurned = true
      game.kick = at
      // A kick can push the piece down as well as up.
      game.lowest = Math.max(game.lowest, game.piece.y)
      settle(game, wasResting)

      return true
    }
  }

  return false
}

function softDrop(game: Game): boolean {
  if (!fits(game, 0, 1)) return false
  descend(game)
  game.score += 1
  game.fallMs = 0

  return true
}

function hardDrop(game: Game): boolean {
  const { kind, rot, x, y: from } = game.piece
  while (fits(game, 0, 1)) {
    game.piece.y += 1
    game.score += 2
    game.wasTurned = false
  }
  const fell = game.piece.y - from
  if (fell > 0) {
    // Each column of the piece, from where its top cell was to just above
    // where that cell came to rest.
    const tops = new Map<number, number>()
    for (const [dx, dy] of shapeOf(kind, rot)) tops.set(dx, Math.min(tops.get(dx) ?? dy, dy))
    const cells: Point[] = []
    for (const [dx, dy] of tops) {
      for (let row = from + dy; row < from + dy + fell; row++) {
        if (row >= HIDDEN) cells.push([x + dx, row - HIDDEN])
      }
    }
    game.trail = { cells, id: idOf(kind) }
    game.trailMs = TRAIL_MS
  }
  lock(game)

  return true
}

function swapHold(game: Game): boolean {
  if (!game.canHold) return false
  const held = game.hold
  game.hold = game.piece.kind
  game.canHold = false
  spawn(game, held ?? undefined)

  return true
}

export function createGame(seed = Math.floor(Math.random() * 0x100000000)): Game {
  const game: Game = {
    board: Array.from({ length: HEIGHT }, emptyRow),
    piece: { kind: 'T', rot: 0, x: 0, y: 0 },
    hold: null,
    canHold: true,
    queue: [],
    score: 0,
    lines: 0,
    level: 1,
    status: 'ready',
    banner: '',
    bannerMs: 0,
    combo: 0,
    isB2B: false,
    pending: [],
    sent: 0,
    seed: seed >>> 0,
    fallMs: 0,
    lockMs: 0,
    lockResets: 0,
    lowest: 0,
    wasTurned: false,
    kick: 0,
    flash: null,
    flashMs: 0,
    trail: null,
    trailMs: 0,
    risen: 0,
    shakeMs: 0,
  }
  spawn(game)

  return game
}

// A fresh game in the same object, dealt from where the old one's bag left off.
export function restart(game: Game): void {
  Object.assign(game, createGame(game.seed))
  game.status = 'playing'
}

export function pause(game: Game): boolean {
  if (game.status !== 'playing') return false
  game.status = 'paused'

  return true
}

// Starts a game not yet begun, or takes a paused one up again.
export function go(game: Game): boolean {
  if (game.status !== 'ready' && game.status !== 'paused') return false
  game.status = 'playing'

  return true
}

// Garbage an opponent sent: `lines` rows, each open at the one column `hole`
// (a random one unless given), which rise the next time a piece locks
// without clearing a line, unless lines sent from here cancel them first.
export function receive(game: Game, lines: number, hole = Math.floor(random(game) * COLS)): void {
  for (let line = 0; line < lines; line++) game.pending.push(hole)
}

// Milliseconds a piece takes to fall one row at a level (the guideline curve).
export function gravityMs(level: number): number {
  const n = Math.min(Math.max(level, 1), 20) - 1

  return Math.pow(0.8 - n * 0.007, n) * 1000
}

// Milliseconds a piece rests on the stack at a level before it locks.
export function lockDelayMs(level: number): number {
  return Math.min(Math.max(gravityMs(level), MIN_LOCK_DELAY_MS), MAX_LOCK_DELAY_MS)
}

// One input. Answers whether anything changed, so a front end knows to draw.
// A game not under way treats any input as "go": the first one starts it and a
// paused one resumes, without also moving the piece.
export function act(game: Game, action: Action): boolean {
  if (game.status === 'over') {
    if (action !== 'restart') return false
    restart(game)

    return true
  }
  if (game.status === 'paused' && action === 'restart') {
    restart(game)

    return true
  }
  if (go(game)) return true

  switch (action) {
    case 'left':
      return shift(game, -1)
    case 'right':
      return shift(game, 1)
    case 'down':
      return softDrop(game)
    case 'drop':
      return hardDrop(game)
    case 'cw':
      return rotate(game, 1)
    case 'ccw':
      return rotate(game, -1)
    case 'hold':
      return swapHold(game)
    case 'pause':
      return pause(game)
    case 'restart':
      // Only from a pause or a finished game: one stray key must not end a run.
      return false
  }
}

// Moves only the effects on by `dt` milliseconds, not the piece: for a game
// whose piece waits on a player's say. Answers whether anything changed.
export function age(game: Game, dt: number): boolean {
  if (game.status !== 'playing') return false
  let hasChanged = false
  // The effects under way, each drawn afresh while it lasts.
  if (game.flashMs > 0) {
    game.flashMs = Math.max(0, game.flashMs - dt)
    if (game.flashMs === 0) game.flash = null
    hasChanged = true
  }
  if (game.trailMs > 0) {
    game.trailMs = Math.max(0, game.trailMs - dt)
    if (game.trailMs === 0) game.trail = null
    hasChanged = true
  }
  if (game.shakeMs > 0) {
    game.shakeMs = Math.max(0, game.shakeMs - dt)
    if (game.shakeMs === 0) game.risen = 0
    hasChanged = true
  }
  if (game.bannerMs > 0) {
    game.bannerMs -= dt
    if (game.bannerMs <= 0) {
      game.banner = ''
      game.bannerMs = 0
      hasChanged = true
    }
  }

  return hasChanged
}

// Moves time on by `dt` milliseconds. Answers whether anything changed.
export function tick(game: Game, dt: number): boolean {
  if (game.status !== 'playing') return false
  let hasChanged = age(game, dt)

  // A piece out of resets is on the lock clock in the air too, or a turn that
  // lifts it each time it lands would keep it up for good.
  const wasResting = !fits(game, 0, 1)
  if (wasResting || game.lockResets >= MAX_LOCK_RESETS) game.lockMs += dt
  if (!wasResting) {
    const every = gravityMs(game.level)
    game.fallMs += dt
    while (game.fallMs >= every && fits(game, 0, 1)) {
      game.fallMs -= every
      descend(game)
      hasChanged = true
    }
    if (fits(game, 0, 1)) return hasChanged
    game.fallMs = 0
  }

  if (game.lockMs < lockDelayMs(game.level)) return hasChanged
  lock(game)

  return true
}

// The visible field as drawn: 0 empty, a kind's id for a block, the negated
// id where the falling piece would land (its ghost), and `-(TRAIL + id)`
// where a hard drop just fell through. While rows just cleared flash, the
// field as it was with them.
export function view(game: Game): number[][] {
  if (game.flashMs > 0 && game.flash !== null) return game.flash.map(row => [...row])
  const grid = game.board.slice(HIDDEN).map(row => [...row])
  if (game.trailMs > 0 && game.trail !== null) {
    for (const [cx, cy] of game.trail.cells) {
      const row = grid[cy]
      if (row !== undefined && row[cx] === 0) row[cx] = -(TRAIL + game.trail.id)
    }
  }
  if (game.status === 'over') return grid

  const { kind, rot, x, y } = game.piece
  const id = idOf(kind)
  let landing = y
  while (!collides(game, kind, rot, x, landing + 1)) landing += 1
  const paint = (top: number, value: number): void => {
    for (const [dx, dy] of shapeOf(kind, rot)) {
      const row = grid[top + dy - HIDDEN]
      if (row !== undefined && (value > 0 || (row[x + dx] ?? 0) <= 0)) row[x + dx] = value
    }
  }
  paint(landing, -id)
  paint(y, id)

  return grid
}

// A kind as the next and hold boxes show it: two rows of four cells.
export function preview(kind: Kind | null): number[][] {
  const grid = [new Array<number>(4).fill(0), new Array<number>(4).fill(0)]
  if (kind === null) return grid
  const cells = SPAWN[kind].cells
  const top = Math.min(...cells.map(([, y]) => y))
  const left = kind === 'O' ? 1 : 0
  for (const [x, y] of cells) {
    const row = grid[y - top]
    if (row !== undefined) row[x + left] = idOf(kind)
  }

  return grid
}
