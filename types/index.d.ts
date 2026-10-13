// What the board posts to the hooks module when a game ends.
export type TetrisResult = { score: number; lines: number; level: number }

// The legend presses the board has yet to play: `last` counts every press of
// the session, `recent` holds the latest of them, the newest at the end.
export type TetrisMoves = { last: number; recent: string[] }

// What the hooks module hands the board each time the pane is drawn.
export type TetrisBoardProps = {
  // Whether the pane holds the keyboard, so the legend's hotkeys are live.
  isFocused: boolean
  // Whether there is room for the layout of two columns to a cell.
  isWide: boolean
  best: number
  moves: TetrisMoves
}

// How one side of a battle stands.
export type BattleSide = { kos: number; sent: number; lines: number; pending: number; height: number }

// What the battle board tells the hooks module every couple of seconds and
// at every KO, for Claude to set its mode and say its piece: numbered so an
// answer is known for its ask.
export type BattleAsk = {
  ask: number
  // What just happened, as a sentence, or nothing.
  event: string
  field: string
  theirField: string
  me: BattleSide
  you: BattleSide
  secondsLeft: number
  mode: 'build' | 'clear'
  said: string
}

// Claude's answer: how its hands play the next pieces, and its words;
// `isClaude` false when the model gave none and the board kept its mode.
export type BattleAnswer = { ask: number; mode: 'build' | 'clear'; say: string; isClaude: boolean }

// What the battle board posts when a match ends.
export type BattleResult = { result: 'win' | 'lose' | 'draw'; kos: number; sent: number }

// What the hooks module hands the battle board each time the pane is drawn.
export type BattleProps = {
  isFocused: boolean
  isWide: boolean
  moves: TetrisMoves
  // The model Claude plays with, as the person named it.
  model: string
  answer: BattleAnswer | null
}

declare module 'claude-code' {
  interface PluginState {
    tetris: { best: number; moves: TetrisMoves; model: string; answer: BattleAnswer | null }
  }
}
