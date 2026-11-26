---
topic: LLD 10 · Amazon Locker
group: LLD
---

## Amazon Locker: the 6-digit code and the wrong-attempt count. Store them on `Locker`, or somewhere else, and why? {#lld10-reservation}
On a separate `Reservation` (package, locker, code, deposit time, failed attempts), deleted when the parcel leaves.
**Why:** the code belongs to this one stay, not to the locker forever; deleting the record cleans everything at once.
**Example:** a hotel booking record, not a PIN painted on the room door.
**Trap:** fields on `Locker` must be wiped on every exit path (pickup, expiry), and one missed path leaks a stale code.

## Amazon Locker: the rule for choosing a locker will change. How is "pick a locker for this parcel" structured? {#lld10-strategy}
A `LockerAssignmentStrategy.choose(lockers, package)` interface; the default `SmallestFitStrategy` keeps lockers that are available with `size >= package.size` and takes the smallest.
**Why:** sizes are ordered numbers (SMALL=1, MEDIUM=2, LARGE=3), so "fits" is `>=`, and a new rule is a new class, not an edit to `deposit`.
**Example:** a MEDIUM parcel with lockers S, M, L free gets M.
**Trap:** forgetting the availability filter, which would hand out OUT_OF_SERVICE or occupied lockers.

## Amazon Locker: a small parcel arrives but no SMALL locker is free. What happens? {#lld10-fallback}
It goes in the smallest larger free locker (MEDIUM, then LARGE); if none fits, `deposit` raises `NoLockerAvailableError`.
**Why:** a bigger locker always fits, and smallest-fit avoids wasting big ones while a small one is free.
**Example:** S full, M and L free → M.
**Trap:** exact-size matching only, which turns parcels away while bigger boxes sit empty. Ask the interviewer, since some versions treat fallback as an extension.

## Amazon Locker: why does locker status not need one class per status? {#lld10-enum-vs-state}
A locker has no per-status behaviour, only "is this move legal?", so an enum plus a transition table is enough.
**Why:** three near-empty classes add noise; a table is one glance and hard to get wrong.
**Example:** adding RESERVED is one enum value plus one table row.

## Amazon Locker: what are the locker's legal status transitions? {#lld10-transitions}
AVAILABLE → OCCUPIED or OUT_OF_SERVICE; OCCUPIED → AVAILABLE (picked up or expired); OUT_OF_SERVICE → AVAILABLE (repaired). Anything else raises `InvalidTransitionError`.
**Why:** `Locker.transition_to` looks up the table, so a bad move fails loudly instead of silently corrupting state.
**Example:** taking an OCCUPIED locker out of service raises, instead of stranding a parcel behind a "broken" door.

## Amazon Locker: two delivery agents deposit at the same instant. Where exactly does the race bite, and what is the fix? {#lld10-race}
Both run "find a free locker", both see S1 free, and both occupy it. Fix: `choose` and `transition_to(OCCUPIED)` run inside one lock, which pickup and expiry also take.
**Why:** finding and occupying must be one atomic step; locking only the occupy still lets both pick S1.
**Example:** test it: 80 threads racing for 50 lockers must get exactly 50 distinct lockers.

## Amazon Locker must tell the customer on deposit and expiry: SMS today, WhatsApp later. Which pattern, and how light can it be? {#lld10-notifier}
Observer: `LockerLocation` holds a list of `Notifier` objects, given at construction, and calls `notify` on each after a deposit or expiry.
**Why light:** nobody subscribes or unsubscribes at runtime, so a fixed list passed in is enough; no `subscribe()` API is needed.
**Example:** a courier with a contact list who calls everyone on it. WhatsApp is just one more name on the list.

## Amazon Locker: a customer has entered 3 wrong codes, then enters the right one. What happens, and why? {#lld10-pickup}
Rejected with `TooManyAttemptsError`: the attempt cap is checked before the code is compared.
**Why:** it stops guessing; a 6-digit code has 1,000,000 values, and 3 tries give a guesser a 3-in-a-million chance.
**Example:** an ATM that keeps your card after 3 wrong PINs, even if the fourth is right.

## Amazon Locker: how should the 6-digit pickup code be generated? {#lld10-codes}
With `secrets` (`f"{secrets.randbelow(1_000_000):06d}"`), regenerating if an active reservation at this location already has that code.
**Why:** `random` is predictable from past outputs, and uniqueness matters if a kiosk looks the parcel up by code alone.
**Example:** like an OTP: it must be both unguessable and not collide with another live one.
**Trap:** using `random` for anything that unlocks something.

## Amazon Locker: parcels expire after 3 days. How do you test that in a unit test that runs in milliseconds? {#lld10-clock}
Inject the clock: `LockerLocation(clock=...)`; production passes `datetime.now`, the test passes a `FakeClock`, calls `advance(days=3)` and then `expire_overdue()`.
**Why:** expiry compares `clock()` with the deposit time, so moving the fake clock is the same as waiting.
**Example:** a scheduler would call `expire_overdue()` hourly in production; the test just calls it once after advancing.

## Amazon Locker: expiry marks the locker AVAILABLE while the parcel may still be inside. What goes wrong, and what is the safer flow? {#lld10-expiry-assumption}
The next agent is sent to a box still holding a parcel. Safer: expire only the code (package EXPIRED) and keep the locker OCCUPIED until staff confirm removal.
**Why:** the simple version assumes the return courier empties the box in the same sweep; if that is not guaranteed, status must follow the physical box.
**Example:** a hotel can't give your room to the next guest just because checkout time passed; housekeeping must clear it first.

## Amazon Locker: why one lock for the whole location, not one per locker size? {#lld10-one-lock}
A location has about 100 lockers and a handful of agents, and each deposit holds the lock for microseconds, so one lock never contends.
**Why:** a fallback deposit may look at several sizes, so per-size locks mean holding several at once and risking deadlock. Split only if profiling shows contention.
**Example:** a single kirana shop needs one cash counter, not one per aisle.

## Give the Amazon Locker design as four beats. {#lld10-pitch}
1. `LockerLocation` owns lockers of three sizes; `SmallestFitStrategy` picks the smallest free locker that fits.
2. Locker status is an enum plus a transition table; find-and-occupy runs under one lock.
3. A `Reservation` holds a `secrets` 6-digit code, deposit time and wrong-attempt count; pickup allows 3 tries.
4. Notifiers tell the customer; a scheduler calls `expire_overdue()`, tested with an injected clock.

Grade Got it only if you said all four beats.
