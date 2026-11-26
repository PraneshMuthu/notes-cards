---
topic: LLD 09 · Snake & Ladder / Chess
group: LLD
---

## Snake & Ladder: why one `Jump` class, not `Snake` and `Ladder`? {#lld09-jump-class}
`Jump(start, end)`. A snake is a jump where `end < start`; a ladder goes up. The rule is identical: land on `start`, move to `end`.
**Why:** separate classes with identical behaviour add nothing. They would be justified only if they behaved differently.
**Example:** a snake that only bites if you lack a shield would earn its own class.

## Why is a cell just an `int`, and where do positions live? {#lld09-positions}
A cell has no behaviour, so no `Cell` class. Positions live in `Game` as `dict[player_name -> cell]`. `Player` is only an identity.
**Why:** position is game state, not identity. Resetting a game is one dict, and the same `Player` can join two games.
**Lookup:** `Board.jumps` is `dict[start -> Jump]`, so landing is an O(1) lookup.

## What makes a Snake & Ladder board invalid? {#lld09-board-validation}
A snake on the last cell (you could never win), two jumps from the same start, a jump off the board, `start == end`, and a **cycle**. Chains are legal; cycles are not.
**Example:** ladder 5->20 plus snake 20->5 loops forever.
**Why:** validate in the `Board` constructor (fail at build time), so an invalid board can never exist.

## How do you detect a cycle in chained jumps? {#lld09-cycle-detect}
For each jump start, follow `end` while it is itself a jump start, keeping a `seen` set. Revisiting a cell means a cycle, so reject the board.
**Why:** after this check, `final_position` can safely follow chains in a `while` loop.
**Example:** 3->10, 10->3: from 3 you reach 10, then 3 again, which is already seen.

## Snake & Ladder: what are the turn rules for overshoot and winning? {#lld09-turn-rules}
You must land on the last cell exactly. If `pos + roll > size`, you stay put, and the turn still passes. The win check comes **after** applying the jump, so a ladder ending on 100 wins.
**Trap:** forgetting that an overshoot still advances to the next player.
**Example:** at 97 rolling 5 is 102, so you stay at 97.

## Which pattern is `Dice`, and why does it matter for testing? {#lld09-dice-strategy}
**Strategy**: `Dice` with `RandomDice` and `FixedDice`. `Game` only calls `dice.roll()`.
**Why:** `FixedDice([5, 1, 6])` makes games deterministic, so tests can force a snake bite. It also allows two dice or a "crooked" die with no change to `Game`.
**Example:** teaching a kid by saying "pretend you rolled a 4".

## Why is game status just an enum, not the State pattern? {#lld09-status-enum}
Only two states (`IN_PROGRESS`, `FINISHED`) and one rule (no turns after finish).
**Why:** a full State pattern means near-empty classes. That is over-engineering. State is for behaviour that differs per mode.

## Snake & Ladder: add "roll a 6 gets an extra turn". What changes? {#lld09-extra-turn}
One line in `play_turn`: only advance `_turn` if `roll != 6`. If rules keep piling up (three sixes cancel, bonus cells), extract a `RuleSet` strategy passed into `Game`.
**Concurrency:** none needed for one process. For online play, add a per-game `threading.Lock` around `play_turn()` so two quick clicks cannot read the same `_turn`.

## Chess: how are move rules split between `Game` and the pieces? {#lld09-chess-validation}
Two layers. `Game._validate` does the generic checks once: game not over, in bounds, a piece is there, it is your colour, you are not landing on your own piece. Each `Piece.can_move(board, frm, to)` holds its own shape rule.
**Why:** this replaces a giant `if piece == "rook"` block. A new piece is one new class, and `Game` is untouched.

## Why does `can_move` take the board, and where does path blocking live? {#lld09-path-clear}
Sliders need the squares in between, and a pawn needs to see an enemy on the diagonal. The piece asks the board and does not store its position. `Board.is_path_clear` is written once: step toward the target and fail on any occupied square between.
**Example:** Rook, Bishop and Queen call it. Knight jumps, so it does not.

## What is the Command pattern, and how does `Move` use it? {#lld09-command-move}
**Command**: wrap an action in an object with `execute()` and `undo()` that remembers what it needs to reverse. `Move` stores the captured piece, and `Game.history` is a stack of moves.
**Why:** undo is pop + `undo()`. Otherwise you would snapshot all 64 squares after every move.
**Example:** Ctrl+Z in an editor.

## How does undo restore a captured piece? {#lld09-undo-capture}
`execute` saves `board.get(to)` into `captured` before overwriting. `undo` puts the mover back on `frm` and `captured` (or `None`) back on `to`. `Game.undo` also flips the turn back and reopens the game if that move took a king.
**Trap:** forgetting to restore status and winner.

## Chess scope: how do you add castling, and check/checkmate? {#lld09-chess-extensions}
Out of scope today (game ends when a king is captured). **Castling:** a `has_moved` flag on `Piece` plus a `CastleMove` command that moves king and rook; `Game` only sees "a Move", so undo still works. **Check:** after `execute`, test whether the enemy can reach my king, then `undo` if so. Checkmate = in check with no legal move.
