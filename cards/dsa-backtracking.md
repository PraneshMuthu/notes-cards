---
topic: DSA · Backtracking
group: DSA
---

## Subsets: return all subsets (the power set) of an array of distinct numbers. E.g. [1,2] gives [[],[1],[2],[1,2]]. {#dsabt-subsets}
**Pattern:** backtracking, include-or-exclude decision per element.
**Insight:** at index i, branch twice: skip nums[i], or add it, recurse, then pop (undo). Each leaf at i = n is one subset.
**Complexity:** O(n x 2^n) time (2^n subsets, copying up to n each), O(n) recursion space excluding output.

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

## Permutations: return all orderings of an array of distinct numbers. E.g. [1,2,3] gives 6 permutations such as [1,2,3] and [3,1,2]. {#dsabt-permutations}
**Pattern:** backtracking with a used[] array.
**Insight:** at each position try every unused element, mark it used, recurse, then unmark. A full-length path is one permutation.
**Complexity:** O(n x n!) time, O(n) recursion space excluding output.

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

## Combination Sum: distinct positive numbers, reusable; list all unique combinations summing to a target. E.g. [2,3,6,7], target 7 gives [[2,2,3],[7]]. {#dsabt-combination-sum}
**Pattern:** backtracking with an index to avoid duplicate orderings.
**Insight:** at index i, take candidate i again (stay at i) or move to i+1. Never going back stops [2,3] and [3,2] both appearing.
**Complexity:** exponential, O(N^(T/M)) time (N candidates, T target, M smallest candidate); O(T/M) recursion depth.

<details>
<summary>Code</summary>

```python
def combination_sum(c, target):
    res = []
    def go(i, cur, rem):
        if rem == 0: res.append(cur[:]); return
        if rem < 0 or i == len(c): return
        cur.append(c[i]); go(i, cur, rem - c[i]); cur.pop()
        go(i + 1, cur, rem)
    go(0, [], target)
    return res
```

</details>

## Word Search: is a word spelled by adjacent grid cells (4 directions, no cell reused)? E.g. [["A","B"],["C","D"]], "ABDC" gives true. {#dsabt-word-search}
**Pattern:** grid DFS with backtracking.
**Insight:** DFS from each cell, matching one letter per step. Mark the cell '#' while exploring and restore it on return (mutates the grid).
**Complexity:** O(R x C x 3^L) time (L = word length; 3 choices after the first step), O(L) space.

<details>
<summary>Code</summary>

```python
def exist(b, w):
    R, C = len(b), len(b[0])
    def dfs(r, c, k):
        if k == len(w): return True
        if not (0 <= r < R and 0 <= c < C) or b[r][c] != w[k]: return False
        ch, b[r][c] = b[r][c], '#'
        ok = any(dfs(r + dr, c + dc, k + 1) for dr, dc in ((1,0), (-1,0), (0,1), (0,-1)))
        b[r][c] = ch
        return ok
    return any(dfs(r, c, 0) for r in range(R) for c in range(C))
```

</details>

## Generate Parentheses: list all well-formed strings of n pairs of parentheses. E.g. n=3 gives ["((()))","(()())","(())()","()(())","()()()"]. {#dsabt-generate-parentheses}
**Pattern:** backtracking with validity counters.
**Insight:** add '(' while opens < n; add ')' only while closes < opens. These two rules guarantee every built string is valid, so no filtering is needed.
**Complexity:** O(4^n / sqrt(n)) time (Catalan number of results, each length 2n), O(n) recursion space excluding output.

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
