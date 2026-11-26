---
topic: LLD 03 · Splitwise
group: LLD
---

## Why is money stored as integer paise, never float? {#lld03-money-paise}
Floats lose precision (₹100 / 3 = 33.33...). Store paise (the minor unit, 1/100 of a rupee) as `int`, and make shares sum exactly to the total.
**Example:** ₹100 split 3 ways is 3334 + 3333 + 3333 paise. The first k people pay 1 extra paisa, so nothing is lost.
**Also:** percentages become integer basis points (1% = 100 bp).

## What is the Strategy for in Splitwise, and what is its signature? {#lld03-strategy}
`SplitStrategy` computes each person's share. Implementations: Equal, Exact, Percentage. Signature: `calculate_shares(amount, participants) -> dict[user_id, paise]`.
**Why:** a new split type is a new class with zero edits elsewhere.

## Where do per-variant inputs (exact amounts, percentages) go in the strategy? {#lld03-config-in-ctor}
In the strategy's constructor: `ExactSplitStrategy({...})`. The shared `calculate_shares` signature stays identical.
**Why:** passing `share` through the common method would force `Equal` to take a param it ignores. This is the Strategy idiom: config in the constructor, uniform operation.

## Why must a Strategy compute and return, not commit to the balance sheet? {#lld03-strategy-pure}
A strategy is a pure calculator: inputs in, shares out. It never touches the ledger.
**Why:** mutating a collaborator fuses two responsibilities and makes it untestable. The owner's first version held a `balance_sheet` and returned nothing.

## How does Template Method protect the exact-sum rule? {#lld03-template-method}
The base `calculate_shares` is concrete: validate, call the abstract `_compute_shares`, then check shares sum to the total and raise if not. Subclasses fill only the hole.
**Why:** a future strategy cannot silently lose a paisa.
**Trap:** use `raise ValueError`, not `assert`. `assert` is stripped under `python -O`, so a real invariant must raise.

## How do the three split types handle the remainder? {#lld03-split-remainders}
- Equal: `divmod(amount, n)`; the first `rem` participants pay base + 1.
- Percentage: floor each share, then give leftover paise by largest fractional remainder.
- Exact: no math, just validate `sum == amount`, else raise.

## What is the convention for `BalanceSheet`, and why one writer? {#lld03-balance-sheet}
`balances[a][b] > 0` means a owes b. Every write goes through `record_debt(debtor, creditor, amount)`, which updates both directions mirrored.
**Why:** an undefined direction causes every sign bug. Mirroring makes `get_balances(user)` one row lookup, with no scan.
**Example:** Bob owes Alice 300: `balances[bob][alice] = 300` and `balances[alice][bob] = -300`.

## Walk through `Splitwise.add_expense`. Is it a god method? {#lld03-orchestrator}
Five steps, all delegation: resolve ids; `strategy.calculate_shares`; build `Expense`; `group.add_expense`; `record_debt` for each non-payer. No arithmetic in it.
**Why:** orchestration is a legitimate responsibility. A line that calls belongs there. A line that computes belongs elsewhere.

## Why does `Expense` store `shares` but not the strategy? {#lld03-expense-shares}
Once shares are computed, the strategy is discarded. `Splitwise` only holds it as a method parameter (a dependency, not a stored field).
**Why:** frozen shares are the audit trail. The expense is immutable and still says who owes what.

## How does `settle_up` work, and why does it need a `Settlement` class? {#lld03-settlement}
`settle_up(from, to, amount)` records one mirrored `record_debt` in the opposite direction and appends a `Settlement`. It is not an expense: no split, no participants.
**Why:** if the logs are the source of truth, every money-moving event needs a record. You cannot rebuild balances from expenses alone.

## What is the source of truth in Splitwise, and how do you prove it? {#lld03-source-of-truth}
The expense log plus the settlement log are truth. `BalanceSheet` is a derived cache.
**Why:** replaying both logs into an empty `BalanceSheet` must give identical state. The demo harness asserts exactly this.

## Which relationships in Splitwise are composition, and which are not? {#lld03-relationships}
- `Group ◆→ Expense`: composition (an expense dies with its group).
- `Group ◇→ User`: aggregation (members outlive the group).
- `Expense → User`: association (stored reference).
- `Splitwise → SplitStrategy`: dependency (parameter only).
**Why:** the test for composition is whether the part dies when the owner is deleted. Not every field is composition.

## Why a global balance sheet, not one per group? {#lld03-global-sheet}
Debts are person-to-person, settlements can happen outside any group, and debt simplification needs the global graph.

## Extension: add debt simplification, edit/undo of expenses, or balance alerts. {#lld03-extensions}
- Simplification: a second Strategy axis (`SimplifyStrategy`) over the global balance graph.
- Edit/undo: Command pattern. Each expense becomes a command with do/undo.
- Alerts or feed: Observer, fired inside `record_debt`.
- Parsing "EQUAL" from an API: Factory.

## Why does `Expense` not hold a back-pointer to `Group` while `Group` holds expenses? {#lld03-back-pointers}
Keep one direction unless a real query needs the other.
**Why:** every back-pointer is an invariant to maintain. The owner had both `Expense.group` and `Group.expenses` with no query needing both.

## Give the 60-second pitch for Splitwise. {#lld03-pitch}
A ledger with pluggable split math. Equal, exact and percentage are Strategies behind `calculate_shares`; Template Method pins exact-sum in the base. Money is integer paise. `Splitwise` is the facade that orchestrates. The expense and settlement logs are truth, and `BalanceSheet` is a rebuildable cache.
