---
topic: HLD 11 · Payments / UPI
group: HLD
---

## UPI: a payment to `ravi@okaxis` leaves our app. Which hops does it take, and who runs the middle one? {#hld11-upi-path}
Our app → our PSP bank → NPCI's UPI switch → payer's bank (debit) and payee's bank (credit). NPCI (National Payments Corporation of India) runs the switch.
**Why:** because UPI (Unified Payments Interface) is a bank-to-bank network: the money sits in banks, so every payment must pass through the central switch that connects them.
**Example:** like a train ticket booked on an app: the app talks to IRCTC, and IRCTC talks to the railway; the app never moves trains itself.
**Trap:** our app never sees the UPI PIN; it is typed into NPCI's secure library and checked by the payer's bank.

## UPI: what is a PSP bank, and why can't our app skip it? {#hld11-psp}
A PSP (Payment Service Provider) bank is the licensed partner bank our app connects through, because NPCI connects banks, not apps.
**Why:** because only regulated banks may join the UPI switch, every UPI app (PhonePe, GPay) rides on one or more PSP banks.
**Example:** a travel agent books flights only through an accredited airline portal; the agent is our app, the portal is the PSP bank.

## Payments: why is a wallet payment "just a DB update" while a UPI payment is not? {#hld11-wallet}
Wallet money (a PPI, prepaid payment instrument) sits in our own DB, so a transfer is our own debit and credit. UPI money sits in banks, so we ask and wait.
**Why:** because we own the wallet data, a wallet payment can finish synchronously in our DB; UPI needs a PENDING state, webhooks and reconciliation.
**Example:** moving cash between two drawers of your own desk, versus asking two different banks to move it for you.

