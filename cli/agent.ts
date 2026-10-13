import { act, createGame, go, receive, restart, tick, view } from '../hooks/engine.ts'
import type { Action, Game } from '../hooks/engine.ts'
import { keysFor, ranked } from '../hooks/plan.ts'
import { connect } from './net.ts'
import { VERSION, encodeGrid, isServerMessage } from './protocol.ts'
import type { Phase } from './protocol.ts'

// A computer player in a battle. It joins the host like anyone else and
// plays its own game with the planner (hooks/plan.ts): for each piece it
// tries every orientation at every column, drops each in its head, and keeps
// the field that comes out best; then it presses the keys that put the
// piece there, one at a time, after a moment's thought. The hard one thinks
// faster, builds for tetrises and looks at the piece after this one too;
// the easy one thinks slower and picks one of its best few at random.

export type Level = 'easy' | 'normal' | 'hard'
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard']
export const isLevel = (value: string): value is Level => (LEVELS as readonly string[]).includes(value)
export const AGENT_NAME = 'Agent'

const STEP_MS = 16
const SNAPSHOT_MS = 66
const KO_MS = 900
const KEY_MS = 30
const THINK_MS: Record<Level, number> = { easy: 800, normal: 420, hard: 180 }
const EASY_CHOICES = 3

export type Plan = { rot: number; x: number }

// Where to put the piece: its orientation and the column of its box.
export function bestPlan(game: Game, level: Level): Plan | undefined {
  const { piece } = game
  const choices = ranked(game.board, piece.kind, piece.y, game.queue[0], level === 'hard' ? 'build' : 'clear')
  const among = level === 'easy' ? choices.slice(0, EASY_CHOICES) : choices.slice(0, 1)
  const chosen = among[Math.floor(Math.random() * among.length)]

  return chosen === undefined ? undefined : { rot: chosen.rot, x: chosen.x }
}

export { keysFor }

// Joins the battle hosted at `port` on this machine and plays in it until
// the connection ends.
export async function joinAsAgent(port: number, level: Level, name = AGENT_NAME): Promise<void> {
  const peer = await connect('127.0.0.1', port)
  let phase: Phase = 'lobby'
  let game = createGame()
  let told = 0
  let koAt = 0
  let shownAt = 0
  let isBoardDirty = false
  let keys: Action[] = []
  let readyAt = 0
  let at = performance.now()

  // Tells the host what the game did, as a player's terminal does.
  function report(now: number): void {
    if (game.sent > told) {
      peer.send({ t: 'attack', lines: game.sent - told })
      told = game.sent
    }
    if (game.status === 'over' && koAt === 0) {
      koAt = now
      peer.send({ t: 'board', grid: encodeGrid(view(game)), status: 'over' })
      peer.send({ t: 'ko' })
    } else if (game.status === 'over' && now - koAt >= KO_MS) {
      restart(game)
      koAt = 0
      told = 0
      shownAt = 0
      keys = []
      readyAt = now + THINK_MS[level]
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
    const elapsed = Math.min(now - at, 100)
    at = now
    if (phase !== 'playing') return
    if (tick(game, elapsed)) isBoardDirty = true
    if (game.status === 'playing' && now >= readyAt) {
      if (keys.length === 0) {
        const plan = bestPlan(game, level)
        keys = plan === undefined ? ['drop'] : keysFor(plan, game.piece)
      }
      const key = keys.shift()
      if (key !== undefined && act(game, key)) isBoardDirty = true
      readyAt = now + (keys.length === 0 ? THINK_MS[level] : KEY_MS)
    }
    report(now)
  }

  return new Promise(resolve => {
    const timer = setInterval(step, STEP_MS)
    peer.onMessage(message => {
      if (!isServerMessage(message)) return
      switch (message.t) {
        case 'count':
          if (phase !== 'count') game = createGame()
          phase = 'count'
          break
        case 'start':
          phase = 'playing'
          if (game.status !== 'ready') game = createGame()
          go(game)
          told = 0
          koAt = 0
          keys = []
          readyAt = performance.now() + THINK_MS[level]
          isBoardDirty = true
          break
        case 'garbage':
          if (phase === 'playing') receive(game, message.lines)
          break
        case 'end':
          phase = 'over'
          break
        case 'refuse':
          peer.close()
          break
        default:
          break
      }
    })
    peer.onClose(() => {
      clearInterval(timer)
      resolve()
    })
    peer.send({ t: 'hello', name, version: VERSION })
  })
}
