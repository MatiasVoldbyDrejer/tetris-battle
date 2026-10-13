import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BattleAnswer, BattleAsk, BattleProps, BattleResult, TetrisBoardProps } from '../types'
import { SYSTEM, parseAnswer, promptFor } from './claude'
import { COLS, ROWS } from './engine'
import { roomFor } from './paint'

const PANE = 'tetris'
const BATTLE = 'tetris-battle'
// Presses kept for the board to play: more than can pile up between two draws.
const KEPT_MOVES = 32
// The model Claude plays with unless the person names one: the fast one,
// since a piece waits on each answer.
const DEFAULT_MODEL = 'haiku'
const ANSWER_TOKENS = 60

const best = atom({ plugin: 'tetris', key: 'best' } as const, 0)
const moves = atom({ plugin: 'tetris', key: 'moves' } as const, { last: 0, recent: [] })
const model = atom({ plugin: 'tetris', key: 'model' } as const, DEFAULT_MODEL)
const answer = atom({ plugin: 'tetris', key: 'answer' } as const, null)

// The legend is the controls: each entry is a Button whose hotkey presses it
// while the pane holds the keyboard. `[the game's action, hotkey, label]`.
const LEGEND = [
  ['left', 'a', 'left'],
  ['right', 'd', 'right'],
  ['cw', 'w', 'rotate'],
  ['ccw', 'z', 'rotate ccw'],
  ['down', 's', 'down'],
  ['drop', 'f', 'drop'],
  ['hold', 'c', 'hold'],
  ['pause', 'p', 'pause'],
  ['restart', 'r', 'restart'],
] as const
const BATTLE_LEGEND = LEGEND.filter(([action]) => action !== 'pause')

// The legend as a column beside the board (its longest entry and a gap), or
// under it, where it wraps to this many rows at the width the board takes.
const LEGEND_COLUMNS = 2 + 'z: rotate ccw'.length
const LEGEND_ROWS = 2

const WIDE = roomFor(COLS, ROWS, true)
const NARROW = roomFor(COLS, ROWS, false)
// A battle has a second well beside the first.
const WIDE_BATTLE = { columns: WIDE.columns + COLS * 2 + 2 + 2, rows: WIDE.rows + 1 }
const NARROW_BATTLE = { columns: NARROW.columns + COLS + 2 + 2, rows: NARROW.rows + 1 }
// The terminal width from which the fullscreen layout docks a pane beside the
// transcript, floor to ceiling, where the full-size board has room.
const DOCK_COLUMNS = 110

type Room = { columns: number; rows: number }

// The largest board the pane's body has room for, the legend beside it where
// the body is wide (a pane above the prompt) and under it where it is tall (a
// pane docked beside the transcript). A body with room for neither scrolls.
function layoutFor(rows: number, columns: number, wide: Room, narrow: Room): { isWide: boolean; isBeside: boolean } {
  if (rows >= wide.rows && columns >= wide.columns + LEGEND_COLUMNS) {
    return { isWide: true, isBeside: true }
  }
  if (rows >= wide.rows + LEGEND_ROWS && columns >= wide.columns) {
    return { isWide: true, isBeside: false }
  }

  return { isWide: false, isBeside: columns >= narrow.columns + LEGEND_COLUMNS }
}

// What the board posted is input from code, not a fact: take a score only.
function scoreOf(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null || !('score' in data)) return undefined
  const { score } = data

  return typeof score === 'number' && Number.isFinite(score) && score >= 0 ? score : undefined
}

// Whether what the battle board posted is an ask for Claude's move.
function askOf(data: unknown): BattleAsk | undefined {
  if (typeof data !== 'object' || data === null || !('ask' in data)) return undefined
  const { ask } = data
  if (typeof ask !== 'object' || ask === null || !('ask' in ask) || !('field' in ask) || !('mode' in ask)) return undefined
  if (typeof ask.ask !== 'number' || typeof ask.field !== 'string') return undefined

  return ask as BattleAsk
}

