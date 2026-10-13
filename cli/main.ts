import { userInfo } from 'node:os'

import { isLevel } from './agent.ts'
import type { Level } from './agent.ts'
import { host, join } from './battle.ts'
import { PORT } from './net.ts'
import { play } from './solo.ts'
import { CONTROL_PORT, RELAY_PORTS, serveRelay } from './tunnel.ts'

// The `tetris` command: alone, or a battle with friends on the network.
// Node runs this file as it is, stripping the types; the package on npm
// carries it bundled.

const USAGE = `tetris: Tetris in the terminal, alone or against friends on the network

  tetris                   play alone
  tetris host              host a battle on this network
  tetris host --agent      the same with the agent in it: challenge it alone, or
                           with friends (easy, normal or hard after --agent)
  tetris join [address]    join the battle on this network, or the one at
                           address (with :port after it, if not the usual)
  tetris host --public     the same, reachable from anywhere through a relay:
                           the lobby says the address friends elsewhere join
                           (bore.pub, or the relay named after --public)
  tetris relay             run a relay on this machine for hosts to go through

  --name NAME              your name in a battle (default: your username)
  --port PORT              the battle's port (default ${PORT})
  --minutes N              how long a battle lasts (the host's; default 2)
  --ports FROM-TO          the ports a relay hands out (default ${RELAY_PORTS[0]}-${RELAY_PORTS[1]})

  ← → or a d    move             ↑ w or x    rotate
  ↓ or s        soft drop        z           rotate the other way
  space or f    hard drop        c           hold
  p or esc      pause (alone)    r           restart (paused or game over)
  q or ctrl+c   quit

A battle is Tetris Battle's: a line clear sends garbage to an opponent, more
for a tetris, a T-spin, back to back, a combo or a perfect clear, and what you
send first cancels what is coming your way. A top-out is a KO for whoever sent
the garbage, and your board starts over. Most KOs wins, then most lines sent.
`

type Args = {
  command: 'play' | 'host' | 'join' | 'relay'
  address?: string
  agent?: Level
  public?: { relay: string; controlPort: number }
  ports: readonly [number, number]
  name: string
  port: number
  minutes: number
  isHelp: boolean
  error?: string
}

function defaultName(): string {
  try {
    return userInfo().username
  } catch {
    return 'player'
  }
}

function parse(argv: readonly string[]): Args {
  const args: Args = { command: 'play', name: defaultName(), port: PORT, minutes: 2, ports: RELAY_PORTS, isHelp: false }
  const words: string[] = []
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at] ?? ''
    if (arg === '-h' || arg === '--help') {
      args.isHelp = true
    } else if (arg.startsWith('--')) {
      const cut = arg.indexOf('=')
      const flag = cut < 0 ? arg : arg.slice(0, cut)
      if (flag === '--agent') {
        // The level is optional: the next word, if it is one.
        const level = cut < 0 ? argv[at + 1] : arg.slice(cut + 1)
        if (level !== undefined && isLevel(level)) {
          args.agent = level
          if (cut < 0) at += 1
        } else if (cut >= 0) {
          return { ...args, error: `not a level: ${level ?? ''} (easy, normal or hard)` }
        } else {
          args.agent = 'normal'
        }
        continue
      }
      if (flag === '--public') {
        // The relay is optional: the next word, unless it is a command or a flag.
        const named = cut < 0 ? argv[at + 1] : arg.slice(cut + 1)
        const isWord = named !== undefined && named !== '' && !named.startsWith('-') && !['host', 'join', 'relay'].includes(named)
        const [relay, given] = isWord ? named.split(':') : ['bore.pub']
        const controlPort = given === undefined ? CONTROL_PORT : Number(given)
        if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535) {
          return { ...args, error: `not a port: ${given ?? ''}` }
        }
        args.public = { relay: relay ?? 'bore.pub', controlPort }
        if (isWord && cut < 0) at += 1
        continue
      }
      const value = cut < 0 ? argv[++at] : arg.slice(cut + 1)
      if (value === undefined) return { ...args, error: `${flag} needs a value` }
      switch (flag) {
        case '--name':
          args.name = value
          break
        case '--port':
          args.port = Number(value)
          if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
            return { ...args, error: `not a port: ${value}` }
          }
          break
        case '--minutes':
          args.minutes = Number(value)
          if (!(args.minutes > 0)) return { ...args, error: `not a number of minutes: ${value}` }
          break
        case '--ports': {
          const [from, to] = value.split('-').map(Number)
          if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || to < from) {
            return { ...args, error: `not a range of ports: ${value} (like 20000-20100)` }
          }
          args.ports = [from, to]
          break
        }
        default:
          return { ...args, error: `unknown option ${flag}` }
      }
    } else {
      words.push(arg)
    }
  }

  const [command, address] = words
  if (command === undefined) return args
  if (command === 'host') return { ...args, command }
  if (command === 'relay') return { ...args, command }
  if (command === 'join') {
    if (args.agent !== undefined) return { ...args, error: 'only the host can bring the agent (tetris host --agent)' }
    if (args.public !== undefined) return { ...args, error: 'only the host opens a way in (tetris host --public)' }

    return { ...args, command, address }
  }
  if (args.agent !== undefined) return { ...args, error: 'the agent plays in a battle: tetris host --agent' }
  if (args.public !== undefined) return { ...args, error: 'a way in is for a battle: tetris host --public' }

  return { ...args, error: `unknown command ${command}` }
}

async function run(): Promise<void> {
  const args = parse(process.argv.slice(2))
  if (args.isHelp) {
    process.stdout.write(USAGE)

    return
  }
  if (args.error !== undefined) {
    process.stderr.write(`tetris: ${args.error} (try \`tetris --help\`)\n`)
    process.exitCode = 1

    return
  }
  if (args.command === 'relay') {
    const relay = await serveRelay({ port: args.port === PORT ? CONTROL_PORT : args.port, ports: args.ports })
    process.stdout.write(
      `Relaying on port ${relay.port}: hosts run \`tetris host --public <this machine's address>\`, and get a port from ${args.ports[0]} to ${args.ports[1]}.\n`,
    )
    const stop = (): void => {
      relay.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)

    return
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('tetris: needs an interactive terminal (try `tetris --help`)\n')
    process.exitCode = 1

    return
  }
  switch (args.command) {
    case 'host':
      await host(args)
      break
    case 'join':
      await join(args)
      break
    case 'play':
      play()
  }
}

run().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const message =
    code === 'EADDRINUSE'
      ? 'that port is taken: is a battle already hosted here? (try --port)'
      : error instanceof Error
        ? error.message
        : String(error)
  process.stderr.write(`tetris: ${message}\n`)
  process.exit(1)
})
