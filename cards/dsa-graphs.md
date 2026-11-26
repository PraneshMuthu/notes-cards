---
topic: DSA · Graphs
group: DSA
---

## Grid of '1' (land) and '0' (water): count the groups of land cells joined up, down, left or right. E.g. [["1","1","0"],["0","0","1"]] gives 2. (Number of Islands) {#dsagr-number-of-islands}
**Pattern:** grid flood fill with DFS (each island is one connected component).
**Insight:** scan every cell; on unvisited land, count one island and "sink" the whole island (mark its cells '0') so none of it is counted again.
**Complexity:** O(R × C) time, O(R × C) space in the worst case (stack).
**Edge:** recursive DFS on a 300 × 300 all-land grid goes 90,000 deep and breaks Python's default recursion limit (1,000); use an explicit stack or BFS, as below. Empty grid → 0.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def num_islands(g):
    R, C, n = len(g), len(g[0]), 0
    for r0 in range(R):
        for c0 in range(C):
            if g[r0][c0] != '1': continue
            n += 1; g[r0][c0] = '0'; st = [(r0, c0)]
            while st:
                r, c = st.pop()
                for nr, nc in ((r+1,c), (r-1,c), (r,c+1), (r,c-1)):
                    if 0 <= nr < R and 0 <= nc < C and g[nr][nc] == '1':
                        g[nr][nc] = '0'; st.append((nr, nc))
    return n
```

</details>

## Given one node of a connected undirected graph (each node has a value and a list of neighbours), build a fully separate copy. E.g. a triangle 1–2–3 gives a new triangle with no shared nodes. (Clone Graph) {#dsagr-clone-graph}
**Pattern:** graph traversal (DFS or BFS) plus an old-node → new-node hash map.
**Insight:** the map doubles as the visited set. The first time you see a neighbour, create its copy and queue it; always link copy(current) to copy(neighbour). Cycles stop because seen nodes are already in the map.
**Complexity:** O(V + E) time, O(V) space.
**Edge:** input None → None; a single node with no neighbours; self-loops work because the map already holds the copy.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def clone(node):
    if not node: return None
    copy, stack = {node: Node(node.val)}, [node]
    while stack:
        cur = stack.pop()
        for nb in cur.neighbors:
            if nb not in copy:
                copy[nb] = Node(nb.val); stack.append(nb)
            copy[cur].neighbors.append(copy[nb])
    return copy[node]
```

</details>

## n courses and prerequisite pairs [a, b] meaning "take b before a": can every course be finished? E.g. n=2, [[1,0],[0,1]] gives false. (Course Schedule) {#dsagr-course-schedule}
**Pattern:** topological sort (an order where every edge points forward) by Kahn's algorithm: repeatedly remove nodes with in-degree 0 (no unmet prerequisites).
**Insight:** take every course with nothing left to wait for; finishing it lowers its dependants' counts. If all n get taken, there is no cycle. Courses on a cycle wait on each other forever and never reach 0.
**Complexity:** O(V + E) time, O(V + E) space.
**Edge:** a self-prerequisite [0,0] is a cycle → false; no prerequisites → true.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import deque
def can_finish(n, pre):
    adj, indeg = [[] for _ in range(n)], [0] * n
    for a, b in pre: adj[b].append(a); indeg[a] += 1
    q, done = deque(i for i in range(n) if indeg[i] == 0), 0
    while q:
        u = q.popleft(); done += 1
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0: q.append(v)
    return done == n
```

</details>

## Grid: 0 empty, 1 fresh orange, 2 rotten. Every minute each rotten orange rots its up/down/left/right fresh neighbours. Minutes until no fresh remain, or -1? E.g. [[2,1,1],[1,1,0],[0,1,1]] gives 4. (Rotting Oranges) {#dsagr-rotting-oranges}
**Pattern:** multi-source BFS (start the queue with every source at once), one level per minute.
**Insight:** all rotten oranges spread at the same time, so queue them together; each BFS level is one minute. Count fresh oranges, and if any are left when the queue empties, they were unreachable.
**Complexity:** O(R × C) time, O(R × C) space.
**Edge:** no fresh oranges at the start → 0; a fresh orange walled off by empty cells → -1.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
from collections import deque
def oranges_rotting(g):
    R, C, q, fresh = len(g), len(g[0]), deque(), 0
    for r in range(R):
        for c in range(C):
            if g[r][c] == 2: q.append((r, c))
            elif g[r][c] == 1: fresh += 1
    mins = 0
    while q and fresh:
        for _ in range(len(q)):
            r, c = q.popleft()
            for nr, nc in ((r+1,c), (r-1,c), (r,c+1), (r,c-1)):
                if 0 <= nr < R and 0 <= nc < C and g[nr][nc] == 1:
                    g[nr][nc] = 2; fresh -= 1; q.append((nr, nc))
        mins += 1
    return -1 if fresh else mins
```

</details>

## Nodes 0..n−1 and a list of undirected edges: how many separate connected groups? E.g. n=5, [[0,1],[1,2],[3,4]] gives 2. (Number of Connected Components) {#dsagr-connected-components}
**Pattern:** union-find (disjoint set union, DSU): each group has a root; find(x) walks up to it; union links two roots.
**Insight:** start with n groups. Each edge whose ends have different roots merges two groups, so subtract one. DSU beats DFS when edges arrive one at a time and you must answer after each.
**Complexity:** O(n + E · α(n)) only with path compression *and* union by size (α ≤ 4 in practice); compression alone gives O(log n) amortised per op. O(n) space.
**Edge:** no edges → n; duplicate edges and self-loops just hit "same root" and change nothing.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def count_components(n, edges):
    p, size = list(range(n)), [1] * n
    def find(x):
        while p[x] != x:
            p[x] = p[p[x]]; x = p[x]     # path halving (a form of compression)
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra == rb: continue
        if size[ra] < size[rb]: ra, rb = rb, ra
        p[rb] = ra; size[ra] += size[rb]  # union by size: small under big
        n -= 1
    return n
```

</details>

## Directed edges (u, v, w) with travel time w ≥ 0; a signal starts at node k. How long until all n nodes have it, or -1 if some never do? E.g. [[2,1,1],[2,3,1],[3,4,1]], n=4, k=2 gives 2. (Network Delay Time) {#dsagr-network-delay}
**Pattern:** Dijkstra: always settle the closest unsettled node next, using a min-heap of (distance, node).
**Insight:** the first time a node is popped, its distance is final: every other route goes through something at least as far, and weights are never negative. Skip stale pops. The answer is the largest final distance.
**Complexity:** O(E log E) time, O(V + E) space.
**Edge:** an unreachable node → -1. Negative weights break it (use Bellman-Ford); all weights equal → plain BFS is enough.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
import heapq
from collections import defaultdict
def network_delay(times, n, k):
    adj = defaultdict(list)
    for u, v, w in times: adj[u].append((v, w))
    dist, h = {}, [(0, k)]
    while h:
        d, u = heapq.heappop(h)
        if u in dist: continue
        dist[u] = d
        for v, w in adj[u]:
            if v not in dist: heapq.heappush(h, (d + w, v))
    return max(dist.values()) if len(dist) == n else -1
```

</details>
