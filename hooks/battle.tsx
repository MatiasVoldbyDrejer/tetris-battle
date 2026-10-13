import type { ClientModule, ClientSurface } from 'claude-code'

import type { BattleAnswer, BattleAsk, BattleProps, BattleResult, BattleSide } from '../types'
import { KEYS, ROWS, act, age, createGame, go, isAction, preview, receive, restart, tick, view } from './engine'
import type { Action, Game, Kind } from './engine'
import { SIDE_COLUMNS, cellRows, wellRows } from './paint'
import type { Run } from './paint'
import { drawn, keysFor, measure, planFor } from './plan'
import type { Mode } from './plan'

// A battle against Claude, in the pane: two games on the drawing thread,
// the person's played with their keys as the solo board is, Claude's by its
// hands, the planner, at full speed, in the mode Claude's head sets. Every
// couple of seconds, and at every KO, the board posts an ask (both fields,
// how the match stands, what just happened) to the hooks module, which puts
// it to the model and hands back in the props the mode for the next pieces
// and a line for the opponent. Garbage goes between the two games here,
// Tetris Battle's way, a top-out is a KO for the other side, and after two
// minutes most KOs wins, then most lines sent.

const TICK_MS = 33
const MATCH_MS = 120_000
const COUNT_FROM = 3
const COUNT_MS = 1000
const KO_MS = 900
// How long Claude's hands take over each piece, and between its keys, so
// its piece is seen to move.
const PIECE_MS = 150
const KEY_MS = 25
// How often Claude's head is asked, and how long an ask is waited for.
const ASK_EVERY_MS = 2500
const ASK_LIMIT_MS = 10_000
const SAY_COLUMNS = 24

type Phase = 'ready' | 'count' | 'playing' | 'over'

type Session = {
  me: Game
  claude: Game
  phase: Phase
  leftMs: number
  countMs: number
  kos: { me: number; claude: number }
  // Lines sent that have been passed to the other side.
  told: { me: number; claude: number }
  // How long a board that topped out has left to show, KO over it.
  koMs: { me: number; claude: number }
  mode: Mode
  asked: number
  pending: { ask: number; waitedMs: number } | null
  sinceAskMs: number
  // What just happened, for the next ask.
  event: string
  keys: Action[]
  keyMs: number
  thinkMs: number
  say: string
  result: BattleResult['result'] | null
  hasReported: boolean
  rev: number
  seen: number
  wasFocused: boolean
  hasKeys: boolean
}

const sessions = new WeakMap<object, Session>()

const sideOf = (game: Game, kos: number): BattleSide => ({
  kos,
  sent: game.sent,
  lines: game.lines,
  pending: game.pending.length,
  height: Math.max(0, ...measure(game.board).heights),
})

// Puts the match to the hooks module: both fields, how it stands, what
// just happened, for Claude to set its mode and say its piece.
function ask(session: Session, surface: ClientSurface<number>, event: string): void {
  const { me, claude } = session
  session.asked += 1
  const asked: BattleAsk = {
    ask: session.asked,
    event,
    field: drawn(claude.board.slice(claude.board.length - ROWS)),
    theirField: drawn(me.board.slice(me.board.length - ROWS)),
    me: sideOf(claude, session.kos.me),
    you: sideOf(me, session.kos.claude),
    secondsLeft: Math.ceil(session.leftMs / 1000),
    mode: session.mode,
    said: session.say,
  }
  session.pending = { ask: asked.ask, waitedMs: 0 }
  session.sinceAskMs = 0
  surface.post({ ask: asked })
}

// Takes an answer to the ask under way: the mode for the next pieces, and
// the words.
function heed(session: Session, answer: BattleAnswer): void {
  const { pending } = session
  if (pending === null || answer.ask !== pending.ask) return
  session.pending = null
  if (!answer.isClaude) return
  session.mode = answer.mode
  if (answer.say !== '') session.say = answer.say
}

function begin(session: Session): void {
  session.me = createGame()
  session.claude = createGame()
  session.phase = 'count'
  session.countMs = COUNT_FROM * COUNT_MS
  session.leftMs = MATCH_MS
  session.kos = { me: 0, claude: 0 }
  session.told = { me: 0, claude: 0 }
  session.koMs = { me: 0, claude: 0 }
  session.mode = 'build'
  session.pending = null
  session.sinceAskMs = ASK_EVERY_MS
  session.event = 'The match is about to start.'
  session.keys = []
  session.thinkMs = 0
  session.say = ''
  session.result = null
  session.hasReported = false
}

