import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const

// A docked pane with room for the two-cells-per-block layout.
const PANE = {
  title: 'Tetris',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const mount = ($: Engine, surface: (typeof SURFACES)[number], props: typeof PANE | object = PANE) =>
  $.ui.mount({
    plugin: 'tetris',
    surface,
    component: 'Pane',
    requestId: 'tetris',
    props: { ...PANE, ...props },
    viewport: { columns: 140, rows: 40, isFullscreen: true },
  })

test('/tetris opens the pane with the keyboard and the best score kept', async ($, on) => {
  const opened: unknown[] = []
  mock.store(on, { best: 4200 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__tetris__${e.name}` } }))
  on('ui.open', (_, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const typed = {
    command: 'tetris',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 140 },
  } as const
  expect(await $.command.run(typed)).toEqual({})
  expect(opened).toEqual([expect.objectContaining({ id: 'tetris', focus: true })])

  const ui = await mount($, 'terminal')
  expect(await ui.find({ in: 'board', text: '4,200' })).toBeDefined()
  await ui.unmount()
})

test('a game plays in the pane on every surface that draws it', async $ => {
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ in: 'board', text: 'press a letter key' })).toBeDefined()

    await ui.key({ key: 'left' })
    expect(await ui.find({ in: 'board', text: 'T E T R I S' })).toBeUndefined()

    // Level one drops a row a second.
    const before = JSON.stringify(await ui.drawn({ in: 'board' }))
    await ui.advance(1100)
    expect(JSON.stringify(await ui.drawn({ in: 'board' }))).not.toBe(before)

    await ui.press({ key: 'pause' })
    expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeDefined()
    await ui.press({ key: 'left' })
    expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the game waits while the keys are back at the prompt', async $ => {
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'down' })
  await ui.redraw({ ...PANE, isFocused: false })

  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeDefined()
  expect(await ui.find({ in: 'board', text: 'click the board to play' })).toBeDefined()
  await ui.unmount()
})

test('a click on the board takes the keys from the pane without a pause', async $ => {
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'down' })
  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  await ui.redraw({ ...PANE, isFocused: false })

  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
  expect(await ui.find({ in: 'board', text: /esc: prompt/ })).toBeDefined()
  await ui.unmount()
})

test('keys reaching the board before the pane says it lost them do not pause it', async $ => {
  const ui = await mount($, 'terminal')
  await ui.key({ key: 'left' })
  await ui.redraw({ ...PANE, isFocused: false })

  expect(await ui.find({ in: 'board', text: 'T E T R I S' })).toBeUndefined()
  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
  await ui.unmount()
})

test('a game nobody is playing waits, and the next key resumes it', async $ => {
  const ui = await mount($, 'terminal', { isFocused: false })
  expect(await ui.find({ in: 'board', text: 'click to play' })).toBeDefined()

  await ui.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  expect(await ui.find({ in: 'board', text: 'T E T R I S' })).toBeUndefined()
  expect(await ui.find({ in: 'board', text: /esc: prompt/ })).toBeDefined()
  // Level one: a piece takes twenty seconds to fall, and two may go untouched.
  await ui.key({ key: 'right' })
  await ui.advance(39_000)
  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
  await ui.advance(1500)
  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeDefined()

  await ui.key({ key: 'right' })
  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
  await ui.unmount()
})

test('a game played with the letter keys is never paused for want of a key', async $ => {
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'down' })
  await ui.advance(45_000)

  expect(await ui.find({ in: 'board', text: 'PAUSED' })).toBeUndefined()
  await ui.unmount()
})

test('a piece resting on the floor slides, by the letter keys and by the arrows', async $ => {
  const drawn = async (ui: Awaited<ReturnType<typeof mount>>) =>
    JSON.stringify(await ui.drawn({ in: 'board' }))

  const letters = await mount($, 'terminal')
  for (let presses = 0; presses < 22; presses++) await letters.press({ key: 'down' })
  const rested = await drawn(letters)
  await letters.press({ key: 'left' })
  expect(await drawn(letters)).not.toBe(rested)
  // Back where it was: the same piece slid, nothing locked.
  await letters.press({ key: 'right' })
  expect(await drawn(letters)).toBe(rested)
  await letters.unmount()

  const arrows = await mount($, 'terminal', { isFocused: false })
  await arrows.pointer({ type: 'down', x: 5, y: 5, button: 'left' })
  for (let presses = 0; presses < 21; presses++) await arrows.key({ key: 'down' })
  const landed = await drawn(arrows)
  await arrows.key({ key: 'right' })
  expect(await drawn(arrows)).not.toBe(landed)
  await arrows.key({ key: 'left' })
  expect(await drawn(arrows)).toBe(landed)
  await arrows.unmount()
})

test('every legend press reaches the game, in order, however fast', async $ => {
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'down' })
  const score = async () =>
    Number((await ui.find({ in: 'board', text: /^Score\s+[\d,]+$/ }))?.text.replace(/\D/g, ''))
  expect(await score()).toBe(0)

  // Three soft drops score a point each; pressed without waiting on a draw.
  await Promise.all([ui.press({ key: 'down' }), ui.press({ key: 'down' }), ui.press({ key: 'down' })])
  expect(await score()).toBe(3)
  await ui.unmount()
})

test('a finished game saves a new best score and r deals another', async ($, on) => {
  const saved: { key: string; value: unknown }[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    saved.push(e)

    return { value: undefined }
  })

  const ui = await mount($, 'terminal')
  const isOver = async () => (await ui.find({ in: 'board', text: 'GAME OVER' })) !== undefined
  for (let drops = 0; drops < 80 && !(await isOver()); drops++) await ui.key({ key: ' ' })

  expect(await isOver()).toBe(true)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ key: 'best' })
  expect(Number(saved[0]?.value)).toBeGreaterThan(0)

  await ui.press({ key: 'restart' })
  expect(await isOver()).toBe(false)
  await ui.unmount()
})

// The Box that holds the legend's Buttons: the innermost one around them.
const legendOf = async (ui: Awaited<ReturnType<typeof mount>>) =>
  (await ui.findAll({ type: 'Box', text: /^leftright/ })).at(-1)

// The well's floor: as wide as the field, two columns to a cell or one.
const FULL_SIZE = /^╰─{20}╯$/
const SMALL = /^╰─{10}╯$/

test('the layout follows the room the pane has', async $ => {
  // Docked beside the transcript: tall and narrow, the legend under the board.
  const docked = await mount($, 'terminal', { bodyColumns: 52 })
  expect(await docked.find({ in: 'board', text: FULL_SIZE })).toBeDefined()
  expect(await legendOf(docked)).toMatchObject({ props: { flexDirection: 'row' } })
  expect(await docked.find({ text: /Too short|Small board/ })).toBeUndefined()
  await docked.unmount()

  // Above the prompt: short and wide, the small board and the legend beside.
  const inline = await mount($, 'terminal', {
    placement: 'inline',
    bodyColumns: 96,
    scroll: { offset: 0, bodyRows: 11 },
  })
  expect(await inline.find({ in: 'board', text: SMALL })).toBeDefined()
  expect(await legendOf(inline)).toMatchObject({ props: { flexDirection: 'column' } })
  expect(await inline.findAll({ type: 'Button' })).toHaveLength(9)
  expect(await inline.find({ text: /Too short|Small board/ })).toBeUndefined()
  await inline.unmount()

  // With a row to spare it says what the full-size board needs.
  const roomy = await mount($, 'terminal', {
    placement: 'inline',
    bodyColumns: 102,
    scroll: { offset: 0, bodyRows: 16 },
  })
  expect(await roomy.find({ in: 'board', text: SMALL })).toBeDefined()
  expect(await roomy.find({ type: 'Text', text: /Small board.*110 columns/ })).toBeDefined()
  await roomy.unmount()

  // A window with no room for the well says so and still draws the game.
  const cramped = await mount($, 'terminal', {
    placement: 'inline',
    bodyColumns: 76,
    scroll: { offset: 0, bodyRows: 6 },
  })
  expect(await cramped.find({ type: 'Text', text: /Too short.*110 columns/ })).toBeDefined()
  expect(await cramped.find({ in: 'board', text: 'TETRIS' })).toBeDefined()
  await cramped.unmount()
})

test('every cell of the field is a painted background, in either layout', async $ => {
  for (const scroll of [PANE.scroll, { offset: 0, bodyRows: 11 }]) {
    const ui = await mount($, 'terminal', { scroll })
    const runs = await ui.findAll({ in: 'board', type: 'Text', text: /^[ ▀▄]+$/ })
    const painted = runs.filter(run => 'backgroundColor' in run.props)

    // The well's rows and the previews, and no glyph but the half blocks of
    // a tile's bevel and of the small layout, each over a painted background.
    expect(painted.length).toBeGreaterThan(10)
    expect(runs.filter(run => /[▀▄]/.test(String(run.text)) && !('backgroundColor' in run.props))).toEqual([])
    expect(await ui.find({ in: 'board', text: /[░·█]/ })).toBeUndefined()
    await ui.unmount()
  }
})
