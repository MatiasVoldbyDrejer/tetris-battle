import { COLS, KEYS, ROWS, act, createGame, go, receive, restart, tick, view } from '../hooks/engine.ts'
import type { Game, Status } from '../hooks/engine.ts'
import { wellRows } from '../hooks/paint.ts'
import { joinAsAgent } from './agent.ts'
import type { Level } from './agent.ts'
import { big } from './font.ts'
import {
  ALERT,
  CYAN,
  FAINT,
  GOLD,
  INK,
  ORANGE,
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
import { PORT, connect, discover, lanAddress } from './net.ts'
import type { Peer } from './net.ts'
import { VERSION, decodeGrid, encodeGrid, isServerMessage } from './protocol.ts'
import type { Phase, Standing } from './protocol.ts'
import { serve } from './server.ts'
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
import type { Block, Line } from './terminal.ts'

// A battle: each player's own game in their own terminal, garbage flying
// between them through the host, Tetris Battle's way. A top-out is a KO for
// whoever sent the garbage, and the board starts over; when time is up, most
// KOs wins, then most lines sent.

const STEP_MS = 16
// How often at most the board is handed to the others.
const SNAPSHOT_MS = 66
// How long a board that topped out stays, KO over it, before it starts over.
const KO_MS = 900
// Garbage waiting is shown as a bar this long at most.
const METER_MAX = 20
// How many rows the big clock takes above the boards, with a gap.
const CLOCK_ROWS = 4

const HELP_WIDE = [['←→', 'move'], ['↑', 'rotate'], ['space', 'drop'], ['c', 'hold']] as const
const HELP = [
  [['←→', 'move'], ['↑', 'rotate']],
  [['↓', 'soft drop'], ['z', 'rotate ccw']],
  [['space', 'drop'], ['c', 'hold']],
  [['q', 'leave'], ['', '']],
] as const

export type Options = { name: string; port: number; minutes: number }

type Opponent = { grid: number[][]; status: Status }

export type Match = {
  phase: 'connecting' | Phase
  // The host's, which can be ahead of ours: one who joins during a match
  // watches it to its end.
  hostPhase: Phase
  id: number
  isHost: boolean
  players: Standing[]
  boards: Map<number, Opponent>
  count: number
  endsAt: number
  winner: number | null
  game: Game
  // Lines sent that the host has been told of.
  told: number
  // When the board topped out, while it stays on show; 0 while it plays.
  koAt: number
}

// Who this player is to the host, and where the host is.
export type Seat = { name: string; token?: string; place: string; onLeave?: () => void }

const at = (address: string, port: number): string => (port === PORT ? address : `${address}:${port}`)

// A seed for the deal, when one is given, so a test knows the pieces to come.
function seed(): number | undefined {
  const given = Number(process.env.TETRIS_SEED)

  return Number.isInteger(given) ? given : undefined
}

const fail = (message: string): void => {
  process.stderr.write(`tetris: ${message}\n`)
  process.exitCode = 1
}

// Hosts a battle here and plays in it, with the agent in it too if asked.
export async function host(options: Options & { agent?: Level }): Promise<void> {
  const token = Math.random().toString(36).slice(2)
  const server = await serve({ ...options, token })
  const peer = await connect('127.0.0.1', server.port)
  if (options.agent !== undefined) {
    joinAsAgent(server.port, options.agent).catch(() => {
      // The agent could not join, or was cut off: the battle goes on without it.
    })
  }
  const address = lanAddress()
  const place = address === undefined ? `port ${server.port}` : at(address, server.port)
  play(peer, { name: options.name, token, place, onLeave: () => server.close() })
}

// Joins the battle on the network, or the one at `address` (with a port
// after a colon, if not the usual one).
export async function join(options: Options & { address?: string }): Promise<void> {
  let address: string
  let port = options.port
  if (options.address !== undefined) {
    const [name, given] = options.address.split(':')
    address = name === undefined || name === '' ? options.address : name
    if (given !== undefined) port = Number(given)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`not a port: ${given ?? ''}`)

      return
    }
  } else {
    process.stdout.write('Looking for a game on this network…\n')
    const found = await discover()
    const [first] = found
    if (first === undefined) {
      fail('no game found on this network. The host can tell you their address: tetris join <address>')

      return
    }
    if (found.length > 1) {
      const list = found
        .map(game => `  tetris join ${at(game.address, game.port)}    ${game.name}, ${game.players} playing`)
        .join('\n')
      fail(`${found.length} games found; pick one:\n${list}`)

      return
    }
    address = first.address
    port = first.port
  }

  let peer: Peer
  try {
    peer = await connect(address, port)
  } catch (error) {
    fail(`no game at ${at(address, port)} (${error instanceof Error ? error.message : String(error)})`)

    return
  }
  play(peer, { name: options.name, place: at(address, port) })
}