function finish(session: Session, surface: ClientSurface<number>): void {
  session.phase = 'over'
  const { kos, me, claude } = session
  const mine = kos.me * 1000 + me.sent
  const theirs = kos.claude * 1000 + claude.sent
  session.result = mine > theirs ? 'win' : mine < theirs ? 'lose' : 'draw'
  if (session.hasReported) return
  session.hasReported = true
  const result: BattleResult = { result: session.result, kos: kos.me, sent: me.sent }
  surface.post({ result })
  const outcome = session.result === 'win' ? 'you lost' : session.result === 'lose' ? 'you won' : 'it is a draw'
  session.event = `The match is over: ${outcome}.`
}

// Claude's side of a step: a KO shown out, a key pressed, the next piece
// planned, and now and then, or at once after an event, its head asked.
function claudeStep(session: Session, surface: ClientSurface<number>): boolean {
  const { claude } = session
  let hasChanged = false
  session.sinceAskMs += TICK_MS
  if (session.pending !== null) {
    session.pending.waitedMs += TICK_MS
    if (session.pending.waitedMs >= ASK_LIMIT_MS) session.pending = null
  } else if (session.event !== '' || session.sinceAskMs >= ASK_EVERY_MS) {
    ask(session, surface, session.event)
    session.event = ''
  }
  if (session.koMs.claude > 0) {
    session.koMs.claude -= TICK_MS
    if (session.koMs.claude <= 0) {
      session.koMs.claude = 0
      restart(claude)
      session.told.claude = 0
    }

    return true
  }
  if (claude.status === 'over') {
    session.kos.me += 1
    session.koMs.claude = KO_MS
    session.keys = []
    session.event = 'They just knocked you out.'

    return true
  }
  if (age(claude, TICK_MS)) hasChanged = true
  if (session.keys.length > 0) {
    session.keyMs += TICK_MS
    if (session.keyMs < KEY_MS) return hasChanged
    session.keyMs = 0
    const key = session.keys.shift()
    if (key !== undefined && act(claude, key)) hasChanged = true

    return hasChanged
  }
  session.thinkMs += TICK_MS
  if (session.thinkMs < PIECE_MS) return hasChanged
  session.thinkMs = 0
  const plan = planFor(claude.board, claude.piece, claude.queue[0], session.mode)
  session.keys = plan === undefined ? ['drop'] : keysFor(plan, claude.piece)
  session.keyMs = KEY_MS

  return hasChanged
}

// Lines sent across, and a top-out on my side.
function exchange(session: Session): boolean {
  const { me, claude } = session
  let hasChanged = false
  if (me.sent > session.told.me) {
    receive(claude, me.sent - session.told.me)
    session.told.me = me.sent
    hasChanged = true
  }
  if (claude.sent > session.told.claude) {
    receive(me, claude.sent - session.told.claude)
    session.told.claude = claude.sent
    hasChanged = true
  }
  if (session.koMs.me > 0) {
    session.koMs.me -= TICK_MS
    if (session.koMs.me <= 0) {
      session.koMs.me = 0
      restart(me)
      session.told.me = 0
    }

    return true
  }
  if (me.status === 'over') {
    session.kos.claude += 1
    session.koMs.me = KO_MS
    session.event = 'You just knocked them out.'
    hasChanged = true
  }

  return hasChanged
}

function redraw(session: Session, surface: ClientSurface<number>): void {
  session.rev += 1
  surface.setState(session.rev)
}

// What the person's input does: starts a match, starts another, or plays.
function input(session: Session, action: Action): boolean {
  if (session.phase === 'ready') {
    begin(session)

    return true
  }
  if (session.phase === 'over') {
    if (action !== 'restart') return false
    begin(session)

    return true
  }
  if (session.phase !== 'playing' || action === 'pause' || action === 'restart') return false
  if (session.me.status !== 'playing') return false

  return act(session.me, action)
}