## Payment system: correctness or availability, and why? {#hld11-correctness}
Correctness: never double-debit, never lose a rupee, every paisa traceable. Wallet balances need ACID (all-or-nothing, isolated) transactions.
**Why:** because a failed payment is cheap (the user retries), while a double charge or lost money means RBI (India's central bank) trouble and lost trust.
**Example:** a shop's card machine saying "declined, try again" is mildly annoying; one that charges you twice makes you never return.
**Trap:** do not pitch NoSQL "for scale" and lose multi-row transactions.

## UPI app: 4B payments/month, 5× peak factor. Average and peak tx/s? {#hld11-capacity}
~1.5K tx/s average, ~8K tx/s peak.
**Why:** because a month's volume spread over its seconds gives the average, and payday/festival spikes multiply it.
**Example:** 4B ÷ 30 ≈ 133M/day ÷ 86,400 s ≈ 1,550/s; × 5 ≈ 7,700/s peak.

## UPI app: 8K payments/s peak, ~3 DB write transactions per payment, ~5K txn/s per Postgres primary. How many shards? {#hld11-shards}
8 shards: 8K × 3 = 24K txn/s ÷ 5K ≈ 5, rounded up to 8 for headroom.
**Why:** because each payment writes its row three times (CREATED, PENDING, final), the DB load is 3× the payment rate.
**Example:** 8 shards × 5K = 40K txn/s of capacity against 24K needed, so a festival spike ~1.6× above the planned peak still fits.

## UPI app: 133M payments/day at ~1 KB each. How fast does storage grow, and what part grows? {#hld11-storage}
~133 GB/day ≈ 48 TB/year, almost all of it payments and ledger rows; balances stay ~30 GB.
**Why:** because history is append-only and kept for audit, while a balance is one row per user that is overwritten.
**Example:** 133M × 1 KB = 133 GB/day × 365 ≈ 48.5 TB/year.

## Payments: how should money be stored in the API and DB, and why? {#hld11-paise}
As integer paise (₹200 = 20000) in a field like `amount_paise`, never floats.
**Why:** because binary floats cannot represent 0.1 exactly, so sums drift by tiny amounts that break "debits = credits".
**Example:** ₹0.10 + ₹0.20 as floats is 0.30000000000000004; as paise it is 10 + 20 = 30, exactly.

## Payments: what states does a payment walk through, and which can change? {#hld11-state-machine}
`CREATED → PENDING → SUCCESS` or `FAILED`. CREATED = request recorded; PENDING = sent to wallet or bank, waiting. Final states never change.
**Why:** because every update is `... WHERE status='PENDING'`, only the first result lands, so a late "failed" message cannot undo a success.
**Example:** a courier parcel goes booked → in transit → delivered; a stray "lost" scan after "delivered" is ignored.

## Payments: the user taps Pay twice, or the response is lost and the app retries. What stops a double charge? {#hld11-idempotency}
A UNIQUE `(payer_id, idempotency_key)` on the payments table, on the payer's shard: the repeat hits the constraint and gets the existing payment's status back.
**Why:** because the DB constraint settles even two identical requests reaching two servers in the same millisecond; that plus client retries gives an exactly-once effect.
**Example:** a restaurant order slip number: hand the same slip in twice and the kitchen cooks once.
**Trap:** a key per HTTP request or per tap makes every retry look like a new payment.

## Payments: why does the client, not the server, generate the idempotency key? {#hld11-client-key}
Only the client knows intent: one key per checkout screen means "this one payment", however many times it is sent.
**Why:** because the server cannot tell "same payment retried" from "a second payment of the same amount".
**Example:** you pay a chaiwala ₹20 twice on purpose for two cups: two checkout screens, two keys, two payments. A network retry of the first reuses its key.

## UPI: our server retries a request to the PSP bank. What stops the bank or NPCI from debiting twice? {#hld11-downstream-dedupe}
We send our own `payment_id` as the UPI transaction ID, so the PSP bank and NPCI see the same ID and treat the retry as a duplicate.
**Why:** because idempotency must hold at every hop; our UNIQUE key only protects our DB, not the bank's.
**Example:** quoting the same booking reference when you call the airline twice, so they don't book you two seats.

## Payments: why Postgres sharded by payer `user_id`? {#hld11-data-model}
So a user's wallet, payments and ledger rows share one shard, and debiting them is a single-shard ACID transaction with UNIQUE constraints and row locks.
**Why:** because Cassandra/DynamoDB lack cheap multi-row transactions, and ~24K txn/s is small enough for 8 Postgres shards.
**Example:** Asha's `wallets` row, her `payments` rows and her ledger entries all live on shard 3, so her debit never leaves shard 3.

## Payments: what is double-entry bookkeeping, and why keep a ledger? {#hld11-ledger}
Every payment writes equal DEBIT and CREDIT rows in an append-only ledger, so total debits always equal total credits and money is never created or lost.
**Why:** because a balance column alone cannot explain why it changed; the ledger is the audit trail, and a nightly job checks each balance equals its ledger sum.
**Example:** Asha pays Ravi ₹200: DEBIT wallet:asha 20000, CREDIT wallet:ravi 20000.

## Wallet: Asha has ₹500 and pays ₹400 from phone and tablet at once. What prevents overspending? {#hld11-concurrent-debit}
One atomic statement: `UPDATE wallets SET balance_paise = balance_paise - 40000 WHERE user_id='asha' AND balance_paise >= 40000`. 1 row = debited, 0 = insufficient.
**Why:** because the row lock makes the second update wait, then it re-checks 10000 ≥ 40000, which fails; read-then-write would let both see ₹500.
**Example:** two ATM withdrawals on one account: the bank checks and subtracts in one step, so only one ₹400 note bundle comes out.
**Trap:** `SELECT ... FOR UPDATE` also works but holds the lock longer.

## Wallet: payer and payee are on the SAME shard. What does the transfer transaction contain? {#hld11-txn}
One BEGIN…COMMIT: conditional debit of payer (0 rows → rollback), credit of payee, 2 ledger rows, payment → SUCCESS `WHERE status='PENDING'`.
**Why:** because it is all-or-nothing, a crash midway leaves no half-transfer. This is the minority case: with 8 shards, most transfers cross shards and need a saga.
**Example:** Asha (shard 3) pays Ravi (shard 3) ₹200: Asha 500→300, Ravi 100→300, DEBIT and CREDIT 20000, one commit.

## Wallet, 8 shards keyed by payer: what fraction of person-to-person transfers cross shards, and what does that force? {#hld11-cross-shard}
About 7 in 8, so the cross-shard saga is the normal path, not the edge case.
**Why:** because the payee is effectively a random user, and lands on the payer's shard only 1 time in 8.
**Example:** 1,000 transfers/s → ~125 same-shard (one ACID txn), ~875 cross-shard (saga).

## Wallet: two opposite transfers (Asha→Ravi and Ravi→Asha) run at once on one shard. What goes wrong, and the fix? {#hld11-txn-deadlock}
Deadlock: each locks its payer's row, then waits for the other's. Fix: update the two wallet rows in a fixed order (smaller user_id first), whoever pays.
**Why:** because when both transactions lock in the same order, one simply waits for the other and no cycle can form.
**Example:** two people at a narrow door; the rule "the one on the left goes first" stops both waiting forever.

## Wallet: Asha (shard A) pays Ravi (shard B). What are the saga's steps? {#hld11-saga}
1. Debit Asha on shard A, payment → `DEBITED`. 2. Credit Ravi on shard B, keyed by `payment_id`, retried until done. 3. Payment → SUCCESS. If step 2 permanently fails, a compensating credit refunds Asha.
**Why:** because a saga (a chain of local transactions, each with an undo step) needs no lock spanning two shards.
**Example:** a bank transfer done as "withdraw at branch A, deposit at branch B", with a written rule to re-deposit at A if B refuses.

## Wallet saga: the worker crashes after debiting Asha and before crediting Ravi. What happens? {#hld11-saga-crash}
The payment sits in `DEBITED`; a recovery worker picks it up and retries the credit with the same `payment_id`, which shard B accepts at most once.
**Why:** because the state is durable on shard A and the credit is idempotent (UNIQUE on `payment_id` on shard B), retrying is always safe; Asha sees "pending" meanwhile.
**Example:** a courier van breaks down mid-route; the depot sees "picked up, not delivered" and sends another van with the same parcel number.

## Wallet: why a saga for cross-shard transfers, not 2PC? {#hld11-saga-2pc}
2PC (two-phase commit: all shards vote, then all commit) blocks with locks held if the coordinator dies; saga steps are short local commits that retry.
**Why:** because a 2PC participant that voted yes must hold its row locks until it hears the outcome, one crash can freeze hot wallets.
**Example:** a group dinner where nobody may leave until the organiser confirms the bill; if the organiser's phone dies, everyone waits.

## UPI: the PSP bank does not answer for 10 s. Did the user get charged, and what status do you show? {#hld11-timeout}
Unknown, so the payment stays PENDING. Never mark it FAILED (the user retries and pays twice) or SUCCESS.
**Why:** because the debit may have happened and only the reply was lost.
**Example:** an ATM that freezes mid-withdrawal: you don't know if your account was debited until the bank tells you.

## UPI: a payment is stuck PENDING. Which three mechanisms resolve it, in order? {#hld11-resolve}
1. Webhook (the bank calls our URL with the result). 2. Status polling with the same `payment_id`. 3. Nightly reconciliation against the bank's file. Grade Got it only if you said all three.
**Why:** because each is slower but more certain than the one before, and every later layer catches what the earlier one missed.
**Example:** you wait for the courier's SMS, then check the tracking page, and finally the monthly statement settles any doubt.

## UPI: a payment is PENDING. How often may you ask the bank for its status? {#hld11-polling}
Rarely: wait ~90 s before the first status check and make only a few (NPCI caps them). Leftovers go to a dead-letter queue (a parking list for ops).
**Why:** because mass status-check storms have taken UPI down. Our volume is tiny anyway: ~0.1% unknown of 133M/day ≈ 1.5/s.
**Example:** asking "is my food ready?" every 2 s slows the kitchen for everyone.

## UPI: what does nightly reconciliation compare, and why run it? {#hld11-recon}
The bank's settlement file (every transaction it processed, with amount and RRN, the bank's reference number) against our `payments` and ledger.
**Why:** because webhooks and polls can both be lost, the bank's own record is the final safety net.
**Example:** a shopkeeper tallies the day's UPI sound-box alerts against the bank statement at night.

