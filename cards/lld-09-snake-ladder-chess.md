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
Any jump starting on the last cell (you could never win), two jumps from the same start, a jump off the board, `start == end`, and a **cycle**. Chains are legal; cycles are not.
**Example:** ladder 5->20 plus snake 20->5 loops forever.
**Why:** validate in the `Board` constructor (fail at build time), so an invalid board can never exist.

## How do chained jumps work, and how do you detect a cycle? {#lld09-cycle-detect}
A ladder may end on another jump's start and the piece keeps moving, so `final_position` follows the chain. To detect a cycle, follow `end` for each start, keeping a `seen` set. Revisiting a cell means a cycle, so reject the board.
**Example:** 3->10, 10->3: from 3 you reach 10, then 3 again, which is already seen.

## Snake & Ladder: what are the turn rules for overshoot and winning? {#lld09-turn-rules}
You must land on the last cell exactly. If `pos + roll > size`, you stay put, and the turn still passes. The win check comes **after** applying the jump, so a ladder ending on 100 wins.
**Trap:** forgetting that an overshoot still advances to the next player.
**Example:** at 97 rolling 5 is 102, so you stay at 97.

## Which pattern is `Dice`, and why does it matter for testing? {#lld09-dice-strategy}
**Strategy** (swap the algorithm behind one interface): `Dice` with `RandomDice` and `FixedDice`. `Game` only calls `dice.roll()`.
**Why:** `FixedDice([5, 1, 6])` makes games deterministic, so tests can force a snake bite. Two dice or a "crooked" die need no change to `Game`.
**Example:** teaching a kid by saying "pretend you rolled a 4".

## Why is game status just an enum, not the State pattern? {#lld09-status-enum}
Only two states (`IN_PROGRESS`, `FINISHED`) and one rule (no turns after finish).
**Why:** the **State pattern** means one class per mode, each behaving differently for the same call. With two modes that is near-empty classes, which is over-engineering.

## Snake & Ladder: add "roll a 6 gets an extra turn". What changes? {#lld09-extra-turn}
One line in `play_turn`: only advance `_turn` if `roll != 6`.
**Why:** if rules keep piling up (three sixes cancel, bonus cells), extract a `RuleSet` strategy passed into `Game`.
**Example:** this is why the turn advance lives in one place.

## Chess: how are move rules split between `Game` and the pieces? {#lld09-chess-validation}
Two layers. `Game._validate` does the generic checks once: game not over, in bounds, a piece is there, it is your colour, you are not landing on your own piece. Each `Piece.can_move(board, frm, to)` holds its own shape rule.
**Why:** this replaces a giant `if piece == "rook"` block. A new piece is one new class, and `Game` is untouched.

## Why does `can_move` take the board, and where does path blocking live? {#lld09-path-clear}
Sliders (Rook, Bishop, Queen: pieces that glide any distance) need the squares in between, and a pawn needs to see an enemy on the diagonal. The piece asks the board and does not store its position. `Board.is_path_clear` is written once: step toward the target and fail on any occupied square between.
**Example:** Knight jumps, so it skips the check.

## What is the Command pattern, and how does `Move` use it? {#lld09-command-move}
**Command**: wrap an action in an object with `execute()` and `undo()` that remembers what it needs to reverse. `Move` stores the captured piece; `Game.history` is a **stack** (last in, first out, like a pile of slips).
**Why:** undo is pop + `undo()`. Otherwise you would snapshot all 64 squares after every move.
**Example:** Ctrl+Z in an editor.

## How does undo restore a captured piece? {#lld09-undo-capture}
`execute` saves `board.get(to)` into `captured` before overwriting. `undo` puts the mover back on `frm` and `captured` (or `None`) back on `to`. `Game.undo` also flips the turn back and reopens the game if that move took a king.
**Trap:** forgetting to restore status and winner.

## Chess scope: how do you add castling, and check/checkmate? {#lld09-chess-extensions}
Out of scope today (game ends when a king is captured). **Castling:** a `has_moved` flag on `Piece` plus a `CastleMove` command that moves king and rook; `Game` only sees "a Move", so undo still works. **Check:** after `execute`, test whether the enemy can reach my king, then `undo` if so. Checkmate = in check with no legal move.

## Chess: why is the Pawn the trickiest piece? {#lld09-pawn}
Forward only onto an empty square; two steps only from its start row with the middle square empty; diagonal only when capturing an opponent.
**Why:** it is the only piece whose move differs between capturing and not capturing, so `can_move` must look at the target square.
**Scope:** castling, en passant and promotion are out, and capturing the king ends the game, a simplification of real checkmate.

## 30-second pitch: Snake & Ladder (and Chess) LLD {#lld09-pitch}
Snake & Ladder: a `Board` of `Jump(start, end)` validated at construction (no cycles), a `Game` holding positions and turns, and a `Dice` Strategy (random or fixed for tests). Exact landing on 100; overshoot stays put. Chess: each `Piece.can_move` owns its shape rule, `Board.is_path_clear` handles sliders, and `Move` is a Command with `execute`/`undo` on a history stack. No locks for one process; lock per game if online.