function play(peer: Peer, seat: Seat): void {
  const match: Match = {
    phase: 'connecting',
    hostPhase: 'lobby',
    id: 0,
    isHost: false,
    players: [],
    boards: new Map(),
    count: 0,
    endsAt: 0,
    winner: null,
    game: createGame(),
    told: 0,
    koAt: 0,
  }
  let isDirty = true
  let isBoardDirty = false
  let shownAt = 0
  let shownSecond = -1
  let isLeaving = false
  let at = performance.now()

  const me = (): Standing | undefined => match.players.find(player => player.id === match.id)

  function draw(): void {
    isDirty = false
    const { columns, rows } = screen.size()
    screen.draw(frame(match, seat, columns, rows))
  }

  function result(): string {
    const mine = me()
    const winner = match.players.find(player => player.id === match.winner)
    const who =
      match.winner === match.id ? 'You won' : match.winner === null ? 'A draw' : `${winner?.name ?? 'Someone'} won`

    return `${who} · KOs ${mine?.kos ?? 0} · sent ${mine?.sent ?? 0}`
  }

  function leave(message?: string, code = 0): void {
    if (isLeaving) return
    isLeaving = true
    clearInterval(timer)
    screen.close()
    peer.close()
    seat.onLeave?.()
    if (message !== undefined) process.stdout.write(`${message}\n`)
    process.exit(code)
  }

  // Tells the host what the game did: lines sent, a top-out (after which the
  // board stays a moment, KO over it, then starts over), and now and then
  // how the board looks.
  function report(): void {
    const { game } = match
    const now = performance.now()
    if (game.sent > match.told) {
      peer.send({ t: 'attack', lines: game.sent - match.told })
      match.told = game.sent
    }
    if (game.status === 'over' && match.koAt === 0) {
      match.koAt = now
      peer.send({ t: 'board', grid: encodeGrid(view(game)), status: 'over' })
      peer.send({ t: 'ko' })
      isDirty = true
    } else if (game.status === 'over' && now - match.koAt >= KO_MS) {
      restart(game)
      match.koAt = 0
      match.told = 0
      shownAt = 0
      isDirty = true
      isBoardDirty = true
    }
    if (isBoardDirty && now - shownAt >= SNAPSHOT_MS) {
      shownAt = now
      isBoardDirty = false
      peer.send({ t: 'board', grid: encodeGrid(view(game)), status: game.status })
    }
  }

  function step(): void {
    const now = performance.now()
    // A process that was stopped comes back to one step, not a pile of them.
    const elapsed = Math.min(now - at, 100)
    at = now
    if (match.phase === 'playing') {
      if (tick(match.game, elapsed)) {
        isDirty = true
        isBoardDirty = true
      }
      report()
      const second = Math.ceil(Math.max(0, match.endsAt - now) / 1000)
      if (second !== shownSecond) {
        shownSecond = second
        isDirty = true
      }
    }
    if (isDirty) draw()
  }

  function onKey(key: string): void {
    if (key === 'quit' || key.toLowerCase() === 'q') {
      leave(match.phase === 'over' ? result() : undefined)

      return
    }
    if (key === 'return' && match.isHost && (match.phase === 'lobby' || match.phase === 'over')) {
      peer.send({ t: 'begin' })

      return
    }
    if (match.phase !== 'playing') return
    const action = KEYS[key.length === 1 ? key.toLowerCase() : key]
    if (action === undefined || action === 'pause' || action === 'restart') return
    if (act(match.game, action)) {
      isDirty = true
      isBoardDirty = true
    }
    report()
    if (isDirty) draw()
  }

  peer.onMessage(message => {
    if (!isServerMessage(message)) return
    switch (message.t) {
      case 'welcome':
        match.id = message.id
        match.isHost = message.isHost
        if (match.phase === 'connecting') match.phase = 'lobby'
        break
      case 'players':
        match.players = message.players
        match.hostPhase = message.phase
        if (match.phase === 'connecting') match.phase = 'lobby'
        break
      case 'count':
        // A fresh field under the countdown, dealt already.
        if (match.phase !== 'count') match.game = createGame(seed())
        match.phase = 'count'
        match.count = message.n
        match.koAt = 0
        break
      case 'start':
        match.phase = 'playing'
        if (match.game.status !== 'ready') match.game = createGame(seed())
        go(match.game)
        match.told = 0
        match.koAt = 0
        match.boards.clear()
        match.endsAt = performance.now() + message.ms
        shownSecond = -1
        isBoardDirty = true
        break
      case 'garbage':
        if (match.phase === 'playing') receive(match.game, message.lines)
        break
      case 'board':
        match.boards.set(message.id, { grid: decodeGrid(message.grid), status: message.status })
        break
      case 'end':
        match.phase = 'over'
        match.players = message.players
        match.winner = message.winner
        break
      case 'refuse':
        leave(`tetris: the host turned us away: ${message.reason}`, 1)

        return
    }
    isDirty = true
    draw()
  })
  peer.onClose(() => {
    if (match.phase === 'over') leave(result())
    else leave('tetris: the connection to the host was lost', 1)
  })

  const screen = openScreen({
    onKey,
    onResize: () => {
      isDirty = true
    },
  })
  const timer = setInterval(step, STEP_MS)
  peer.send({ t: 'hello', name: seat.name, version: VERSION, token: seat.token })
  draw()
}

