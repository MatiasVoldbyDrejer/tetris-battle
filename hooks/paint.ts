import type { Status } from './engine'

// What the game looks like, as runs of styled text and nothing more: the pane
// turns a run into a Text element and the terminal front end into an escape
// sequence, so the game looks the same in both.
//
// Every cell of the field is a painted background, not a glyph: a terminal
// fills a cell's background edge to edge, where a block glyph is only as tall
// as the font draws it (in Apple's Terminal, 42% of the row for a half block,
// and off centre), which leaves gaps between tiles. A tile's bevel is a half
// block over that background, in a lighter and a darker shade of it.

export type Style = {
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  bold?: boolean
}

export type Run = { text: string; style: Style }

// Columns of the score, next and hold panel beside the well.
export const SIDE_COLUMNS = 26

// The field's own background, and the text drawn over it.
export const WELL = '#111827'
const INK = '#f3f4f6'
const FAINT = '#9ca3af'

// The engine's ids of a cell in a row about to go, and its offset for a
// cell a hard drop fell through (`-(TRAIL + id)`), as it has them: Node
// cannot follow a value import from here without an extension the pane's
// loader does not take.
const FLASH = 9
const TRAIL = 10

// By cell id: I O T S Z J L, then garbage, then a row about to go.
export const COLORS = [
  '',
  '#22d3ee',
  '#facc15',
  '#c084fc',
  '#4ade80',
  '#f87171',
  '#60a5fa',
  '#fb923c',
  '#6b7280',
  '#f9fafb',
]

// How much of a piece's colour its ghost keeps over the well's, and the
// trail of a hard drop; how much white and black a tile's bevel adds.
const GHOST_SHARE = 0.3
const TRAIL_SHARE = 0.16
const BEVEL_SHARE = 0.38

export function mixed(hex: string, into: string, share: number): string {
  const from = Number.parseInt(hex.slice(1), 16)
  const to = Number.parseInt(into.slice(1), 16)
  let rgb = 0
  for (const at of [16, 8, 0]) {
    const channel = ((from >> at) & 255) * share + ((to >> at) & 255) * (1 - share)
    rgb |= Math.round(channel) << at
  }

  return `#${rgb.toString(16).padStart(6, '0')}`
}

const shades = (into: string, share: number): string[] =>
  COLORS.map(color => (color === '' ? '' : mixed(into, color, share)))

// Where a piece would land, in its own colour sunk into the well's.
export const GHOSTS = COLORS.map(color => (color === '' ? '' : mixed(color, WELL, GHOST_SHARE)))
// Where a hard drop fell through, fainter still.
export const TRAILS = COLORS.map(color => (color === '' ? '' : mixed(color, WELL, TRAIL_SHARE)))
// A tile's lit edge and its shaded one.
export const LIGHTS = shades('#ffffff', BEVEL_SHARE)
export const DARKS = shades('#000000', BEVEL_SHARE)

// What the well says over the field while no game is under way: a title, and
// what to do about it.
export const MESSAGES: Record<
  Exclude<Status, 'playing'>,
  { wide: readonly [string, string]; narrow: readonly [string, string] }
> = {
  ready: { wide: ['T E T R I S', 'press any key'], narrow: ['TETRIS', 'any key'] },
  paused: { wide: ['PAUSED', 'press any key'], narrow: ['PAUSED', 'any key'] },
  over: { wide: ['GAME OVER', 'r to play again'], narrow: ['GAME OVER', 'r: again'] },
}

// The room a layout takes, well and panel side by side: two columns to a cell
// where there is room (`isWide`), else two rows of the field to a row of the
// terminal. The well is open at the top: walls and a floor.
export function roomFor(
  cols: number,
  rows: number,
  isWide: boolean,
): { columns: number; rows: number } {
  return {
    columns: (isWide ? cols * 2 : cols) + 2 + 2 + SIDE_COLUMNS,
    rows: (isWide ? rows : rows / 2) + 1,
  }
}

// The colour a cell is painted: a block's, a ghost's, a trail's, or the well's.
export function paintOf(cell = 0): string {
  if (cell > 0) return COLORS[cell] ?? WELL
  if (cell <= -TRAIL) return TRAILS[-cell - TRAIL] ?? WELL
  if (cell < 0) return GHOSTS[-cell] ?? WELL

  return WELL
}

function push(runs: Run[], text: string, style: Style): void {
  const last = runs[runs.length - 1]
  const isSame =
    last !== undefined &&
    last.style.color === style.color &&
    last.style.backgroundColor === style.backgroundColor
  if (isSame) last.text += text
  else runs.push({ text, style })
}

// A row of a grid, two columns to a cell: a tile is bevelled, lit at the top
// left and shaded at the bottom right; a row about to go is flat white.
function wideCells(row: readonly number[]): Run[] {
  const runs: Run[] = []
  for (const cell of row) {
    const base = paintOf(cell)
    if (cell > 0 && cell !== FLASH) {
      push(runs, '▀', { color: LIGHTS[cell] ?? base, backgroundColor: base })
      push(runs, '▄', { color: DARKS[cell] ?? base, backgroundColor: base })
    } else {
      push(runs, '  ', { backgroundColor: base })
    }
  }

  return runs
}

// Two rows of a grid in one row of the terminal. The upper cell is the
// background and the lower a half block over it, never the other way round,
// so the two meet at one height whatever the font makes of the glyph; a cell
// of one colour is background alone.
function halfCells(top: readonly number[], bottom: readonly number[]): Run[] {
  const runs: Run[] = []
  for (let x = 0; x < top.length; x++) {
    const upper = paintOf(top[x])
    const lower = paintOf(bottom[x])
    if (upper === lower) push(runs, ' ', { backgroundColor: upper })
    else push(runs, '▄', { color: lower, backgroundColor: upper })
  }

  return runs
}

// A grid as rows of runs, in the layout the room allows.
export function cellRows(grid: readonly (readonly number[])[], isWide: boolean): Run[][] {
  if (isWide) return grid.map(wideCells)
  const rows: Run[][] = []
  for (let y = 0; y < grid.length; y += 2) rows.push(halfCells(grid[y] ?? [], grid[y + 1] ?? []))

  return rows
}

export function center(text: string, width: number): string {
  const left = Math.max(0, Math.floor((width - text.length) / 2))

  return (' '.repeat(left) + text).padEnd(width)
}

// The well with the field in it: a wall either side of each row and a floor
// under the last, and across the middle the `notice`, when there is one.
export function wellRows(
  grid: readonly (readonly number[])[],
  isWide: boolean,
  notice: readonly [string, string] | undefined,
  wall: Style,
): Run[][] {
  const width = (grid[0]?.length ?? 0) * (isWide ? 2 : 1)
  const rows = cellRows(grid, isWide)
  if (notice !== undefined) {
    const over = (text: string, style: Style): Run[] => [
      { text: center(text, width), style: { ...style, backgroundColor: WELL } },
    ]
    const at = Math.floor(rows.length / 2) - 1
    if (isWide) rows[at - 1] = over('', {})
    rows[at] = over(notice[0], { color: INK, bold: true })
    rows[at + 1] = over(notice[1], { color: FAINT })
    if (isWide) rows[at + 2] = over('', {})
  }
  const side: Run = { text: '│', style: wall }

  return [
    ...rows.map(row => [side, ...row, side]),
    [{ text: `╰${'─'.repeat(width)}╯`, style: wall }],
  ]
}

export const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