## UPI reconciliation: what do you do in each of the 3 mismatch cases? {#hld11-recon-outcomes}
1. Ours PENDING, bank SUCCESS → mark SUCCESS. 2. Ours PENDING/FAILED, bank absent or FAILED → mark FAILED, refund any wallet debit by reversing entry. 3. Ours SUCCESS, bank absent, or amounts differ → flag to ops. Grade Got it only if all three.
**Why:** because the bank's file is the truth for money it moved, but a success it never saw is a possible bug that a human must check.
**Example:** case 1: the webhook got lost at 23:58; the file shows SUCCESS, so the user's "pending" flips to paid.

## UPI: a failed payment's debit hasn't been reversed. How long can it stay pending? {#hld11-t1}
RBI rule: a failed UPI transfer must be reversed by T+1 (the next working day), or the bank pays the user ₹100 per day of delay.
**Why:** because the penalty makes banks reverse fast, so our UI can honestly say "pending, auto-reversed if it fails"; usually it settles in minutes.
**Example:** fails Monday, so the deadline is Tuesday; reversed only on Thursday is 2 days late, so the bank owes ₹200.

## Wallet: a big merchant receives 1,000 payments/s. How do you avoid a hot balance row? {#hld11-hot-wallet}
Don't update the merchant's balance per payment: insert CREDIT ledger rows (inserts don't contend) and roll them into the balance every few seconds.
**Why:** because every per-payment update would queue on one row lock; merchants don't need a to-the-paisa live balance.
**Example:** a toll plaza counts cars per booth and adds the totals each hour, instead of every booth queuing at one shared counter.

## UPI: the PSP bank is down. What happens to new payments? {#hld11-psp-down}
A circuit breaker (stops calling a failing service and fails fast) rejects new UPI payments with "bank unavailable", or routes them to a second PSP bank.
**Why:** because waiting on timeouts would tie up threads and pile up PENDING payments; wallet payments don't touch the bank and keep working.
**Example:** when one ATM shows "out of service", you walk to the next one instead of standing at it.

## UPI: the bank's webhook arrives twice, or before our own PENDING write. What happens? {#hld11-webhook-dup}
The handler does `UPDATE payments SET status=... WHERE id=? AND status='PENDING'`: the first webhook wins, repeats update 0 rows and are no-ops.
**Why:** because final states never change, a conditional update makes the handler idempotent without a separate dedupe table.
**Example:** a doorbell pressed twice by the same courier: you open the door once and ignore the second ring.

## Payments: after a payment commits, how do you reliably send the "Paid ₹200" event to Kafka? {#hld11-outbox}
Transactional outbox: insert an `outbox` row in the SAME DB transaction as the payment; a relay publishes outbox rows to Kafka, retrying until acked.
**Why:** because "commit then publish" loses the event if the app crashes in between, and "publish then commit" announces payments that rolled back.
**Example:** a shop writes the delivery slip in the same bill book as the sale, and the courier picks up from the book.

## Payments: a ₹200 payment must be refunded. How is that recorded? {#hld11-refund}
A new reversing entry (credit back what was debited); ledger rows are never edited or deleted.
**Why:** because the ledger is the permanent audit trail, so every change must itself be a visible entry.
**Example:** Asha's refund adds CREDIT wallet:asha 20000 and DEBIT wallet:ravi 20000; the original pair stays.

## Give the 30-second pitch for the payment system as 4 beats. {#hld11-pitch}
1. Scale is modest (~8K tx/s peak), so correctness is the game. 2. Client idempotency key + UNIQUE index; CREATED → PENDING → SUCCESS/FAILED. 3. Postgres sharded by payer: same-shard transfer = one ACID txn, cross-shard (~7 in 8) = saga. 4. UPI timeout stays PENDING until webhook, poll or reconciliation. Grade Got it only if all 4.
**Why:** because this order goes from the number that rules out exotic stores to the tricks that make money safe.
**Example:** 8K tx/s × 3 writes = 24K txn/s, which 8 Postgres shards handle, so no NoSQL is needed and transactions stay available.
