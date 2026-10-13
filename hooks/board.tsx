import type { ClientModule, ClientSurface } from 'claude-code'

import type { TetrisBoardProps, TetrisResult } from '../types'
import { KEYS, ROWS, act, createGame, go, gravityMs, isAction, pause, preview, tick, view } from './engine'
import type { Game } from './engine'
import { MESSAGES, SIDE_COLUMNS, cellRows, grouped, wellRows } from './paint'
import type { Run } from './paint'

// The game itself, on the drawing thread: its clock is the surface's frame
// clock, and once the person has clicked the board its keys arrive here
// directly, so a move costs no round trip. The legend's hotkeys, which work
// while the pane holds the keyboard, arrive as `props.moves`. The hooks module
// hears of the game once, when it ends.

const TICK_MS = 33
// The board is not told when its keys go back to the prompt, so a game it has
// had no key for in the time two pieces take to fall, and never under this,
// is taken to be unattended and waits.
const IDLE_MS = 10_000

type Session = {
  game: Game
  rev: number
  // The last of `props.moves` already played.
  seen: number
  idleMs: number
  wasFocused: boolean
  // Whether keys have been arriving here, the board itself holding them.
  hasKeys: boolean
  hasReported: boolean
}

// One per mounted instance: the surface object is the instance's own.
const sessions = new WeakMap<object, Session>()

const idleLimitMs = (level: number): number => Math.max(IDLE_MS, 2 * ROWS * gravityMs(level))

// Tells the hooks module of a game that ended, once.
function report(session: Session, surface: ClientSurface<number>): void {
  const { game } = session
  if (game.status !== 'over') {
    session.hasReported = false
  } else if (!session.hasReported) {
    session.hasReported = true
    const result: TetrisResult = { score: game.score, lines: game.lines, level: game.level }
    surface.post(result)
  }
}

function redraw(session: Session, surface: ClientSurface<number>): void {
  report(session, surface)
  session.rev += 1
  surface.setState(session.rev)
}

function open(props: TetrisBoardProps, surface: ClientSurface<number>): Session {
  const session: Session = {
    game: createGame(),
    rev: 0,
    // What was pressed before this board existed is not for this game.
    seen: props.moves.last,
    idleMs: 0,
    wasFocused: false,
    hasKeys: false,
    hasReported: false,
  }
  sessions.set(surface, session)
  surface.every(TICK_MS, () => {
    const { game } = session
    let hasChanged = tick(game, TICK_MS)
    // While the pane holds the keyboard it says when it loses it; only a
    // board holding the keys itself has to guess that the person has left.
    if (game.status === 'playing' && !session.wasFocused) {
      session.idleMs += TICK_MS
      if (session.idleMs >= idleLimitMs(game.level) && pause(game)) {
        session.hasKeys = false
        hasChanged = true
      }
    }
    if (hasChanged) redraw(session, surface)
  })
  surface.onKey(event => {
    if (event.ctrl === true || event.meta === true) return
    const action = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
    if (action === undefined) return
    session.idleMs = 0
    const hadKeys = session.hasKeys
    session.hasKeys = true
    if (act(session.game, action) || !hadKeys) redraw(session, surface)
  })
  // A click on the board gives it the keys, and is the person saying "play".
  surface.onPointer(event => {
    if (event.type !== 'down') return
    session.idleMs = 0
    session.hasKeys = true
    go(session.game)
    redraw(session, surface)
  })

  return session
}

// Plays the legend presses that arrived since the last draw. A draw made from
// older props than the last one has nothing new, and takes nothing back.
function play(session: Session, moves: TetrisBoardProps['moves']): void {
  const fresh = moves.last - session.seen
  if (fresh <= 0) return
  session.seen = moves.last
  session.idleMs = 0
  for (const move of moves.recent.slice(-fresh)) {
    if (isAction(move)) act(session.game, move)
  }
}

type Keys = 'board' | 'pane' | 'prompt'

