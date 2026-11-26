# Card style guide

Each card is seen **cold, shuffled, on a phone**: the learner reads the question, says or types an answer, taps to reveal, then grades Forgot / Hard / Got it / Easy. A card is good when the learner can grade it honestly in about 10 seconds and the act of recalling it builds what the interview needs.

## Format

```markdown
## <question> {#<id>}
<line 1: the answer you would say out loud, at most ~25 words, conclusion first>
**Why:** <because X, so Y; the cost is Z — a mechanism or trade-off, never a new fact>
**Example:** <an everyday scene (Indian context welcome: UPI, trains, kirana shop, lifts) or a worked number>
**Trap:** <optional, one sentence on the same idea>
```

DSA cards use **Pattern:**, **Insight:**, **Complexity:**, **Edge:** and the code in `<details>`; see rule 13.

## Rules

1. **One gradable idea per card.** If you could get half of it right, it is two cards. A second "and" between separable facts, a list of more than 3, or two questions in one heading means split.
2. **The heading asks one question and shows the answer's shape**: "Which one, and why?", "Derive … from …", "What breaks, and what is the one fix?". No bare noun phrases, statements, yes/no, or "common mistakes" lists.
3. **Name the system in the heading** when the card is about one design ("BookMyShow: …", "UPI: …"). The topic label helps, but the question must make sense on its own.
4. **Don't leak the answer.** The heading must not contain the key noun of the answer (no "Why use State here?"; ask "Behaviour depends on mode; which pattern?").
5. **Line 1 is the whole answer.** The learner grades from line 1. Everything after supports it.
6. **Why explains, it doesn't add.** It starts with or implies "because". A new fact belongs on its own card.
7. **Every card gets an Example** — an everyday scene or a worked number with its derivation (`1M ÷ 4 s = 250K/s`). Never a definition or an extra fact.
8. **Define every jargon term on first use in that card**, in parentheses, in under 10 words (QPS, p99, idempotent, ISR, hash tag, saga…). Cards are not read in order.
9. **Give inputs, ask for derivations.** Estimation cards put the 2–3 givens in the heading and ask for the result and formula. At most ~5 numbers per answer.
10. **Pitch / walk-through cards are skeletons**: 3–4 numbered beats plus "Grade Got it only if you said all beats." Long pitches are split into beat cards.
11. **One home per lesson.** A principle that recurs (idempotency key, check-then-act race, cache stampede, L4 vs L7, at-least-once…) has one general card; other cards ask only for the system-specific twist, stated in line 1. Two cards must never give contradictory advice; if both options are valid, one card says *when* to use each.
12. **Failure-scenario and decision headings beat definition headings**: "Redis is slow, not down — what happens to your 2 ms budget?" beats "What is the failure handling?".
13. **DSA**: the question is the problem statement (shape first; famous name at the end or dropped), never the pattern. Grade on pattern + one-line insight; complexity is a check; code is reference. Add one **Edge:** line (empty input, duplicates, negatives, no answer). Confusable pairs get "which pattern?" discrimination cards.
14. **LLD**: train the decision (which pattern / structure, why, what breaks otherwise), not class lists. One everyday analogy plus one concrete code-level example.
15. **Correct before clever.** Verify commands, numbers and complexities (Redis docs, Python stdlib, known bounds) and state conditions behind a bound. No notes to the author ("verify before quoting"), no personal history in questions.

## Ids

- Keep the existing `{#id}` on the card that keeps the original idea, so progress carries over.
- Split-off and new cards get new ids with the same file prefix (`hld08-`, `lld04-`, `dsaah-` …), lowercase, hyphenated, unique across the deck.
- A card that is merged away is deleted; its id is not reused.
