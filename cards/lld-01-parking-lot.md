---
topic: LLD 01 · Parking Lot
group: LLD
---

## Before coding a parking lot, which three buckets of clarifying questions do you cover? {#lld01-clarify-buckets}
Entities (nouns), operations (verbs) and constraints (non-functional requirements).
**Why:** the owner's first attempt probed nouns well (floors, vehicle types) but skipped verbs (ticket at entry, payment at exit) and the big constraint, concurrency.
**Example:** "Multiple gates? Two cars entering at once?" is a constraint question. It later forces a lock around spot allocation.

## What are the core classes in the parking lot design? {#lld01-entities}
`ParkingLot` → `Floor` → `ParkingSpot` (type, position, `is_occupied`, with `assign()` and `vacate()`), plus `Vehicle` (plate, type) and `Ticket` (vehicle, spot, entry/exit time). `ParkingLot` is the orchestrator with `park`, `unpark`, `is_available`.
**Why:** each class holds only data it describes. A `Ticket` is a parking session, so entry time and spot belong there, not on `Vehicle`.
**Trap:** putting `entry_time` and `spot` on `Vehicle`. A car is not a session.

## Why do you need a top-level `ParkingLot` class? {#lld01-aggregate-root}
It is the aggregate root: the one top-level object that owns the parts (floors, spots) and is the single entry point for park and unpark.
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

## `park()` on a full lot built a `Ticket(spot=None)`. What is the fix? {#lld01-bugs}
Guard the empty result: if the strategy returns no spot, raise `ValueError` before building the ticket.
**Why:** a `None` that flows downstream becomes a ticket for a spot that does not exist. Handle the failure case where it happens.

## How do you stop two gates from giving the same spot to two cars? {#lld01-concurrency}
Lock around allocate plus assign so it is one atomic step, or use an atomic compare-and-set on the spot.
**Why:** check-then-act is the hazard. Two threads both see spot 5 free, and both take it.

## Extension: add EV or handicapped spots. What changes? {#lld01-ext-ev}
A new spot type plus an allocation rule. If a vehicle can fit several spot types, split `VehicleType` from `SpotType` and add a compatibility map.
**Why:** v1 was exact match only. The map keeps that rule in data, not in `if` chains.

## Give the 60-second pitch for the parking lot. {#lld01-pitch}
Core entities: `ParkingLot` → `Floor` → `ParkingSpot`, plus `Vehicle` and `Ticket`. Entry asks an `AllocationStrategy` for the nearest free compatible spot, marks it occupied and issues a ticket. Exit computes the fee via a `PricingStrategy` and frees the spot.
**Why:** both policies are strategies, so EV spots, cheapest-spot or flat pricing are extensions, not rewrites.

## What did `unpark()` forget, and what is the rule? {#lld01-release-on-unpark}
It computed the fee but never called `ticket.spot.vacate()`, so the spot stayed occupied forever. Every acquire needs a matching release.
**Why:** same family as `park()` forgetting `assign()`. Structure looked right but state never changed.

## Why must price not live in the `Vehicle` enum? {#lld01-price-not-on-vehicle}
Price is a policy, not an intrinsic property of a vehicle. It belongs in `PricingStrategy`.
**Why:** SRP (one class, one reason to change) and Open/Closed (extend, do not edit). If price sits in the enum, changing pricing means editing `Vehicle`.

## What is the finalized parking lot spec for matching and fees? {#lld01-spec}
Each vehicle parks only in its matching spot type (exact match only in v1). Fee = time × per-hour rate, where the rate varies by vehicle type, and hours round up: `max(1, ceil(seconds / 3600))`.
**Why:** exact match keeps v1 simple. Spot sizes that fit several vehicle types are an extension.
**Example:** 90 minutes of parking bills as 2 hours.