function open(props: BattleProps, surface: ClientSurface<number>): Session {
  const session: Session = {
    me: createGame(),
    claude: createGame(),
    phase: 'ready',
    leftMs: MATCH_MS,
    countMs: 0,
    kos: { me: 0, claude: 0 },
    told: { me: 0, claude: 0 },
    koMs: { me: 0, claude: 0 },
    mode: 'build',
    asked: 0,
    pending: null,
    sinceAskMs: 0,
    event: '',
    keys: [],
    keyMs: 0,
    thinkMs: 0,
    say: '',
    result: null,
    hasReported: false,
    rev: 0,
    seen: props.moves.last,
    wasFocused: false,
    hasKeys: false,
  }
  sessions.set(surface, session)
  surface.every(TICK_MS, () => {
    let hasChanged = false
    if (session.phase === 'count') {
      const was = Math.ceil(session.countMs / COUNT_MS)
      session.countMs -= TICK_MS
      if (session.countMs <= 0) {
        session.phase = 'playing'
        go(session.me)
        go(session.claude)
        hasChanged = true
      } else if (Math.ceil(session.countMs / COUNT_MS) !== was) {
        hasChanged = true
      }
    }
    if (session.phase === 'over' && session.event !== '' && session.pending === null) {
      ask(session, surface, session.event)
      session.event = ''
    }
    if (session.phase === 'playing') {
      if (tick(session.me, TICK_MS)) hasChanged = true
      if (claudeStep(session, surface)) hasChanged = true
      if (exchange(session)) hasChanged = true
      const second = Math.ceil(session.leftMs / 1000)
      session.leftMs -= TICK_MS
      if (session.leftMs <= 0) {
        session.leftMs = 0
        finish(session, surface)
        hasChanged = true
      } else if (Math.ceil(session.leftMs / 1000) !== second) {
        hasChanged = true
      }
    }
    if (hasChanged) redraw(session, surface)
  })
  surface.onKey(event => {
    if (event.ctrl === true || event.meta === true) return
    const action = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
    if (action === undefined) return
    const hadKeys = session.hasKeys
    session.hasKeys = true
    if (input(session, action) || !hadKeys) redraw(session, surface)
  })
  surface.onPointer(event => {
    if (event.type !== 'down') return
    session.hasKeys = true
    if (session.phase === 'ready') begin(session)
    redraw(session, surface)
  })

  return session
}

// Plays the legend presses that arrived since the last draw.
function play(session: Session, moves: BattleProps['moves']): void {
  const fresh = moves.last - session.seen
  if (fresh <= 0) return
  session.seen = moves.last
  for (const move of moves.recent.slice(-fresh)) {
    if (isAction(move)) input(session, move)
  }
}

type Keys = 'board' | 'pane' | 'prompt'

const RESULTS: Record<BattleResult['result'], string> = { win: 'YOU WIN', lose: 'CLAUDE WINS', draw: 'DRAW' }

// What my well says over the field while the match is not under way, or
// while my board is out.
function noticeFor(session: Session, isWide: boolean, keys: Keys): readonly [string, string] | undefined {
  const go = keys === 'pane' ? (isWide ? 'press a letter key' : 'a d s w f') : keys === 'prompt' ? (isWide ? 'click to play' : 'click') : isWide ? 'press any key' : 'any key'
  switch (session.phase) {
    case 'ready':
      return [isWide ? 'YOU vs CLAUDE' : 'VS CLAUDE', go]
    case 'count':
      return [String(Math.ceil(session.countMs / COUNT_MS)), isWide ? 'get ready' : 'ready']
    case 'over':
      return [RESULTS[session.result ?? 'draw'], keys === 'prompt' ? (isWide ? 'click, then r' : 'click') : isWide ? 'r to play again' : 'r: again']
    default:
      return session.koMs.me > 0 ? ['KO!', ''] : undefined
  }
}

const HELP: Record<Keys, readonly [string, string]> = {
  pane: ['play with the letter keys', 'or click: arrows + space'],
  board: ['← → ↓ move   ↑ rotate', 'space drop   esc: prompt'],
  prompt: ['click the board to play', ' '],
}

const clock = (ms: number): string => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Claude's words, in lines the panel has room for.
function wrapped(say: string): string[] {
  const words = say.split(' ')
  const lines: string[] = []
  for (const word of words) {
    const last = lines[lines.length - 1]
    if (last !== undefined && `${last} ${word}`.length <= SAY_COLUMNS) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word.slice(0, SAY_COLUMNS))
  }

  return lines.slice(0, 2)
}

