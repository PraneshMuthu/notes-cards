---
topic: DSA · Heap & Intervals
group: DSA
---

## Kth Largest Element: find the kth largest value in an unsorted array. E.g. [3,2,1,5,6,4], k=2 gives 5. {#dsahi-kth-largest}
**Pattern:** min-heap of size k.
**Insight:** keep only the k largest seen so far; the heap root is the smallest of those, which is exactly the kth largest. Replace the root whenever a bigger value arrives.
**Complexity:** O(n log k) time, O(k) space.

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

## Merge Intervals: merge all overlapping intervals. E.g. [[1,3],[2,6],[8,10]] gives [[1,6],[8,10]]. {#dsahi-merge-intervals}
**Pattern:** sort by start, then sweep.
**Insight:** after sorting by start, an interval overlaps the last merged one only if its start is <= that one's end. Then extend the end with `max`; otherwise start a new one.
**Complexity:** O(n log n) time, O(n) space for output.

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

## Meeting Rooms II: given meeting [start, end) times, the minimum number of rooms needed. E.g. [[0,30],[5,10],[15,20]] gives 2. {#dsahi-meeting-rooms-ii}
**Pattern:** sort by start plus a min-heap of end times.
**Insight:** the heap holds end times of rooms in use. If the earliest end is <= the new start, reuse that room; else add a room. Heap size at the end is the answer.
**Complexity:** O(n log n) time, O(n) space.

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

## Find Median from Data Stream: support adding numbers and reading the current median at any time. E.g. add 1, add 2 gives 1.5; add 3 gives 2. {#dsahi-median-stream}
**Pattern:** two heaps (max-heap for the lower half, min-heap for the upper half).
**Insight:** keep the halves balanced so the lower half is equal in size or one larger. The median is the lower top, or the average of both tops. Python has no max-heap, so store negatives.
**Complexity:** O(log n) per add, O(1) per median, O(n) space.

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

## Non-overlapping Intervals: the minimum number of intervals to remove so the rest do not overlap. E.g. [[1,2],[2,3],[3,4],[1,3]] gives 1. {#dsahi-non-overlapping}
**Pattern:** greedy, sort by end time (interval scheduling).
**Insight:** always keep the interval that ends earliest, since it leaves the most room. Any interval starting before the kept end overlaps and is removed. Touching ends (2 and 2) do not overlap.
**Complexity:** O(n log n) time, O(1) extra space.

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
