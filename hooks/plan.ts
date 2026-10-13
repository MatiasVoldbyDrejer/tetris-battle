import { COLS, shapeOf } from './engine.ts'
import type { Action, Kind, Piece, Point } from './engine.ts'

// Where a piece can go and what comes of it, tried out on the field by the
// engine's own rules: what a computer player, and Claude, choose from. No
// drawing, no clock, no imports but the engine's.

export type Board = readonly (readonly number[])[]

// A piece dropped somewhere: its orientation and the column of its box, the
// field it leaves with the full rows gone, how many went, and the columns
// its cells took.
export type Placement = {
  rot: number
  x: number
  board: number[][]
  cleared: number
  columns: number[]
}

// The stack's measure: its columns' heights and their sum, the holes under
// its surface and the bumps along it.
export type Measure = { heights: number[]; height: number; holes: number; bumps: number }

export type Plan = { rot: number; x: number }

// What a field is worth, Dellacherie's way: the stack's height, the holes
// under its surface and the bumps along it count against it, and the lines
// just cleared for it.
const HEIGHT_COST = 0.51
const CLEAR_GAIN = 0.76
const HOLE_COST = 0.36
const BUMP_COST = 0.18

const SIZES: Record<Kind, number> = { I: 4, O: 2, T: 3, S: 3, Z: 3, J: 3, L: 3 }

// Where a kind's box starts, as the engine spawns it.
export const spawnX = (kind: Kind): number => Math.floor((COLS - SIZES[kind]) / 2)

export function fits(board: Board, shape: readonly Point[], x: number, y: number): boolean {
  for (const [dx, dy] of shape) {
    const cx = x + dx
    const cy = y + dy
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= board.length) return false
    if (board[cy]?.[cx] !== 0) return false
  }

  return true
}

// The field with the shape dropped from (x, y) and locked, and the full rows
// gone; nothing if it does not even fit there.
export function dropped(board: Board, shape: readonly Point[], x: number, y: number): Placement | undefined {
  if (!fits(board, shape, x, y)) return undefined
  let landing = y
  while (fits(board, shape, x, landing + 1)) landing += 1
  const after = board.map(row => [...row])
  for (const [dx, dy] of shape) {
    const row = after[landing + dy]
    if (row !== undefined) row[x + dx] = 1
  }
  const kept = after.filter(row => row.includes(0))
  const cleared = after.length - kept.length
  while (kept.length < after.length) kept.unshift(new Array<number>(COLS).fill(0))
  const columns = [...new Set(shape.map(([dx]) => x + dx))].sort((a, b) => a - b)

  return { rot: 0, x, board: kept, cleared, columns }
}

// The measure of a field, its bumps counted over the first `columns`.
export function measure(board: Board, columns = COLS): Measure {
  const heights: number[] = []
  let holes = 0
  for (let x = 0; x < COLS; x++) {
    let top = board.length
    for (let y = 0; y < board.length; y++) {
      if (board[y]?.[x] !== 0) {
        top = y
        break
      }
    }
    heights.push(board.length - top)
    for (let y = top + 1; y < board.length; y++) if (board[y]?.[x] === 0) holes += 1
  }
  let bumps = 0
  for (let x = 1; x < columns; x++) bumps += Math.abs((heights[x] ?? 0) - (heights[x - 1] ?? 0))

  return { heights, height: heights.reduce((sum, height) => sum + height, 0), holes, bumps }
}

// Every way the kind can be dropped from row `y`, anywhere along it.
export function placements(board: Board, kind: Kind, y: number): Placement[] {
  const found: Placement[] = []
  for (let rot = 0; rot < (kind === 'O' ? 1 : 4); rot++) {
    const shape = shapeOf(kind, rot)
    for (let x = -3; x < COLS; x++) {
      const placement = dropped(board, shape, x, y)
      if (placement !== undefined) found.push({ ...placement, rot })
    }
  }

  return found
}

// What a placement comes to, by the measure of the field it leaves.
export function rate(placement: Placement): number {
  const { height, holes, bumps } = measure(placement.board)

  return CLEAR_GAIN * placement.cleared - HEIGHT_COST * height - HOLE_COST * holes - BUMP_COST * bumps
}