const clock = (ms: number): string => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const blankGrid = (): number[][] => Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0))

const me = (match: Match): Standing | undefined => match.players.find(player => player.id === match.id)

const timeOf = (match: Match): string =>
  match.phase === 'playing' ? clock(match.endsAt - performance.now()) : match.phase === 'over' ? '0:00' : ''

const key = (hotkey: string, what: string): Line => row(text(' '), bold(hotkey), dim(` ${what}`))

// A player's name over their well, with their KOs and lines sent.
function header(player: Standing, isWide: boolean): Line {
  if (!isWide) return row(bold(player.name.slice(0, 6).padEnd(7)), dim(`KO ${player.kos}`))

  return row(bold(player.name.slice(0, 6).padEnd(7)), dim(`KO ${player.kos} · sent ${player.sent}`))
}

// What lies over the field, never while it is played: the countdown, the
// result and standings when time is up, KO over a board that topped out.
function overlay(match: Match): Block | undefined {
  const { game } = match
  switch (match.phase) {
    case 'count':
      return centred([big(String(match.count), INK), [across('get ready')]], 1)
    case 'over': {
      const [words, color] =
        match.winner === match.id
          ? [['YOU', 'WIN'], GOLD]
          : match.winner === null
            ? [['DRAW'], INK]
            : [['YOU', 'LOSE'], ALERT]
      const ranked = [...match.players].sort((a, b) => b.kos - a.kos || b.sent - a.sent)
      const table = ranked.map(player => {
        const isWinner = player.id === match.winner

        return across(`${player.name.slice(0, 6).padEnd(7)}${`KO ${player.kos}`.padEnd(5)}sent ${player.sent}`, {
          color: isWinner ? INK : FAINT,
          bold: isWinner,
        })
      })
      const hint = across(match.isHost ? 'enter: play again' : 'wait for the host')

      return centred([centred(words.map(word => big(word, color))), table, [hint]], 1)
    }
    case 'playing':
      return game.status === 'over' ? big('KO!', ALERT) : undefined
    default:
      return undefined
  }
}

