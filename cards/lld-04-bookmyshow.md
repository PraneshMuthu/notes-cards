---
topic: LLD 04 · BookMyShow / IRCTC
group: LLD
---

## BookMyShow LLD in 45 minutes: what do you cut, and what core do you keep? {#lld04-scope}
Cut browse, search and login. Keep the seat-booking core: the user is already on a show, picks specific seats, holds them, pays and confirms.
**Why:** the marks are in "never sell a seat twice". Time spent modelling theatres and cities never reaches the concurrency question.
**Example:** like a Tatkal exam question that only asks about the booking window, not how IRCTC lists trains.

## BookMyShow: seat A1 is free at 6 pm and booked at 9 pm. Which object owns seat status? {#lld04-bookable-unit}
The `Show` (movie × screen × start time), not the `Seat` or `Screen`. Each show has its own seat map.
**Why:** a physical seat is reused across shows, so status only makes sense per show.
**Example:** a train berth is booked per journey date, not forever. Code: `show.seats["A1"] = (HELD, token, expires_at)`.

## BookMyShow: what is the one invariant the design must never break? {#lld04-show-invariant}
A seat in a show is BOOKED by at most one booking, ever.
**Why:** correctness beats throughput, so when in doubt, reject the booking rather than risk a double sale.
**Example:** two people arriving at the cinema with tickets for the same seat is the one failure users never forgive. Rejecting one at checkout is cheap by comparison.

## BookMyShow: what are the seat states, and which transitions exist? {#lld04-seat-states}
AVAILABLE → HELD → BOOKED. HELD → AVAILABLE on TTL (time-to-live) expiry or payment failure. BOOKED → AVAILABLE on cancel.
**Why:** a seat held by someone who walked away must not stay locked forever, so HELD always has a way back.
**Example:** a shop keeps an item aside for you for an hour; after that it goes back on the shelf.

## BookMyShow seat status has three values with simple transitions. One class per state, or an enum? Why? {#lld04-no-state-pattern}
An enum with guarded transitions (`if status != HELD: raise`), because the states only change which moves are legal, not what an operation does.
**Why:** classes per state pay off when each state has different behaviour for the same input, as in the vending machine. Here they would be ceremony.
**Example:** a parcel's tracking status (packed, shipped, delivered) is a label, not a different machine.

## BookMyShow: where do the lock and seat map live, and why one lock per show rather than per seat? {#lld04-lock-per-show}
On `Show`: it holds `{seat_id → (status, hold_token, expires_at)}` and one lock, and every hold, confirm, release and cancel runs inside it.
**Why:** a booking is several seats, all or nothing. Per-seat locks mean taking many locks in a fixed order or risking deadlock; different shows still run in parallel.
**Example:** one counter per screen at a cinema, not one clerk per seat.

## BookMyShow: a user picks A1, A2 and A3, and A2 is already taken. What happens to A1 and A3? {#lld04-specific-seats}
Nothing is held: the whole request fails, and the user picks again. Holds are all or nothing.
**Why:** a family wants seats together; holding A1 and A3 alone blocks other buyers and helps nobody. Under the per-show lock, check all seats, then mark all.
**Example:** a group train booking that confirms either everyone or no one. Code: `if any(not free(s) for s in seats): return None`.

## BookMyShow: what are the three steps of booking, and which one runs without the lock? {#lld04-two-phase}
1. `hold(seats, ttl)`: under the lock, mark seats HELD and return a token.
2. `charge()`: payment, with no lock held.
3. `confirm(token)`: under the lock, HELD → BOOKED only if the hold is still valid.
**Why:** never hold a lock across slow network calls. Confirm re-checks because the world changed during payment.
**Example:** a restaurant holds your table while you park, then checks you are still in time when you walk in.

## BookMyShow: what does the `hold_token` returned by `hold` protect against? {#lld04-hold-token}
An expired holder confirming seats someone else now holds. Only the matching token can confirm or release a hold.
**Why:** after expiry another user can re-hold A1 with a new token, so "confirm A1" alone would book it for the wrong person.
**Example:** a cloakroom token: only the person with token 42 gets coat 42 back. Your hold expires mid-payment, someone re-holds A1, and your `confirm` fails cleanly, so you are refunded.

