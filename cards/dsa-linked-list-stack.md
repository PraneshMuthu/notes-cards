---
topic: DSA · Linked List & Stack
group: DSA
---

## Singly linked list: reverse it in place and return the new head. E.g. 1->2->3 becomes 3->2->1. (Reverse Linked List) {#dsals-reverse-list}
**Pattern:** iterative pointer reversal with three pointers (prev, current, next).
**Insight:** walk once; for each node, save its next, point it back at prev, then step both forward. Saving next first is what stops you losing the rest of the list. prev ends as the new head.
**Complexity:** O(n) time, O(1) space. (Recursion is O(n) stack.)
**Edge:** empty list or single node → returned unchanged.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def reverse_list(head):
    prev = None
    while head:
        nxt = head.next
        head.next = prev
        prev, head = head, nxt
    return prev
```

</details>

## Two sorted linked lists: splice them into one sorted list. E.g. 1->2->4 and 1->3->4 give 1->1->2->3->4->4. (Merge Two Sorted Lists) {#dsals-merge-sorted-lists}
**Pattern:** dummy head (a placeholder node before the real first node) plus a two-pointer merge.
**Insight:** the dummy removes the "result is still empty" special case. Attach the smaller head each step; when one list runs out, attach the rest of the other in one go.
**Complexity:** O(n + m) time, O(1) space.
**Edge:** one or both lists empty → the other list (or None).
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def merge_two(a, b):
    dummy = tail = ListNode()
    while a and b:
        if a.val <= b.val: tail.next, a = a, a.next
        else: tail.next, b = b, b.next
        tail = tail.next
    tail.next = a or b
    return dummy.next
```

</details>

## Linked list: does following next pointers ever loop back, using O(1) extra space? E.g. 3->2->0->-4 with -4 pointing back to 2 gives true. (Linked List Cycle) {#dsals-list-cycle}
**Pattern:** fast and slow pointers (Floyd's cycle detection).
**Insight:** fast moves 2 steps, slow 1. Inside a loop, fast gains one step per move, so it must land on slow; if fast reaches the end, there is no loop.
**Complexity:** O(n) time, O(1) space. (A visited set is O(n) space.)
**Edge:** empty list → false; one node pointing to itself → true.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow, fast = slow.next, fast.next.next
        if slow is fast: return True
    return False
```

</details>

## Linked list and n: delete the nth node counted from the end, in one pass. E.g. 1->2->3->4->5, n=2 gives 1->2->3->5. (Remove Nth Node From End of List) {#dsals-remove-nth-from-end}
**Pattern:** two pointers with a fixed gap, plus a dummy head.
**Insight:** move fast n steps ahead of slow, then move both until fast is on the last node. Slow is then just before the node to delete, so skip it.
**Complexity:** O(n) time, O(1) space.
**Edge:** n equal to the length removes the head; the dummy node makes that case the same as any other.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def remove_nth(head, n):
    dummy = ListNode(0, head)
    fast = slow = dummy
    for _ in range(n): fast = fast.next
    while fast.next:
        fast, slow = fast.next, slow.next
    slow.next = slow.next.next
    return dummy.next
```

</details>

## String of ( ) [ ] { }: is every bracket closed by the right type, in the right order? E.g. "([])" gives true; "(]" and "([)]" give false. (Valid Parentheses) {#dsals-valid-parentheses}
**Pattern:** stack (last in, first out).
**Insight:** the most recently opened bracket must be the first one closed, which is exactly last-in-first-out. Push openers; on a closer, the top must be its matching opener.
**Complexity:** O(n) time, O(n) space.
**Edge:** a closer with an empty stack ("]") → false; openers left over at the end ("((") → false.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def is_valid(s):
    pair, st = {')': '(', ']': '[', '}': '{'}, []
    for c in s:
        if c in pair:
            if not st or st.pop() != pair[c]: return False
        else:
            st.append(c)
    return not st
```

</details>

## Design a stack where push, pop, top and get-min are all O(1). E.g. push 2, push 1, get-min gives 1; pop; get-min gives 2. (Min Stack) {#dsals-min-stack}
**Pattern:** stack where each entry also stores the minimum at that depth.
**Insight:** store (value, min so far) per entry. The current minimum is the top's second field, and popping automatically restores the minimum from before that push.
**Complexity:** O(1) per operation, O(n) space.
**Edge:** repeated minimums (push 1, push 1, pop) still leave 1; a single shared min variable would lose it.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
class MinStack:
    def __init__(self): self.st = []
    def push(self, x):
        m = min(x, self.st[-1][1]) if self.st else x
        self.st.append((x, m))
    def pop(self): self.st.pop()
    def top(self): return self.st[-1][0]
    def get_min(self): return self.st[-1][1]
```

</details>

## Daily temperatures: for each day, how many days until a strictly warmer day (0 if none)? E.g. [73,74,75,71,69,72,76,73] gives [1,1,4,2,1,1,0,0]. (Daily Temperatures) {#dsals-daily-temperatures}
**Pattern:** monotonic stack (a stack kept in sorted order: here, temperatures only decrease from bottom to top), holding indices.
**Insight:** the stack holds days still waiting for a warmer day. When today beats the top, pop it: today is its answer (gap = today − that index). Keep popping, then push today.
**Complexity:** O(n) time (each index pushed and popped once), O(n) space.
**Edge:** equal temperatures are not warmer (strict <); days left on the stack keep 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def daily_temps(t):
    res, st = [0] * len(t), []
    for i, x in enumerate(t):
        while st and t[st[-1]] < x:
            j = st.pop()
            res[j] = i - j
        st.append(i)
    return res
```

</details>

## Fixed-capacity cache with get(key) and put(key, value), both O(1); when full, evict the key used longest ago. E.g. capacity 2: put 1, put 2, get 1, put 3 evicts key 2. (LRU Cache) {#dsals-lru-cache}
**Pattern:** hash map (key → node) plus a doubly linked list ordered by recency, with dummy head and tail.
**Insight:** the map finds the node in O(1); the node knows its prev, so it can be unlinked in O(1). Every get or put moves it to the front; evict the node before the tail.
**Complexity:** O(1) per operation, O(capacity) space.
**Edge:** put on an existing key updates it *and* counts as a use. OrderedDict (move_to_end, popitem(last=False)) is the shortcut; mention it, but expect to code the list.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
class Node:
    def __init__(self, k=0, v=0): self.k, self.v, self.prev, self.next = k, v, None, None
class LRUCache:
    def __init__(self, cap):
        self.cap, self.m = cap, {}
        self.head, self.tail = Node(), Node()
        self.head.next, self.tail.prev = self.tail, self.head
    def _remove(self, n): n.prev.next, n.next.prev = n.next, n.prev
    def _add_front(self, n):
        n.prev, n.next = self.head, self.head.next
        self.head.next.prev = n; self.head.next = n
    def get(self, k):
        if k not in self.m: return -1
        n = self.m[k]; self._remove(n); self._add_front(n)
        return n.v
    def put(self, k, v):
        if k in self.m: self._remove(self.m[k])
        n = self.m[k] = Node(k, v); self._add_front(n)
        if len(self.m) > self.cap:
            lru = self.tail.prev; self._remove(lru); del self.m[lru.k]
```

</details>
