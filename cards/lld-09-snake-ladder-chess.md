---
topic: LLD 09 · Snake & Ladder / Chess
group: LLD
---

## Snake & Ladder: separate `Snake` and `Ladder` classes, or one class? Justify it. {#lld09-jump-class}
One `Jump(start, end)`: a snake is a jump with `end < start`, a ladder goes up. The rule is identical: land on `start`, move to `end`.
**Why:** classes earn their place by behaving differently; two classes with identical behaviour add nothing. `Board.jumps` is `dict[start → Jump]`, so landing is an O(1) lookup.
**Example:** a snake that only bites if you lack a shield would earn its own class.

## Snake & Ladder: where does a player's position live (on `Player`, a `Cell` object, or `Game`), and why? {#lld09-positions}
In `Game`, as `dict[player_name → cell]`; a cell is just an `int` and `Player` is only an identity.
**Why:** position is game state, not identity, so resetting a game is one dict and the same `Player` can join two games. A cell has no behaviour, so it needs no class.
**Example:** the same friend playing two Ludo boards at once: one person, two positions.

## Snake & Ladder: name three per-jump checks the `Board` constructor must run. {#lld09-board-validation}
Start strictly between the first and last cell, end on the board, and no two jumps from the same start.
**Why:** checking in the constructor means an invalid board can never exist, so `Game` never has to defend against one.
**Example:** a snake starting on 100 means nobody can ever win.
**Trap:** forgetting `start == end`, which is a jump that goes nowhere.

