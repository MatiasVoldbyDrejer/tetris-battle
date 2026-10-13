import { expect, test } from 'claude-code/testing'

import { COLS, FLASH, GARBAGE, KINDS, ROWS, TRAIL, act, createGame, gravityMs, lockDelayMs, receive, tick, view } from '../hooks/engine'
import type { Game } from '../hooks/engine'

// A game under way: the first input of a new game only starts it.
function playing(seed = 1): Game {
  const game = createGame(seed)
  act(game, 'down')

  return game
}

const isEmpty = (game: Game): boolean => game.board.flat().every(cell => cell === 0)

// Soft-drops the piece until it rests on what is under it.
function land(game: Game): void {
  while (act(game, 'down')) {
    // to the floor
  }
}

test('a bag deals every kind once, the same way for the same seed', () => {
  const game = createGame(7)
  const dealt = [game.piece.kind, ...game.queue.slice(0, 6)]

  expect([...dealt].sort()).toEqual([...KINDS].sort())
  expect(createGame(7).queue).toEqual(game.queue)
})

test('nothing moves until the first input, which only starts the game', () => {
  const game = createGame(1)
  const { x, y } = game.piece

  expect(tick(game, 5000)).toBe(false)
  expect(act(game, 'left')).toBe(true)
  expect(game.status).toBe('playing')
  expect(game.piece).toMatchObject({ x, y })
})

test('a piece falls a row each gravity interval', () => {
  const game = playing()
  const { y } = game.piece

  expect(tick(game, gravityMs(1) - 1)).toBe(false)
  expect(tick(game, 1)).toBe(true)
  expect(game.piece.y).toBe(y + 1)
  expect(gravityMs(5)).toBeLessThan(gravityMs(1))
})

test('a piece on the floor locks after the lock delay, not before', () => {
  const game = playing()
  land(game)

  expect(tick(game, lockDelayMs(1) - 1)).toBe(false)
  expect(isEmpty(game)).toBe(true)
  expect(tick(game, 1)).toBe(true)
  expect(isEmpty(game)).toBe(false)
})

test('the lock delay is a beat of the fall, and half a second at the least', () => {
  expect(lockDelayMs(1)).toBe(gravityMs(1))
  expect(lockDelayMs(2)).toBe(gravityMs(2))
  expect(lockDelayMs(5)).toBe(500)
  expect(lockDelayMs(20)).toBe(500)
})

test('a piece resting on the floor still slides and turns, and each buys it time', () => {
  for (const action of ['left', 'right', 'cw', 'ccw'] as const) {
    const game = playing()
    game.piece = { ...game.piece, kind: 'T' }
    land(game)
    const before = { ...game.piece }
    tick(game, lockDelayMs(1) - 1)

    expect(act(game, action)).toBe(true)
    expect(game.piece).not.toEqual(before)
    // The whole delay again, less the instant that would lock it.
    tick(game, lockDelayMs(1) - 1)
    expect(isEmpty(game)).toBe(true)
  }
})

test('a piece slides along the top of a stack as it does along the floor', () => {
  const game = playing()
  for (const row of game.board.slice(-3)) row.fill(1, 0, COLS - 1)
  game.piece = { ...game.piece, kind: 'O' }
  land(game)
  const { x, y } = game.piece

  expect(act(game, 'left')).toBe(true)
  expect(game.piece).toMatchObject({ x: x - 1, y })
  expect(act(game, 'right')).toBe(true)
  expect(act(game, 'right')).toBe(true)
  expect(game.piece).toMatchObject({ x: x + 1, y })
})

