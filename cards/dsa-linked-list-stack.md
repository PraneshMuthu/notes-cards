---
topic: DSA · Linked List & Stack
group: DSA
---

## Reverse Linked List: reverse a singly linked list. E.g. 1->2->3 becomes 3->2->1. {#dsals-reverse-list}
**Pattern:** iterative pointer reversal.
**Insight:** walk once; for each node, save `next`, point the node back at `prev`, then advance both. `prev` ends as the new head.
**Complexity:** O(n) time, O(1) space.

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

## Merge Two Sorted Lists: merge two sorted linked lists into one sorted list. E.g. 1->2->4 and 1->3->4 gives 1->1->2->3->4->4. {#dsals-merge-sorted-lists}
**Pattern:** dummy head plus two-pointer merge.
**Insight:** a dummy node removes the "empty result" special case. Append the smaller head each step, then attach whatever list remains.
**Complexity:** O(n + m) time, O(1) space.

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

## Linked List Cycle: does a linked list contain a cycle? E.g. 3->2->0->-4 with -4 pointing back to 2 gives true. {#dsals-list-cycle}
**Pattern:** fast and slow pointers (Floyd).
**Insight:** fast moves 2 steps, slow moves 1. If there is a cycle they must meet inside it; if fast hits the end, there is none.
**Complexity:** O(n) time, O(1) space.

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

## Remove Nth Node From End: delete the nth node counted from the tail in one pass. E.g. 1->2->3->4->5, n=2 gives 1->2->3->5. {#dsals-remove-nth-from-end}
**Pattern:** two pointers with a fixed gap.
**Insight:** move `fast` n steps ahead of `slow`, then advance both until fast is on the last node. Slow is then just before the target. A dummy head handles removing the first node.
**Complexity:** O(n) time, O(1) space.

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

## Valid Parentheses: a string of ()[]{} brackets; are they all closed in the correct order? E.g. "([])" gives true, "(]" gives false. {#dsals-valid-parentheses}
**Pattern:** stack.
**Insight:** push opening brackets; on a closing one, the stack top must be its matching opener. At the end the stack must be empty.
**Complexity:** O(n) time, O(n) space.

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

## Min Stack: design a stack with push, pop, top and get-min all in O(1). E.g. push 2, push 1, getMin gives 1; pop; getMin gives 2. {#dsals-min-stack}
**Pattern:** stack storing running minimum with each element.
**Insight:** store `(value, min so far)` per entry. The current minimum is always the top entry's second field, and popping restores the previous minimum automatically.
**Complexity:** O(1) time per operation, O(n) space.

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

## Daily Temperatures: for each day, how many days until a warmer one (0 if none)? E.g. [73,74,75,71,69,72,76,73] gives [1,1,4,2,1,1,0,0]. {#dsals-daily-temperatures}
**Pattern:** monotonic decreasing stack of indices.
**Insight:** keep indices of days still waiting for a warmer day. When today is warmer than the stack top, pop it and its answer is the index gap.
**Complexity:** O(n) time (each index pushed and popped once), O(n) space.

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

## LRU Cache: design a fixed-capacity cache with get(key) and put(key, value), both O(1); when full, evict the least recently used key. E.g. cap 2: put 1, put 2, get 1, put 3 evicts key 2. {#dsals-lru-cache}
**Pattern:** hash map plus recency order (doubly linked list; Python's OrderedDict does both).
**Insight:** the map finds a key in O(1); the ordered list moves a touched key to the "most recent" end and drops from the "oldest" end in O(1). Both get and put count as a use.
**Complexity:** O(1) time per operation, O(capacity) space.

<details>
<summary>Code</summary>

```python
from collections import OrderedDict
class LRUCache:
    def __init__(self, cap): self.cap, self.d = cap, OrderedDict()
    def get(self, k):
        if k not in self.d: return -1
        self.d.move_to_end(k)
        return self.d[k]
    def put(self, k, v):
        self.d[k] = v
        self.d.move_to_end(k)
        if len(self.d) > self.cap: self.d.popitem(last=False)
```

</details>
