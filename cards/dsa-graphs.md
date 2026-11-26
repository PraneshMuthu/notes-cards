---
topic: DSA · Graphs
group: DSA
---

## Number of Islands: in a grid of '1' (land) and '0' (water), count groups of land connected up, down, left or right. E.g. [["1","1","0"],["0","0","1"]] gives 2. {#dsagr-number-of-islands}
**Pattern:** grid DFS flood fill (connected components).
**Insight:** each time you meet unvisited land, count one island and sink the whole island by marking its cells '0' via DFS.
**Complexity:** O(R x C) time, O(R x C) space worst case (recursion depth).

<details>
<summary>Code</summary>

```python
def num_islands(g):
    R, C, n = len(g), len(g[0]), 0
    def dfs(r, c):
        if not (0 <= r < R and 0 <= c < C) or g[r][c] != '1': return
        g[r][c] = '0'
        for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)): dfs(r + dr, c + dc)
    for r in range(R):
        for c in range(C):
            if g[r][c] == '1': n += 1; dfs(r, c)
    return n
```

</details>

## Clone Graph: deep-copy a connected undirected graph given one node (each node has a value and a neighbours list). E.g. a triangle of nodes 1,2,3 gives a new, separate triangle. {#dsagr-clone-graph}
**Pattern:** graph traversal plus old-to-new hash map.
**Insight:** the map doubles as the visited set. When you see a neighbour for the first time, create its copy; always link the copy of the current node to the copy of the neighbour.
**Complexity:** O(V + E) time, O(V) space.

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

## Course Schedule: n courses with prerequisite pairs [a, b] meaning b before a. Can you finish all? E.g. n=2, [[1,0],[0,1]] gives false (cycle). {#dsagr-course-schedule}
**Pattern:** topological sort (Kahn's BFS) / cycle detection in a directed graph.
**Insight:** repeatedly take courses with zero unmet prerequisites. If you can process all n, there is no cycle; if some remain stuck, they sit on a cycle.
**Complexity:** O(V + E) time, O(V + E) space.

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

## Rotting Oranges: grid with 0 empty, 1 fresh, 2 rotten. Each minute rotten oranges rot their 4-neighbour fresh ones. Minutes until none are fresh, or -1? E.g. [[2,1,1],[1,1,0],[0,1,1]] gives 4. {#dsagr-rotting-oranges}
**Pattern:** multi-source BFS, level by level.
**Insight:** start the queue with all rotten oranges at once; each BFS level is one minute. Track the fresh count; if any remain at the end, return -1.
**Complexity:** O(R x C) time, O(R x C) space.

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
            for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)):
                nr, nc = r + dr, c + dc
                if 0 <= nr < R and 0 <= nc < C and g[nr][nc] == 1:
                    g[nr][nc] = 2; fresh -= 1; q.append((nr, nc))
        mins += 1
    return -1 if fresh else mins
```

</details>

## Number of Connected Components: n nodes labelled 0..n-1 and an undirected edge list; count the connected groups. E.g. n=5, [[0,1],[1,2],[3,4]] gives 2. {#dsagr-connected-components}
**Pattern:** union-find (disjoint set union) with path compression.
**Insight:** start with n components. For each edge, if the endpoints have different roots, merge them and subtract one.
**Complexity:** O(n + E x alpha(n)) time (alpha is the near-constant inverse Ackermann), O(n) space.

<details>
<summary>Code</summary>

```python
def count_components(n, edges):
    p = list(range(n))
    def find(x):
        while p[x] != x:
            p[x] = p[p[x]]; x = p[x]
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb: p[ra] = rb; n -= 1
    return n
```

</details>