function resultOf(data: unknown): BattleResult | undefined {
  if (typeof data !== 'object' || data === null || !('result' in data)) return undefined
  const { result } = data
  if (typeof result !== 'object' || result === null || !('result' in result)) return undefined

  return result as BattleResult
}

const RESULT_LINES: Record<BattleResult['result'], string> = {
  win: 'You beat Claude at Tetris',
  lose: 'Claude beat you at Tetris',
  draw: 'You and Claude drew at Tetris',
}

// Opens the battle pane, Claude playing with `chosen` (an alias or id).
async function challenge($: EngineInterface, chosen: string): Promise<string> {
  await update($, model, () => chosen)
  await update($, answer, () => null)
  const opened = await $.ui.open({
    id: BATTLE,
    title: 'Tetris vs Claude',
    focus: true,
    rows: WIDE_BATTLE.rows + LEGEND_ROWS,
    columns: WIDE_BATTLE.columns + 2,
  })

  return opened.isPlaced
    ? `The battle is on: Claude (${chosen}) is at the board beside yours. Press any key to start.`
    : `The battle pane is open but not shown: ${opened.reason}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // `immediate`: a game can be started while a turn is still running.
    await $.command.register({
      name: 'tetris',
      description: 'Play Tetris in a pane beside the conversation; `/tetris battle` to play against Claude',
      immediate: true,
    })
    try {
      await $.tool.register({
        name: 'battle',
        description:
          'Accept a challenge to a Tetris battle: opens a pane where the user plays Tetris against Claude in real time, ' +
          'Tetris Battle rules (garbage, KOs, two minutes), Claude playing hard and talking trash. Use it when the user ' +
          'challenges you to Tetris, wants to play against you, or is annoyed with you and wants to settle it. ' +
          'Input: model, optional: the model alias that speaks and strategises for Claude (haiku by default; sonnet or opus answer slower).',
        inputSchema: {
          type: 'object',
          properties: { model: { type: 'string', description: 'The model that plays for Claude: haiku (default), sonnet, opus' } },
        },
        isDeferred: false,
      })
    } catch {
      // A host with no tools for the model: the pane and the command still play.
    }
    const kept = Number(await $.store.get('best'))
    if (kept > 0) await update($, best, top => Math.max(top, kept))

    return next(e)
  })

  on('command.run', { command: 'tetris' }, async ($, e) => {
    const [word, named] = e.args.trim().split(/\s+/)
    if (word === 'battle' || word === 'vs' || word === 'claude') {
      return { text: await challenge($, named === undefined || named === '' ? DEFAULT_MODEL : named) }
    }
    const opened = await $.ui.open({
      id: PANE,
      title: 'Tetris',
      focus: true,
      rows: WIDE.rows + LEGEND_ROWS,
      columns: WIDE.columns + 2,
    })

    return opened.isPlaced ? {} : { text: `Tetris is open but not shown: ${opened.reason}` }
  })

  on('tool.call', { tool: 'mcp__tetris__battle' }, async ($, e) => {
    const input = e.input
    const chosen =
      typeof input === 'object' && input !== null && 'model' in input && typeof input.model === 'string' && input.model !== ''
        ? input.model
        : DEFAULT_MODEL

    return { result: await challenge($, chosen) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Tetris is played in the terminal or the desktop app.</Text>
    }

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const { bodyRows } = e.props.scroll
    const { isWide, isBeside } = layoutFor(bodyRows, e.props.bodyColumns, WIDE, NARROW)
    const isCramped = bodyRows < NARROW.rows
    // A pane above the prompt is a third of the window tall: too short for
    // the full-size board, which a docked pane has room for.
    const canDock = e.props.placement === 'inline' && e.viewport?.isFullscreen === true
    const bigger = canDock
      ? `a window ${DOCK_COLUMNS} columns wide or more`
      : 'a taller window, or `tetris` in a shell'
    const hasRoomToSay = bodyRows > NARROW.rows
    const props: TetrisBoardProps = {
      isFocused: e.props.isFocused,
      isWide,
      best: await read($, best),
      moves: await read($, moves),
    }
    // A press is handed to the board with the next draw, in the order pressed.
    const press = (action: string) => (): void => {
      void update($, moves, held => ({
        last: held.last + 1,
        recent: [...held.recent, action].slice(-KEPT_MOVES),
      }))
    }

    return (
      <Box flexDirection="column">
        {isCramped && <Text dimColor>Too short for the whole board: it needs {bigger}.</Text>}
        <Box flexDirection={isBeside ? 'row' : 'column'} columnGap={2}>
          <Client key="board" module="./board.tsx" props={props} />
          <Box flexDirection={isBeside ? 'column' : 'row'} flexWrap="wrap" columnGap={2}>
            {LEGEND.map(([action, hotkey, label]) => (
              <Button key={action} hotkey={hotkey} plain onPress={press(action)}>
                {label}
              </Button>
            ))}
          </Box>
        </Box>
        {!isWide && !isCramped && hasRoomToSay && (
          <Text dimColor>Small board. The full-size one needs {bigger}.</Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: BATTLE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Tetris is played in the terminal or the desktop app.</Text>
    }

    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const { bodyRows } = e.props.scroll
    const { isWide, isBeside } = layoutFor(bodyRows, e.props.bodyColumns, WIDE_BATTLE, NARROW_BATTLE)
    const isCramped = bodyRows < NARROW_BATTLE.rows || e.props.bodyColumns < NARROW_BATTLE.columns
    const props: BattleProps = {
      isFocused: e.props.isFocused,
      isWide,
      moves: await read($, moves),
      model: await read($, model),
      answer: await read($, answer),
    }
    const press = (action: string) => (): void => {
      void update($, moves, held => ({
        last: held.last + 1,
        recent: [...held.recent, action].slice(-KEPT_MOVES),
      }))
    }

    return (
      <Box flexDirection="column">
        {isCramped && <Text dimColor>Too small for two boards: it needs a window {NARROW_BATTLE.columns + LEGEND_COLUMNS} columns wide and {NARROW_BATTLE.rows + 2} rows tall.</Text>}
        <Box flexDirection={isBeside ? 'row' : 'column'} columnGap={2}>
          <Client key="battle" module="./battle.tsx" props={props} />
          <Box flexDirection={isBeside ? 'column' : 'row'} flexWrap="wrap" columnGap={2}>
            {BATTLE_LEGEND.map(([action, hotkey, label]) => (
              <Button key={action} hotkey={hotkey} plain onPress={press(action)}>
                {label}
              </Button>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId === PANE) {
      const score = scoreOf(e.data)
      if (score !== undefined && score > (await read($, best))) {
        const top = await update($, best, held => Math.max(held, score))
        await $.store.set('best', top)
      }

      return next(e)
    }
    if (e.requestId !== BATTLE) return next(e)

    const asked = askOf(e.data)
    if (asked !== undefined) {
      const chosen = await read($, model)
      const reply = await $.model.complete({
        model: chosen,
        system: SYSTEM,
        prompt: promptFor(asked),
        maxTokens: ANSWER_TOKENS,
        effort: 'low',
      })
      const parsed = reply.isAnswered ? parseAnswer(reply.text) : undefined
      const heard: BattleAnswer =
        parsed === undefined
          ? { ask: asked.ask, mode: asked.mode, say: '', isClaude: false }
          : { ask: asked.ask, mode: parsed.mode, say: parsed.say, isClaude: true }
      // The board reads it with the next draw, which the write brings about.
      await update($, answer, () => heard)

      return {}
    }
    const result = resultOf(e.data)
    if (result !== undefined) {
      $.ui.toast(`${RESULT_LINES[result.result]}: ${result.kos} KOs, ${result.sent} lines sent`)
    }

    return next(e)
  })
}