// What the small layout's well says between matches.
function noticeFor(match: Match): readonly [string, string] | undefined {
  switch (match.phase) {
    case 'count':
      return [String(match.count), 'ready']
    case 'over':
      return [
        match.winner === match.id ? 'YOU WIN' : match.winner === null ? 'DRAW' : 'YOU LOSE',
        match.isHost ? 'enter' : 'wait',
      ]
    default:
      return match.game.status === 'over' ? ['KO!', ''] : undefined
  }
}

// My board, full size: the hold box and the numbers down the left, the well
// with the garbage waiting shown up its left wall and the strip for shouting
// under it where there is room (else the shouting goes down the left, in
// small print), the pieces to come and the keys down the right.
function ownWide(match: Match, mine: Standing, hasStrip: boolean): Block {
  const { game } = match
  const incoming = game.pending.length
  const left = stacked(
    [
      holdBox(game),
      stacked([
        figure('TIME', timeOf(match)),
        figure('KO', String(mine.kos), { bold: true, color: ALERT }),
        figure('SENT', String(mine.sent), { bold: true, color: GOLD }),
        figure('LINES', String(game.lines)),
      ]),
      figure('INCOMING', String(incoming), incoming > 0 ? { bold: true, color: ALERT } : { dimColor: true }),
      ...(hasStrip ? [] : [shoutLines(game)]),
      [key('q', 'leave')],
    ],
    1,
  )
  const right = stacked([nextBox(game), HELP_WIDE.map(([hotkey, what]) => key(hotkey, what))], 1)
  const field = [
    header(mine, true),
    ...well(view(game), true, Math.min(incoming, ROWS)),
    ...(hasStrip ? blank(STRIP_ROWS) : []),
  ]
  let frame = beside([left, field, right], 1)
  if (hasStrip) frame = over(frame, SIDE, 1 + wellSize(true).rows, strip(game))
  const words = overlay(match)

  return words === undefined ? frame : overField(frame, SIDE + 1, 1, words)
}

// My board, small: half a row to a cell, the numbers beside the well.
function ownNarrow(match: Match, mine: Standing): Block {
  const { game } = match
  const field = [header(mine, false), ...wellRows(view(game), false, noticeFor(match), WALL).map(runs)]
  const help = HELP.map(([left, right]) =>
    row(pad(row(bold(left[0]), dim(` ${left[1]}`)), 13), bold(right[0]), dim(right[1] === '' ? '' : ` ${right[1]}`)),
  )
  let panel: Block
  if (match.phase === 'over') {
    const ranked = [...match.players].sort((a, b) => b.kos - a.kos || b.sent - a.sent)
    const table = ranked.map(player =>
      row(
        pad(player.id === match.winner ? bold(player.name.slice(0, 10)) : dim(player.name.slice(0, 10)), 11),
        dim(`KO ${player.kos}  sent ${player.sent}`),
      ),
    )
    panel = [stat('Time', timeOf(match)), ...table.slice(0, 5), ...help]
  } else {
    const incoming = game.pending.length
    const meter = row(
      text(' '.repeat(Math.min(incoming, METER_MAX)), { backgroundColor: ALERT }),
      dim(incoming > 0 ? ` ${incoming}` : ''),
    )
    panel = [
      stat('Time', timeOf(match)),
      stat('KOs', `${mine.kos}   Sent ${mine.sent}`),
      row(dim('Next'.padEnd(7)), upcoming(game, 3)),
      row(dim('Hold'.padEnd(7)), piece(game.hold, false)[0] ?? EMPTY),
      row(dim('In'.padEnd(7)), meter),
      game.combo >= 2 ? comboLine(game) : bannerLine(game),
      ...help,
    ]
  }

  return beside([field, panel])
}

