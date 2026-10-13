import { createSocket } from 'node:dgram'
import { createConnection, createServer } from 'node:net'
import type { Socket } from 'node:net'
import { networkInterfaces } from 'node:os'

// A battle's wires: a line of JSON per message over TCP between each player
// and the host, and a shout over UDP to find a host on the network.

export const PORT = 7372
export const DISCOVERY_PORT = 7373
const PROBE = 'tetris?'
const DISCOVER_MS = 1500
// A line longer than this is no message of ours.
const LINE_LIMIT = 65536

export type Peer = {
  send(message: unknown): void
  close(): void
  onMessage(listener: (message: unknown) => void): void
  onClose(listener: () => void): void
}

function peerOf(socket: Socket): Peer {
  const messages: ((message: unknown) => void)[] = []
  const closes: (() => void)[] = []
  let buffered = ''
  let isClosed = false
  socket.setNoDelay(true)
  socket.on('data', (chunk: Buffer | string) => {
    buffered += chunk.toString()
    let cut = buffered.indexOf('\n')
    while (cut >= 0) {
      const line = buffered.slice(0, cut)
      buffered = buffered.slice(cut + 1)
      cut = buffered.indexOf('\n')
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      for (const listener of messages) listener(parsed)
    }
    if (buffered.length > LINE_LIMIT) socket.destroy()
  })
  socket.on('error', () => socket.destroy())
  socket.on('close', () => {
    if (isClosed) return
    isClosed = true
    for (const listener of closes) listener()
  })

  return {
    send(message) {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
    },
    close() {
      socket.destroy()
    },
    onMessage(listener) {
      messages.push(listener)
    },
    onClose(listener) {
      closes.push(listener)
    },
  }
}

export type Listening = { port: number; close(): void }

// Takes players in at `port` (0 for any free one).
export function listen(port: number, onPeer: (peer: Peer) => void): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => onPeer(peerOf(socket)))
    server.once('error', reject)
    server.listen(port, () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : port,
        close: () => server.close(),
      })
    })
  })
}

export function connect(host: string, port: number): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    socket.once('error', reject)
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(peerOf(socket))
    })
  })
}

export type Found = { address: string; port: number; name: string; players: number }

// This machine's IPv4 addresses on its networks, each with the address that
// reaches the whole network.
function interfaces(): { address: string; broadcast: string }[] {
  const found: { address: string; broadcast: string }[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const ip = entry.address.split('.').map(Number)
      const mask = entry.netmask.split('.').map(Number)
      const broadcast = ip.map((octet, at) => octet | (~(mask[at] ?? 255) & 255)).join('.')
      found.push({ address: entry.address, broadcast })
    }
  }

  return found
}

// The address friends on the network reach this machine at, if it is on one.
export const lanAddress = (): string | undefined => interfaces()[0]?.address

// Answers anyone on the network asking for a game, with where it is, until
// the function returned is called.
export function advertise(
  port: number,
  info: () => { name: string; players: number },
  discoveryPort = DISCOVERY_PORT,
): () => void {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const stop = (): void => {
    try {
      socket.close()
    } catch {
      // Already closed.
    }
  }
  socket.on('error', stop)
  socket.on('message', (message, from) => {
    if (message.toString() !== PROBE) return
    socket.send(JSON.stringify({ tetris: port, ...info() }), from.port, from.address)
  })
  socket.bind(discoveryPort)

  return stop
}

// Asks the network for games and collects the answers for a moment.
export function discover(
  options: { ms?: number; discoveryPort?: number; targets?: readonly string[] } = {},
): Promise<Found[]> {
  const { ms = DISCOVER_MS, discoveryPort = DISCOVERY_PORT } = options
  const targets = new Set(options.targets ?? ['255.255.255.255', ...interfaces().map(entry => entry.broadcast)])

  return new Promise(resolve => {
    const found = new Map<string, Found>()
    const socket = createSocket({ type: 'udp4' })
    let isDone = false
    const done = (): void => {
      if (isDone) return
      isDone = true
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      resolve([...found.values()])
    }
    socket.on('error', done)
    socket.on('message', (message, from) => {
      let reply: unknown
      try {
        reply = JSON.parse(message.toString())
      } catch {
        return
      }
      if (typeof reply !== 'object' || reply === null || !('tetris' in reply)) return
      const port = reply.tetris
      if (typeof port !== 'number') return
      const name = 'name' in reply && typeof reply.name === 'string' ? reply.name : ''
      const players = 'players' in reply && typeof reply.players === 'number' ? reply.players : 0
      found.set(`${from.address}:${port}`, { address: from.address, port, name, players })
    })
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        // Then only the addresses given are asked.
      }
      for (const target of targets) {
        socket.send(PROBE, discoveryPort, target, () => {
          // A network that cannot be reached is no reason to stop asking.
        })
      }
      setTimeout(done, ms)
    })
  })
}
