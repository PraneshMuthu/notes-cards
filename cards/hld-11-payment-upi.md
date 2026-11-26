---
topic: HLD 11 · Payments / UPI
group: HLD
---

## Define UPI, NPCI, PSP bank and wallet for this design. {#hld11-jargon}
UPI (Unified Payments Interface) is India's real-time bank-to-bank payment network. NPCI (National Payments Corporation of India) runs the UPI switch every payment passes through. A PSP (Payment Service Provider) bank is the partner bank our app calls to reach UPI. A wallet is money we hold for the user (a PPI, prepaid payment instrument), so moving it is just a DB update.
**Example:** pay `ravi@okaxis` from a bank account: our app → PSP bank → NPCI → payer's bank and payee's bank. The UPI PIN is entered in NPCI's secure library and checked by the user's bank; our app never sees it.

## Payments system: do you favour correctness or availability, and why? {#hld11-correctness}
Correctness. Never double-debit, never lose a rupee, every paisa traceable.
**Why:** a failed payment is cheap because the user retries. A double charge or lost money means regulator (RBI, India's central bank) trouble and lost trust. Wallet balance needs ACID (all-or-nothing, isolated transactions) consistency.
**Trap:** do not pitch NoSQL "for scale" and lose multi-row transactions.

## How many payments per second, and how many DB shards? {#hld11-capacity}
~1.5K tx/s average, ~8K peak, and 8 Postgres shards.
**Why:** 4B tx/month ÷ 30 ≈ 133M/day ÷ 86,400 ≈ 1,550/s; × 5 peak factor ≈ 7,700. Each payment is ~3 DB write txns (create, pending, final) = 24K txn/s ÷ ~5K per primary ≈ 5, use 8 for headroom.
**Example:** data is ~1 KB per payment = 133 GB/day ≈ 48 TB/yr. Balances are only ~30 GB, so the ledger is what grows.

## How should money be stored in the API and DB? {#hld11-paise}
As integer paise (₹200 = 20000), never floats.
**Why:** floats round badly (0.1 + 0.2 ≠ 0.3). The amount field is `amount_paise`.

## What is the payment state machine? {#hld11-state-machine}
`CREATED → PENDING → SUCCESS` or `FAILED`. CREATED means we recorded the request, PENDING means sent to wallet or bank and waiting. Final states never change.
**Why:** a late "failed" message cannot undo a success. Updates are `... WHERE status='PENDING'`, so only the first result wins.

## User taps Pay twice, or the response is lost and the app retries. How do you avoid a double charge? {#hld11-idempotency}
The app generates an `Idempotency-Key` once per checkout. Store it with a UNIQUE `(payer_id, idempotency_key)`. A repeat hits the constraint, so we return the existing payment's status.
**Why:** this gives an exactly-once effect = at-least-once retries + an idempotent receiver. Exactly-once delivery over a network is impossible. The UNIQUE index also settles two identical requests on two servers at the same millisecond.
**Trap:** a key per HTTP request or per tap makes retries look new.

## Why is the idempotency key generated on the client, not the server? {#hld11-client-key}
Only the client knows user intent. The server cannot tell "same payment retried" from "new payment of the same amount". One key per checkout screen captures that.
**Example:** we also pass our `payment_id` downstream as the UPI transaction ID, so the PSP bank and NPCI dedupe our retries too.

## How is the data modelled and why Postgres sharded by `user_id`? {#hld11-data-model}
Tables: `payments`, `wallets` (balance cache + version), `ledger_entries` (append-only). Shard by payer `user_id` so a user's wallet, payments and ledger share one shard.
**Why:** a wallet debit becomes a single-shard ACID transaction, with UNIQUE constraints and row locks. Cassandra/DynamoDB lack cheap multi-row transactions and 24K txn/s is small.

## What is double-entry bookkeeping and why a ledger? {#hld11-ledger}
Every payment writes equal DEBIT and CREDIT rows, so total debits always equal total credits and money is never created or destroyed. Ledger rows are append-only; mistakes get a reversing entry.
**Why:** a balance column alone cannot explain why it changed. The ledger is the audit trail and source of truth. A nightly job checks each `wallets.balance` equals its ledger sum.
**Example:** Asha pays Ravi ₹200: DEBIT wallet:asha 20000, CREDIT wallet:ravi 20000.

## Asha has ₹500 and pays ₹400 from phone and tablet at once. What prevents overspending? {#hld11-concurrent-debit}
Make check and write one atomic statement: `UPDATE wallets SET balance_paise = balance_paise - 40000 WHERE user_id='asha' AND balance_paise >= 40000`. Rows affected 1 = debited, 0 = insufficient funds.
**Why:** read-then-write lets both see 500 (lost update). The row lock makes the second wait, then 100 ≥ 400 is false, so it gets 0 rows.
**Trap:** SELECT ... FOR UPDATE also works but holds the lock longer. Optimistic locking (a `version` column) suits rare conflicts.

## What does a full wallet-to-wallet transaction contain? {#hld11-txn}
One DB transaction: conditional debit of the payer (0 rows means rollback), credit of the payee, insert the 2 ledger rows, set the payment to SUCCESS `WHERE status='PENDING'`. Commit.
**Why:** all-or-nothing, so a crash midway rolls back everything.
**Trap:** two opposite transfers (A→B and B→A) can deadlock. Issue the two balance updates in a fixed order, smaller user_id first, whichever is the payer.

## The PSP bank does not answer for 10 s. Did the user get charged? {#hld11-timeout}
Unknown, so the payment stays PENDING. Never mark it FAILED (the user retries and pays twice) or SUCCESS.
**Why:** the debit may have happened and the reply been lost. Resolve in three layers: webhook (the bank calls our URL with the final result), status polling with the same `payment_id`, then nightly reconciliation.

## How do you poll the bank for a stuck payment? {#hld11-polling}
A poller queries the PSP with the same `payment_id` (a query, not a new payment). NPCI limits status checks: wait about 90 s before the first and make only a few per payment. Leftovers go to a dead-letter queue (a parking list for ops to handle by hand).
**Why:** status-check storms caused UPI outages. At ~0.1% unknown (133K/day ≈ 1.5/s) the load is tiny. The exact limits come from the source doc's reading of the NPCI circular; verify before quoting.

## What is reconciliation and what does it do? {#hld11-recon}
Nightly, compare the bank's settlement file (every transaction it processed, with amount and RRN, the bank's reference number) against our `payments` and ledger.
**Why:** it is the final safety net. Three outcomes: we say PENDING, bank says SUCCESS: mark SUCCESS. We say PENDING/FAILED, bank absent or FAILED: mark FAILED and refund by reversing entry. We say SUCCESS but bank absent, or amounts differ: flag to ops.