// An opponent's board: their name, their field as last seen, KO over it
// while they are out.
function theirBoard(match: Match, other: Standing, isWide: boolean): Block {
  const board = match.boards.get(other.id)
  const grid = board?.grid ?? blankGrid()
  const isOut = board?.status === 'over'
  if (!isWide) return [header(other, false), ...wellRows(grid, false, isOut ? ['KO!', ''] : undefined, WALL).map(runs)]
  const block = [header(other, true), ...well(grid, true)]

  return isOut ? overField(block, 0, 1, big('KO!', ALERT)) : block
}

function lobby(match: Match, seat: Seat): Block {
  const lines: Block = [...centred([big('TETRIS', CYAN), big('BATTLE', ORANGE)]), EMPTY]
  if (match.phase === 'connecting') return [...lines, dim(`Connecting to ${seat.place}…`)]
  if (match.isHost) lines.push(bold(`Hosting at ${seat.place}`), dim('Friends on this network: tetris join'))
  else lines.push(bold(`Joined ${seat.place}`))
  lines.push(EMPTY, dim('Players'))
  for (const player of match.players) {
    lines.push(row(bold(`  ${player.name}`), dim(player.id === match.id ? '  (you)' : '')))
  }
  lines.push(EMPTY)
  if (match.hostPhase === 'playing' || match.hostPhase === 'count') {
    lines.push(dim('A match is under way: you play the next one.'))
  } else if (match.isHost) {
    lines.push(match.players.length >= 2 ? bold('Press enter to start') : dim('Waiting for a player to join…'))
  } else {
    lines.push(dim('Waiting for the host to start…'))
  }
  lines.push(dim('Most KOs wins, then most lines sent.'), EMPTY, dim('q to leave'))

  return lines
}

// The whole screen: the lobby, or my board with the others' wells beside
// it, full size where there is room and small where there is not, the clock
// big above them where there is room for that too. While garbage that just
// rose shakes my board, the whole picture shakes with it.
export function frame(match: Match, seat: Seat, columns: number, rows: number): string[] {
  if (match.phase === 'connecting' || match.phase === 'lobby') return centered(lobby(match, seat), columns, rows)

  const others = match.players.filter(player => player.id !== match.id)
  const fits = (isWide: boolean, isOtherWide: boolean): boolean => {
    const wide = 1 + Math.max(wellSize(isWide).rows, wellSize(isOtherWide).rows)

    return (
      frameColumns(isWide) + others.length * (wellSize(isOtherWide).columns + 2) <= columns &&
      wide + (isWide ? 0 : 1) <= rows
    )
  }
  let isWide = true
  let isOtherWide = true
  if (!fits(true, true)) {
    isOtherWide = false
    if (!fits(true, false)) {
      isWide = false
      if (!fits(false, false)) {
        const wanted = frameColumns(false) + others.length * (wellSize(false).columns + 2)

        return [`Tetris needs a window of ${wanted}x${wellSize(false).rows + 2} or more for ${others.length + 1} players.`]
      }
    }
  }

  const mine = me(match) ?? { id: match.id, name: seat.name, kos: 0, sent: 0, downs: 0 }
  const tall = 1 + wellSize(true).rows
  const hasStrip = isWide && rows >= tall + STRIP_ROWS
  const own = isWide ? ownWide(match, mine, hasStrip) : ownNarrow(match, mine)
  const theirs = others.map(other => theirBoard(match, other, isOtherWide))
  let all = beside([own, ...theirs])
  if (isWide && rows >= tall + (hasStrip ? STRIP_ROWS : 0) + CLOCK_ROWS && match.phase !== 'count') {
    all = centred([big(timeOf(match) === '' ? '0:00' : timeOf(match), INK), all], 1)
  }
  const { game } = match
  if (game.shakeMs > 0 && Math.floor(game.shakeMs / 50) % 2 === 1) all = all.map(line => [undefined, ...line])

  return centered(all, columns, rows)
}
