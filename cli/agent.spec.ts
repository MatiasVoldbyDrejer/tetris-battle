import assert from 'node:assert/strict'
import { test } from 'node:test'

import { act, createGame, go } from '../hooks/engine.ts'
import { AGENT_NAME, bestPlan, joinAsAgent, keysFor } from './agent.ts'
import { connect } from './net.ts'
import { VERSION, decodeGrid, isServerMessage } from './protocol.ts'
import type { ServerMessage } from './protocol.ts'
import { serve } from './server.ts'

const DISCOVERY_PORT = 40_000 + Math.floor(Math.random() * 20_000)
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('the agent drops the I down the column the stack leaves open, for a tetris', () => {
  const game = createGame(1)
  go(game)
  for (const row of game.board.slice(-4)) {
    row.fill(1)
    row[9] = 0
  }
  game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
  for (const level of ['normal', 'hard'] as const) {
    const plan = bestPlan(game, level)
    assert.ok(plan !== undefined)
    assert.equal(plan.rot % 2, 1)
    const trial = structuredClone(game)
    for (const key of keysFor(plan, trial.piece)) act(trial, key)
    assert.equal(trial.lines, 4, level)
  }
  // The easy one picks one of its best few at random, so not always this.
  const easy = bestPlan(game, 'easy')
  assert.ok(easy !== undefined)
  const trial = structuredClone(game)
  for (const key of keysFor(easy, trial.piece)) act(trial, key)
  assert.equal(trial.status, 'playing')
})

test('the agent fills a flat floor without leaving a hole', () => {
  const game = createGame(3)
  go(game)
  game.piece = { kind: 'O', rot: 0, x: 4, y: 0 }
  const plan = bestPlan(game, 'normal')
  assert.ok(plan !== undefined)
  for (const key of keysFor(plan, game.piece)) act(game, key)
  const floor = game.board[game.board.length - 1] ?? []
  const above = game.board[game.board.length - 2] ?? []
  assert.equal(floor.filter(cell => cell !== 0).length, 2)
  assert.equal(above.filter(cell => cell !== 0).length, 2)
  // Against a wall, or it would leave the floor bumpy both sides.
  assert.ok(floor[0] !== 0 || floor[9] !== 0)
})

test('the agent joins a battle, plays its board, and is in the standings when time is up', async () => {
  const server = await serve({
    port: 0,
    name: 'host',
    minutes: 0.05,
    token: 'secret',
    discoveryPort: DISCOVERY_PORT,
    countMs: 10,
  })
  const heard: ServerMessage[] = []
  const until = async (test: (message: ServerMessage) => boolean, ms: number): Promise<ServerMessage> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const found = [...heard].reverse().find(test)
      if (found !== undefined) return found
      await sleep(20)
    }
    throw new Error('heard nothing of the kind')
  }
  const agent = joinAsAgent(server.port, 'hard')
  const host = await connect('127.0.0.1', server.port)
  host.onMessage(message => {
    if (isServerMessage(message)) heard.push(message)
  })
  try {
    host.send({ t: 'hello', name: 'host', version: VERSION, token: 'secret' })
    const lobby = await until(m => m.t === 'players' && m.players.some(p => p.name === AGENT_NAME), 2000)
    assert.equal(lobby.t, 'players')
    host.send({ t: 'begin' })
    await until(m => m.t === 'start', 2000)
    // Its pieces land on its board.
    await sleep(2000)
    const boards = heard.filter((m): m is Extract<ServerMessage, { t: 'board' }> => m.t === 'board')
    assert.ok(boards.length > 3)
    const latest = boards[boards.length - 1]
    assert.ok(latest !== undefined && decodeGrid(latest.grid).flat().filter(cell => cell > 0).length >= 8)
    const end = await until(m => m.t === 'end', 3000)
    assert.equal(end.t, 'end')
    if (end.t === 'end') assert.ok(end.players.some(p => p.name === AGENT_NAME))
  } finally {
    host.close()
    server.close()
  }
  await agent
})
