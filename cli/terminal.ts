import type { Run, Style } from '../hooks/paint.ts'

// A terminal as the game's front ends use it: a screen as a grid of styled
// cells that blocks are laid out in and drawn over, written as escape
// sequences to the alternate screen a whole frame at a time, and keys as
// they arrive, by name.

// One column of the screen.
export type Cell = { ch: string; style: Style }
// A row of cells, `undefined` where it shows what is under it.
export type Line = (Cell | undefined)[]
// Rows of them, the top left at (0, 0).
export type Block = Line[]

const hasTrueColor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '')
// The levels of each channel in the 256-colour palette's cube.
const CUBE = [0, 95, 135, 175, 215, 255]

// The nearest of the 256-colour palette's cube and greys to a colour, for a
// terminal with no 24-bit colour.
function indexed(red: number, green: number, blue: number): number {
  const channels = [red, green, blue]
  const far = (to: readonly number[]): number =>
    to.reduce((sum, value, at) => sum + (value - (channels[at] ?? 0)) ** 2, 0)
  const steps = channels.map(value =>
    CUBE.reduce((best, level, at) => (Math.abs(level - value) < Math.abs((CUBE[best] ?? 0) - value) ? at : best), 0),
  )
  const cube = steps.map(step => CUBE[step] ?? 0)
  const step = Math.min(23, Math.max(0, Math.round(((red + green + blue) / 3 - 8) / 10)))
  const grey = 8 + 10 * step
  if (far([grey, grey, grey]) < far(cube)) return 232 + step

  return 16 + steps.reduce((sum, at) => sum * 6 + at, 0)
}

function colorCode(hex: string, base: 38 | 48): string {
  const rgb = Number.parseInt(hex.slice(1), 16)
  const [red, green, blue] = [rgb >> 16, (rgb >> 8) & 255, rgb & 255]

  return hasTrueColor
    ? `${base};2;${red};${green};${blue}`
    : `${base};5;${indexed(red, green, blue)}`
}

function codesOf(style: Style): string {
  const codes: string[] = []
  if (style.bold === true) codes.push('1')
  if (style.dimColor === true) codes.push('2')
  if (style.color !== undefined) codes.push(colorCode(style.color, 38))
  if (style.backgroundColor !== undefined) codes.push(colorCode(style.backgroundColor, 48))

  return codes.join(';')
}

const isSameStyle = (a: Style, b: Style): boolean =>
  a.color === b.color &&
  a.backgroundColor === b.backgroundColor &&
  (a.bold ?? false) === (b.bold ?? false) &&
  (a.dimColor ?? false) === (b.dimColor ?? false)

const PLAIN: Style = {}

// A line as escape sequences: cells styled alike in one run, and nothing
// after the last cell that shows anything.
export function render(line: Line): string {
  let end = line.length
  while (end > 0 && line[end - 1] === undefined) end -= 1
  let out = ''
  let style = PLAIN
  let run = ''
  const flush = (): void => {
    if (run === '') return
    const codes = codesOf(style)
    out += codes === '' ? run : `\x1b[${codes}m${run}\x1b[0m`
    run = ''
  }
  for (let at = 0; at < end; at++) {
    const cell = line[at]
    const next = cell?.style ?? PLAIN
    if (!isSameStyle(next, style)) {
      flush()
      style = next
    }
    run += cell?.ch ?? ' '
  }
  flush()

  return out
}

export const text = (value: string, style: Style = {}): Line => [...value].map(ch => ({ ch, style }))
export const row = (...parts: readonly Line[]): Line => parts.flat()
export const EMPTY: Line = []
export const dim = (value: string): Line => text(value, { dimColor: true })
export const bold = (value: string): Line => text(value, { bold: true })
export const runs = (line: readonly Run[]): Line => line.flatMap(run => text(run.text, run.style))
export const gap = (count: number): Line => new Array<undefined>(Math.max(0, count)).fill(undefined)
export const blank = (count: number): Block => Array.from({ length: Math.max(0, count) }, () => [])
export const pad = (line: Line, width: number): Line => (line.length >= width ? line : [...line, ...gap(width - line.length)])
export const widthOf = (block: Block): number => Math.max(0, ...block.map(line => line.length))

// A label and a value, as the panels show their numbers.
export const stat = (label: string, value: string): Line => row(dim(label.padEnd(7)), bold(value))

// Blocks side by side, each as wide as its widest line, `apart` columns
// apart; a shorter block is blank below.
export function beside(blocks: readonly Block[], apart = 2): Block {
  const height = Math.max(0, ...blocks.map(block => block.length))
  const widths = blocks.map(widthOf)
  const lines: Block = []
  for (let at = 0; at < height; at++) {
    const line: Line = []
    blocks.forEach((block, which) => {
      if (which > 0) line.push(...gap(apart))
      line.push(...pad(block[at] ?? EMPTY, widths[which] ?? 0))
    })
    lines.push(line)
  }

  return lines
}

