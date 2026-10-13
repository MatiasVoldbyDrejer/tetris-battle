import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createGame, receive } from '../hooks/engine.ts'
import { big, bigWidth } from './font.ts'
import { headline, strip, well } from './frame.ts'
import { beside, centred, over, render, text } from './terminal.ts'
import type { Line } from './terminal.ts'

const shape = (line: Line): string => line.map(cell => cell?.ch ?? ' ').join('')

test('big letters are three rows of half blocks, a column apart, nothing where there is no ink', () => {
  const rows = big('TO', '#ffffff')

  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(shape), ['▀█▀ ▄▀▄', ' █  █ █', ' ▀   ▀ '])
  assert.equal(bigWidth('TO'), 7)
  assert.equal(rows[0]?.[3], undefined)
  assert.equal(bigWidth('A B'), 3 + 1 + 2 + 1 + 3)
})

test('a layer drawn over a block shows through where it has no cell', () => {
  const base = [text('abcdef'), text('ghijkl')]
  const layer = [[undefined, { ch: 'X', style: {} }, undefined]]
  const drawn = over(base, 2, 1, layer)

  assert.equal(shape(drawn[0] ?? []), 'abcdef')
  assert.equal(shape(drawn[1] ?? []), 'ghiXkl')
})

test('cells styled alike are one escape sequence, and nothing is written after the last cell', () => {
  process.env.COLORTERM = 'truecolor'
  const line = [...text('ab', { color: '#ff0000' }), ...text('c', { color: '#ff0000', bold: true }), undefined, undefined]

  assert.equal(render(line), '\x1b[38;2;255;0;0mab\x1b[0m\x1b[1;38;2;255;0;0mc\x1b[0m')
  assert.equal(render([undefined, ...text('x')]), ' x')
})

test('blocks side by side are padded to the widest line, and centred ones to the widest block', () => {
  const pair = beside([[text('a'), text('bbb')], [text('c')]], 1)

  assert.deepEqual(pair.map(shape), ['a   c', 'bbb  '])
  assert.deepEqual(centred([[text('abcde')], [text('x')]]).map(shape), ['abcde', '  x'])
})

test('the well shows garbage waiting as red up its left wall, and shouts the clear it made', () => {
  const game = createGame(1)
  receive(game, 3, 0)
  const grid = Array.from({ length: 20 }, () => new Array<number>(10).fill(0))
  const rows = well(grid, true, game.pending.length)

  assert.equal(rows.length, 21)
  assert.equal(rows[16]?.[0]?.ch, '│')
  assert.equal(rows[17]?.[0]?.ch, '┃')
  assert.equal(rows[19]?.[0]?.style.color, '#f87171')

  assert.equal(headline(game), undefined)
  assert.equal(strip(game).length, 4)
  game.banner = 'B2B T-Spin Double'
  game.bannerMs = 500
  game.combo = 3
  assert.deepEqual(headline(game), { word: 'T SPIN', color: '#c084fc', rest: 'B2B · Double · Combo ×3' })
  const said = strip(game)
  assert.equal(said.length, 4)
  assert.ok(said.every(line => line.length <= 23))
  game.banner = 'Perfect Clear!'
  game.combo = 0
  assert.equal(headline(game)?.word, 'CLEAR')
  game.banner = 'Tetris!'
  assert.equal(headline(game)?.rest, '')
  assert.ok(strip(game).every(line => line.length <= 23))
})