## How long can a UPI payment stay pending? {#hld11-t1}
Usually minutes. Worst case the user sees "pending, auto-reversed if it fails". RBI's rule: a failed UPI transfer must be reversed by T+1 (next working day), else the bank pays the user ₹100/day.

## Payer and payee are on different DB shards. How do you transfer? {#hld11-saga}
Use a saga (a chain of local steps with undo steps) driven by the state machine: debit Asha on shard A (extra state `DEBITED`), then credit Ravi on shard B using `payment_id` as the idempotency key, retrying until it succeeds. If it permanently fails, a compensating credit refunds Asha.
**Why:** 2PC (two-phase commit, all shards vote then commit) blocks if the coordinator dies; saga steps are idempotent and retryable.

## A big merchant receives 1,000 payments/s. How do you avoid a hot row? {#hld11-hot-wallet}
Do not update the merchant's balance row per payment. Insert CREDIT ledger rows (inserts do not contend) and roll them into the balance every few seconds.
**Why:** otherwise every credit queues on one row lock. Merchants do not need a to-the-paisa live balance.

## The PSP bank is down, or the webhook arrives twice. What happens? {#hld11-psp-failures}
Bank down: a circuit breaker (stops calling a failing service and fails fast) rejects new UPI payments with "bank unavailable" while wallet payments keep working. Many apps route to a second PSP bank. Duplicate or early webhook: the handler does `UPDATE ... WHERE status='PENDING'`, so the first wins and the rest are no-ops.

## Give the 30-second pitch for the payment system. {#hld11-pitch}
Scale is modest (~8K tx/s peak), so correctness is the game. Client idempotency key + UNIQUE index gives an exactly-once effect, and each payment walks CREATED → PENDING → SUCCESS/FAILED.
**Why:** wallet money is in Postgres sharded by user, with one ACID txn doing a conditional debit, credit and 2 ledger rows. UPI goes through the PSP bank; on timeout stay PENDING until webhook, poll or nightly reconciliation.

## How are refunds and reversals recorded? {#hld11-refund}
Never edit or delete ledger rows. A refund is a new reversing entry (credit back what was debited), so the ledger stays a permanent audit trail.
**Why:** failed UPI transfers must be auto-reversed by T+1 (next working day), else the bank pays the user ₹100/day (RBI rule). Reconciliation creates these entries too.
