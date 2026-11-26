---
topic: DSA · Heap & Intervals
group: DSA
---

## Unsorted integer array and k: the kth largest value (counting repeats). E.g. [3,2,1,5,6,4], k=2 gives 5. (Kth Largest Element in an Array) {#dsahi-kth-largest}
**Pattern:** min-heap of size k (a heap: a tree that hands you its smallest item in O(log n)).
**Insight:** keep only the k largest values seen so far. The smallest of those, the heap's top, is exactly the kth largest; when a bigger value arrives, it replaces the top.
**Complexity:** O(n log k) time, O(k) space. Quickselect (partition like quicksort, recurse into one side) is O(n) on average, O(n²) worst.
**Edge:** repeats count separately ([3,3,1], k=2 → 3); k = n → the minimum.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
import heapq
def kth_largest(nums, k):
    h = nums[:k]
    heapq.heapify(h)
    for x in nums[k:]:
        if x > h[0]: heapq.heapreplace(h, x)
    return h[0]
```

</details>

## List of [start, end] intervals in any order: merge every group that overlaps. E.g. [[1,3],[2,6],[8,10]] gives [[1,6],[8,10]]. (Merge Intervals) {#dsahi-merge-intervals}
**Pattern:** sort by start, then one sweep.
**Insight:** once sorted by start, an interval can only overlap the last merged one, and does when its start ≤ that end. Then extend the end with max (it may be swallowed whole); otherwise start a new group.
**Complexity:** O(n log n) time, O(n) space for the output.
**Edge:** touching intervals [1,2],[2,3] merge to [1,3]; a nested one [1,10],[2,3] must not shrink the end (hence max).
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def merge(iv):
    iv.sort()
    out = []
    for s, e in iv:
        if out and s <= out[-1][1]: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return out
```

</details>

## Meetings as [start, end) times (end is exclusive): the fewest rooms so no two overlapping meetings share one. E.g. [[0,30],[5,10],[15,20]] gives 2. (Meeting Rooms II) {#dsahi-meeting-rooms-ii}
**Pattern:** sort by start, plus a min-heap of the end times of rooms in use.
**Insight:** for each meeting, if the earliest-ending room is free (end ≤ start), reuse it; else open a room. A room is added only when every room in the heap is busy at that moment, so the final heap size is the most meetings ever running at once.
**Complexity:** O(n log n) time, O(n) space.
**Edge:** back-to-back [1,5],[5,8] share one room because end is exclusive; no meetings → 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
import heapq
def min_rooms(iv):
    iv.sort()
    h = []
    for s, e in iv:
        if h and h[0] <= s: heapq.heapreplace(h, e)
        else: heapq.heappush(h, e)
    return len(h)
```

</details>

## Numbers arrive one at a time; at any moment, report the median of everything so far, with add in O(log n). E.g. add 1, add 2 gives 1.5; add 3 gives 2. (Find Median from Data Stream) {#dsahi-median-stream}
**Pattern:** two heaps: a max-heap for the lower half, a min-heap for the upper half.
**Insight:** keep the halves balanced (lower equal or one bigger) and every lower value ≤ every upper value. The median is then the lower top, or the average of both tops.
**Complexity:** O(log n) per add, O(1) per median, O(n) space.
**Edge:** Python has only a min-heap, so store the lower half negated; even count → average of the two tops.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
import heapq
class MedianFinder:
    def __init__(self): self.lo, self.hi = [], []  # lo holds negated values
    def add(self, x):
        heapq.heappush(self.lo, -x)
        heapq.heappush(self.hi, -heapq.heappop(self.lo))
        if len(self.hi) > len(self.lo):
            heapq.heappush(self.lo, -heapq.heappop(self.hi))
    def median(self):
        if len(self.lo) > len(self.hi): return -self.lo[0]
        return (-self.lo[0] + self.hi[0]) / 2
```

</details>

## List of intervals: the fewest to delete so that none of the rest overlap. E.g. [[1,2],[2,3],[3,4],[1,3]] gives 1 (delete [1,3]). (Non-overlapping Intervals) {#dsahi-non-overlapping}
**Pattern:** greedy interval scheduling: sort by **end** time.
**Insight:** keep the interval that finishes first, because it leaves the most room for the rest. Any interval starting before the last kept end overlaps it and is deleted.
**Complexity:** O(n log n) time, O(1) extra space.
**Edge:** touching ends ([1,2],[2,3]) do not overlap, hence `s >= end`. Sorting by start instead keeps a long early interval that blocks many short ones.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def erase_overlap(iv):
    iv.sort(key=lambda x: x[1])
    end, removed = float('-inf'), 0
    for s, e in iv:
        if s >= end: end = e
        else: removed += 1
    return removed
```

</details>

## k linked lists, each sorted: combine them into one sorted list. E.g. [1->4->5, 1->3->4, 2->6] gives 1->1->2->3->4->4->5->6. (Merge k Sorted Lists) {#dsahi-merge-k-lists}
**Pattern:** min-heap holding the current head of each list.
**Insight:** the smallest remaining node is always one of the k heads. Pop it, append it, push its successor. Store (value, list index, node) so equal values never compare nodes.
**Complexity:** O(N log k) time (N total nodes), O(k) space. Merging lists one by one is O(N · k).
**Edge:** some or all lists empty → skip None heads; all empty → None.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
import heapq
def merge_k(lists):
    h = [(n.val, i, n) for i, n in enumerate(lists) if n]
    heapq.heapify(h)
    dummy = tail = ListNode()
    while h:
        _, i, n = heapq.heappop(h)
        tail.next = n; tail = n
        if n.next: heapq.heappush(h, (n.next.val, i, n.next))
    return dummy.next
```

</details>
