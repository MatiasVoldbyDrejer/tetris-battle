import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseAnswer, promptFor } from '../hooks/claude'
import { createGame, go } from '../hooks/engine'
import { keysFor, placements, planFor, ranked } from '../hooks/plan'
import { act } from '../hooks/engine'

// A docked pane with room for two full-size wells and the panel.
const PANE = {
  title: 'Tetris vs Claude',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const ASK = {
  ask: 1,
  event: 'You just knocked them out.',
  field: '..........\n'.repeat(19) + '####.#####',
  theirField: '..........\n'.repeat(20).trim(),
  me: { kos: 1, sent: 4, lines: 2, pending: 0, height: 1 },
  you: { kos: 0, sent: 0, lines: 0, pending: 3, height: 9 },
  secondsLeft: 77,
  mode: 'build' as const,
  said: '',
}

const mount = ($: Engine, props: Partial<typeof PANE> = {}) =>
  $.ui.mount({
    plugin: 'tetris',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tetris-battle',
    props: { ...PANE, ...props },
    viewport: { columns: 140, rows: 40, isFullscreen: true },
  })

test('the prompt tells Claude how the match stands, and its answer is read for a mode and a line', () => {
  const prompt = promptFor(ASK)
  expect(prompt).toContain('You just knocked them out. 77 seconds left.')
  expect(prompt).toContain('You: 1 KO, 4 lines sent')
  expect(prompt).toContain('Your opponent: 0 KO, 0 lines sent, 0 lines cleared, 3 garbage lines waiting, stack 9 high.')
  expect(prompt).toContain('####.#####')
  expect(prompt).toContain('Your mode so far: build.')

  expect(parseAnswer('{"mode": "clear", "say": "Is that a stack or a landfill?"}')).toEqual({
    mode: 'clear',
    say: 'Is that a stack or a landfill?',
  })
  expect(parseAnswer('Sure! Here it is:\n{"mode":"build","say":""}\n')).toEqual({ mode: 'build', say: '' })
  expect(parseAnswer('{"mode": "panic", "say": "help"}')).toBeUndefined()
  expect(parseAnswer('I would rather not play.')).toBeUndefined()
})

test('the planner finds every place a piece can go, and the builder saves the well for a tetris', () => {
  const game = createGame(1)
  go(game)
  expect(placements(game.board, 'O', 0)).toHaveLength(9)
  expect(placements(game.board, 'I', 0)).toHaveLength(34)

  // Three rows ready but for the last column: the builder does not spend
  // the I there, the clearer does.
  for (const row of game.board.slice(-3)) {
    row.fill(1)
    row[9] = 0
  }
  game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
  const built = planFor(game.board, game.piece, 'T', 'build')
  expect(built?.columns.includes(9)).toBe(false)
  const cleared = planFor(game.board, game.piece, 'T', 'clear')
  expect(cleared?.cleared).toBe(3)

  // A fourth row ready: the builder takes all four.
  const floor = game.board[game.board.length - 4]
  if (floor !== undefined) {
    floor.fill(1)
    floor[9] = 0
  }
  const tetris = planFor(game.board, game.piece, 'T', 'build')
  expect(tetris?.cleared).toBe(4)
  for (const key of keysFor(tetris ?? { rot: 0, x: 0 }, game.piece)) act(game, key)
  expect(game.lines).toBe(4)
  expect(ranked(game.board, 'T', 0, undefined, 'clear').length).toBeGreaterThan(20)
})

test('/tetris battle opens the pane with Claude at the board, and the chat tool does the same', async ($, on) => {
  const opened: unknown[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tetris__${e.name}` } }))
  on('ui.open', (_, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = {
    command: 'tetris',
    args: 'battle sonnet',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 140 },
  } as const
  const answered = await $.command.run(run)
  expect(JSON.stringify(answered)).toContain('Claude (sonnet)')
  expect(opened).toEqual([expect.objectContaining({ id: 'tetris-battle', focus: true })])

  const called = await $.tool.call({ tool: 'mcp__tetris__battle', model: 'haiku' })
  expect(JSON.stringify(called)).toContain('Claude (haiku)')
  expect(opened).toHaveLength(2)
})

test('in a match Claude plays on its own, talks, and the clock ends it', async ($, on) => {
  const prompts: string[] = []
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)

    return {
      value: {
        isAnswered: true,
        text: '{"mode": "clear", "say": "Is that a stack or a landfill?"}',
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  const ui = await mount($)
  expect(await ui.find({ in: 'battle', text: 'YOU vs CLAUDE' })).toBeDefined()
  expect(await ui.find({ in: 'battle', text: /Claude · haiku/ })).toBeDefined()

  // Any key starts the countdown; three seconds later the match is on.
  await ui.key({ key: 'left' })
  await ui.advance(100)
  expect(await ui.find({ in: 'battle', text: 'get ready' })).toBeDefined()
  await ui.advance(3200)
  expect(await ui.find({ in: 'battle', text: 'get ready' })).toBeUndefined()

  // Claude's hands place pieces by themselves and clear lines, the clock
  // runs, and its head is asked and talks.
  await ui.advance(4000)
  expect(await ui.find({ in: 'battle', text: /1:5\d/ })).toBeDefined()
  await ui.advance(20_000)
  expect(await ui.find({ in: 'battle', text: /^0 · [1-9]\d*$/ })).toBeDefined()
  expect(prompts.length).toBeGreaterThan(0)
  expect(prompts[0]).toContain('The match is about to start.')
  expect(await ui.find({ in: 'battle', text: /landfill/ })).toBeDefined()
  expect(await ui.find({ in: 'battle', text: /clearing/ })).toBeDefined()

  // Time runs out: a result, and r plays again.
  await ui.advance(120_000)
  expect(await ui.find({ in: 'battle', text: /YOU WIN|CLAUDE WINS|DRAW/ })).toBeDefined()
  await ui.key({ key: 'r' })
  await ui.advance(100)
  expect(await ui.find({ in: 'battle', text: 'get ready' })).toBeDefined()
  await ui.unmount()
})
