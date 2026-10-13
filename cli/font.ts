import { WELL } from '../hooks/paint.ts'
import type { Block, Line } from './terminal.ts'

// Letters three rows tall, for what the game shouts over the field: each
// three by five pixels, two pixels to a row of the terminal as half blocks,
// on the well's dark so they read over the tiles, and nothing at all where
// a letter has no ink, so the field shows through.

type Glyph = readonly [string, string, string, string, string]

const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '###', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '-': ['...', '...', '###', '...', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '×': ['...', '#.#', '.#.', '#.#', '...'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
}

const NONE: Glyph = ['...', '...', '...', '...', '...']
export const BIG_ROWS = 3
const GLYPH_COLUMNS = 3
const SPACE_COLUMNS = 2

// How many columns `big(text)` takes.
export function bigWidth(text: string): number {
  let width = 0
  for (const ch of text) width += (ch === ' ' ? SPACE_COLUMNS : GLYPH_COLUMNS) + 1

  return Math.max(0, width - 1)
}

// `text` in big letters of `color`, a column between letters, on the well's
// dark unless `background` says otherwise (`null`: whatever is under them).
export function big(text: string, color: string, background: string | null = WELL): Block {
  const rows: Line[] = [[], [], []]
  const style = background === null ? { color } : { color, backgroundColor: background }
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') {
      for (const line of rows) line.push(...new Array<undefined>(SPACE_COLUMNS + 1).fill(undefined))
      continue
    }
    const glyph = GLYPHS[ch] ?? NONE
    rows.forEach((line, at) => {
      const top = glyph[at * 2] ?? '...'
      const bottom = glyph[at * 2 + 1] ?? '...'
      for (let x = 0; x < GLYPH_COLUMNS; x++) {
        const hasTop = top[x] === '#'
        const hasBottom = bottom[x] === '#'
        const ink = hasTop && hasBottom ? '█' : hasTop ? '▀' : hasBottom ? '▄' : undefined
        line.push(ink === undefined ? undefined : { ch: ink, style })
      }
      line.push(undefined)
    })
  }

  return rows.map(line => line.slice(0, -1))
}
