import { COLS, ROWS } from '../hooks/engine.ts'
import type { Status } from '../hooks/engine.ts'

// What a player and the host of a battle say to each other, one JSON object
// per line. Each player plays their own game; the host passes lines sent on
// to an opponent, keeps the score, and keeps the clock.

export const VERSION = 1

export type Phase = 'lobby' | 'count' | 'playing' | 'over'

export type Standing = {
  id: number
  name: string
  // Opponents knocked out by garbage from here, lines sent, and times
  // knocked out.
  kos: number
  sent: number
  downs: number
}

export type ClientMessage =
  | { t: 'hello'; name: string; version: number; token?: string }
  // The host's player only: start the match, or the next one.
  | { t: 'begin' }
  | { t: 'attack'; lines: number }
  | { t: 'board'; grid: string; status: Status }
  | { t: 'ko' }

export type ServerMessage =
  | { t: 'welcome'; id: number; isHost: boolean }
  | { t: 'players'; players: Standing[]; phase: Phase }
  | { t: 'count'; n: number }
  | { t: 'start'; ms: number }
  | { t: 'garbage'; lines: number; from: number }
  | { t: 'board'; id: number; grid: string; status: Status }
  | { t: 'end'; players: Standing[]; winner: number | null }
  | { t: 'refuse'; reason: string }

const STATUSES: readonly string[] = ['ready', 'playing', 'paused', 'over']
const PHASES: readonly string[] = ['lobby', 'count', 'playing', 'over']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
const isStatus = (value: unknown): value is Status =>
  typeof value === 'string' && STATUSES.includes(value)
const isPhase = (value: unknown): value is Phase => typeof value === 'string' && PHASES.includes(value)
const isStanding = (value: unknown): value is Standing =>
  isRecord(value) &&
  isCount(value.id) &&
  typeof value.name === 'string' &&
  isCount(value.kos) &&
  isCount(value.sent) &&
  isCount(value.downs)
const isStandings = (value: unknown): value is Standing[] =>
  Array.isArray(value) && value.every(isStanding)

// Whether what a line of JSON holds is a message, well formed; anything else
// is dropped.
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false
  switch (value.t) {
    case 'hello':
      return (
        typeof value.name === 'string' &&
        typeof value.version === 'number' &&
        (value.token === undefined || typeof value.token === 'string')
      )
    case 'begin':
    case 'ko':
      return true
    case 'attack':
      return isCount(value.lines)
    case 'board':
      return typeof value.grid === 'string' && isStatus(value.status)
    default:
      return false
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false
  switch (value.t) {
    case 'welcome':
      return isCount(value.id) && typeof value.isHost === 'boolean'
    case 'players':
      return isStandings(value.players) && isPhase(value.phase)
    case 'count':
      return isCount(value.n)
    case 'start':
      return isCount(value.ms)
    case 'garbage':
      return isCount(value.lines) && isCount(value.from)
    case 'board':
      return isCount(value.id) && typeof value.grid === 'string' && isStatus(value.status)
    case 'end':
      return isStandings(value.players) && (value.winner === null || isCount(value.winner))
    case 'refuse':
      return typeof value.reason === 'string'
    default:
      return false
  }
}

// The field as drawn, a digit a cell, the ghost left out.
export function encodeGrid(grid: readonly (readonly number[])[]): string {
  return grid.map(row => row.map(cell => Math.max(0, Math.min(9, cell))).join('')).join('')
}

export function decodeGrid(text: string): number[][] {
  const grid: number[][] = []
  for (let y = 0; y < ROWS; y++) {
    const row: number[] = []
    for (let x = 0; x < COLS; x++) {
      const digit = Number(text[y * COLS + x])
      row.push(Number.isInteger(digit) ? digit : 0)
    }
    grid.push(row)
  }

  return grid
}
