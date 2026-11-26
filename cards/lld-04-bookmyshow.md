---
topic: LLD 04 · BookMyShow / IRCTC
group: LLD
---

## How do you scope a BookMyShow LLD so you reach the real problem? {#lld04-scope}
Cut to the seat-booking core: the user is already on a show; pick specific seats, hold, pay, confirm. Skip browse, search and login.
**Why:** booking is a scope trap. You can burn 40 minutes on theatre models and never reach the concurrency question, which is the whole point.

## What is the bookable unit, and what is the one invariant? {#lld04-show-invariant}
A `Show` (movie × screen × start time), because seat A1 is free at 6 pm and booked at 9 pm independently. Invariant: a seat is BOOKED by at most one booking, ever.
**Why:** correctness beats throughput. When in doubt, reject.

## What is the seat lifecycle? {#lld04-seat-states}
`AVAILABLE → HELD → BOOKED`. `HELD → AVAILABLE` on TTL (time-to-live) expiry or payment failure. `BOOKED → AVAILABLE` on cancel.
**Why:** a seat held by someone who walked away must not be locked forever.

## Where do the lock and seat state live, and why per-show, not per-seat? {#lld04-lock-per-show}
On `Show`: it holds `{seat_id → (status, hold_token, expires_at)}` and one lock. Every hold, confirm, release and cancel runs inside it.
**Why:** a booking is multi-seat, all-or-nothing. Per-seat locks mean taking many locks in order and risking deadlock. One per-show lock is simpler, and different shows still run in parallel.

## What is the two-phase booking flow? {#lld04-two-phase}
1. `hold(seats, ttl)` atomically marks seats HELD, or returns None if any is taken.
2. `charge()` runs outside the lock.
3. `confirm(token)` atomically moves HELD to BOOKED if still valid.
Any failure releases the hold.
**Why:** never hold a mutex across slow network I/O. Confirm re-checks because the world changed during payment.

## What does the `hold_token` do? {#lld04-hold-token}
It is a unique random id returned by `hold`. Only the holder of the matching token can confirm or release those seats.
**Example:** your hold expires mid-payment and someone else re-holds A1. Their state has a different token, so your `confirm` fails cleanly and you are refunded.

## How are expired holds reclaimed without a background thread? {#lld04-lazy-ttl}
Lazily. A seat counts as effectively available if status is AVAILABLE, or HELD with `now >= expires_at`. This is checked when someone tries to hold it.
**Why:** correct without a sweeper thread. A sweeper is optional, for freeing memory and showing accurate availability.

## What happens if payment fails, or the hold expires during payment? {#lld04-payment-failure}
Payment fails: `release(token)` and the booking is FAILED. Hold expired mid-payment: `confirm` returns False, so refund and mark FAILED.
**Why:** the gateway is mocked. The interesting part is what booking does around payment, not payment itself.

## Why is `Clock` injected into `Show`? {#lld04-clock}
Time is non-determinism, so it sits behind a `Clock.now()` interface (`RealClock` or `FakeClock`). `PaymentGateway` is injected the same way.
**Why:** tests can expire a TTL or fail a payment deterministically, with no `sleep()`.

## Why an enum plus guards for seat state, not the State pattern? {#lld04-no-state-pattern}
Three states with trivial transitions are clearer as an enum with guarded transitions. Reach for class-per-state when each state has rich, divergent behaviour, as in Vending (LLD 02).

## What patterns does BookMyShow use, and what are the candidates? {#lld04-patterns}
Used: state machine (enum), dependency injection (`Clock`, `PaymentGateway`), a `BookingService` facade for the hold, pay, confirm dance.
Candidates: Strategy for pricing (per seat type, surge), Observer to notify on CONFIRMED.
Rejected: per-seat locks, and optimistic locking (right for the distributed twin, unneeded for one in-process mutex).

## What is the distributed version of the seat lock? {#lld04-distributed-twin}
Two shapes. A Redis key `SETNX show:seat EX 300` where the TTL is the hold expiry. Or a conditional write: `UPDATE ... SET status=BOOKED WHERE id=? AND status=AVAILABLE`, where 0 rows means someone beat you.
**Why:** also fail closed (never double-book) and make confirm idempotent by hold token.

## Give the 60-second pitch for BookMyShow. {#lld04-pitch}
The only hard problem is not selling a seat twice. `Show` owns its seat map and one lock, so bookings serialize per show and different shows run in parallel. Booking is two-phase: hold with a TTL, charge outside the lock, then confirm. A token ties confirm to the right hold. Clock and payment are injected.
