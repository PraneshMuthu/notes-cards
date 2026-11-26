---
topic: LLD 01 · Parking Lot
group: LLD
---

## Parking lot: before designing, which three kinds of clarifying question do you ask? Give one example of each. {#lld01-clarify-buckets}
Entities (nouns: floors, vehicle types), operations (verbs: ticket at entry, pay at exit) and constraints (non-functional: several gates at once?).
**Why:** nouns become classes, verbs become methods, and constraints decide the hard parts, like locking.
**Example:** "Can two cars enter through different gates at the same moment?" is the constraint question that later forces a lock around spot allocation.
**Trap:** asking only about nouns. You get a tidy class diagram and miss concurrency.

## Parking lot: where do a car's entry time and assigned spot belong, and why not on `Vehicle`? {#lld01-entities}
On a `Ticket`, which models one parking session (vehicle, spot, entry and exit time).
**Why:** a class holds only data it describes. A car exists before and after it parks; entry time belongs to the visit, not the car.
**Example:** a cinema ticket records your seat and showtime; your Aadhaar card does not. Code: `Ticket(vehicle, spot, entry_time=now)`.
**Trap:** `vehicle.entry_time`. The same car parking twice in a day breaks it.

## Parking lot: `Floor` objects already exist. Why add a top-level `ParkingLot` class? {#lld01-aggregate-root}
It is the aggregate root: the one object that owns all floors and is the single entry point for `park` and `unpark`.
**Why:** "find a free spot anywhere" is lot-wide, and no single `Floor` can see the other floors.
**Example:** a floor supervisor cannot tell you the nearest free spot in the whole mall; the building manager can. Code: `lot.park(vehicle)` loops over `self.floors`.

## Parking lot spec: "the pricing rule and the spot-choosing rule might change later". How do you model them? {#lld01-strategy-pair}
As two Strategy interfaces, `PricingStrategy` and `AllocationStrategy`, each injected into `ParkingLot`. A new rule is a new class.
**Why:** both are policies that change independently of the lot's structure, so new rules need zero edits to `ParkingLot`, `Floor` or `ParkingSpot` (Open/Closed).
**Example:** hourly to flat pricing is `FlatPricing()`; nearest to cheapest spot is `CheapestFirst()`.
**Trap:** storing the hourly rate on the `Vehicle` enum. A price change then edits `Vehicle`, which should change only when vehicles do.

## Parking lot: should "find the nearest free spot" be a method on `Floor` or inside the allocation strategy? {#lld01-mechanism-policy}
`Floor` exposes the mechanism, `get_available_spots(type)` (what is possible); the strategy holds the policy, choosing one of them (what to pick).
**Why:** "nearest" is one choice among many. Hard-coded on `Floor`, it cannot be swapped for "cheapest" or "closest to lift".
**Example:** a hotel front desk lists free rooms (mechanism); the guest's preference picks one (policy).
**Trap:** keeping `find_nearest_free_spot()` on `Floor` while also adding an `AllocationStrategy`. Now the policy lives in two places.

## Parking lot: what must you state to make "nearest free spot" well defined? {#lld01-nearest-assumption}
A reference point (the entrance) and a metric. Since spot numbers restart per floor, order by a composite key `(floor.level, position)`.
**Why:** `min(position)` alone breaks across floors, because spot 3 exists on every floor. Stated assumptions read as rigour; hidden ones as luck.
**Example:** spots (floor 2, pos 1) and (floor 0, pos 5): by `(level, position)` the ground-floor spot wins, which matches a driver entering at ground level.

## Parking lot: write the method signatures of the pricing and allocation interfaces. {#lld01-strategy-signatures}
`calculate_price(vehicle_type, entry_time, exit_time) -> price` and `allocate_spot(floors, vehicle) -> spot | None`.
**Why:** an interface is defined by its method contract, not its name. A bare `PricingStrategy` with no method promises nothing.
**Example:** `FlatPricing.calculate_price(...)` returns 100 whatever the times; `HourlyPricing` uses them. Both fit the same signature.

## Parking lot, one gate, no threads: two cars still get the same spot. What is the bug? {#lld01-flows}
`park()` asks the strategy for a spot and issues a ticket but never calls `spot.assign()`, so the spot still looks free to the next car.
**Why:** the structure looks right, but the state that the next decision reads never changed.
**Example:** a hotel clerk who hands you a key but never marks the room taken on the board. Code fix: `spot = strategy.allocate_spot(...); spot.assign(vehicle); return Ticket(...)`.

## Parking lot: after a busy day the lot reports "full" while it is half empty. Where is the leak? {#lld01-release-on-unpark}
`unpark()` computes the fee but never calls `ticket.spot.vacate()`, so every departed car keeps its spot taken (the release-on-every-exit lesson).
**Why:** a missed release never errors; free capacity just shrinks with every exit.
**Example:** a cloakroom that hands back coats but never frees the hooks. Code fix: `fee = pricing.calculate_price(...); ticket.spot.vacate(); return fee`.

## Parking lot is full and the allocation strategy returns `None`. What must `park()` do? {#lld01-bugs}
Check the result and raise (or return a "lot full" error) before building a ticket.
**Why:** a `None` that flows downstream becomes `Ticket(spot=None)`, a ticket for a spot that does not exist, which fails later and far away.
**Example:** a car park shows "FULL" at the gate instead of handing out a ticket. Code: `if spot is None: raise LotFullError()`.

## Parking lot with several entry gates: where exactly is the check-then-act race, and what must be atomic? {#lld01-concurrency}
Between `allocate_spot` (sees spot 5 free) and `spot.assign()`. Allocate plus assign must run under one lock, or `assign` must be an atomic compare-and-set that fails if already taken.
**Why:** two gate threads can both pick spot 5 before either assigns it.
**Example:** two valets both reading "spot 5 free" from the whiteboard and driving there.

## Parking lot extension: add EV and accessible spots, where some vehicles fit several spot types. What changes? {#lld01-ext-ev}
Split `VehicleType` from `SpotType` and add a compatibility map, `{CAR: [COMPACT, LARGE, EV], ...}`, that the allocation strategy consults.
**Why:** v1 was exact match only. A map keeps the fitting rule in data, not in growing `if` chains.
**Example:** an EV car can take an EV spot or a normal one; a bike cannot take an EV charger. Code: `if spot.type in COMPATIBLE[vehicle.type]`.

## Parking lot fee: per-hour rate by vehicle type, car parked 90 minutes. How many hours do you bill, and what is the formula? {#lld01-spec}
2 hours: `hours = max(1, ceil(seconds / 3600))`, fee = hours × rate for that vehicle type.
**Why:** rounding up is the usual parking rule, and `max(1, …)` bills a 5-minute stay as one hour.
**Example:** 90 min = 5400 s; 5400 / 3600 = 1.5, so ceil gives 2. At ₹40/hour for a car, the fee is ₹80.
**Trap:** `int(exit - entry)`. Subtracting datetimes gives a `timedelta`; use `.total_seconds()`.

## Give the parking lot design as four beats. {#lld01-pitch}
1. `ParkingLot` → `Floor` → `ParkingSpot`, plus `Vehicle` and a `Ticket` per session.
2. Entry: an `AllocationStrategy` picks a compatible spot, which is assigned atomically, and a ticket is issued.
3. Exit: a `PricingStrategy` computes the fee and the spot is vacated.
4. Both policies are strategies, so EV spots or flat pricing are new classes, not rewrites.
Grade Got it only if you said all four beats.
