import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { KEYS, act, createGame, pause, tick, view } from '../hooks/engine.ts'
import type { Game, Status } from '../hooks/engine.ts'
import { MESSAGES, grouped, wellRows } from '../hooks/paint.ts'
import { big } from './font.ts'
import {
  ALERT,
  CYAN,
  INK,
  SIDE,
  WALL,
  across,
  bannerLine,
  comboLine,
  figure,
  frameColumns,
  holdBox,
  nextBox,
  STRIP_ROWS,
  overField,
  piece,
  shoutLines,
  strip,
  upcoming,
  well,
  wellSize,
} from './frame.ts'
import {
  EMPTY,
  beside,
  blank,
  bold,
  centered,
  centred,
  dim,
  openScreen,
  over,
  pad,
  row,
  runs,
  stacked,
  stat,
  text,
} from './terminal.ts'
import type { Block } from './terminal.ts'

// Tetris alone in a terminal: the same game and the same tiles as the Claude
// Code pane (hooks/board.tsx), played with the keys a terminal has (arrows,
// space) beside the pane's letters.

const STEP_MS = 16
const WIDE = { columns: frameColumns(true), rows: 1 + wellSize(true).rows }
const NARROW = { columns: frameColumns(false), rows: wellSize(false).rows }

const BEST_FILE = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
  'tetris',
  'best.json',
)

// The keys, under the next box in the full-size layout and beside the well
// in the small one.
const HELP_WIDE = [['←→', 'move'], ['↑', 'rotate'], ['space', 'drop'], ['c', 'hold']] as const
const HELP = [
  [['←→', 'move'], ['↑', 'rotate']],
  [['↓', 'soft drop'], ['z', 'rotate ccw']],
  [['space', 'drop'], ['c', 'hold']],
  [['p', 'pause'], ['q', 'quit']],
] as const

// What the field says in big letters while no game is under way.
const TITLES: Record<Exclude<Status, 'playing'>, { words: readonly string[]; color: string }> = {
  ready: { words: ['TETRIS'], color: CYAN },
  paused: { words: ['PAUSED'], color: INK },
  over: { words: ['GAME', 'OVER'], color: ALERT },
}

const key = (hotkey: string, what: string): Block[number] => row(text(' '), bold(hotkey), dim(` ${what}`))

// The hold box, the numbers and the keys down the left, the well with the
// strip for shouting under it where there is room (else the shouting goes
// down the left, in small print), and the pieces to come down the right.
function wideFrame(game: Game, best: number, hasStrip: boolean): Block {
  const canRestart = game.status === 'paused' || game.status === 'over'
  const left = stacked(
    [
      holdBox(game),
      stacked([
        figure('SCORE', grouped(game.score)),
        figure('BEST', grouped(Math.max(best, game.score))),
        figure('LEVEL', String(game.level)),
        figure('LINES', String(game.lines)),
      ]),
      ...(hasStrip ? [] : [shoutLines(game)]),
      [key('p', 'pause'), key('q', 'quit'), canRestart ? key('r', 'restart') : EMPTY],
    ],
    1,
  )
  const right = stacked([nextBox(game), HELP_WIDE.map(([hotkey, what]) => key(hotkey, what))], 1)
  const field = [dim(' T E T R I S'), ...well(view(game), true), ...(hasStrip ? blank(STRIP_ROWS) : [])]
  let frame = beside([left, field, right], 1)
  if (hasStrip) frame = over(frame, SIDE, 1 + wellSize(true).rows, strip(game))

  if (game.status === 'playing') return frame
  const { words, color } = TITLES[game.status]
  const [, hint] = MESSAGES[game.status].wide
  const title = centred([centred(words.map(word => big(word, color))), [across(hint)]], 1)

  return overField(frame, SIDE + 1, 1, title)
}

// Half a row to a cell, the numbers beside the well.
function narrowFrame(game: Game, best: number): Block {
  const notice = game.status === 'playing' ? undefined : MESSAGES[game.status].narrow
  const field = wellRows(view(game), false, notice, WALL).map(runs)
  const canRestart = game.status === 'paused' || game.status === 'over'
  const help = HELP.map(([left, right]) =>
    row(pad(row(text(left[0]), dim(` ${left[1]}`)), 13), text(right[0]), dim(` ${right[1]}`)),
  )
  const panel: Block = [
    stat('Score', grouped(game.score)),
    stat('Best', grouped(Math.max(best, game.score))),
    stat('Level', `${game.level}   Lines ${game.lines}`),
    row(dim('Next'.padEnd(7)), upcoming(game, 3)),
    EMPTY,
    row(dim('Hold'.padEnd(7)), piece(game.hold, false)[0] ?? EMPTY),
    canRestart ? key('r', 'restart') : game.combo >= 2 ? comboLine(game) : bannerLine(game),
    ...help,
  ]

  return beside([field, panel])
}

// The whole screen as rows of text, the game centred in it.
export function frame(game: Game, best: number, columns: number, rows: number): string[] {
  if (rows < NARROW.rows || columns < NARROW.columns) {
    return [`Tetris needs a window of ${NARROW.columns}x${NARROW.rows} or more.`]
  }
  const isWide = rows >= WIDE.rows && columns >= WIDE.columns
  const hasStrip = rows >= WIDE.rows + STRIP_ROWS

  return centered(isWide ? wideFrame(game, best, hasStrip) : narrowFrame(game, best), columns, rows)
}

function loadBest(): number {
  try {
    const best = Number(JSON.parse(readFileSync(BEST_FILE, 'utf8')).best)

    return Number.isFinite(best) && best > 0 ? best : 0
  } catch {
    return 0
  }
}

function saveBest(best: number): void {
  try {
    mkdirSync(dirname(BEST_FILE), { recursive: true })
    writeFileSync(BEST_FILE, `${JSON.stringify({ best })}\n`)
  } catch {
    // A score that could not be kept is no reason to stop the game.
  }
}

export function play(): void {
  const game = createGame()
  let best = loadBest()
  let isDirty = true
  let at = performance.now()

  function draw(): void {
    isDirty = false
    const { columns, rows } = screen.size()
    screen.draw(frame(game, best, columns, rows))
  }

  function keep(): void {
    if (game.score <= best) return
    best = game.score
    saveBest(best)
  }

  function quit(): void {
    clearInterval(timer)
    keep()
    screen.close()
    if (game.status !== 'ready') {
      process.stdout.write(
        `Score ${grouped(game.score)} · Lines ${game.lines} · Level ${game.level} · Best ${grouped(best)}\n`,
      )
    }
    process.exit(0)
  }

  function step(): void {
    const now = performance.now()
    // A process that was stopped comes back to one step, not a pile of them.
    const elapsed = Math.min(now - at, 100)
    at = now
    if (tick(game, elapsed)) isDirty = true
    if (game.status === 'over') keep()
    if (isDirty) draw()
  }

  function onKey(key: string): void {
    if (key === 'quit' || key.toLowerCase() === 'q') {
      quit()

      return
    }
    if (key === 'focus') return
    if (key === 'blur') {
      // The window went to the background.
      if (pause(game)) isDirty = true
    } else {
      const action = key === 'escape' ? 'pause' : KEYS[key.length === 1 ? key.toLowerCase() : key]
      if (action !== undefined && act(game, action)) isDirty = true
    }
    if (isDirty) draw()
  }

  const screen = openScreen({
    onKey,
    onResize: () => {
      isDirty = true
    },
  })
  const timer = setInterval(step, STEP_MS)
  draw()
}
