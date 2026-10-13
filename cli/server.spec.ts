import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connect, discover } from './net.ts'
import type { Peer } from './net.ts'
import { VERSION, isServerMessage } from './protocol.ts'
import type { ServerMessage } from './protocol.ts'
import { serve } from './server.ts'

// The host and two players on this machine, over real sockets.

const DISCOVERY_PORT = 40_000 + Math.floor(Math.random() * 20_000)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// What a peer has heard, and a wait for what it hears next.
function ears(peer: Peer) {
  const heard: ServerMessage[] = []
  const waiting: { test: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }[] = []
  peer.onMessage(message => {
    if (!isServerMessage(message)) return
    heard.push(message)
    for (const wait of [...waiting]) {
      if (!wait.test(message)) continue
      waiting.splice(waiting.indexOf(wait), 1)
      wait.resolve(message)
    }
  })
  // A message already heard that passes, else the next one that does.
  const until = (test: (message: ServerMessage) => boolean, ms = 3000): Promise<ServerMessage> => {
    const already = [...heard].reverse().find(test)
    if (already !== undefined) return Promise.resolve(already)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('heard nothing of the kind')), ms)
      waiting.push({
        test,
        resolve: message => {
          clearTimeout(timer)
          resolve(message)
        },
      })
    })
  }
  const next = <T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> =>
    until(message => message.t === t) as Promise<Extract<ServerMessage, { t: T }>>

  return { heard, until, next }
}

test('a battle: the host starts it, garbage is passed on, a KO is credited, and time ends it', async () => {
  const server = await serve({
    port: 0,
    name: 'host',
    minutes: 0.02,
    token: 'secret',
    discoveryPort: DISCOVERY_PORT,
    countMs: 10,
  })
  try {
    const a = await connect('127.0.0.1', server.port)
    const b = await connect('127.0.0.1', server.port)
    const A = ears(a)
    const B = ears(b)
    a.send({ t: 'hello', name: 'ann', version: VERSION, token: 'secret' })
    b.send({ t: 'hello', name: 'bob', version: VERSION })
    const [wa, wb] = await Promise.all([A.next('welcome'), B.next('welcome')])
    assert.equal(wa.isHost, true)
    assert.equal(wb.isHost, false)
    const roster = await A.until(m => m.t === 'players' && m.players.length === 2)
    assert.equal(roster.t, 'players')
    if (roster.t === 'players') assert.deepEqual(roster.players.map(p => p.name), ['ann', 'bob'])

    // Only the host starts a match.
    b.send({ t: 'begin' })
    await sleep(50)
    assert.equal(A.heard.some(m => m.t === 'count'), false)
    a.send({ t: 'begin' })
    const [sa, sb] = await Promise.all([A.next('start'), B.next('start')])
    assert.equal(sa.ms, 1200)
    assert.equal(sb.ms, 1200)
    assert.deepEqual(A.heard.filter(m => m.t === 'count').map(m => (m.t === 'count' ? m.n : 0)), [3, 2, 1])

    // Lines sent go to the opponent, and show in the standings.
    a.send({ t: 'attack', lines: 3 })
    assert.deepEqual(await B.next('garbage'), { t: 'garbage', lines: 3, from: wa.id })
    await A.until(m => m.t === 'players' && m.players.find(p => p.id === wa.id)?.sent === 3)

    // A top-out is a KO for the last to send garbage there.
    b.send({ t: 'ko' })
    const credited = await A.until(m => m.t === 'players' && m.players.find(p => p.id === wa.id)?.kos === 1)
    if (credited.t === 'players') assert.equal(credited.players.find(p => p.id === wb.id)?.downs, 1)

    // A board goes to the others, not back.
    b.send({ t: 'board', grid: '0'.repeat(200), status: 'playing' })
    assert.equal((await A.next('board')).id, wb.id)
    await sleep(50)
    assert.equal(B.heard.some(m => m.t === 'board'), false)

    const [ea, eb] = await Promise.all([A.next('end'), B.next('end')])
    assert.equal(ea.winner, wa.id)
    assert.equal(eb.winner, wa.id)
    assert.deepEqual(
      ea.players.map(p => [p.name, p.kos, p.sent, p.downs]),
      [
        ['ann', 1, 3, 0],
        ['bob', 0, 0, 1],
      ],
    )
    a.close()
    b.close()
  } finally {
    server.close()
  }
})

test('a host answers a shout on the network, and turns a different version away', async () => {
  const server = await serve({
    port: 0,
    name: 'host',
    minutes: 1,
    token: 'secret',
    discoveryPort: DISCOVERY_PORT + 1,
  })
  try {
    const found = await discover({ targets: ['127.0.0.1'], discoveryPort: DISCOVERY_PORT + 1, ms: 300 })
    assert.deepEqual(found, [{ address: '127.0.0.1', port: server.port, name: 'host', players: 0 }])

    const c = await connect('127.0.0.1', server.port)
    const C = ears(c)
    const closed = new Promise<void>(resolve => c.onClose(resolve))
    c.send({ t: 'hello', name: 'old', version: VERSION + 1 })
    assert.match((await C.next('refuse')).reason, /version/)
    await closed
  } finally {
    server.close()
  }
})