// Blocks one under another, `apart` rows apart.
export function stacked(blocks: readonly Block[], apart = 0): Block {
  const lines: Block = []
  blocks.forEach((block, which) => {
    if (which > 0) lines.push(...blank(apart))
    lines.push(...block.map(line => [...line]))
  })

  return lines
}

// Blocks one under another, each centred on the widest.
export function centred(blocks: readonly Block[], apart = 0): Block {
  const width = Math.max(0, ...blocks.map(widthOf))

  return stacked(
    blocks.map(block => {
      const left = Math.floor((width - widthOf(block)) / 2)

      return block.map(line => [...gap(left), ...line])
    }),
    apart,
  )
}

// `layer` drawn over `base` with its top left at (x, y): where it has a
// cell, that cell shows; elsewhere the base does.
export function over(base: Block, x: number, y: number, layer: Block): Block {
  const lines = base.map(line => [...line])
  layer.forEach((cells, dy) => {
    const at = y + dy
    if (at < 0) return
    while (lines.length <= at) lines.push([])
    const line = lines[at] ?? []
    cells.forEach((cell, dx) => {
      const col = x + dx
      if (cell === undefined || col < 0) return
      while (line.length < col) line.push(undefined)
      line[col] = cell
    })
  })

  return lines
}

// A block as the strings to print, centred in a window.
export function centered(block: Block, columns: number, rows: number): string[] {
  const width = widthOf(block)
  const left = ' '.repeat(Math.max(0, Math.floor((columns - width) / 2)))
  const above = Math.max(0, Math.floor((rows - block.length) / 2))

  return [...new Array<string>(above).fill(''), ...block.map(line => `${left}${render(line)}`)]
}

// Alternate screen, cursor hidden, focus reported (so a game can wait while
// the window is in the background), and back.
const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?1004h\x1b[2J'
const LEAVE = '\x1b[?1004l\x1b[?25h\x1b[?1049l'

const TOKENS = /\x1b\[[0-9;?]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/gu
// The start of a key's escape sequence with the rest still to come: held
// back this long before it is taken for the Escape key itself.
const UNFINISHED = /\x1b(?:\[[0-9;?]*|O)?$/u
const ESCAPE_MS = 50
const NAMED: Readonly<Record<string, string>> = {
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[C': 'right',
  '\x1b[D': 'left',
  '\x1bOA': 'up',
  '\x1bOB': 'down',
  '\x1bOC': 'right',
  '\x1bOD': 'left',
  '\x1b[I': 'focus',
  '\x1b[O': 'blur',
  '\x1b': 'escape',
  '\r': 'return',
  '\n': 'return',
  '\x03': 'quit',
  '\x04': 'quit',
}

// A key as it arrives: a character, or the name of a special one (`up`,
// `return`, `escape`, `quit` for ctrl+c and a signal to stop) or of the
// window gaining or losing focus (`focus`, `blur`).
export type Key = string

export type Screen = {
  size(): { columns: number; rows: number }
  // Draws a whole frame, unless it is the one already drawn.
  draw(lines: readonly string[]): void
  close(): void
}

// Takes the terminal over until `close`: raw keys to `onKey`, and a call to
// `onResize` when the frame must be drawn again whatever it shows.
export function openScreen(handlers: { onKey(key: Key): void; onResize(): void }): Screen {
  const { stdin, stdout } = process
  let drawn = ''
  let isClosed = false

  const close = (): void => {
    if (isClosed) return
    isClosed = true
    stdout.write(LEAVE)
    stdin.setRawMode(false)
    stdin.pause()
  }

  // Keys as they arrive. A sequence cut in two by the read is put back
  // together, so its first byte is not taken for Escape and its rest for
  // letters.
  let unfinished = ''
  let escape: ReturnType<typeof setTimeout> | undefined
  const read = (chunk: string, isWhole = false): void => {
    clearTimeout(escape)
    const typed = unfinished + chunk
    const cut = isWhole ? null : UNFINISHED.exec(typed)
    unfinished = cut?.[0] ?? ''
    if (unfinished !== '') escape = setTimeout(() => read('', true), ESCAPE_MS)
    for (const token of typed.slice(0, typed.length - unfinished.length).match(TOKENS) ?? []) {
      handlers.onKey(NAMED[token] ?? token)
    }
  }

  const again = (): void => {
    drawn = ''
    handlers.onResize()
  }

  process.on('exit', close)
  process.on('SIGTERM', () => handlers.onKey('quit'))
  process.on('SIGHUP', () => handlers.onKey('quit'))
  process.on('SIGCONT', again)
  process.on('uncaughtException', error => {
    close()
    console.error(error)
    process.exit(1)
  })
  stdout.on('resize', again)

  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()
  stdin.on('data', read)
  stdout.write(ENTER)

  return {
    size: () => ({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 }),
    draw(lines) {
      const next = lines.join('\x1b[K\r\n')
      if (next === drawn) return
      drawn = next
      // One synchronized update, so a frame is never seen half drawn.
      stdout.write(`\x1b[?2026h\x1b[H${next}\x1b[K\x1b[J\x1b[?2026l`)
    },
    close,
  }
}
