---
topic: LLD 10 · Amazon Locker
group: LLD
---

## Amazon Locker: what are the entities? {#lld10-entities}
`Locker` (id, size, status), `Package` (id, size, customer), `Reservation` (package, locker, code, deposit time, failed attempts), and `LockerLocation`, the service that owns lockers and reservations and runs deposit, pickup and expiry.
**Why:** the service is the single owner of state, so one lock can protect it.

## Why a separate `Reservation` instead of putting the code on `Locker`? {#lld10-reservation}
The code and wrong-attempt count belong to this one stay, not to the locker forever. When the parcel leaves, delete the reservation and the locker is clean.
**Trap:** fields on `Locker` must be wiped on every exit path (pickup, expiry), and one missed path leaks a stale code.
**Example:** a hotel booking record, not a field painted on the room door.

## Which pattern picks the locker, and how does smallest-fit work? {#lld10-strategy}
**Strategy** (swap the algorithm behind one interface): `LockerAssignmentStrategy.choose(lockers, package)`, with `SmallestFitStrategy` as default. Filter lockers that are available and `size >= package.size`, then take the min by size.
**Why:** sizes are named constants with numbers (SMALL=1, MEDIUM=2, LARGE=3), so "fits" is `>=`. A new rule is a new class, not an edit to `deposit`.

## A small parcel arrives but no SMALL locker is free. What happens? {#lld10-fallback}
It falls back to the smallest larger free locker (MEDIUM, then LARGE). A bigger locker always fits, but smallest-fit avoids wasting big ones.
**Trap:** exact-size matching only, which fails when a bigger box is free. Ask the interviewer, since some versions list fallback as an extension.

## Why is `LockerStatus` an enum plus a transition table, not the State pattern? {#lld10-enum-vs-state}
The **State pattern** is one class per mode, each behaving differently for the same call (as in a vending machine). A locker has no behaviour per state, only "is this move legal?".
**Why:** three near-empty State classes add noise. A table is one glance and hard to get wrong.
**Extension:** adding `RESERVED` is one enum value plus one table row.

## What are the locker's legal status transitions? {#lld10-transitions}
- `AVAILABLE` -> `OCCUPIED` or `OUT_OF_SERVICE`
- `OCCUPIED` -> `AVAILABLE` (picked up or expired)
- `OUT_OF_SERVICE` -> `AVAILABLE` (repaired)

`Locker.transition_to` looks up the table and raises `InvalidTransitionError` otherwise.
**Why:** taking an occupied locker out of service fails loudly instead of stranding a parcel.

## What is the one race in `deposit`, and how is it fixed? {#lld10-race}
Check-then-act: two agents both run "find a free locker" and both see S1 free, then both occupy it. Fix: `choose` and `transition_to(OCCUPIED)` happen inside one `threading.Lock`. Pickup and expiry take the same lock.
**Trap:** checking availability outside the lock, then locking only to occupy.
**Test:** 80 threads racing for 50 lockers give exactly 50 distinct lockers.

## What is the `Notifier` pattern here? {#lld10-notifier}
**Observer-lite**: Observer means notifying everyone who signed up when something happens. Here `LockerLocation` holds a list of `Notifier`s (`ConsoleNotifier`, later SMS or email) and calls each after a deposit or expiry. "Lite" = no per-event subscribe/unsubscribe.
**Why:** adding WhatsApp is one new class.
**Example:** a courier calling the contact list, whatever the channel.

## How does pickup work, and what is the wrong-attempt rule? {#lld10-pickup}
Pickup takes package id + 6-digit code. If `failed_attempts >= 3` it raises `TooManyAttemptsError`, even for the right code. A wrong code increments the counter. A right one frees the locker and marks the package `PICKED_UP`.
**Why:** it stops code guessing. Keying by package id gives the 3-tries rule something to count against.

## How are codes generated, and can two parcels share one? {#lld10-codes}
`_new_code()` uses `secrets` (not `random`, which is predictable) and retries until the code is not used by any active reservation at this location.
**Trap:** using `random` for anything that unlocks something.
**Why:** unique-per-location matters if kiosks look the parcel up by code alone.

## How do you test expiry after 3 days without waiting? {#lld10-clock}
Inject the clock: `clock: Callable[[], datetime]`. Production passes `datetime.now`; tests pass a `FakeClock` and call `advance(days=3)`. A scheduler job runs `expire_overdue()` every hour; the scheduling itself is out of scope.
**Trap:** calling `datetime.now()` directly makes expiry untestable.

## Expiry marks the locker AVAILABLE, but the parcel is still inside. Problem? {#lld10-expiry-assumption}
Yes. `expire_overdue()` scans reservations older than max age, releases each (locker AVAILABLE, package `RETURNED_TO_SENDER`), then notifies. This assumes the return courier empties the box in the same sweep. If not, kill only the code (package `EXPIRED`) and keep the locker `OCCUPIED` until staff confirm removal.
**Why:** otherwise the next agent is sent to a box still holding a parcel.

## Why one lock for the whole location, not one per size? {#lld10-one-lock}
A location has about 100 lockers and a handful of agents, and each deposit holds the lock for microseconds. A per-size lock adds deadlock risk for no real gain.
**Why:** split it only if profiling shows contention.
**Also:** lockers `OUT_OF_SERVICE` are never assigned, because the strategy filters on `is_available()`.

## 30-second pitch: Amazon Locker LLD {#lld10-pitch}
`LockerLocation` owns lockers of three sizes. `SmallestFitStrategy` picks the smallest free locker that fits; the status moves through a transition table (not State classes). A `Reservation` holds a `secrets` 6-digit code, deposit time and wrong-attempt count; a `Notifier` tells the customer. Pickup allows 3 tries. A scheduler calls `expire_overdue()` with an injected clock. Find-and-occupy runs under one lock.
