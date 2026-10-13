import { COLS, ROWS, preview } from '../hooks/engine.ts'
import type { Game, Kind } from '../hooks/engine.ts'
import { WELL, cellRows, center } from '../hooks/paint.ts'
import type { Style } from '../hooks/paint.ts'
import { big, bigWidth } from './font.ts'
import { blank, dim, gap, over, pad, row, runs, stacked, text } from './terminal.ts'
import type { Block, Line } from './terminal.ts'

// The pieces of the picture both front ends draw, Tetris Battle's way: the
// hold box on the left of the well, the pieces to come on its right, the
// numbers under the hold box, and over the field in big letters what the
// game has to shout about.

export const WALL: Style = { dimColor: true }
export const INK = '#f3f4f6'
export const FAINT = '#9ca3af'
export const ALERT = '#f87171'
export const GOLD = '#facc15'
export const CYAN = '#22d3ee'
export const PURPLE = '#c084fc'
export const ORANGE = '#fb923c'

// Columns of the hold and next columns beside the well in the full-size
// layout, and of the panel beside it in the small one.
export const SIDE = 10
export const PANEL = 26
// How many pieces to come the full-size layout shows.
const NEXT = 5

// The well's size on the screen, walls and floor included.
export const wellSize = (isWide: boolean): { columns: number; rows: number } => ({
  columns: COLS * (isWide ? 2 : 1) + 2,
  rows: (isWide ? ROWS : ROWS / 2) + 1,
})

// The columns the whole frame takes: hold column, well and next column in
// the full size, well and panel in the small.
export const frameColumns = (isWide: boolean): number =>
  isWide ? SIDE + 1 + wellSize(true).columns + 1 + SIDE : wellSize(false).columns + 2 + PANEL

// The well: walls, the field, a floor; the bottom `meter` rows of the left
// wall red, the garbage waiting to rise.
export function well(grid: readonly (readonly number[])[], isWide: boolean, meter = 0): Block {
  const rows = cellRows(grid, isWide).map(runs)
  const width = COLS * (isWide ? 2 : 1)

  return [
    ...rows.map((cells, at) =>
      row(rows.length - at <= meter ? text('┃', { color: ALERT, bold: true }) : text('│', WALL), cells, text('│', WALL)),
    ),
    text(`╰${'─'.repeat(width)}╯`, WALL),
  ]
}

// A kind as the hold and next boxes show it.
export const piece = (kind: Kind | null, isWide: boolean): Block => cellRows(preview(kind), isWide).map(runs)

// A box round some rows, `width` columns inside.
export function boxed(inside: Block, width: number): Block {
  return [
    text(`┌${'─'.repeat(width)}┐`, WALL),
    ...inside.map(line => row(text('│', WALL), pad(line, width), text('│', WALL))),
    text(`└${'─'.repeat(width)}┘`, WALL),
  ]
}

// The hold box under its label, and the next box with the pieces to come,
// both for the full-size layout.
export const holdBox = (game: Game): Block => [dim(' HOLD'), ...boxed(piece(game.hold, true), 8)]
export const nextBox = (game: Game): Block => [
  dim(' NEXT'),
  ...boxed(
    stacked(
      game.queue.slice(0, NEXT).map(kind => piece(kind, true)),
      1,
    ),
    8,
  ),
]

// A label over a value, as the column under the hold box shows its numbers.
export const figure = (label: string, value: string, style: Style = { bold: true }): Block => [
  dim(` ${label}`),
  row(text(' '), text(value, style)),
]

// A line of plain text across the field, on the well's dark.
export const across = (value: string, style: Style = { color: FAINT }): Line =>
  text(center(value, COLS * 2), { ...style, backgroundColor: WELL })

// `layer` over the field of a well whose top left wall is at (x, y), centred.
export function overField(base: Block, x: number, y: number, layer: Block): Block {
  const width = Math.max(0, ...layer.map(line => line.length))
  const left = x + 1 + Math.floor((COLS * 2 - width) / 2)
  const top = y + Math.max(0, Math.floor((ROWS - layer.length) / 2))

  return over(base, left, top, layer)
}

// What the game has to shout about, while it has: the clear it just made as
// one word for the big letters (six at most: the well's width and a column
// over), and the rest of it, with the combo it is in, as small print.
export function headline(game: Game): { word: string; color: string; rest: string } | undefined {
  if (game.bannerMs <= 0 || game.banner === '') return undefined
  const isB2B = game.banner.startsWith('B2B ')
  const banner = isB2B ? game.banner.slice(4) : game.banner
  const rest: string[] = isB2B ? ['B2B'] : []
  let word = banner.toUpperCase()
  let color = INK
  if (banner === 'Perfect Clear!') {
    word = 'CLEAR'
    color = GOLD
    rest.push('Perfect clear')
  } else if (banner.startsWith('T-Spin')) {
    word = 'T SPIN'
    color = PURPLE
    const spin = banner.slice('T-Spin'.length).trim()
    if (spin !== '') rest.push(spin)
  } else if (banner === 'Tetris!') {
    word = 'TETRIS'
    color = CYAN
  }
  if (game.combo >= 2) rest.push(`Combo ×${game.combo}`)

  return { word, color, rest: rest.join(' · ') }
}

// The strip under the well that the shouting goes in, so it never covers
// the field: the word big, the rest under it, or nothing, the same height.
export const STRIP_ROWS = 4
export const STRIP_COLUMNS = COLS * 2 + 3

export function strip(game: Game): Block {
  const said = headline(game)
  if (said === undefined) return blank(STRIP_ROWS)
  const left = Math.max(0, Math.floor((STRIP_COLUMNS - bigWidth(said.word)) / 2))

  return [
    ...big(said.word, said.color, null).map(line => [...gap(left), ...line]),
    text(center(said.rest, STRIP_COLUMNS), { color: FAINT, bold: true }),
  ]
}

// The same in two lines of plain text, where there is no room for the strip.
export function shoutLines(game: Game): [Line, Line] {
  const said = headline(game)
  if (said === undefined) return [[], []]

  return [text(` ${said.word}`, { bold: true, color: said.color }), text(` ${said.rest}`, { color: FAINT })]
}

// The small layout's pieces: the pieces to come side by side, one row each,
// the combo under way, and the clear just made as a line of text.
export const upcoming = (game: Game, count: number): Line =>
  row(...game.queue.slice(0, count).map(kind => pad(piece(kind, false)[0] ?? [], 5)))
export const comboLine = (game: Game): Line =>
  game.combo >= 2 ? text(`Combo ×${game.combo}`, { bold: true }) : []
export const bannerLine = (game: Game): Line => text(game.banner, { bold: true, color: ORANGE })