## BookMyShow: how are expired holds reclaimed without a background thread? {#lld04-lazy-ttl}
Lazily: a seat counts as free if it is AVAILABLE, or HELD with `now >= expires_at`. This is checked when someone next tries to hold it.
**Why:** correctness needs no sweeper thread; a sweeper is optional, only to free memory and show accurate availability.
**Example:** a library shelf where an overdue reservation simply lapses when the next person asks for the book.

## BookMyShow: payment fails, or the hold expires during payment. What happens in each case? {#lld04-payment-failure}
Payment fails: `release(token)` frees the seats and the booking is FAILED. Hold expired mid-payment: `confirm` returns False, so refund the charge and mark FAILED.
**Why:** each exit path must release or refund (release on every exit); the payment gateway itself is mocked.
**Example:** a shop that charged your card for an item someone else just bought must refund you.

## BookMyShow: which test is impossible to write well without injecting a clock, and what does it look like with one? {#lld04-clock}
"A hold expires after 5 minutes." With a `FakeClock` injected into `Show`, the test advances time instead of sleeping.
**Why:** `time.time()` inside `Show` would force a 5-minute real wait per test. `PaymentGateway` is injected for the same reason, to fail payments on demand.
**Example:** `clock = FakeClock(0); token = show.hold(["A1"], ttl=300); clock.advance(301); assert show.hold(["A1"], ttl=300) is not None` (the next user gets A1).

## Across many app servers, how do you hold seat A1 for 5 minutes using Redis? {#lld04-distributed-twin}
`SET show:42:A1 <hold_token> NX EX 300`. NX sets only if the key is absent; EX 300 expires it after 300 s, which is the hold TTL. A nil reply means someone else holds it.
**Why one command:** `SETNX` then `EXPIRE` is two steps, and a crash between them leaves a hold that never expires.
**Example:** a single "reserved till 6:05" tag tied to the seat, instead of a tag plus a separate note about when to remove it.
**Trap:** writing `SETNX key EX 300`. `SETNX` takes no options.

## Redis seat hold: why can't you release it with a plain `DEL show:42:A1`? {#lld04-redis-release}
Your hold may already have expired and been re-taken, so `DEL` would delete someone else's hold. Release only if the stored value equals your token, atomically (a small Lua script: GET, compare, DEL).
**Why:** GET then DEL from the app is check-then-act again; the Lua script runs as one step on the Redis server.
**Example:** a hotel that frees a room only if your key card still matches the room's current code.

## With only a SQL database and no app-level lock, how do you make "book seat A1" safe across servers? {#lld04-distributed-sql}
A conditional write: `UPDATE seats SET status='BOOKED', token=? WHERE show_id=? AND seat_id='A1' AND status='AVAILABLE'`. If 0 rows change, someone beat you.
**Why:** the database checks and writes in one atomic statement, so the check-then-act cannot split.
**Example:** an ATM that debits only `WHERE balance >= amount`.

## BookMyShow: why keep `Booking.status` separate from seat status? {#lld04-cancel}
They track different things: `Booking.status` (CONFIRMED, FAILED, CANCELLED) is one purchase attempt; seat status is the seat. Cancel sets the booking CANCELLED and moves its seats BOOKED → AVAILABLE.
**Why:** a failed booking leaves seats AVAILABLE, and a seat can belong to many bookings over time; one field cannot say both.
**Example:** an order on Swiggy is "cancelled" while the restaurant's dish stays "available".

## Give the BookMyShow design as four beats. {#lld04-pitch}
1. The only hard problem is not selling a seat twice.
2. `Show` owns its seat map and one lock, so bookings serialize per show and shows run in parallel.
3. Two phases: hold with a TTL and token, charge outside the lock, then confirm by token.
4. Clock and payment are injected; the distributed version uses Redis `SET NX EX` or a conditional SQL update.
Grade Got it only if you said all four beats.
