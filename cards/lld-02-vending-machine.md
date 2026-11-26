---
topic: LLD 02 · Vending Machine
group: LLD
---

## Vending machine: insert money, select and cancel mean different things in Idle, HasMoney and Dispensing. Which pattern, and what does it replace? {#lld02-why-state}
State: one class per mode behind a `MachineState` interface; the machine delegates each input to `current_state`. It replaces an `if state == ...` ladder inside every method.
**Why:** a new mode (Maintenance) is one new class, not an edit to every method.
**Example:** a phone's power button wakes the screen when locked and locks it when unlocked. Same input, the mode decides.
**Trap:** putting the whole flow in one `buy_item()` method. Every new mode then edits it.

## Vending machine in HasMoney: what do insert money, select and cancel each do? {#lld02-state-table}
Insert adds to the balance and stays. Select moves to Dispensing if in stock and balance ≥ price, else rejects and stays. Cancel refunds the balance and goes to Idle.
**Why:** HasMoney is the only mode where all three inputs do real work, so it is where the bugs live.
**Example:** ₹20 inserted, Lays costs ₹30: select is rejected, and the user can insert ₹10 more or cancel for ₹20 back.

## Vending machine: what do Idle and Dispensing do with user inputs? {#lld02-state-idle-dispensing}
Idle accepts only insert money (→ HasMoney); select is rejected and cancel does nothing. Dispensing ignores every input until it finishes and returns to Idle by itself.
**Why:** Dispensing is driven by the machine, not the user, so input must not interrupt a half-dropped item.
**Example:** a lift's door button does nothing while the lift is moving between floors.

## Vending machine: insert, select and cancel are user inputs. What kind of transition is "dispense", and who triggers it? {#lld02-inputs-vs-auto}
An automatic transition the machine triggers itself: entering Dispensing drops the item, returns change and moves to Idle. The user never presses "dispense".
**Why:** inputs are external events. Modelling dispense as an input would let a user call it in any state.
**Example:** a washing machine moves from wash to rinse on its own; you only pressed start. A jam likewise auto-refunds and goes to Idle.

## Vending machine with one class per mode: which object holds the balance and selected item, and why not the mode objects? {#lld02-context}
The context, `VendingMachine`: it holds all mutable data (items, balance, selection, coin float) plus `current_state`, and delegates each input to it.
**Why:** mode objects then hold no data, so one shared instance of each is enough, and a transition is just repointing `current_state`.
**Example:** a TV remote's buttons (modes) hold nothing; the TV (context) remembers the channel and volume.
**Trap:** forgetting `current_state` on the context. Then nothing records which mode you are in.

## Vending machine: the mode objects store no reference to the machine. How does one move the machine to the next mode? {#lld02-wiring}
The machine passes itself in: `state.insert_money(self, amount)`. The state does its work, then calls `machine.set_state(machine.has_money_state)`.
**Why:** passing it per call makes `state → machine` a dependency (used only as a parameter), not an association (kept as a stored field).
**Example:** a delivery agent is handed the parcel at each stop instead of carrying a permanent copy of every customer's address book.

## Vending machine modes: pass the machine as a method parameter, or store it via the constructor? What is the trade-off? {#lld02-param-vs-ctor}
Parameter keeps modes data-free and shareable across many machines. Constructor storage gives shorter signatures but ties each mode object to one machine.
**Why:** a fleet of machines can then share one `IdleState` object. For a single machine either works.
**Example:** a shared office printer vs a printer bolted to one desk. Code: `IDLE.insert_money(machine, 10)` vs `IdleState(machine).insert_money(10)`.

## Vending machine: every machine shares one `IdleState` object, one `HasMoneyState`, and so on. What is that sharing called, and why is it not a Singleton? {#lld02-flyweight}
Flyweight: share one immutable, data-free object among many users instead of making copies. It is not a Singleton because nothing forbids creating another and nobody fetches it from a global.
**Why:** the mode objects hold no data, so copies would be identical; sharing saves memory and allocation.
**Example:** one printed bus timetable at a stop, read by every passenger. Code: `IDLE = IdleState()` at module level, passed to each machine.

## Vending machine: there is exactly one physical machine. What do you build instead of a Singleton, and which follow-up would a Singleton block? {#lld02-no-singleton}
Create one `VendingMachine` and pass it to whoever needs it. A Singleton would block the "fleet of machines" follow-up and make tests share global state.
**Why:** one machine is a deployment fact, not a rule the class should enforce.
**Example:** a test that needs a machine with 0 stock and another with 20 cannot have both if the class allows one instance.

## A single vending machine vs a fleet sharing central stock: which needs concurrency handling, and why? {#lld02-concurrency}
Only the fleet. One machine serves one person at a time, so there is no race; a fleet's machines can sell the last unit of the same central stock at once.
**Why:** pick hazards the real system has. Adding locks to a single serial machine is noise.
**Example:** one shop counter vs Swiggy Instamart's app selling the last packet from two phones at once.

## Vending machine: which three money paths must you handle beyond a normal sale? {#lld02-failure-paths}
Cancel after paying: full refund. Paid more than the price: dispense, then return change. Item jams: auto-refund and go to Idle.
**Why:** money in must equal item out plus money back on every path, or the machine keeps cash it should not.
**Example:** ₹50 for a ₹30 item: dispense, then return ₹20.
**Also:** paid too little waits for more money or cancel. "Cannot make change" is a v1 out-of-scope note.

## Vending machine: the coin float (coins for change) only ever goes down until it cannot make change. What is missing from `CoinInventory`? {#lld02-dead-code}
The inflow: inserted coins must be added to the float (`add()` called on insert), not only removed when giving change.
**Why:** model a resource's inflow and outflow. A method with no caller, like an unused `add()`, signals the missing half.
**Example:** a shop till that only pays out change and never keeps customers' cash. Code: `insert_money → float.add(coin)`; `refund → float.dispense_change(amt)`.

## Vending machine: why store stock as `quantity: int` rather than `in_stock: bool`? {#lld02-data-fidelity}
A bool cannot tell 1 left from 20 left, so you cannot decrement on sale, restock by a count, or raise a low-stock alert.
**Why:** store the quantity the rules need; derive the bool (`quantity > 0`) when asked.
**Example:** a kirana shop's register says "Maggi: 3", not "Maggi: yes".

## Vending machine extension: accept card and UPI as well as cash. How do you add payment methods without editing the machine? {#lld02-extensions}
A `PaymentStrategy` interface with `pay(amount) -> bool`, one class per method (Cash, Card, UPI), chosen by the user at checkout.
**Why:** the payment algorithm varies by choice, not by machine mode, so it is a strategy, not another state.
**Example:** a petrol pump that takes cash, card or UPI at the same nozzle. Code: `machine.checkout(UpiPayment(vpa))`.

## Vending machine extension: tell the operator when an item runs low, without the machine knowing about SMS or email. How? {#lld02-ext-alerts}
Observer: the machine keeps a list of listeners and calls `on_low_stock(item)` on each from `reduce_stock` when quantity drops below a threshold.
**Why:** a new alert channel is a new listener; the machine never changes.
**Example:** a school bell rings once and every class reacts in its own way. Code: `for l in self.listeners: l.on_low_stock(item)`.

## Give the vending machine design as three beats. {#lld02-pitch}
1. It is a state machine: Idle, HasMoney and Dispensing are classes behind `MachineState`.
2. `VendingMachine` is the context: it holds balance, selection and coin float, and delegates each input to `current_state`.
3. A mode does its work and repoints `current_state`; dispense and refund are automatic transitions.
Grade Got it only if you said all three beats.
