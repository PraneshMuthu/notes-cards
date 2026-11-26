---
topic: LLD 03 · Splitwise
group: LLD
---

## Splitwise: ₹100 split three ways. How do you store money and split it so that no paisa is lost? {#lld03-money-paise}
Store integer paise (1/100 of a rupee), never float, and hand the remainder out one paisa at a time so shares sum exactly to the total.
**Why:** floats cannot represent ₹33.33… exactly, so totals drift; integers plus a fixed remainder rule are exact.
**Example:** 10000 paise ÷ 3 = 3333 rem 1 (`divmod`), so shares are 3334, 3333, 3333. Percentages likewise become integer basis points (1% = 100 bp).

## Splitwise percentage split: 1000 paise at 33.33%, 33.33%, 33.34%. Flooring gives 333 each, 999 in total. Where does the last paisa go? {#lld03-split-remainders}
Floor each share, then give the leftover paise one each to the shares with the largest fractional parts (ties broken by a fixed order).
**Why:** this is the fairest deterministic rounding: each person is off by under one paisa, and the sum is exact.
**Example:** exact shares are 333.3, 333.3 and 333.4. The largest fraction is 0.4, so the third person gets 334: 333 + 333 + 334 = 1000.
**Trap:** exact-amount splits need no rounding at all; just reject them unless `sum == total`.

## Splitwise supports equal, exact and percentage splits, with more coming. How do you model the split calculation, and what is its one method? {#lld03-strategy}
A `SplitStrategy` interface with one method, `calculate_shares(amount, participants) -> dict[user_id, paise]`, and a class per split type.
**Why:** a new split type is a new class with zero edits to `Splitwise` or `Expense`.
**Example:** like a restaurant bill splitter app's "equally / by item / by percent" tabs. Code: `EqualSplit().calculate_shares(10000, [a, b, c])`.

## Splitwise: exact splits need per-person amounts and percentage splits need percentages. Where do those inputs go so every split type keeps the same method? {#lld03-config-in-ctor}
In each strategy's constructor: `ExactSplit({a: 6000, b: 4000})`, `PercentSplit({a: 5000, b: 5000})` in basis points. `calculate_shares(amount, participants)` stays identical for all.
**Why:** passing them through the shared method would force `EqualSplit` to take a parameter it ignores.
**Example:** a pressure cooker set to "3 whistles" before cooking; "start" is the same button for every setting.

## Splitwise: why should the split calculation return shares rather than write them into the balance sheet itself? {#lld03-strategy-pure}
It should be a pure calculator (inputs in, result out); the orchestrator, `Splitwise`, commits shares to the ledger.
**Why:** a calculator that also mutates a ledger has two jobs, and you cannot unit-test it without building a ledger.
**Example:** a calculator shows the bill split; it does not move money in your UPI app.
**Trap:** a `SplitStrategy` that holds a `balance_sheet` and returns nothing.

## Splitwise: how do you guarantee that every split type, including ones written next year, returns shares that sum exactly to the total? {#lld03-template-method}
Template Method: the base class's `calculate_shares` is concrete. It validates, calls an abstract `_compute_shares` hook, then raises if the shares do not sum to the total. Subclasses fill only the hook.
**Why:** the rule lives in one place no subclass can skip, so a new split type cannot silently lose a paisa.
**Example:** an exam hall where any invigilator can run the paper, but the answer sheets are always counted at the door.

## Why must an invariant check (like "shares sum to total") use `raise`, not `assert`? {#lld03-assert-not-guard}
`python -O` strips every `assert`, so the check silently disappears in an optimised run; `raise ValueError(...)` always runs.
**Why:** asserts document assumptions for developers; exceptions enforce rules on real data.
**Example:** a "mind the gap" sign vs a platform barrier door. Code: `if sum(shares.values()) != amount: raise ValueError("shares do not sum")`.

## Splitwise `BalanceSheet`: what convention does it fix, and why route every write through one method? {#lld03-balance-sheet}
`balances[a][b] > 0` means a owes b, and only `record_debt(debtor, creditor, amount)` writes, updating both directions mirrored.
**Why:** without a fixed direction every sign is a guess; one writer keeps the mirror consistent, and a user's balances are one row lookup.
**Example:** Bob owes Alice ₹300: `balances[bob][alice] = 30000` and `balances[alice][bob] = -30000` (paise).

## Splitwise: `add_expense` resolves ids, calls the split, builds an `Expense`, stores it and records debts. Someone calls it a god method (one method doing too much). How do you judge? {#lld03-orchestrator}
It is fine if every line delegates (calls another object) and none computes. Orchestration is a legitimate responsibility; arithmetic belongs elsewhere.
**Why:** the test is "does this line call, or calculate?". Calls belong in the orchestrator; a calculation means logic leaked in.
**Example:** a wedding planner who only calls the caterer, decorator and band is doing their job; one who starts cooking is not.