const Battle: ClientModule<BattleProps, number> = (props, surface) => {
  const { Box, Text } = surface.elements
  const session = sessions.get(surface) ?? open(props, surface)
  play(session, props.moves)
  if (props.answer !== null) heed(session, props.answer)
  if (props.isFocused !== session.wasFocused) {
    session.wasFocused = props.isFocused
    if (props.isFocused) session.hasKeys = false
  }

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
  const mine = wellRows(view(session.me), isWide, noticeFor(session, isWide, keys), wall).map(line)
  const theirNotice: readonly [string, string] | undefined =
    session.koMs.claude > 0 ? ['KO!', ''] : session.phase === 'over' ? [session.result === 'lose' ? 'WINNER' : session.result === 'win' ? 'BEATEN' : 'DRAW', ''] : undefined
  const theirs = wellRows(view(session.claude), isWide, theirNotice, { dimColor: true }).map(line)
  const cells = (kind: Kind | null) => (
    <Box flexDirection="column">{cellRows(preview(kind), isWide).map(line)}</Box>
  )
  const stat = (label: string, value: string) => (
    <Box>
      <Text dimColor>{label.padEnd(7)}</Text>
      <Text bold>{value}</Text>
    </Box>
  )
  const header = (name: string, kos: number, note: string) => (
    <Box>
      <Text bold>{name.padEnd(isWide ? 10 : 7)}</Text>
      <Text dimColor>{`KO ${kos}${note}`}</Text>
    </Box>
  )
  const mood = session.phase === 'playing' ? (isWide ? ` · ${session.mode === 'build' ? 'building' : 'clearing'}` : '') : ''
  const incoming = session.me.pending.length
  const meter = (
    <Box>
      <Text backgroundColor="#f87171">{' '.repeat(Math.min(incoming, 20))}</Text>
      <Text dimColor>{incoming > 0 ? ` ${incoming}` : ''}</Text>
    </Box>
  )
  const banner = (
    <Text bold color="claude">
      {session.me.banner === '' ? ' ' : session.me.banner}
    </Text>
  )
  const combo = <Text bold>{session.me.combo >= 2 ? `Combo ×${session.me.combo}` : ' '}</Text>
  const said = wrapped(session.say)
  const says = (
    <Box flexDirection="column">
      <Text dimColor>{session.say === '' ? ' ' : 'Claude says'}</Text>
      <Text color="#fb923c">{said[0] ?? ' '}</Text>
      <Text color="#fb923c">{said[1] ?? ' '}</Text>
    </Box>
  )
  const help = (
    <Box flexDirection="column">
      {HELP[keys].map(text => (
        <Text dimColor>{text}</Text>
      ))}
    </Box>
  )
  const upcoming = (count: number) => (
    <Box columnGap={isWide ? 2 : 1}>{session.me.queue.slice(0, count).map(cells)}</Box>
  )
  const time = session.phase === 'playing' || session.phase === 'over' ? clock(session.leftMs) : '2:00'

  const side = isWide ? (
    <Box flexDirection="column" width={SIDE_COLUMNS}>
      {stat('Time', time)}
      {stat('KOs', `you ${session.kos.me} · Claude ${session.kos.claude}`)}
      {stat('Sent', `${session.me.sent} · ${session.claude.sent}`)}
      {stat('Lines', `${session.me.lines} · ${session.claude.lines}`)}
      <Text> </Text>
      <Text dimColor>Next</Text>
      {upcoming(2)}
      <Text> </Text>
      <Text dimColor>Hold</Text>
      {cells(session.me.hold)}
      <Text> </Text>
      {banner}
      {combo}
      <Text dimColor>Incoming</Text>
      {meter}
      <Text> </Text>
      {says}
      <Text> </Text>
      {help}
    </Box>
  ) : (
    <Box flexDirection="column" width={SIDE_COLUMNS}>
      {stat('Time', time)}
      {stat('KOs', `${session.kos.me} · ${session.kos.claude}   Sent ${session.me.sent}`)}
      <Box>
        <Text dimColor>{'Next'.padEnd(7)}</Text>
        {upcoming(3)}
      </Box>
      <Box>
        <Text dimColor>{'Hold'.padEnd(7)}</Text>
        {cells(session.me.hold)}
      </Box>
      <Box>
        <Text dimColor>{'In'.padEnd(7)}</Text>
        {meter}
      </Box>
      {session.me.combo >= 2 ? combo : banner}
      {says}
      {help}
    </Box>
  )

  return (
    <Box columnGap={2} alignItems="flex-start">
      <Box flexDirection="column" flexShrink={0}>
        {header('You', session.kos.me, '')}
        {mine}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        {header(isWide ? `Claude · ${props.model}` : 'Claude', session.kos.claude, mood)}
        {theirs}
      </Box>
      {side}
    </Box>
  )
}

export default Battle
