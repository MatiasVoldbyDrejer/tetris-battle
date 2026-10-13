import { randomUUID } from 'node:crypto'
import { connect as dial, createServer } from 'node:net'
import type { Server, Socket } from 'node:net'

import { addressOf } from './net.ts'

// A way in for friends who are not on this network: the host's battle port
// forwarded through a relay on the internet, in the protocol of `bore`
// (https://github.com/ekzhang/bore), so a `bore server` anywhere serves as
// the relay, and `tetris relay` is one too, for a `bore local` client as
// much as for a host here. Over the control connection go JSON messages
// ended by a NUL byte: the client's `{"Hello": port}` (0 for any) and the
// server's `{"Hello": port}` back; then the server's `"Heartbeat"`s, and
// for each caller a `{"Connection": id}`, which the client answers on a
// fresh connection with `{"Accept": id}`, after which that connection
// carries the caller's bytes.

export const CONTROL_PORT = 7835
// How long a caller waits for the host to accept it.
const ACCEPT_MS = 10_000
const HEARTBEAT_MS = 500
// A control connection with nothing on it for this long is taken for dead.
const SILENCE_MS = 15_000
const CONNECT_MS = 3000
const MAX_FRAME = 256
// The ports a relay hands out, unless told others.
export const RELAY_PORTS: readonly [number, number] = [20_000, 20_100]

type Frame = Record<string, unknown> | string

// Reads NUL-ended JSON frames off a socket, as they come, until the
// returned function is called, which answers what came after the last
// frame read: the start of what the socket carries from then on.
function frames(socket: Socket, onFrame: (frame: Frame) => void, onBad: () => void): () => Buffer {
  let held = Buffer.alloc(0)
  let isOn = true
  const read = (chunk: Buffer): void => {
    held = Buffer.concat([held, chunk])
    let cut = held.indexOf(0)
    while (isOn && cut >= 0) {
      const text = held.subarray(0, cut).toString('utf8')
      held = held.subarray(cut + 1)
      try {
        onFrame(JSON.parse(text) as Frame)
      } catch {
        onBad()

        return
      }
      cut = held.indexOf(0)
    }
    if (isOn && held.length > MAX_FRAME) onBad()
  }
  socket.on('data', read)

  return () => {
    isOn = false
    socket.off('data', read)

    return held
  }
}

const send = (socket: Socket, frame: Frame): boolean => socket.write(`${JSON.stringify(frame)}\0`)

const field = (frame: Frame, name: string): unknown =>
  typeof frame === 'object' && frame !== null && name in frame ? frame[name] : undefined

function connectTo(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = dial({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`no answer from ${host}:${port}`))
    }, CONNECT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export type Tunnel = {
  // Where callers reach the local port: the relay's host, and the port it gave.
  host: string
  port: number
  close(): void
  // Called once, when the relay drops the tunnel.
  onClose(fn: (reason: string) => void): void
}

// Forwards `localPort` here through the relay at `host`, and resolves once
// the relay has said which of its ports callers use.
export async function openTunnel(host: string, localPort: number, controlPort = CONTROL_PORT): Promise<Tunnel> {
  // The relay's address, looked up once: every caller's connection goes there too.
  const address = await addressOf(host)
  const control = await connectTo(address, controlPort)
  let onClose: ((reason: string) => void) | undefined
  let isOpen = true
  const end = (reason: string): void => {
    if (!isOpen) return
    isOpen = false
    control.destroy()
    onClose?.(reason)
  }
  let quiet = setTimeout(() => end('the relay went quiet'), SILENCE_MS)
  const heard = (): void => {
    clearTimeout(quiet)
    quiet = setTimeout(() => end('the relay went quiet'), SILENCE_MS)
  }

  const port = await new Promise<number>((resolve, reject) => {
    const first = setTimeout(() => reject(new Error('the relay did not answer')), CONNECT_MS)
    frames(
      control,
      frame => {
        heard()
        const given = field(frame, 'Hello')
        const error = field(frame, 'Error')
        const id = field(frame, 'Connection')
        if (typeof given === 'number') {
          clearTimeout(first)
          resolve(given)
        } else if (typeof error === 'string') {
          clearTimeout(first)
          reject(new Error(`the relay refused: ${error}`))
          end(error)
        } else if (field(frame, 'Challenge') !== undefined) {
          clearTimeout(first)
          reject(new Error('the relay wants a secret, which tetris cannot give'))
          end('secret wanted')
        } else if (typeof id === 'string') {
          accept(id)
        }
      },
      () => end('the relay spoke out of turn'),
    )
    control.on('error', error => {
      clearTimeout(first)
      reject(error)
      end(error.message)
    })
    control.on('close', () => {
      clearTimeout(first)
      reject(new Error('the relay hung up'))
      end('the relay hung up')
    })
    send(control, { Hello: 0 })
  })

  // A caller: one connection to the relay for them, one to the local port,
  // joined.
  function accept(id: string): void {
    void (async () => {
      let remote: Socket | undefined
      let local: Socket | undefined
      try {
        remote = await connectTo(address, controlPort)
        send(remote, { Accept: id })
        local = await connectTo('127.0.0.1', localPort)
        remote.pipe(local)
        local.pipe(remote)
        remote.on('error', () => local?.destroy())
        local.on('error', () => remote?.destroy())
        remote.on('close', () => local?.destroy())
        local.on('close', () => remote?.destroy())
      } catch {
        remote?.destroy()
        local?.destroy()
      }
    })()
  }

  return {
    host,
    port,
    close: () => {
      clearTimeout(quiet)
      isOpen = false
      control.destroy()
    },
    onClose(fn) {
      onClose = fn
    },
  }
}