## Splitwise: why does `Expense` store the computed shares but not the split strategy that produced them? {#lld03-expense-shares}
Shares are the permanent record of who owes what; the strategy is just the tool used once to compute them, then discarded.
**Why:** frozen shares make the expense immutable and auditable, even if split rules change later.
**Example:** a restaurant receipt lists what each person paid, not the calculator app used. Code: `Expense(payer, amount, shares)`.

## Splitwise: Bob pays Alice back ₹300. Why record a `Settlement` instead of just adjusting the balance? {#lld03-settlement}
If the logs are the source of truth, every event that moves money needs a record; a bare balance edit could never be replayed or audited.
**Why:** a settlement is not an expense (no split, no participants), so it needs its own type: `settle_up` calls `record_debt` in the opposite direction and appends a `Settlement`.
**Example:** a bank passbook shows the repayment as its own line, not a silently corrected balance.

## Splitwise: what is the source of truth for balances, and how do you prove the design honours it? {#lld03-source-of-truth}
The expense log plus the settlement log are truth; `BalanceSheet` is a derived cache. Prove it by replaying both logs into an empty sheet and asserting identical balances.
**Why:** a cache that cannot be rebuilt from the log has quietly become a second source of truth.
**Example:** a shop's sales register is truth; the cash in the drawer must match a recount from it.

## Splitwise: a `Group` holds `Expense`s and `User`s. Which is composition and which aggregation, and what is the test? {#lld03-relationships}
Group → Expense is composition (the part dies with the owner). Group → User is aggregation (has-a, but the part outlives the owner). Test: delete the owner; does the part die?
**Why:** deleting a group deletes its expenses, but the users still exist in other groups.
**Example:** a house's rooms vs the family living in it. Demolish the house and the rooms go; the family moves.

## Splitwise extension: let users edit or undo an expense. Which pattern, and what does each expense become? {#lld03-extensions}
Command: each change becomes an object with `execute()` and `undo()`, kept on a history stack.
**Why:** undo needs to know exactly what was done; a command object carries its own reverse (re-record the opposite debts).
**Example:** Ctrl+Z in a text editor. Code: `cmd = AddExpense(e); cmd.execute(); history.append(cmd)`, then `history.pop().undo()`.

## Splitwise extension: "simplify debts" so A→B→C chains become fewer payments. Where does it plug in? {#lld03-ext-simplify}
As a second strategy axis, `SimplifyStrategy`, run over the group's balance graph to produce a minimal set of payments; the ledger stays untouched.
**Why:** simplification is a view over balances, and different algorithms (greedy, none) can be swapped.
**Example:** A owes B ₹100 and B owes C ₹100, simplified to A pays C ₹100.

## Splitwise: where do `add_expense` and `settle_up` live, and what is the rule for placing a method? {#lld03-verb-on-noun}
On `Splitwise` (orchestrates) and `Group` (stores). A method lives on the object that owns the data it changes and can reach every collaborator it needs.
**Why:** an expense cannot add itself to a group, and a user cannot see the ledger.
**Example:** a passenger does not issue their own railway ticket; the booking counter does.
**Trap:** `Expense.add_expense()`, `Group.join_group()`, `User.settle_up()`: verbs on the wrong noun.

## Splitwise: two people add expenses to the same group at the same moment. What can go wrong? {#lld03-concurrency}
A lost update: both read `balances[a][b] = 500`, both add their amount, and the second write overwrites the first.
**Why:** `record_debt` is read-modify-write, so it must run under a lock (or be an atomic increment in the database).
**Example:** two flatmates updating the same paper ledger from memory: the later write erases the earlier one.

## Splitwise: `Expense.group` and `Group.expenses` both exist. When is a back-pointer (a reference from the part back to its owner) worth it? {#lld03-back-pointer}
Only when a real query needs to go from the part to its owner. Otherwise drop it.
**Why:** every back-pointer is an invariant to keep in sync on add, move and delete.
**Example:** a library card that also lists every book's borrower: twice the records, twice the chances to disagree.

## Give the Splitwise design as four beats. {#lld03-pitch}
1. Money is integer paise, and splits sum exactly to the total.
2. Equal, exact and percentage are strategies behind `calculate_shares`, with the exact-sum check in a base method.
3. `Splitwise` is the front-door orchestrator; `BalanceSheet` has one writer, `record_debt`.
4. Expense and settlement logs are the truth; the balance sheet is a rebuildable cache.
Grade Got it only if you said all four beats.