## Snake & Ladder: chained jumps are legal but a loop is not. How does the constructor detect a loop? {#lld09-cycle-detect}
From each jump's start, keep following `end` to the next jump while one exists, with a `seen` set; reaching a cell already seen means a cycle, so reject the board.
**Why:** `final_position` follows chains (a ladder may end on another jump's start), so a loop would spin forever at play time.
**Example:** 3→10 and 10→3: from 3 you reach 10, then 3 again, which is already seen.

## Snake & Ladder: a player on 97 rolls a 5. What happens to the piece and to the turn? {#lld09-turn-rules}
The piece stays on 97 (you must land on 100 exactly), and the turn still passes to the next player.
**Why:** the turn advance lives in one place at the end of `play_turn`, so every outcome, including "no move", hands over the dice.
**Example:** 97 + 5 = 102 > 100, so no move.
**Trap:** returning early on overshoot and skipping the turn advance, so the same player rolls again.

## Snake & Ladder: a ladder from 80 ends on 100. Does the player win, and what ordering in the code makes that true? {#lld09-win-after-jump}
Yes: the win check runs after the jump is applied, on the final position.
**Why:** checking before the jump would see 80 and miss the win; checking after also catches a chain that ends on 100.
**Example:** at 76 roll 4 → 80 → ladder → 100 → winner.

## Snake & Ladder: dice are random. How do you write a test that forces a snake bite on turn 2? {#lld09-dice-strategy}
`Game` takes a `Dice` interface; tests inject `FixedDice([5, 1, 6])`, whose `roll()` returns scripted values, and production passes `RandomDice`.
**Why:** `Game` only calls `dice.roll()`, so the randomness is swappable; two dice or a crooked die also need no change to `Game`.
**Example:** teaching a kid the rules by saying "pretend you rolled a 4".

## Snake & Ladder: game status is IN_PROGRESS or FINISHED. Why not one class per status? {#lld09-status-enum}
Two modes and one rule (no turns after finish), so an enum plus one guard, `if status is FINISHED: raise GameOverError`, is enough.
**Why:** one class per mode pays off when each mode behaves differently for the same call; here it would be two near-empty classes.
**Example:** a shop's OPEN/CLOSED sign is a flag on the door, not a second shop.

## Snake & Ladder: add "rolling a 6 gives an extra turn". What changes? {#lld09-extra-turn}
One line in `play_turn`: advance `_turn` only if `roll != 6`.
**Why:** the turn advance lives in one place. If rules keep piling up (three sixes cancel, bonus cells), extract a `RuleSet` passed into `Game`.
**Example:** at 30 roll 6 → 36 and roll again; roll 2 → 38 and the next player goes.

## Chess: how are move rules split between `Game` and the pieces? {#lld09-chess-validation}
`Game` runs the checks common to every piece once; each `Piece.can_move(board, frm, to)` holds only its own shape rule.
**Why:** this replaces a giant `if piece == "rook"` block; a new piece is one new class and `Game` is untouched.
**Example:** the common checks: game not over, in bounds, a piece is there, it is your colour, not landing on your own piece.

## Chess: a rook on a1 moving to a8 with a pawn on a4 must fail. Where does that check live, and why there? {#lld09-path-clear}
In `Board.is_path_clear(frm, to)`, written once: step toward the target and fail on any occupied square in between. Sliders (rook, bishop, queen: pieces that glide any distance) call it from `can_move`.
**Why:** the piece is handed the board instead of storing its position, so it can ask about the squares between without duplicating the stepping logic three times.
**Example:** the knight jumps, so it never calls it.

## Chess: support undo without copying all 64 squares after every move. How? {#lld09-command-move}
Make each move an object with `execute()` and `undo()` that remembers what it overwrote (the captured piece), push it on a history stack (last in, first out); undo is pop and `undo()` (Command).
**Why:** each move stores only what it changed, so undo costs O(1) memory per move instead of a full board copy.
**Example:** Ctrl+Z in an editor.

## Chess: undoing a capture. What must `Move.undo` and `Game.undo` restore? {#lld09-undo-capture}
`Move.undo` puts the mover back on `frm` and `captured` (or `None`) back on `to`; `Game.undo` also flips the turn back and, if that move took a king, reopens the game.
**Why:** `execute` saved `board.get(to)` into `captured` before overwriting, so the square can be refilled exactly.
**Example:** rook e1 takes knight e5; undo puts the rook on e1 and the knight on e5.
**Trap:** forgetting to restore status and winner.

## Chess: how do you add castling so that undo still works? {#lld09-chess-extensions}
A `has_moved` flag on `Piece` plus a `CastleMove` command whose `execute` and `undo` move both king and rook.
**Why:** `Game` only sees "a Move", so history and undo work unchanged.
**Example:** king e1 → g1 and rook h1 → f1 in one `execute`; one `undo` puts both back.
**Trap:** undo must also reset `has_moved`, or the king can never castle again.

## Chess: the design ends the game when a king is captured. How do you add "you may not move into check"? {#lld09-check-detect}
Execute the move, ask whether any enemy piece can now reach your king, and if so undo it and reject. Checkmate = in check with no move that passes this test.
**Why:** execute-test-undo reuses `can_move` and the undo you already have, instead of a separate "attacked squares" engine.
**Example:** moving a pinned bishop exposes your king to a rook, so the move is executed, tested, undone and rejected.

## Chess: why is the pawn the trickiest piece to code? {#lld09-pawn}
It is the only piece whose move depends on whether it captures: forward only onto an empty square (two steps only from its start row), diagonal only onto an enemy.
**Why:** so `can_move` must inspect the target square, not just the shape of the move.
**Example:** white pawn on e2: e3 and e4 are fine if empty; d3 only if a black piece is there.

## Give the Snake & Ladder and Chess design as four beats. {#lld09-pitch}
1. Snake & Ladder: a `Board` of `Jump(start, end)` validated at construction (no cycles); `Game` holds positions and turns.
2. Dice is an injected interface (random, or fixed for tests); exact landing on 100, overshoot stays put.
3. Chess: each `Piece.can_move` owns its shape rule and `Board.is_path_clear` serves the sliders.
4. Each move is an object with `execute`/`undo` on a history stack; no locks in one process, one lock per game if online.

Grade Got it only if you said all four beats.
