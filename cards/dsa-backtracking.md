---
topic: DSA · Backtracking
group: DSA
---

## Array of distinct numbers: return every subset, including the empty one. E.g. [1,2] gives [[],[1],[2],[1,2]]. (Subsets) {#dsabt-subsets}
**Pattern:** backtracking (build a choice, recurse, then undo it) with an include-or-skip decision per element.
**Insight:** at index i, branch twice: skip nums[i], or add it, recurse, then pop it (undo). Each path that reaches i = n is one subset, so there are exactly 2ⁿ leaves.
**Complexity:** O(n · 2ⁿ) time (2ⁿ subsets, copying up to n each), O(n) recursion depth excluding output.
**Edge:** empty input → [[]], not []. With repeated values you must sort and skip equal siblings (Subsets II).
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def subsets(nums):
    res = []
    def go(i, cur):
        if i == len(nums): res.append(cur[:]); return
        go(i + 1, cur)
        cur.append(nums[i]); go(i + 1, cur); cur.pop()
    go(0, [])
    return res
```

</details>

## Array of distinct numbers: return every ordering of all of them. E.g. [1,2,3] gives 6 orderings such as [1,2,3] and [3,1,2]. (Permutations) {#dsabt-permutations}
**Pattern:** backtracking with a used[] array.
**Insight:** order matters, so at each position try *every* unused element (not just later ones as in subsets): mark it used, recurse, then unmark. A full-length path is one ordering.
**Complexity:** O(n · n!) time, O(n) recursion depth excluding output.
**Edge:** empty input → [[]]; with repeated values, sort and skip a value equal to an unused previous sibling.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def permute(nums):
    res = []
    def go(cur, used):
        if len(cur) == len(nums): res.append(cur[:]); return
        for i, x in enumerate(nums):
            if not used[i]:
                used[i] = True; cur.append(x); go(cur, used)
                cur.pop(); used[i] = False
    go([], [False] * len(nums))
    return res
```

</details>

## Distinct positive numbers, each usable any number of times, and a target: list every combination (order ignored) that sums to it. E.g. [2,3,6,7], target 7 gives [[2,2,3],[7]]. (Combination Sum) {#dsabt-combination-sum}
**Pattern:** backtracking with a start index (the combinations template).
**Insight:** loop i from `start`; recurse with start = i (same number may repeat), never earlier. Never looking back means [2,3] and [3,2] cannot both appear. Sort first, so you can stop once a number exceeds what is left.
**Complexity:** exponential, roughly O(N^(T/M)) (N numbers, T target, M smallest number); recursion depth at most T/M.
**Edge:** no combination → []; numbers bigger than the target are simply never used.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def combination_sum(c, target):
    c, res = sorted(c), []
    def go(start, cur, rem):
        if rem == 0: res.append(cur[:]); return
        for i in range(start, len(c)):
            if c[i] > rem: break
            cur.append(c[i]); go(i, cur, rem - c[i]); cur.pop()
    go(0, [], target)
    return res
```

</details>

## Grid of letters and a word: can the word be spelled by stepping between up/down/left/right neighbours, using each cell at most once? E.g. [["A","B"],["C","D"]], "ABDC" gives true. (Word Search) {#dsabt-word-search}
**Pattern:** grid DFS with backtracking.
**Insight:** from each cell, match one letter per step in 4 directions. Mark the cell '#' while it is on the current path so it is not reused, and restore it on the way back so other paths can use it.
**Complexity:** O(R · C · 3^L) time (L = word length; at most 3 new directions after the first step), O(L) recursion depth.
**Edge:** word longer than R · C → false at once.
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def exist(b, w):
    R, C = len(b), len(b[0])
    def dfs(r, c, k):
        if k == len(w): return True
        if not (0 <= r < R and 0 <= c < C) or b[r][c] != w[k]: return False
        ch, b[r][c] = b[r][c], '#'
        ok = any(dfs(r + dr, c + dc, k + 1)
                 for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)))
        b[r][c] = ch
        return ok
    return any(dfs(r, c, 0) for r in range(R) for c in range(C))
```

</details>

## n pairs of brackets: list every well-formed string of n "(" and n ")". E.g. n=3 gives ["((()))","(()())","(())()","()(())","()()()"]. (Generate Parentheses) {#dsabt-generate-parentheses}
**Pattern:** backtracking with two counters (opens used, closes used).
**Insight:** add "(" while opens < n; add ")" only while closes < opens. Those two rules make every built string valid, so nothing has to be generated and then filtered.
**Complexity:** O(4ⁿ / √n) time: the answer count is the nth Catalan number (the count of balanced bracket strings, about 4ⁿ / n^1.5), each of length 2n. O(n) recursion depth.
**Edge:** n = 0 → [""].
Grade on pattern + insight; complexity is a check.

<details>
<summary>Code</summary>

```python
def generate(n):
    res = []
    def go(s, o, c):
        if len(s) == 2 * n: res.append(s); return
        if o < n: go(s + '(', o + 1, c)
        if c < o: go(s + ')', o, c + 1)
    go('', 0, 0)
    return res
```

</details>
