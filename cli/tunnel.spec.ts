import assert from 'node:assert/strict'
import { connect as dial } from 'node:net'
import { test } from 'node:test'

import { connect } from './net.ts'
import { VERSION, isServerMessage } from './protocol.ts'
import type { ServerMessage } from './protocol.ts'
import { serve } from './server.ts'
import { openTunnel, serveRelay } from './tunnel.ts'

// A relay on this machine, a battle hosted behind it, and a player who comes
// in through the relay's port: the whole way in, over real sockets.

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('a battle hosted through a relay is joined at the port the relay gave', async () => {
  const relay = await serveRelay({ port: 0, ports: [41_000, 41_020] })
  const server = await serve({ port: 0, name: 'host', minutes: 0.05, token: 'secret', discoveryPort: 0, countMs: 10 })
  const tunnel = await openTunnel('127.0.0.1', server.port, relay.port)
  try {
    assert.equal(tunnel.host, '127.0.0.1')
    assert.ok(tunnel.port >= 41_000 && tunnel.port <= 41_020, String(tunnel.port))

    // The host's own player, straight in; a friend, through the relay.
    const host = await connect('127.0.0.1', server.port)
    const friend = await connect(tunnel.host, tunnel.port)
    const heard: ServerMessage[] = []
    friend.onMessage(message => {
      if (isServerMessage(message)) heard.push(message)
    })
    host.send({ t: 'hello', name: 'host', version: VERSION, token: 'secret' })
    friend.send({ t: 'hello', name: 'far away', version: VERSION })
    const until = async (test: (m: ServerMessage) => boolean, ms: number): Promise<ServerMessage> => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const found = [...heard].reverse().find(test)
        if (found !== undefined) return found
        await sleep(20)
      }
      throw new Error('heard nothing of the kind')
    }
    const welcome = await until(m => m.t === 'welcome', 2000)
    assert.equal(welcome.t, 'welcome')
    const lobby = await until(m => m.t === 'players' && m.players.length === 2, 2000)
    assert.equal(lobby.t, 'players')
    host.send({ t: 'begin' })
    await until(m => m.t === 'start', 2000)
    friend.send({ t: 'attack', lines: 3 })
    const end = await until(m => m.t === 'end', 4000)
    if (end.t === 'end') assert.equal(end.players.find(p => p.name === 'far away')?.sent, 3)

    // A second friend, at the same time.
    const other = await connect(tunnel.host, tunnel.port)
    const greeted = new Promise<void>(resolve => other.onMessage(m => isServerMessage(m) && m.t === 'welcome' && resolve()))
    other.send({ t: 'hello', name: 'also far', version: VERSION })
    await greeted
    other.close()
    friend.close()
    host.close()
  } finally {
    tunnel.close()
    server.close()
    relay.close()
  }
})

test('the relay refuses a caller nobody accepts, and a client that will not say hello', async () => {
  const relay = await serveRelay({ port: 0, ports: [41_030, 41_031] })
  try {
    const tunnel = await openTunnel('127.0.0.1', 1, relay.port)
    // Nothing listens on port 1, so the caller's connection is dropped.
    const caller = dial({ host: '127.0.0.1', port: tunnel.port })
    const closed = new Promise<void>(resolve => caller.on('close', () => resolve()))
    caller.on('error', () => undefined)
    await closed
    tunnel.close()

    const rude = dial({ host: '127.0.0.1', port: relay.port })
    const answer = new Promise<string>(resolve => rude.on('data', chunk => resolve(chunk.toString())))
    rude.write('{"Accept":"nobody"}\0')
    const ended = new Promise<void>(resolve => rude.on('close', () => resolve()))
    rude.on('error', () => undefined)
    await ended
    void answer
  } finally {
    relay.close()
  }
})

test('a tunnel ends when the relay goes away', async () => {
  const relay = await serveRelay({ port: 0, ports: [41_040, 41_041] })
  const tunnel = await openTunnel('127.0.0.1', 1, relay.port)
  const reason = new Promise<string>(resolve => tunnel.onClose(resolve))
  relay.close()
  assert.equal(await reason, 'the relay hung up')
})
