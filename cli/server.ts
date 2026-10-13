import { advertise, listen } from './net.ts'
import type { Peer } from './net.ts'
import { VERSION, isClientMessage } from './protocol.ts'
import type { Phase, ServerMessage, Standing } from './protocol.ts'

// The host of a battle. Each player plays their own game and reports what it
// sends and when it tops out; the host passes garbage on to an opponent,
// keeps the standings and the clock, and shows each player the others'
// boards.

const COUNT_FROM = 3
const COUNT_MS = 1000
const MIN_MATCH_MS = 1000
const NAME_LENGTH = 12

export type ServerOptions = {
  port: number
  name: string
  minutes: number
  // What the host's own player says in its hello, to be the one who starts.
  token: string
  discoveryPort?: number
  // A step of the countdown before a match.
  countMs?: number
}

export type Server = { port: number; close(): void }

type Player = Standing & {
  peer: Peer
  isHost: boolean
  // The last opponent to send garbage here, who gets the KO if it tops out.
  lastAttacker: number | null
  // Whether in the match under way: one who joined during it watches.
  isIn: boolean
}

export async function serve(options: ServerOptions): Promise<Server> {
  const players = new Map<number, Player>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const ms = Math.max(MIN_MATCH_MS, Math.round(options.minutes * 60_000))
  const countMs = options.countMs ?? COUNT_MS
  let nextId = 1
  let phase: Phase = 'lobby'

  const later = (delay: number, run: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, delay)
    timers.add(timer)
  }
  const forget = (): void => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  const standings = (): Standing[] =>
    [...players.values()].map(({ id, name, kos, sent, downs }) => ({ id, name, kos, sent, downs }))
  const inMatch = (): Player[] => [...players.values()].filter(player => player.isIn)
  const broadcast = (message: ServerMessage, except?: number): void => {
    for (const player of players.values()) if (player.id !== except) player.peer.send(message)
  }
  const tell = (): void => broadcast({ t: 'players', players: standings(), phase })

  const end = (): void => {
    forget()
    phase = 'over'
    const ranked = inMatch().sort((a, b) => b.kos - a.kos || b.sent - a.sent)
    const [first, second] = ranked
    const isClear =
      first !== undefined &&
      (second === undefined || first.kos !== second.kos || first.sent !== second.sent)
    broadcast({ t: 'end', players: standings(), winner: isClear ? first.id : null })
  }
  const start = (): void => {
    phase = 'playing'
    for (const player of players.values()) {
      Object.assign(player, { kos: 0, sent: 0, downs: 0, lastAttacker: null, isIn: true })
    }
    broadcast({ t: 'start', ms })
    tell()
    later(ms, end)
  }
  const begin = (): void => {
    if ((phase !== 'lobby' && phase !== 'over') || players.size < 2) return
    phase = 'count'
    tell()
    for (let n = COUNT_FROM; n >= 1; n--) {
      later((COUNT_FROM - n) * countMs, () => broadcast({ t: 'count', n }))
    }
    later(COUNT_FROM * countMs, start)
  }
  const attack = (player: Player, lines: number): void => {
    if (phase !== 'playing' || !player.isIn || lines <= 0) return
    player.sent += lines
    const others = inMatch().filter(other => other.id !== player.id)
    const target = others[Math.floor(Math.random() * others.length)]
    if (target !== undefined) {
      target.lastAttacker = player.id
      target.peer.send({ t: 'garbage', lines, from: player.id })
    }
    tell()
  }
  const knockOut = (player: Player): void => {
    if (phase !== 'playing' || !player.isIn) return
    player.downs += 1
    const by = player.lastAttacker === null ? undefined : players.get(player.lastAttacker)
    if (by !== undefined) by.kos += 1
    player.lastAttacker = null
    tell()
  }
  const leave = (player: Player): void => {
    players.delete(player.id)
    if (phase === 'count' && players.size < 2) {
      forget()
      phase = 'lobby'
    }
    tell()
    if (phase === 'playing' && inMatch().length < 2) end()
  }

  const greet = (peer: Peer): void => {
    let player: Player | undefined
    peer.onMessage(message => {
      if (!isClientMessage(message)) return
      if (player === undefined) {
        if (message.t !== 'hello') return
        if (message.version !== VERSION) {
          peer.send({
            t: 'refuse',
            reason: `the host plays version ${VERSION} of the game and you version ${message.version}`,
          })
          peer.close()

          return
        }
        player = {
          id: nextId,
          name: message.name.trim().slice(0, NAME_LENGTH) || `player ${nextId}`,
          kos: 0,
          sent: 0,
          downs: 0,
          peer,
          isHost: message.token !== undefined && message.token === options.token,
          lastAttacker: null,
          isIn: false,
        }
        nextId += 1
        players.set(player.id, player)
        peer.send({ t: 'welcome', id: player.id, isHost: player.isHost })
        tell()

        return
      }
      switch (message.t) {
        case 'begin':
          if (player.isHost) begin()
          break
        case 'attack':
          attack(player, message.lines)
          break
        case 'ko':
          knockOut(player)
          break
        case 'board':
          broadcast({ t: 'board', id: player.id, grid: message.grid, status: message.status }, player.id)
          break
        case 'hello':
          break
      }
    })
    peer.onClose(() => {
      if (player !== undefined) leave(player)
    })
  }

  const listening = await listen(options.port, greet)
  const stop = advertise(
    listening.port,
    () => ({ name: options.name, players: players.size }),
    options.discoveryPort,
  )

  return {
    port: listening.port,
    close() {
      stop()
      forget()
      for (const player of players.values()) player.peer.close()
      listening.close()
    },
  }
}