test('turning a resting piece does not keep it in the air for ever', () => {
  const game = playing()
  game.piece = { ...game.piece, kind: 'T' }
  land(game)
  // One turn in four lifts a T off the floor. Turned again the instant it is
  // back down, it never rests long enough to lock by resting alone.
  const isInTheAir = (): boolean => view(game).flat().some(cell => cell < 0)
  let turns = 0
  let lifts = 0
  while (isEmpty(game) && turns < 2000) {
    act(game, 'cw')
    turns += 1
    if (!isInTheAir()) continue
    lifts += 1
    tick(game, gravityMs(1))
  }

  expect(lifts).toBeGreaterThan(1)
  expect(isEmpty(game)).toBe(false)
})

// One block in the corner, so a clear is not a perfect one.
function stray(game: Game): void {
  const above = game.board[game.board.length - 2]
  if (above !== undefined) above[0] = 1
}

const blocks = (game: Game): number => game.board.flat().filter(cell => cell !== 0).length

test('a hard drop that completes a row clears it and scores', () => {
  const game = playing()
  const floor = game.board[game.board.length - 1] ?? []
  floor.fill(1)
  for (const x of [3, 4, 5, 6]) floor[x] = 0
  stray(game)
  game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
  act(game, 'drop')

  expect(game.lines).toBe(1)
  expect(game.banner).toBe('Single')
  // Twenty rows dropped at two points each, and a single at level one.
  expect(game.score).toBe(140)
  expect(blocks(game)).toBe(1)
})

test('four rows at once is a Tetris', () => {
  const game = playing()
  for (const row of game.board.slice(-4)) {
    row.fill(1)
    row[0] = 0
  }
  const fifth = game.board[game.board.length - 5]
  if (fifth !== undefined) fifth[9] = 1
  // Upright in the leftmost column: the I's cells sit two right of its box.
  game.piece = { kind: 'I', rot: 1, x: -2, y: 0 }
  act(game, 'drop')

  expect(game.lines).toBe(4)
  expect(game.banner).toBe('Tetris!')
  expect(game.score).toBe(800 + 2 * 18)
  expect(blocks(game)).toBe(1)
})

test('a turn against the wall kicks the piece off it', () => {
  const game = playing()
  game.piece = { kind: 'I', rot: 1, x: -2, y: 5 }

  expect(act(game, 'cw')).toBe(true)
  expect(game.piece).toMatchObject({ rot: 2, x: 0 })
})

test('hold swaps the piece once per drop', () => {
  const game = playing()
  const first = game.piece.kind
  const second = game.queue[0]

  expect(act(game, 'hold')).toBe(true)
  expect(game.hold).toBe(first)
  expect(game.piece.kind).toBe(second)
  expect(act(game, 'hold')).toBe(false)
  act(game, 'drop')
  expect(act(game, 'hold')).toBe(true)
  expect(game.piece.kind).toBe(first)
})

test('a pause stops the clock and any input resumes without moving', () => {
  const game = playing()
  const { x, y } = game.piece

  expect(act(game, 'restart')).toBe(false)
  expect(act(game, 'pause')).toBe(true)
  expect(tick(game, 5000)).toBe(false)
  expect(act(game, 'left')).toBe(true)
  expect(game.status).toBe('playing')
  expect(game.piece).toMatchObject({ x, y })
})

test('a stack that reaches the top ends the game, and restart deals a new one', () => {
  const game = playing()
  let drops = 0
  while (game.status === 'playing' && drops < 200) {
    act(game, 'drop')
    drops += 1
  }

  expect(game.status).toBe('over')
  expect(game.score).toBeGreaterThan(0)
  expect(act(game, 'left')).toBe(false)
  expect(act(game, 'restart')).toBe(true)
  expect(game).toMatchObject({ status: 'playing', score: 0, lines: 0 })
  expect(isEmpty(game)).toBe(true)
})

test('the view shows the piece and, under it, where it would land', () => {
  const cells = view(playing()).flat()

  expect(view(playing())).toHaveLength(ROWS)
  expect(cells).toHaveLength(ROWS * COLS)
  expect(cells.filter(cell => cell > 0)).toHaveLength(4)
  expect(cells.filter(cell => cell < 0)).toHaveLength(4)
})

