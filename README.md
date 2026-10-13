# Tetris

Tetris for the terminal, alone or against friends on the network, and as a pane inside Claude
Code. One game, two front ends.

## Play

| Where | How |
| --- | --- |
| A terminal | `npx tetris-battle`, or `tetris` once installed |
| Against friends | one of you: `tetris host`; the others: `tetris join` |
| Against the agent | `tetris host --agent`, then enter; `--agent hard` or `--agent easy` |
| Claude Code | `/tetris`, or `/tetris battle` to play against Claude |

```sh
npm install -g tetris-battle   # the `tetris` command; Node 18 or newer
```

In Claude Code, at the prompt of a terminal session (`y` to add the marketplace, then a scope):

```
/plugin install tetris --marketplace MatiasVoldbyDrejer/tetris-battle
```

## Battles

One player hosts, `tetris host`, and the screen says where (`Hosting at 192.168.1.5`). Everyone
else on the same network runs `tetris join`, which finds the game by itself; on a network that
keeps machines from calling out to each other, `tetris join 192.168.1.5`. The host presses enter
to start, and again after a match for the next one. `--name` says who you are, `--minutes` (the
host's) how long a match is, and `--port` where it is, when the usual port is taken.

`tetris host --agent` puts a computer player in the lobby, so you can start at once and
challenge it alone, or with friends against it. It plays its own game like everyone else: for each
piece it tries every orientation at every column and keeps the field that comes out lowest,
flattest and with the fewest holes. `--agent easy` thinks slower and picks one of its best few at
random; `--agent hard` thinks faster, goes for tetrises, and looks at the next piece too.

The rules are Tetris Battle's. Everyone plays their own game, and clearing lines sends garbage to
an opponent:

| Clear | Lines sent |
| --- | --- |
| Single, Double, Triple, Tetris | 0, 1, 2, 4 |
| T-spin Single, Double, Triple | 2, 4, 6 |
| T-spin Mini Single, Double | 0, 1 |
| Back to back: a tetris or T-spin straight after another | +1 |
| Combo: locks that each clear a line, one after another | +0, +0, +1, +1, +1, +2, +2, +3, +3, +4, +4, +4, +5 … |
| Perfect clear | +10 |

Lines you send first cancel garbage waiting for you. Garbage rises when a piece locks without
clearing a line, eight lines at most at a time, each attack's lines with one column open. Topping
out is a KO for whoever last sent you garbage, and your board starts over, empty. After two
minutes, most KOs wins, then most lines sent. A T-spin is the usual three-corner one: a T whose
last move was a turn, locked with three of the corners around it filled; a mini when a corner it
points at is open.

The screen is Tetris Battle's too: the hold box on the left of your well, the next five pieces
on the right, your KOs and lines sent under the hold box, the clock big across the top, and the
opponents' wells beside yours. Garbage waiting for you climbs the left wall of your well in red.
What you clear is shouted in big letters in a strip under your well, never over the field
(`TETRIS`, `T SPIN` with `B2B · Double · Combo ×4` in small print under it, `CLEAR` for a
perfect clear), the rows you cleared flash before they go, a hard drop leaves a trail, garbage
that rises shakes the screen, and a board that tops out gets a `KO!`.

## Against Claude

`/tetris battle` in Claude Code, or just challenge it in the chat, opens a pane with your well and
Claude's side by side: Tetris Battle rules, two minutes, most KOs wins. Claude is your nemesis
here. Its hands are the game's own hard player, which drops a piece every quarter second and
builds for tetrises, so it will hammer you; its head is the model, asked every couple of seconds
and at every KO, which sees both fields and sets how the next pieces are played (build for a
tetris, or clear whatever clears) and says one line to you, gloating, needling, sulking, never
gracious. `/tetris battle sonnet` or `opus` puts a slower, wittier head on it; `haiku` is the
default, since a line a second is the point. The result goes to the chat as a toast.

When you tell Claude in the chat that you challenge it, or that you have had enough of it for
today, it has a tool to accept with, and the pane opens.

## In Claude Code

The pane opens with the keyboard: the letter keys in its legend play at once. Click the board to
give it the keys directly, which adds the arrow keys and space. Esc hands the keys back to the
prompt; `/tetris` or a click takes them again. It can be started while Claude is working.

From 110 columns the pane docks beside the conversation at full height and draws the full-size
board. In a narrower window it sits above the prompt, a third of the window tall, and draws the
small board, which needs a terminal about 40 rows tall. The terminal command draws the full-size
board in any window of 44x22 or more (the strip from 26 rows, the big clock from 30), and a battle's opponents
beside it where there is room; a smaller window gets the half-height board and a panel.

Every cell is a painted background, which a terminal fills edge to edge, so the full-size board
lines up exactly everywhere. The small board fits two rows of the field in one line with a lower
half block; how evenly that splits the line is up to the terminal's font (Apple's Terminal draws
it a little under half).

## Keys

| | Letters | Terminal, or after a click on the board |
| --- | --- | --- |
| Move | `a` `d` | `←` `→` |
| Rotate | `w`, `z` the other way | `↑` or `x` |
| Soft drop | `s` | `↓` |
| Hard drop | `f` | `space` |
| Hold | `c` | |
| Pause (alone) | `p` | `esc` (terminal) |
| Restart, when paused or over | `r` | |
| Start a match (the host) | | `enter` |
| Quit (terminal) | `q` | `ctrl+c` |

The rules are the usual ones: seven-bag dealing, SRS rotation with wall kicks, a ghost piece, hold,
and a level every ten lines. A piece that lands can still be slid and turned: it locks after a
beat of its own fall (a second at level 1, never under half a second), and each move starts that
wait over, fifteen times at most. Hard drop locks at once.

A game whose pane has lost the keyboard waits. One played with the arrow keys cannot tell when Esc
takes them away, so it waits once two pieces' worth of time (ten seconds at least) pass untouched.

## What is where

| | |
| --- | --- |
| `hooks/engine.ts` | The rules, battles included. No drawing, no clock, no imports. |
| `hooks/paint.ts` | What the game looks like, as runs of styled text. |
| `hooks/board.tsx` | The pane's board: draws the game and takes its keys. |
| `hooks/register.tsx` | The Claude Code mod: `/tetris`, the legend, the best score. |
| `cli/main.ts` | The `tetris` command: which of the three to run. |
| `cli/solo.ts` | Alone. |
| `cli/battle.ts` | A battle: hosting, joining, the match and its screen. |
| `cli/server.ts` | The host: passes garbage on, keeps the standings and the clock. |
| `cli/net.ts`, `cli/protocol.ts` | TCP between the players and the host, UDP to find a host, and what they say. |
| `cli/terminal.ts` | Escape sequences, layout, and keys by name. |
| `bin/tetris.mjs` | Runs the command from its source (Node 22.18+). |
| `tests/` | The rules and the pane: `claude plugin test .` |
| `cli/*.spec.ts` | The host, over real sockets: `node --test "cli/**/*.spec.ts"` |

Best scores are kept apart: the terminal's in `~/.local/state/tetris/best.json`, the pane's in the
mod's own store.

## Developing

Two links run both front ends from the source:

```sh
ln -s "$PWD/bin/tetris.mjs" ~/.local/bin/tetris   # the command
ln -s "$PWD" ~/.claude/skills/tetris              # the mod, loaded by every session
```

`npm test` runs every test, `npm run typecheck` the types of both front ends, and `npm run build`
bundles the command into `dist/tetris.mjs` for any Node from 18, which `npm publish` does by
itself.
