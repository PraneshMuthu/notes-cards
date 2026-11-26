---
topic: LLD 06 · Ride-sharing
group: LLD
---

## Ride-sharing LLD in 45 minutes: what do you cut from scope, and which one guarantee must survive? {#lld06-scope}
Cut real maps (use straight-line distance), payments, ratings, the geo-index and persistence. Keep the guarantee that no driver is ever on two active trips.
**Why:** fares and matching can be imperfect and still safe, but a double-booked driver is a correctness bug, and that is where the interviewer probes.
**Example:** one auto driver accepting two Ola rides at the same signal. Everything else can wait for v2.

## Ride-sharing: what is the trip's status flow, including where the cancel branch leaves it? {#lld06-trip-lifecycle}
REQUESTED → DRIVER_ASSIGNED → IN_PROGRESS → COMPLETED. CANCELLED is reachable only from REQUESTED or DRIVER_ASSIGNED; once started, a trip can only end.
**Why:** every other move (end a trip that never started, cancel a finished one) must raise an error, so the flow is the spec for those errors.
**Example:** you can cancel your Uber while the driver is on the way, not halfway to the airport.

## Ride-sharing: assign, start, end and cancel are each legal in some trip statuses and not others. How do you avoid a 4 × 5 if/elif grid? {#lld06-trip-state}
One class per status behind a `TripState` interface; `Trip` delegates each action to its current state. The base class raises `InvalidTransitionError` for everything, and each state overrides only its legal moves.
**Why:** here the transitions carry work (end prices the trip and frees the driver, cancel frees the driver), so per-status classes earn their keep; COMPLETED and CANCELLED override nothing, so they are final for free.
**Example:** adding DRIVER_ARRIVED is one new class plus a change to the one state that leads into it.

## Ride-sharing: surge (×1.5) must stack on any base fare, with no surge flag inside each pricing class. How? {#lld06-surge}
A wrapper that is itself a `PricingStrategy`, holds an inner one, and multiplies its fare: `SurgePricing(StandardPricing(50, 12), 1.5)`. That is a Decorator.
**Why:** the wrapper and the wrapped share one interface, so wrappers stack (night charge, coupon) and no base class ever learns about surge.
**Example:** 5 km: (50 + 12 × 5) × 1.5 = 110 × 1.5 = 165.
**Trap:** a `surge` flag in `StandardPricing`; every new rule becomes another flag.

## Ride-sharing: two riders request at the same instant and both rank driver D1 first. Where exactly does the race bite, and which method closes it? {#lld06-driver-race}
Both see D1 AVAILABLE and both set it ON_TRIP. `Driver.try_assign()` does the check and the set under D1's own lock and returns False to the loser.
**Why:** the check and the write must be one atomic step; a lock around only the write still lets both pass the check.
**Example:** two people both see the last seat in a shared auto and both sit down.

## Ride-sharing: the ranked driver list can be stale by the time you claim a driver. Why is it safe to rank without a lock? {#lld06-stale-ranking}
Ranking only proposes candidates; `try_assign()` is the real guard. A stale candidate just returns False and the service tries the next one.
**Why:** locking during the scan would serialise every ride request in the city and buy nothing the claim does not already guarantee.
**Example:** phoning hotels from a list printed an hour ago: a full one says no, so you call the next.
**Trap:** forgetting the end case: if every candidate fails, cancel the trip and raise `NoDriverAvailableError`.

## Ride-sharing: one service-wide lock or one lock per driver? Pick one and justify it. {#lld06-lock-granularity}
Per-driver, taken inside `try_assign()`: riders in different areas never wait on each other and contend only for the same driver.
**Why:** each claim holds exactly one lock, so there is no lock ordering to get wrong and no deadlock. A global lock is also correct, just slower under load.
**Example:** each auto stand has its own queue; you don't make the whole city queue at one counter.

