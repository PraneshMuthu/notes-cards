---
topic: LLD 02 · Vending Machine
group: LLD
---

## Why model the vending machine with the State pattern? {#lld02-why-state}
The same input (insert money, select, cancel) means different things in different modes: Idle, HasMoney, Dispensing. One class per mode replaces an `if state == ...` ladder.
**Why:** a new mode becomes a new class, not an edit to existing code.
**Trap:** the owner's first try crammed the whole flow into one `buy_item()`.

## What is the vending machine's state table? {#lld02-state-table}
Inputs: `insert_money`, `select_product`, `cancel`.
- Idle: insert goes to HasMoney. Select is rejected. Cancel does nothing.
- HasMoney: insert stays. Select moves to Dispensing if in stock and balance ≥ price, else rejects and stays. Cancel refunds and goes to Idle.
- Dispensing: all three are ignored.

## Why is `dispense` not an input in the state table? {#lld02-inputs-vs-auto}
Inputs are external events from the user. Dispense and refund are automatic transitions the machine drives itself.
**Example:** entering Dispensing drops the item, returns change and goes to Idle. A jam auto-refunds and goes to Idle.

## In the State pattern, what is the "context" and what does it hold? {#lld02-context}
The context is `VendingMachine`. It holds all mutable data (items, balance, selected item, coin float) plus `current_state`. It delegates each input to the active state.
**Why:** states stay stateless behavior, so one shared instance of each is enough.
**Trap:** forgetting `current_state`. A transition is just repointing it.

## How does a state change the machine's state? {#lld02-wiring}
The machine passes itself in: `state.insert_money(self, amount)`. The state does its work, then calls `machine.set_state(machine.has_money_state)`.
**Why:** the state has no other way to reach the machine. This makes `state → machine` a dependency (a parameter), not an association (a stored field).

## Method-param context or constructor-injected `self.machine`? {#lld02-param-vs-ctor}
Method-param keeps states stateless and shareable. Constructor injection gives cleaner signatures but binds a state to one machine.
**Why:** param was chosen so a fleet of machines could share the same state objects. For one machine either is fine.

## Why not make `VendingMachine` a Singleton? {#lld02-no-singleton}
One physical machine does not mean the pattern is needed. Singleton adds global state, hurts testing, and would block the fleet follow-up.
**Why:** the senior signal is naming those costs. Just instantiate one object.
**Also:** sharing one instance of each stateless state is Flyweight, not Singleton.

## Does the vending machine need concurrency handling? {#lld02-concurrency}
No. One physical machine serves one user at a time, so there is no double-booking hazard.
**Why:** match the non-functional requirement to the real system. The valid follow-up is a fleet of machines sharing central inventory.

## What money failure paths should you ask about for a vending machine? {#lld02-failure-paths}
- Cancel after paying: full refund.
- Paid less than price: wait for more money or cancel.
- Paid more: dispense, then return change.
- Item jams: auto-refund.
- Cannot make change: out of scope in v1.

## What was wrong with `CoinInventory` first, and what is the lesson? {#lld02-dead-code}
`add()` had no caller. Inserted coins never entered the float, which only depleted.
**Why:** model a resource's inflow and outflow. A method with no caller signals a missing half of the model.
**Example:** `add()` on insert, `dispense_change()` on change or refund, `can_make_change()` to guard the sale.

## Which data structures and types did the vending machine fix? {#lld02-data-fidelity}
Stock is `quantity: int`, not a bool, because a bool cannot tell 1 left from 20. Items are a `dict[code → Item]` for O(1) lookup by code. The coin float is `CoinInventory`, so it does not clash with the user's balance.

## Extension: which pattern for card or UPI payment, and which for low-stock alerts? {#lld02-extensions}
Strategy for payment: a `PaymentStrategy`, like parking pricing. Observer for alerts: the machine is the subject and an alert service is notified in `reduce_stock`.
**Also:** Chain of Responsibility if selection grows a check pipeline (valid code, in stock, enough balance, can make change). Factory if the machine is built from a layout file.

## Give the 60-second pitch for the vending machine. {#lld02-pitch}
A vending machine is a state machine. Each mode (Idle, HasMoney, Dispensing) is a class behind `MachineState`. `VendingMachine` is the context: it holds balance, selected item and coin float, and delegates each input to `current_state`, which works and repoints the state.
**Why:** no `if state` ladder, and a new mode is a new class.

## What is the finalized scope of the vending machine? {#lld02-scope}
Money first: insert coins or notes, then select by code. One item per transaction. Cancel gives a full refund. The operator can `restock`.
**Why:** this is the standard interview version and the cleanest teach for State. Multi-buy with partial fulfilment, change-making limits and a fleet are stated follow-ups.