export type Relay = { port: number; close(): void }

// A relay: hands each client a port of its own on this machine, and passes
// what arrives there on to the client. Resolves once it listens.
export function serveRelay(options: { port?: number; ports?: readonly [number, number] } = {}): Promise<Relay> {
  const [first, last] = options.ports ?? RELAY_PORTS
  const taken = new Set<number>()
  const callers = new Map<string, { socket: Socket; timer: ReturnType<typeof setTimeout> }>()

  // Picks a port of the range not in use, trying each once in a random order.
  async function freePort(wanted: number): Promise<Server | undefined> {
    const order = wanted >= first && wanted <= last ? [wanted] : []
    const rest: number[] = []
    for (let port = first; port <= last; port++) if (!taken.has(port) && port !== wanted) rest.push(port)
    for (let at = rest.length - 1; at > 0; at--) {
      const other = Math.floor(Math.random() * (at + 1))
      const swapped = rest[at]
      const picked = rest[other]
      if (swapped !== undefined && picked !== undefined) {
        rest[at] = picked
        rest[other] = swapped
      }
    }
    for (const port of [...order, ...rest.slice(0, 16)]) {
      const listener = await new Promise<Server | undefined>(resolve => {
        const server = createServer()
        server.once('error', () => resolve(undefined))
        server.listen(port, () => resolve(server))
      })
      if (listener !== undefined) {
        taken.add(port)

        return listener
      }
    }

    return undefined
  }

  function control(socket: Socket): void {
    let listener: Server | undefined
    let beat: ReturnType<typeof setInterval> | undefined
    let isFirst = true
    let stop: (() => Buffer) | undefined
    const close = (): void => {
      clearInterval(beat)
      listener?.close()
      const address = listener?.address()
      if (typeof address === 'object' && address !== null) taken.delete(address.port)
      socket.destroy()
    }
    stop = frames(
      socket,
      frame => {
        const wanted = field(frame, 'Hello')
        const id = field(frame, 'Accept')
        if (isFirst && typeof wanted === 'number') {
          isFirst = false
          void freePort(wanted).then(given => {
            if (given === undefined) {
              send(socket, { Error: 'no port free' })
              close()

              return
            }
            listener = given
            const address = given.address()
            const port = typeof address === 'object' && address !== null ? address.port : 0
            send(socket, { Hello: port })
            beat = setInterval(() => {
              if (!send(socket, 'Heartbeat')) close()
            }, HEARTBEAT_MS)
            given.on('connection', caller => {
              const callerId = randomUUID()
              callers.set(callerId, {
                socket: caller,
                timer: setTimeout(() => {
                  callers.delete(callerId)
                  caller.destroy()
                }, ACCEPT_MS),
              })
              caller.on('error', () => undefined)
              send(socket, { Connection: callerId })
            })
          })
        } else if (isFirst && typeof id === 'string') {
          isFirst = false
          const caller = callers.get(id)
          if (caller === undefined) {
            socket.destroy()

            return
          }
          callers.delete(id)
          clearTimeout(caller.timer)
          // From here the connection carries the caller's bytes, raw.
          const rest = stop?.() ?? Buffer.alloc(0)
          if (rest.length > 0) caller.socket.write(rest)
          socket.pipe(caller.socket)
          caller.socket.pipe(socket)
          socket.on('close', () => caller.socket.destroy())
          caller.socket.on('close', () => socket.destroy())
        } else if (isFirst) {
          send(socket, { Error: 'say hello first' })
          close()
        }
      },
      close,
    )
    socket.on('error', close)
    socket.on('close', close)
  }

  // Every control connection open, so that closing the relay ends them.
  const controls = new Set<Socket>()

  return new Promise((resolve, reject) => {
    const server = createServer(socket => {
      controls.add(socket)
      socket.on('close', () => controls.delete(socket))
      control(socket)
    })
    server.once('error', reject)
    server.listen(options.port ?? CONTROL_PORT, () => {
      const address = server.address()
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : 0,
        close: () => {
          server.close()
          for (const socket of controls) socket.destroy()
        },
      })
    })
  })
}