// Fills the row `fromBottom` (1 is the floor) but for the columns given.
function fill(game: Game, fromBottom: number, holes: readonly number[] = []): void {
  const row = game.board[game.board.length - fromBottom]
  if (row === undefined) return
  row.fill(1)
  for (const x of holes) row[x] = 0
}

function put(game: Game, fromBottom: number, x: number): void {
  const row = game.board[game.board.length - fromBottom]
  if (row !== undefined) row[x] = 1
}

// A slot for a T under an overhang: the floor open at one column, the row
// above it at three, and a block over the left of them.
function slot(game: Game): void {
  fill(game, 1, [4])
  fill(game, 2, [3, 4, 5])
  put(game, 3, 3)
}

test('a T turned into a slot and locked there has spun: a T-spin double sends four lines', () => {
  const game = playing()
  slot(game)
  // Upright in the slot with its nub to the right, a turn lays it flat, pointing down.
  game.piece = { kind: 'T', rot: 1, x: 3, y: 19 }

  expect(act(game, 'cw')).toBe(true)
  expect(game.piece).toMatchObject({ rot: 2, x: 3, y: 19 })
  act(game, 'drop')
  expect(game.lines).toBe(2)
  expect(game.banner).toBe('T-Spin Double')
  expect(game.score).toBe(1200)
  expect(game.sent).toBe(4)
  expect(blocks(game)).toBe(1)
})

test('a T spun with a corner it points at open is a mini, worth little', () => {
  const game = playing()
  slot(game)
  // Its nub to the left, a turn lays it flat pointing up, under the overhang.
  game.piece = { kind: 'T', rot: 3, x: 3, y: 19 }

  expect(act(game, 'cw')).toBe(true)
  expect(game.piece).toMatchObject({ rot: 0, x: 3, y: 19 })
  act(game, 'drop')
  expect(game.lines).toBe(1)
  expect(game.banner).toBe('T-Spin Mini Single')
  expect(game.score).toBe(200)
  expect(game.sent).toBe(0)
})

test('a T slid after its turn has not spun', () => {
  // On the floor by the wall with a block over its left corner: three corners
  // filled, the one it points at on the right open.
  const turned = (): Game => {
    const game = playing()
    fill(game, 1, [1])
    put(game, 3, 0)
    game.piece = { kind: 'T', rot: 3, x: 0, y: 19 }
    expect(act(game, 'cw')).toBe(true)

    return game
  }
  const spun = turned()
  act(spun, 'drop')
  expect(spun.banner).toBe('T-Spin Mini')
  expect(spun.score).toBe(100)

  const slid = turned()
  expect(act(slid, 'right')).toBe(true)
  expect(act(slid, 'left')).toBe(true)
  act(slid, 'drop')
  expect(slid.banner).toBe('')
  expect(slid.score).toBe(0)
})

test('a tetris straight after a tetris is back to back, and the second lock of a combo', () => {
  const game = playing()
  for (let fromBottom = 1; fromBottom <= 8; fromBottom++) fill(game, fromBottom, [0])
  put(game, 9, 9)
  game.piece = { kind: 'I', rot: 1, x: -2, y: 0 }
  act(game, 'drop')

  expect(game.sent).toBe(4)
  game.piece = { kind: 'I', rot: 1, x: -2, y: 0 }
  act(game, 'drop')
  expect(game.banner).toBe('B2B Tetris!')
  expect(game.combo).toBe(2)
  expect(game.sent).toBe(9)
  expect(game.score).toBe(36 + 800 + 36 + 1250)
  expect(blocks(game)).toBe(1)
})

test('a combo grows with each lock that clears a line, and a lock that does not ends it', () => {
  const game = playing()
  for (let fromBottom = 1; fromBottom <= 3; fromBottom++) fill(game, fromBottom, [3, 4, 5, 6])
  put(game, 4, 0)
  const sent: number[] = []
  for (let drops = 0; drops < 3; drops++) {
    game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
    act(game, 'drop')
    sent.push(game.sent)
  }

  expect(game.combo).toBe(3)
  expect(sent).toEqual([0, 0, 1])
  game.piece = { kind: 'O', rot: 0, x: 8, y: 0 }
  act(game, 'drop')
  expect(game.combo).toBe(0)
})