// The placement that comes to most.
export function bestOf(found: readonly Placement[]): Placement | undefined {
  let best: Placement | undefined
  let most = -Infinity
  for (const placement of found) {
    const value = rate(placement)
    if (value > most) {
      most = value
      best = placement
    }
  }

  return best
}

// The keys that put the piece where the plan says, then drop it.
export function keysFor(plan: Plan, piece: Piece): Action[] {
  const keys: Action[] = []
  const turns = (plan.rot - piece.rot) & 3
  if (turns === 3) keys.push('ccw')
  else for (let turn = 0; turn < turns; turn++) keys.push('cw')
  const dx = plan.x - piece.x
  for (let step = 0; step < Math.abs(dx); step++) keys.push(dx < 0 ? 'left' : 'right')
  keys.push('drop')

  return keys
}

// The field as text, a row a line from the top, `#` a block and `.` a gap.
export const drawn = (grid: Board): string =>
  grid.map(row => row.map(cell => (cell > 0 ? '#' : '.')).join('')).join('\n')

// How a computer player plays: `build` keeps the last column open as a well
// that nothing goes in unless it takes four rows at once, minds holes more,
// counts the bumps up to the well's edge and looks at the next piece too,
// until the stack is so tall that any clear will do; `clear` takes what
// clears lines and keeps the stack low.
export type Mode = 'build' | 'clear'

const WELL = COLS - 1
const DANGER_HEIGHT = 12
const BUILD_HOLE_COST = 0.7
// How many of its best placements the builder follows up with the next piece.
const LOOKED_AT = 10
const LOOKAHEAD_SHARE = 0.5

const isSafe = (board: Board): boolean => Math.max(0, ...measure(board).heights) < DANGER_HEIGHT

// What a field is worth as it stands, by the mode.
function fieldValue(board: Board, mode: Mode): number {
  const isBuilding = mode === 'build' && isSafe(board)
  const { height, holes, bumps } = measure(board, isBuilding ? WELL : COLS)

  return -HEIGHT_COST * height - (isBuilding ? BUILD_HOLE_COST : HOLE_COST) * holes - BUMP_COST * bumps
}

const valueOf = (placement: Placement, mode: Mode): number =>
  fieldValue(placement.board, mode) + CLEAR_GAIN * placement.cleared

// Every way the kind can be dropped from row `y` that the mode allows; any
// way at all when it allows none.
function allowed(board: Board, kind: Kind, y: number, mode: Mode): Placement[] {
  const found = placements(board, kind, y)
  if (mode !== 'build' || !isSafe(board)) return found
  const kept = found.filter(placement => !placement.columns.includes(WELL) || placement.cleared === 4)

  return kept.length > 0 ? kept : found
}

// The places the piece could go, the best first.
export function ranked(board: Board, kind: Kind, y: number, next: Kind | undefined, mode: Mode): Placement[] {
  const scored = allowed(board, kind, y, mode).map(placement => ({ placement, value: valueOf(placement, mode) }))
  scored.sort((a, b) => b.value - a.value)
  // The builder follows its best few up with the next piece, and ranks
  // those few by what the best place for it adds: only them, so they are
  // compared alike.
  let chosen = scored
  if (mode === 'build' && next !== undefined) {
    chosen = scored.slice(0, LOOKED_AT)
    for (const entry of chosen) {
      const base = fieldValue(entry.placement.board, mode)
      const after = allowed(entry.placement.board, next, 0, mode).map(p => valueOf(p, mode) - base)
      entry.value += LOOKAHEAD_SHARE * (after.length === 0 ? -1000 : Math.max(...after))
    }
    chosen.sort((a, b) => b.value - a.value)
  }

  return chosen.map(entry => entry.placement)
}

// Where to put the piece, by the mode.
export const planFor = (board: Board, piece: Piece, next: Kind | undefined, mode: Mode): Placement | undefined =>
  ranked(board, piece.kind, piece.y, next, mode)[0]
