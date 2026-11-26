---
topic: LLD 06 · Ride-sharing
group: LLD
---

## What scope do you lock for a ride-sharing LLD? {#lld06-scope}
Rider, Driver (location plus status), Trip lifecycle, nearest-driver matching, base-plus-per-km fare with surge, and no double-assigned driver. Out: real maps, ratings, payments, ride types, geo-index, persistence.
**Why:** straight-line grid distance is enough. Say the rest is out of scope and move on.

## What is the trip lifecycle, and what can cancel? {#lld06-trip-lifecycle}
REQUESTED → DRIVER_ASSIGNED → IN_PROGRESS → COMPLETED, plus CANCELLED. Either side can cancel before the trip starts. Once started, the only option is to end it.
**Why:** illegal moves must raise an error, such as ending a trip that never started.

## Which patterns does the ride-sharing design use, and what triggers each? {#lld06-patterns}
- Strategy for matching: the matching rule will change.
- Strategy plus Decorator for pricing: surge stacks on any base fare.
- State for the trip: legal moves depend on the trip status.
- Lock-guarded check-and-set on `Driver`: two riders may grab the same driver.
**Why:** it is the LLD twin of HLD ride-hailing. LLD is classes and correctness in one process, HLD is scale.

## Why is `TripState` a State pattern, not an if/elif on status? {#lld06-trip-state}
Four actions × five statuses is twenty cases spread over four methods. With State, each status's rules live in one small class.
**Why:** the base class makes every action raise `InvalidTransitionError`. Each state overrides only its legal moves, and Completed and Cancelled override nothing, so they are final.
**Example:** add `DRIVER_ARRIVED` by adding one class and changing the one state that leads into it.

## How does `SurgePricing` work, and what pattern is it? {#lld06-surge}
`SurgePricing(inner, multiplier)` wraps another `PricingStrategy` and multiplies its fare. Since it wraps the same interface and adds to the result, it is strictly a Decorator.
**Example:** `SurgePricing(StandardPricing(50, 12), 1.5).fare(5) = (50 + 12×5) × 1.5 = 165`.
**Trap:** a surge flag inside `StandardPricing`. Every new rule becomes another flag.

## What is the race in `request_ride`, and how is it fixed? {#lld06-driver-race}
Two riders rank the same drivers, both see D1 AVAILABLE, and both set it ON_TRIP. Fix: `Driver.try_assign()` does check-and-set under the driver's own lock. It returns False if someone beat you.
**Trap:** locking only the write does not help. The check must be inside the lock too.

## Why is ranking done without a lock, and is a stale list a problem? {#lld06-stale-ranking}
Ranking only produces candidates, and `try_assign()` is the real guard. The service loops over ranked drivers until one claim succeeds. A stale candidate just fails and the next is tried.
**Why:** locking during the scan slows every request and gains nothing. If none succeeds, cancel the trip and raise `NoDriverAvailableError`.

## Per-driver lock or one global service lock? {#lld06-lock-granularity}
Either is correct, and you should say why. Per-driver is `Driver._lock`, taken inside `try_assign()`, so riders in different parts of the city never wait on each other. They only compete for the same driver. A global lock is simpler to explain.

## What is the second race on the trip itself? {#lld06-trip-race}
The driver taps Start while the rider taps Cancel. Both see `DriverAssignedState`, so cancel frees the driver while start moves the trip to IN_PROGRESS. The driver is now AVAILABLE mid-trip and can be double-booked.
**Why:** `Trip` holds a small lock around its transitions.

## What common mistakes leave a driver stuck? {#lld06-mistakes}
- Forgetting to release the driver on cancel or end: the driver stays ON_TRIP and the fleet shrinks.
- Matching OFFLINE drivers or drivers 50 km away: filter on status and radius.
- `if status` chains in `RideService`: the rules belong in the state classes.

## Extension: add ride types such as Mini and Sedan. What changes? {#lld06-ext-ride-types}
Add `vehicle_type` to `Driver` and the request. Matching filters on it, inside the strategy or a decorator around it. Pricing becomes `dict[VehicleType, PricingStrategy]`. `Trip` and its states stay the same.

## What breaks with 10 million drivers? {#lld06-scale}
`NearestDriverStrategy` is an O(N) linear scan per request. The HLD fix is to bucket drivers by geohash cell and look at the rider's cell and its neighbours.
**Why:** it sits behind the strategy interface, so a geo-index strategy is one new class and the rest does not change.

## Which candidates and rejections are in the pattern atlas? {#lld06-atlas}
Candidates: Observer (notify rider on assign or arrival), more decorators (`Coupon(NightCharge(Surge(Standard)))`), Factory (pricing and matching pair per vehicle type).
Rejected: Singleton for `RideService` (hurts tests), Template Method for pricing (formulas share no fixed steps).

## What is the `DriverMatchingStrategy` seam? {#lld06-matching}
`rank(pickup, drivers)` returns AVAILABLE drivers within the radius, closest first. Driver statuses are AVAILABLE, ON_TRIP and OFFLINE.
**Why:** a new rule (highest-rated, geohash) is one new class and `RideService` does not change.

## What happens when a trip ends? {#lld06-end-trip}
`InProgressState.end()` computes the fare via the injected `PricingStrategy`, moves the driver to the drop point, and releases the driver back to AVAILABLE.
**Why:** forgetting the release leaves the driver ON_TRIP forever.

## Give the 60-second pitch for ride-sharing. {#lld06-pitch}
Rider, Driver, Location and Trip, with `RideService` on top. Matching is a Strategy and pricing is a Strategy with surge as a Decorator. The trip uses State, so illegal moves raise. The race is two riders grabbing one driver, fixed by `try_assign()` under a per-driver lock. Ranking can be stale. At Uber scale, a geohash replaces the scan.