test('garbage rises under a lock that clears nothing, one column open, eight lines at most at a time', () => {
  const game = playing()
  receive(game, 10, 4)

  expect(game.pending).toHaveLength(10)
  game.piece = { kind: 'O', rot: 0, x: 0, y: 0 }
  act(game, 'drop')
  const risen = game.board.slice(-8)
  expect(risen).toHaveLength(8)
  for (const row of risen) {
    expect(row[4]).toBe(0)
    expect(row.filter(cell => cell === GARBAGE)).toHaveLength(COLS - 1)
  }
  expect(game.pending).toHaveLength(2)
  // The O, which was on the floor, rode up on top of it.
  expect(game.board[game.board.length - 9]?.slice(0, 2)).toEqual([2, 2])
})

test('lines sent first cancel garbage waiting, and a perfect clear sends ten', () => {
  const game = playing()
  receive(game, 2, 0)
  fill(game, 1, [3, 4, 5, 6])
  game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
  act(game, 'drop')

  expect(game.banner).toBe('Perfect Clear!')
  expect(game.pending).toHaveLength(0)
  expect(game.sent).toBe(8)
  expect(game.score).toBe(40 + 100 + 800)
  expect(isEmpty(game)).toBe(true)
})

test('rows just cleared show white for a moment, then go', () => {
  const game = playing()
  stray(game)
  fill(game, 1, [3, 4, 5, 6])
  game.piece = { kind: 'I', rot: 0, x: 3, y: 0 }
  act(game, 'drop')

  expect(game.lines).toBe(1)
  // The field as drawn still has the row, every cell of it a flash.
  const shown = view(game)
  expect(shown[ROWS - 1]?.every(cell => cell === FLASH)).toBe(true)
  expect(shown[ROWS - 2]?.[0]).toBe(1)
  expect(tick(game, 100)).toBe(true)
  expect(view(game)[ROWS - 1]?.every(cell => cell === FLASH)).toBe(true)
  tick(game, 100)
  expect(game.flash).toBeNull()
  expect(view(game)[ROWS - 1]?.some(cell => cell === FLASH)).toBe(false)
  expect(view(game)[ROWS - 1]?.[0]).toBe(1)
})

test('a hard drop leaves a trail down the columns it fell through, for a moment', () => {
  const game = playing()
  game.piece = { kind: 'O', rot: 0, x: 4, y: 2 }
  act(game, 'drop')

  expect(game.trail?.cells.length).toBe(2 * (ROWS - 2))
  const shown = view(game)
  expect(shown[0]?.[4]).toBe(-(TRAIL + 2))
  expect(shown[10]?.[5]).toBe(-(TRAIL + 2))
  expect(shown[ROWS - 2]?.[4]).toBe(2)
  // The next piece's ghost shows over the trail.
  expect(shown.flat().some(cell => cell < 0 && cell > -TRAIL)).toBe(true)
  tick(game, 200)
  expect(game.trail).toBeNull()
  expect(view(game).flat().some(cell => cell <= -TRAIL)).toBe(false)
})

test('garbage that rose shakes the field for a moment', () => {
  const game = playing()
  receive(game, 3, 0)
  game.piece = { kind: 'O', rot: 0, x: 0, y: 0 }

  expect(game.shakeMs).toBe(0)
  act(game, 'drop')
  expect(game.risen).toBe(3)
  expect(game.shakeMs).toBeGreaterThan(0)
  expect(tick(game, 100)).toBe(true)
  tick(game, 200)
  expect(game.shakeMs).toBe(0)
  expect(game.risen).toBe(0)
})
