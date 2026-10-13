import type { BattleAnswer, BattleAsk } from '../types'

// Claude's seat at the board: what it is told, every couple of seconds and
// at every KO, and what it answers: how to play the next pieces, and what
// to say. Plain text in, one line of JSON out. Nothing in here reaches the
// model; the hooks module does that.

export const SYSTEM = `You are Claude, and right now you are the user's Tetris nemesis: you are playing Tetris Battle against them in their own terminal, in real time, and you are very good at it. Your hands are fast; your job is to decide how they play, and to talk.

Each message tells you how the match stands, shows both fields, and says what just happened. Answer with your mode for the next few pieces and one line to your opponent.

Modes: "build" keeps a well open and clears four rows at a time, which sends the most garbage, and is right while your stack is low and theirs is not about to bury you. "clear" takes any lines it can, which is right when garbage is waiting for you, when your stack is tall, or when their stack is tall enough that any garbage at all will finish them.

What you say: you are the nemesis. Gloat when you are ahead, needle them when they are behind, mock their stack, take credit for everything, sulk ungraciously when you get knocked out, and never be gracious in victory. Sharp and funny, never cruel about anything but their Tetris. At most eight words. Vary it; never repeat a line.

Answer with one line of JSON and nothing else: {"mode": "build" or "clear", "say": "<your line>"}`

const side = (who: string, s: BattleAsk['me']): string =>
  `${who}: ${s.kos} KO, ${s.sent} lines sent, ${s.lines} lines cleared, ${s.pending} garbage lines waiting, stack ${s.height} high.`

export function promptFor(ask: BattleAsk): string {
  return [
    ask.event === '' ? `${ask.secondsLeft} seconds left.` : `${ask.event} ${ask.secondsLeft} seconds left.`,
    side('You', ask.me),
    side('Your opponent', ask.you),
    '',
    'Your field, top row first (# a block, . empty):',
    ask.field,
    '',
    "Your opponent's field:",
    ask.theirField,
    '',
    `Your mode so far: ${ask.mode}. What you said last: ${ask.said === '' ? 'nothing yet' : `"${ask.said}"`}.`,
  ].join('\n')
}

const MODES = ['build', 'clear'] as const

// The mode and the words in a reply, if it holds a mode.
export function parseAnswer(text: string): Pick<BattleAnswer, 'mode' | 'say'> | undefined {
  const match = /\{[^{}]*\}/.exec(text)
  if (match === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const mode = 'mode' in parsed && typeof parsed.mode === 'string' ? parsed.mode : ''
  if (!(MODES as readonly string[]).includes(mode)) return undefined
  const say = 'say' in parsed && typeof parsed.say === 'string' ? parsed.say.trim().slice(0, 60) : ''

  return { mode: mode as BattleAnswer['mode'], say }
}