## Ride-sharing: the driver taps Start while the rider taps Cancel. What goes wrong, and what is the fix? {#lld06-trip-race}
Both pass the DRIVER_ASSIGNED check: cancel frees the driver while start moves the trip to IN_PROGRESS, so a driver mid-trip shows AVAILABLE and can be double-booked. Fix: a per-trip lock around every transition.
**Why:** the state check and the state change are separate steps; the lock makes each transition one step, so the second tap sees the new status and raises.
**Example:** two lift buttons pressed together: the controller handles one request at a time, never both halfway.

## Ride-sharing: add Mini and Sedan with different fares. Which parts change, and what stays untouched? {#lld06-ext-ride-types}
`Driver` and the request gain `vehicle_type`; matching filters on it; pricing becomes `dict[VehicleType, PricingStrategy]`. `Trip` and its states do not change.
**Why:** vehicle type is a matching and pricing policy, not a lifecycle change, so it lands only in the pluggable parts.
**Example:** on Ola, Auto and Prime Sedan have different fares but the same request → assigned → started → ended flow.

## Ride-sharing: 10 million drivers. What breaks in matching, and what replaces it? {#lld06-scale}
Nearest-driver is an O(N) scan per request. Replace it with a geohash (a short string naming one square of a map grid): bucket drivers by cell and search only the rider's cell and its 8 neighbours.
**Why:** matching sits behind the strategy interface, so a geo-index is one new class and `RideService` is untouched.
**Example:** 10M drivers × 1,000 requests/s = 10 billion distance checks per second for the scan.

## Ride-sharing: fares (per-km, flat, surge) differ by formula. Why is Template Method the wrong pattern for pricing? {#lld06-atlas}
Template Method (a base class fixes the steps; subclasses fill in some) needs a shared sequence of steps. Fare formulas share none, so use a pluggable pricing interface, with wrappers for add-ons like surge.
**Why:** a template whose skeleton is empty is just one abstract method, i.e. a strategy with extra inheritance.
**Example:** Splitwise's split does have a skeleton (validate → compute shares → check they sum to the total), so Template Method fits there.

## Ride-sharing: tell the rider on driver-assigned and on arrival, without `RideService` knowing about SMS or push. How? {#lld06-atlas-observer}
`RideService` keeps a list of listeners and calls `on_event(trip_event)` on each; SMS and push are listener classes (Observer).
**Why:** a new channel is one new listener; the code that runs the trip never changes.
**Example:** a school WhatsApp group: the teacher posts once instead of phoning every parent.

## Ride-sharing: matching rules will change (nearest, highest-rated, geohash). What interface does `RideService` call, and what does it return? {#lld06-matching}
`DriverMatchingStrategy.rank(pickup, drivers)` returns AVAILABLE drivers within the radius (5 km by default), closest first.
**Why:** a new rule is one new class; `RideService` only loops over whatever list comes back.
**Example:** Swiggy picking a delivery partner: nearest today, nearest-with-good-rating tomorrow, same calling code.
**Trap:** forgetting the filter, so OFFLINE, ON_TRIP or 50-km-away drivers get matched.

## Ride-sharing: ending a trip does three things. What are they, and which one is easy to forget? {#lld06-end-trip}
Compute the fare via the injected `PricingStrategy`, move the driver to the drop point, and release the driver to AVAILABLE. The release is the one people forget.
**Why:** a missed release leaves the driver ON_TRIP forever, so the fleet silently shrinks; cancel needs the same release.
**Example:** a hotel that checks you out but never marks the room clean: it is never rented again.

## Give the ride-sharing design as four beats. {#lld06-pitch}
1. Rider, Driver, Location, Trip, with `RideService` on top.
2. Matching is a pluggable strategy; pricing is a strategy with surge as a wrapper.
3. Trip status is one class per state, so illegal moves raise.
4. Race: two riders grab one driver, fixed by `try_assign()` under a per-driver lock; at Uber scale a geohash replaces the scan.

Grade Got it only if you said all four beats.
**Example:** like describing an auto stand: drivers, a dispatcher, the fare meter, and one rule that no driver takes two fares.
