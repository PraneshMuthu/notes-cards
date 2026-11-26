---
topic: LLD 01 · Parking Lot
group: LLD
---

## Before coding a parking lot, which three buckets of clarifying questions do you cover? {#lld01-clarify-buckets}
Entities (nouns), operations (verbs) and constraints (non-functional requirements).
**Why:** the owner's first attempt probed nouns well (floors, vehicle types) but skipped verbs (ticket at entry, payment at exit) and the big constraint, concurrency.
**Example:** "Multiple gates? Two cars entering at once?" is a constraint question. It later forces a lock around spot allocation.

## What are the core classes in the parking lot design? {#lld01-entities}
`ParkingLot` → `Floor` → `ParkingSpot`, plus `Vehicle` (plate, type) and `Ticket` (vehicle, spot, entry/exit time). `ParkingLot` is the orchestrator with `park`, `unpark`, `is_available`.
**Why:** each class holds only data it describes. A `Ticket` is a parking session, so entry time and spot belong there, not on `Vehicle`.
**Trap:** putting `entry_time` and `spot` on `Vehicle`. A car is not a session.

## Why do you need a top-level `ParkingLot` class? {#lld01-aggregate-root}
It is the aggregate root: the owner of the whole operation. It owns the floors and runs park and unpark.
**Why:** one `Floor` cannot choose a spot across all floors. A lot-wide operation needs a lot-wide owner.
**Example:** a single floor supervisor cannot tell you the nearest free spot in the whole building. The building manager can.

## Which patterns does the parking lot use, and what triggers each? {#lld01-strategy-pair}
Two Strategy patterns: `PricingStrategy` and `AllocationStrategy`. The spec said both "might change later".
**Why:** pricing and allocation are policies that vary independently of the lot's structure. A new policy is a new class with zero edits to `ParkingLot`, `Floor` or `ParkingSpot`.
**Example:** hourly pricing to flat pricing, or nearest to cheapest spot, is a new strategy class.

## What are "mechanism" and "policy", and how do they split `Floor` from `AllocationStrategy`? {#lld01-mechanism-policy}
Mechanism is what is possible. Policy is what to choose. `Floor.get_available_spots(type)` is the mechanism, and the `AllocationStrategy` picks one of them.
**Why:** the owner first hard-coded `findNearestFreeSpot` on `Floor`, so "nearest" could not be swapped. It is a policy, so it belongs in a strategy.
**Trap:** keeping a policy method on the domain class while also having a strategy for it.

## What must you state to define "nearest free spot"? {#lld01-nearest-assumption}
A reference point (the entrance) and a metric. Spot positions restart per floor, so order by a composite key `(floor.level, position)`.
**Why:** `min(position)` alone breaks across floors, since spot 3 exists on every floor. Declared assumptions read as rigor, hidden ones as luck.

## What are the signatures of the two strategy interfaces? {#lld01-strategy-signatures}
`calculate_price(type, entry_time, exit_time) -> price` and `allocate_spot(floors, vehicle) -> spot`.
**Why:** an interface is its method contract, not its name. The owner first wrote them as bare names with no methods.

## Walk through `park()` and `unpark()` in the parking lot. {#lld01-flows}
`park`: ask `AllocationStrategy` for a spot, call `spot.assign()`, return a `Ticket` with entry time. `unpark`: set exit time, fee from `PricingStrategy`, `spot.vacate()`, return the fee.
**Trap:** the owner's first code never called `assign()` or `vacate()`, so spots never flipped state and two cars got the same spot. Structure looked right but state never changed.

## What two failure cases did the parking lot code get wrong first? {#lld01-bugs}
When the lot was full, `park()` built a `Ticket(spot=None)`. Fix: raise `ValueError` if no spot. Also, `unpark()` never freed the spot, so it stayed occupied forever. Every acquire needs its release.
**Also:** you cannot `int()` a `datetime`. Subtract two datetimes to get a `timedelta`, then bill hours with `max(1, ceil(seconds / 3600))`.

## How do you stop two gates from giving the same spot to two cars? {#lld01-concurrency}
Lock around allocate plus assign so it is one atomic step, or use an atomic compare-and-set on the spot.
**Why:** check-then-act is the hazard. Two threads both see spot 5 free, and both take it.

## Extension: add EV or handicapped spots. What changes? {#lld01-ext-ev}
A new spot type plus an allocation rule. If a vehicle can fit several spot types, split `VehicleType` from `SpotType` and add a compatibility map.
**Why:** v1 was exact match only. The map keeps that rule in data, not in `if` chains.

## Give the 60-second pitch for the parking lot. {#lld01-pitch}
Core entities: `ParkingLot` → `Floor` → `ParkingSpot`, plus `Vehicle` and `Ticket`. Entry asks an `AllocationStrategy` for the nearest free compatible spot, marks it occupied and issues a ticket. Exit computes the fee via a `PricingStrategy` and frees the spot.
**Why:** both policies are strategies, so EV spots, cheapest-spot or flat pricing are extensions, not rewrites.