// What the well tells the person to do, which depends on where their keys go:
// to the board (any key plays), to the pane (the legend's letters do), or to
// the prompt (a click brings them here).
function noticeFor(game: Game, isWide: boolean, keys: Keys): readonly [string, string] | undefined {
  if (game.status === 'playing') return undefined
  const [title, go] = MESSAGES[game.status][isWide ? 'wide' : 'narrow']
  if (game.status === 'over' || keys === 'board') return [title, go]
  if (keys === 'pane') return [title, isWide ? 'press a letter key' : 'a d s w f']
  if (game.status === 'ready') return [title, isWide ? 'click to play' : 'click']

  return [title, isWide ? 'click or press a key' : 'click/key']
}

// Which keys play right now, in the two lines the panel has for it.
const HELP: Record<Keys, readonly [string, string]> = {
  pane: ['play with the letter keys', 'or click: arrows + space'],
  board: ['← → ↓ move   ↑ rotate', 'space drop   esc: prompt'],
  prompt: ['click the board to play', ' '],
}

const Tetris: ClientModule<TetrisBoardProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const session = sessions.get(surface) ?? open(props, surface)
  const { game } = session
  play(session, props.moves)
  if (props.isFocused !== session.wasFocused) {
    session.wasFocused = props.isFocused
    // The pane took the keys, so the board no longer has them; or it lost
    // them, and unless they came here (a click, keys arriving) they went back
    // to the prompt: wait until the person returns.
    if (props.isFocused) session.hasKeys = false
    else if (!session.hasKeys) pause(game)
    session.idleMs = 0
  }
  report(session, surface)

  const { isWide } = props
  const keys: Keys = props.isFocused ? 'pane' : session.hasKeys ? 'board' : 'prompt'
  const line = (runs: readonly Run[]) => (
    <Box>
      {runs.map(run => (
        <Text {...run.style}>{run.text}</Text>
      ))}
    </Box>
  )
  const wall = keys === 'prompt' ? { dimColor: true } : { color: 'claude' }
  const well = wellRows(view(game), isWide, noticeFor(game, isWide, keys), wall).map(line)
  const cells = (kind: Game['hold']) => (
    <Box flexDirection="column">{cellRows(preview(kind), isWide).map(line)}</Box>
  )

  const stat = (label: string, value: string) => (
    <Box>
      <Text dimColor>{label.padEnd(7)}</Text>
      <Text bold>{value}</Text>
    </Box>
  )
  const banner = (
    <Text bold color="claude">
      {game.banner === '' ? ' ' : game.banner}
    </Text>
  )
  const combo = <Text bold>{game.combo >= 2 ? `Combo ×${game.combo}` : ' '}</Text>
  const help = (
    <Box flexDirection="column">
      {HELP[keys].map(text => (
        <Text dimColor>{text}</Text>
      ))}
    </Box>
  )
  const best = grouped(Math.max(props.best, game.score))
  const upcoming = (count: number) => (
    <Box columnGap={isWide ? 2 : 1}>{game.queue.slice(0, count).map(cells)}</Box>
  )

  const side = isWide ? (
    <Box flexDirection="column" width={SIDE_COLUMNS}>
      {stat('Score', grouped(game.score))}
      {stat('Best', best)}
      {stat('Level', String(game.level))}
      {stat('Lines', String(game.lines))}
      <Text> </Text>
      <Text dimColor>Next</Text>
      {upcoming(2)}
      <Text> </Text>
      <Text dimColor>Hold</Text>
      {cells(game.hold)}
      <Text> </Text>
      {banner}
      {combo}
      {help}
    </Box>
  ) : (
    <Box flexDirection="column" width={SIDE_COLUMNS}>
      {stat('Score', grouped(game.score))}
      {stat('Best', best)}
      {stat('Level', `${game.level}   Lines ${game.lines}`)}
      <Box>
        <Text dimColor>{'Next'.padEnd(7)}</Text>
        {upcoming(3)}
      </Box>
      <Text> </Text>
      <Box>
        <Text dimColor>{'Hold'.padEnd(7)}</Text>
        {cells(game.hold)}
      </Box>
      {game.combo >= 2 ? combo : banner}
      <Text> </Text>
      {help}
    </Box>
  )

  return (
    <Box columnGap={2} alignItems="flex-start">
      <Box flexDirection="column" flexShrink={0}>
        {well}
      </Box>
      {side}
    </Box>
  )
}

export default Tetris
