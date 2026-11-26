# notes-cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a static, swipe-style recall app on GitHub Pages. It has FSRS spaced repetition, a mixed-topic feed and three queues, plus card decks generated from the HLD and LLD repos and common DSA problems.

**Architecture:**
- The app is static files with no build step.
- **Pure logic:** small ES modules under `js/` (parse, markdown, scheduler, store, picker, day) that know nothing about the browser. Node's built-in test runner tests them directly.
- **The browser part:** `js/app.js` is the only browser-facing module. It wires the DOM to the logic.
- **Card content:** Markdown files in `cards/`, listed in `cards/index.json`.
- **Progress:** an append-only review log in localStorage. FSRS state is rebuilt by replaying it.

**Tech Stack:**
- HTML, CSS and plain JS (ES modules).
- `ts-fsrs@5.4.2`, single-file `dist/index.mjs` with no dependencies, vendored to `vendor/ts-fsrs.mjs`.
- Node 22 `node --test` for tests (dev only, no npm dependencies).
- A service worker for offline use.

**Spec:** `docs/superpowers/specs/2026-11-26-notes-cards-design.md`

## Global Constraints

- **Repo:**
  - The local repo is `/Users/pranesh/Personal/notes-cards`.
  - The remote is exactly `git@github.com:PraneshMuthu/notes-cards.git`.
  - Never use the `gh` CLI; push only over SSH as PraneshMuthu.
  - Verify the remote before every push.
- **No build step:** every file is served as-is by GitHub Pages from `main`, folder `/`.
- **Relative paths only:** all URLs are relative (`./js/app.js`), because the site lives at `/notes-cards/`, not `/`.
- **FSRS settings:**
  - `request_retention: 0.9`
  - `learning_steps: ['1m','10m']`
  - `relearning_steps: ['10m','1d']`
  - `enable_fuzz: true` in the app. Tests pass `enable_fuzz: false`.
- **Grades:** Forgot = `Rating.Again` (1), Hard = 2, Got it = `Rating.Good` (3), Easy = 4.
- **Daily new-card cap:** default `10`, editable in settings.
- **"Today" boundary:** resets at **04:00 local time**.
- **Endless mode:** after the due cards, cards are weakest-first by retrievability, ascending. Every **5th** endless pick is a new card, if any exist. Endless new cards do not count toward the cap.
- **No short repeats:** skip cards shown in the last `min(20, floor(eligibleCount/2))` picks or in the last **10 minutes**. Exception: a learning or relearning card whose step is due.
- **Mixing:**
  - Never two consecutive cards from the same **topic**, unless only one topic is eligible.
  - **Groups** take equal turns (round-robin), not weighted by size.
- **Card copy:**
  - The back is readable in ~10 s.
  - Define jargon, lead with an example.
  - DSA backs use **Pattern / Insight / Complexity** plus an optional collapsed `<details>` code skeleton.
- **Theme:** mobile-first, dark mode via `prefers-color-scheme`, no horizontal scroll at 360 px width.

## Review Focus

1. **A `## ` line inside a fenced code block** (DSA code, Markdown examples) must stay part of the back, not start a new card. → test in Task 2.
2. **localStorage missing or throwing** (private mode, quota full):
   - The app must still run in memory.
   - It shows a visible "progress not being saved" banner.
   - It never crashes.

   → test in Task 4.
3. **Review-log entries for card ids no longer in the deck** (a card was edited or deleted) must be ignored, not crash the replay, and not count anywhere. → test in Task 4/5.
4. **An app left open past 04:00:** the "new left today" figure and the cap must be recomputed on every pick, not cached at load. → test in Task 5.
5. **Importing a malformed or foreign JSON file** must be rejected with a message and leave the existing log untouched. Importing a valid file twice must not duplicate entries. → test in Task 4.

---

## File Structure

```
notes-cards/
  index.html               app shell (one screen)
  styles.css               mobile-first, dark mode
  manifest.webmanifest     add-to-home-screen metadata
  icon.svg                 app icon
  sw.js                    service worker (offline)
  js/
    day.js                 dayKey(date, cutoffHour) – "today" with 4 AM cutoff
    parse.js               parseCardFile(text, fileName) → deck slice
    markdown.js            renderMarkdown(md) → safe HTML subset
    scheduler.js           thin wrapper over ts-fsrs
    store.js               review log + settings over a Storage-like object; replay; export/import
    picker.js              pickNext(...) – queues, filters, mixing, no-repeat
    app.js                 DOM wiring only
  vendor/ts-fsrs.mjs       vendored ts-fsrs@5.4.2 dist/index.mjs
  cards/
    index.json             ["hld-01-url-shortener.md", ...]
    *.md                   one topic per file
  scripts/check.mjs        validate cards + index.json (node scripts/check.mjs)
  tests/*.test.mjs         node --test tests
  docs/superpowers/...     spec + this plan
```

---

### Task 1: Repo scaffold, vendored FSRS, day boundary

**Files:**
- Create: `vendor/ts-fsrs.mjs`, `js/day.js`, `tests/day.test.mjs`, `.gitignore`, `README.md` (3 lines: what it is, `node --test`, `node scripts/check.mjs`)

**Interfaces:**
- Produces: `dayKey(date: Date, cutoffHour = 4): string`. It returns the local-time `YYYY-MM-DD` of `date - cutoffHour hours`.

- [ ] **Step 1:** `git init -b main` in `/Users/pranesh/Personal/notes-cards` (the `docs/` folder already exists there). Add the remote `git@github.com:PraneshMuthu/notes-cards.git`.
- [ ] **Step 2:** Vendor FSRS:
  ```
  npm pack ts-fsrs@5.4.2
  tar xzf ts-fsrs-5.4.2.tgz
  cp package/dist/index.mjs vendor/ts-fsrs.mjs
  ```
  Delete the tarball and the `package/` folder afterwards. Add a header comment in `vendor/ts-fsrs.mjs` naming the version and its MIT licence.
- [ ] **Step 3: Write the failing test** `tests/day.test.mjs`. Build the dates with `new Date(y, m, d, h, min)` (local time):
  ```js
  assert.equal(dayKey(new Date(2026,10,26,3,59)), '2026-11-25');
  assert.equal(dayKey(new Date(2026,10,26,4,0)),  '2026-11-26');
  assert.equal(dayKey(new Date(2026,10,26,23,30)),'2026-11-26');
  assert.equal(dayKey(new Date(2026,11,1,2,0)),   '2026-11-30'); // month rollover
  ```
- [ ] **Step 4:** Run `node --test tests/`. Expect a FAIL (module not found).
- [ ] **Step 5:** Implement `js/day.js`.
- [ ] **Step 6:** Run `node --test tests/`. Expect a PASS.
- [ ] **Step 7:** Commit with `chore: scaffold, vendor ts-fsrs 5.4.2, dayKey`.

### Task 2: Card file parser

**Files:**
- Create: `js/parse.js`, `tests/parse.test.mjs`

**Interfaces:**
- Produces: `parseCardFile(text: string, fileName: string): { topic, group, cards: Card[], warnings: string[] }`
  - `Card = { id, topic, group, front, back, file }`
- Produces: `slugify(s: string): string`. It lowercases, turns each run of non-`[a-z0-9]` characters into `-`, and trims dashes.

**Rules:**
- **Front matter:** optional, between `---` lines, with keys `topic` and `group`.
  - If `topic` is missing, it defaults to the filename without `.md`.
  - If `group` is missing, it defaults to the filename prefix before the first `-`, upper-cased.
- **Card front:** each line starting with `## ` outside a ``` fence begins a card. The heading text is the front.
  - A trailing `{#some-id}` is stripped from the front and used as the id.
  - Otherwise `id = slugify(topic) + '--' + slugify(front)`, truncated to 80 characters.
- **Card back:** everything until the next card heading, trimmed.
- **Empty back:** a card with an empty back is skipped, with a warning.
- **Duplicate ids in one file:** keep the first, warn on the rest.

- [ ] **Step 1: Write the failing tests:**
  - `parses front matter and two cards`: topic and group are read; `cards.length === 2`; the ids come from `{#..}`; the backs are trimmed.
  - `defaults topic/group from filename`: `'dsa-two-pointers.md'` gives group `'DSA'` and topic `'dsa-two-pointers'`.
  - `## inside code fence stays in back` (Review Focus 1): a back containing ```` ```\n## not a card\n``` ```` gives 1 card, and its back includes `## not a card`.
  - `slug id when no explicit id`: `id === 'hld-08-bookmyshow--why-uuid'` for topic `HLD 08 · BookMyShow` and front `Why UUID?`. The `·` collapses into the dash run.
  - `duplicate id warns and keeps first`.
  - `empty back skipped with warning`.
- [ ] **Step 2:** Run `node --test tests/parse.test.mjs`. Expect FAIL.
- [ ] **Step 3:** Implement it with a line-by-line scan that tracks an `inFence` flag (toggled by lines starting with ```` ``` ````).
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit with `feat: card file parser`.

### Task 3: Safe Markdown renderer

**Files:**
- Create: `js/markdown.js`, `tests/markdown.test.mjs`

**Interfaces:**
- Produces: `renderMarkdown(md: string): string` (HTML)

**Supported subset:**
- paragraphs
- `**bold**`, `*italic*` and `` `code` ``
- fenced code blocks, escaped inside `<pre><code>`
- `-` and `1.` lists, one level
- pipe tables, where the header row is followed by a `|---|` row
- lines that are exactly `<details>`, `</details>` or `<summary>…</summary>` pass through as raw HTML

Everything else is HTML-escaped.

- [ ] **Step 1: Write the failing tests:**
  - `escapes html`: `<script>x</script>` becomes `&lt;script&gt;…`.
  - Bold, italic and inline code each render.
  - A code fence keeps `<` escaped and does not render `**` inside.
  - A list of 2 items gives `<ul><li>…</li><li>…</li></ul>`.
  - A 2×2 pipe table gives `<table>` with `<th>` and `<td>`.
  - `details passthrough`: `<details>` and `<summary>Code</summary>` survive, and the content between them is rendered.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement it as a block scanner (fence, table, list, paragraph), with an inline pass applied *after* escaping.
- [ ] **Step 4:** Run the tests. Expect PASS.
- [ ] **Step 5:** Commit with `feat: safe markdown subset renderer`.

### Task 4: Scheduler wrapper and progress store

**Files:**
- Create: `js/scheduler.js`, `js/store.js`, `tests/store.test.mjs`

**Interfaces:**
- `scheduler.js`:
  - `makeFsrs({ fuzz = true } = {})` → a ts-fsrs instance with the Global Constraints settings.
  - `replay(entries: Review[], fsrs, knownIds: Set<string>): Map<cardId, FsrsCard>`.
    - It sorts entries by `t`, skips unknown ids, and starts each card from `createEmptyCard(firstReviewTime)`.
  - `retrievability(fsrs, card: FsrsCard, now: Date): number` (0..1).
  - `queueOf(card: FsrsCard | undefined, now): 'new'|'learning'|'relearning'|'due'|'later'`.
    - `undefined` gives `'new'`.
    - The State enum gives Learning or Relearning.
    - Review with `due <= now` gives `'due'`.
    - Anything else gives `'later'`.
- `store.js`:
  - `createStore(storage: Storage-like | null)` returns:
    - `{ ok: boolean, deviceId, reviews(): Review[], add(review), settings(), saveSettings(s), exportJson(): string, importJson(text): { added: number } }`
  - `Review = { c: cardId, g: 1..4, t: epochMs, d: deviceId, x?: true }`, where `x` marks an endless-mode pick.
  - **Storage keys:** `nc:v1:log`, `nc:v1:device`, `nc:v1:settings`.
  - **Device id:** `crypto.randomUUID()` on the first run.
  - **Settings default:** `{ newPerDay: 10 }`.
  - **Failure handling:** any throw from storage (or `storage === null`) gives `ok = false`, and the store keeps working in memory.
  - **Export format:** `{ app: 'notes-cards', version: 1, reviews }`.
  - **Import:** accepts only that shape and unions by the key `` `${c}|${t}|${d}` ``. Anything else throws `Error('Not a notes-cards export')` and the log is unchanged.

- [ ] **Step 1: Write the failing tests.** Use an in-memory fake Storage, `makeFsrs({fuzz:false})`, and fixed dates.
  - `replay Good then Again → relearning due +10m` (matches the spike: Good, Good gives Review; then Again gives Relearning at +10 min).
  - `relearning Good → review due +1d`.
  - `replay ignores unknown card ids` (Review Focus 3).
  - `queueOf undefined is new; due review is due; future review is later`.
  - `store survives throwing storage`: the storage's `getItem` and `setItem` throw, yet `ok === false`, `add` works, and `reviews().length === 1` (Review Focus 2).
  - `store persists across instances`: add on store A, then create store B on the same storage and B sees the entry.
  - `import rejects garbage, log unchanged`: both `'{"x":1}'` and `'not json'` throw (Review Focus 5).
  - `import is idempotent`: importing the same export twice gives `added` 2 then 0 (Review Focus 5).
- [ ] **Step 2:** Run `node --test tests/`. Expect FAIL.
- [ ] **Step 3:** Implement both modules. `scheduler.js` imports from `../vendor/ts-fsrs.mjs`.
- [ ] **Step 4:** Run `node --test tests/`. Expect PASS.
- [ ] **Step 5:** Commit with `feat: fsrs wrapper and progress store`.

### Task 5: Feed picker

**Files:**
- Create: `js/picker.js`, `tests/picker.test.mjs`

**Interfaces:**
- Consumes: `queueOf` and `retrievability` from Task 4, and `dayKey` from Task 1.
- Produces:
  ```
  pickNext({ cards, states, reviews, history, now, fsrs,
             filter: { queue: 'all'|'due'|'forgot'|'new', groups?: Set<string>, topics?: Set<string> },
             settings: { newPerDay }, session: { lastGroup?, endlessCount } })
    → { card, queue: 'relearning'|'learning'|'due'|'new'|'endless-new'|'weak', endless: boolean } | null
  newLeftToday(reviews, cards, now, newPerDay): number
  counts(cards, states, reviews, now, newPerDay): { due, forgot, newLeft }
  ```
  - `history` holds recent shows, `[{ id, at }]`, newest last.
  - `null` means no cards match the filter at all.
  - **`newLeftToday`:** the cap minus the number of distinct cards whose **first** review falls on `dayKey(now)` and has no `x`.
  - **The counts** are computed on every call; nothing is cached (Review Focus 4).

**Algorithm** (the tests do not fully determine it, so it is fixed here):
1. **`pool`:** the cards passing the group and topic filter.
2. **Tiers, in order:**
   - **T1:** learning or relearning cards with `due <= now`, soonest first.
   - **T2:** `'due'` cards, oldest due first.
   - **T3:** new cards in file order, only if `newLeftToday > 0`.
   - **T4:** endless. If `session.endlessCount % 5 === 4` and new cards exist, take a new card (`'endless-new'`). Otherwise take every studied card by retrievability, ascending (`'weak'`).
3. **Queue filters:**
   - `due` uses T1 and T2.
   - `forgot` uses all relearning cards, soonest due first, ignoring due time.
   - `new` uses all new cards, ignoring the cap. These are still counted, so they are not marked `x`.
   - `all` uses T1 → T2 → T3 → T4.
4. **No-repeat exclusion,** per Global Constraints.
   - A T1 card whose step is due is exempt.
   - If the exclusion empties everything, ignore it.
5. **Mixing:** let `lastTopic` be the topic of the last history id.
   - In the first non-empty tier, walk the groups in sorted order, starting after `session.lastGroup`. Pick the first group that has a candidate whose topic is not `lastTopic`, and take that group's best such candidate (topic ≠ `lastTopic`) in tier order.
   - If no such candidate exists, try the next tiers the same way. (For the `all` filter, T4 always exists while studied cards do.)
   - If still nothing, allow `lastTopic`.
6. **Return value:** `endless` is true for T4 picks. The caller bumps `session.endlessCount` and sets `session.lastGroup`.

- [ ] **Step 1: Write the failing tests** with a tiny deck built in code and `makeFsrs({fuzz:false})`:
  - `relearning before due before new`.
  - `never same topic back-to-back when another exists`: due cards are 3 from topic A and 1 from topic B, the last shown was A, so B is picked even though A's card is older.
  - `same topic allowed when only one topic eligible` (the topics filter is set to `{A}`).
  - `groups take equal turns`: 10 DSA cards and 2 PY cards, all new, `newPerDay` 4. The 4 picks alternate groups, DSA, PY, DSA, PY, in sorted group order after `lastGroup` (simulated by feeding each pick back into `history` and `session`).
  - `cap counts first reviews today only, ignores x`: 10 first-reviews today gives `newLeftToday === 0`; with `x:true` on all of them it gives `10`.
  - `cap resets at 4 AM, recomputed per call` (Review Focus 4): reviews at 03:00 today local and `now` at 03:59 give `newLeftToday` 0. The same reviews with `now` at 04:01 give `newPerDay`.
  - `endless: weakest first, every 5th new`: no due and cap exhausted. Picks 1–4 are `'weak'`, ordered by ascending retrievability, and pick 5 is `'endless-new'`.
  - `no repeat within window`: a card in the last 2 history entries is not picked while others exist.
  - `forgot filter shows relearning cards before their step`.
  - `returns null when filter matches no cards`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement `picker.js` per the algorithm above.
- [ ] **Step 4:** Run `node --test tests/`. Expect PASS, including the earlier tasks.
- [ ] **Step 5:** Commit with `feat: feed picker with queues, mixing, no-repeat`.

### Task 6: Card checker, sample deck, app UI, offline

**Files:**
- Create: `scripts/check.mjs`, `tests/check.test.mjs`, `cards/index.json`, `cards/sample-hld.md`, `cards/sample-dsa.md`, `index.html`, `styles.css`, `js/app.js`, `sw.js`, `manifest.webmanifest`, `icon.svg`

**Interfaces:**
- `scripts/check.mjs`:
  - exports `checkDeck(dir): { cards: number, errors: string[], warnings: string[] }`
  - when run directly, prints a summary and exits 1 on errors.
  - **Errors:**
    - a file in `index.json` is missing
    - a `.md` file in `cards/` is not listed in `index.json`
    - a card id is duplicated across files
    - a file has 0 cards
  - **Warning:** a back longer than 700 characters (the "readable in ~10 s" proxy).
- `app.js`:
  1. Fetches `cards/index.json`, then each file. Parses them, builds the deck, and drops duplicate ids across files with a `console.warn`.
  2. Creates the store on `localStorage`, wrapped so a throw gives `null`.
  3. Replays the log.
  4. Runs the feed loop.

- [ ] **Step 1: Write the failing test** `tests/check.test.mjs` against a temp dir: an unlisted file is an error, a duplicate id across files is an error, a clean deck gives 0 errors.
- [ ] **Step 2:** Run it. Expect FAIL. Implement `check.mjs`. Run it. Expect PASS.
- [ ] **Step 3: Sample deck.**
  - `cards/sample-hld.md`: 3 cards from `HLD/08-bookmyshow-autogenerated/solution.md`, including the `hold_id` card from the spec.
  - `cards/sample-dsa.md`: 2 DSA cards in the Pattern/Insight/Complexity + `<details>` format.
  - `node scripts/check.mjs` reports 0 errors.
- [ ] **Step 4: UI** per the spec's Screens sketch:
  - **Top bar:** the topic chip, plus `⏳ due · ✗ forgot · ✦ new left` from `counts()`, recomputed after every grade.
  - **Card:** the front, large. Tap anywhere to reveal the back (via `renderMarkdown`).
  - **Grade buttons:** four buttons, Forgot, Hard, Got it, Easy. Keyboard keys 1–4 and Space (reveal) for the laptop.
  - **After a grade:**
    1. `store.add({c, g, t: Date.now(), d, ...(endless && {x:true})})`.
    2. Update that card's state with `fsrs.next`.
    3. Push to `history` and update `session`.
    4. Slide the next card up (CSS transform, ~200 ms).
  - **Menu (☰):** the queue filter (All, Due, Forgot, New), group and topic checkboxes, the new-per-day number, Export (downloads `notes-cards-progress-YYYY-MM-DD.json`), and Import (file input; shows the success or error text).
  - **Banners:**
    - `store.ok === false` → a persistent banner "Progress isn't being saved on this browser — export a backup."
    - `pickNext` returns `null` → "No cards match this filter."
- [ ] **Step 5: Offline.**
  - `sw.js` with `const VERSION = 'v1'`. It precaches the app shell (html, css, js/*, vendor, manifest, icon).
  - Network-first, falling back to the cache, for `cards/*`. Cache-first for everything else.
  - `app.js` registers it with a relative path.
  - `manifest.webmanifest`: name "Notes Cards", `display: standalone`, `start_url: "./"`, and the icon.
- [ ] **Step 6:** Serve and smoke-test the app:
  ```
  python3 -m http.server 8765
  curl -s localhost:8765/ | grep -c '<script'
  curl -s localhost:8765/cards/index.json
  ```
  Both should return non-empty output.
- [ ] **Step 7:** Commit with `feat: app UI, card checker, sample deck, offline`.

### Task 7: Deploy to GitHub Pages

- [ ] **Step 1:** `git remote get-url origin` must print exactly `git@github.com:PraneshMuthu/notes-cards.git`.
- [ ] **Step 2:** `node --test tests/ && node scripts/check.mjs` passes.
- [ ] **Step 3:** `git push -u origin main`.
- [ ] **Step 4: Owner step.** Ask the owner to switch on Pages: Settings → Pages → Deploy from a branch → `main` / root.
- [ ] **Step 5:** `curl -sI https://praneshmuthu.github.io/notes-cards/` returns 200, and the cards load in a browser.

### Task 8: Content A, studied problems

**Files:**
- Create one file per problem, then update `cards/index.json`:
  - `cards/hld-01-url-shortener.md`, `hld-02-rate-limiter.md`, `hld-03-news-feed.md`, `hld-04-chat.md`, `hld-05-notification-system.md`, `hld-07-ride-hailing.md`, `hld-08-bookmyshow.md`
  - `cards/hld-building-blocks.md` (from `HLD/docs/building-blocks.md`)
  - `cards/lld-01-parking-lot.md` … `lld-07-notification-logger.md`
- Delete: `cards/sample-*.md` (move the `hold_id` card into `hld-08`).

**Source:**
- Each problem's `solution.md` (or the owner's own write-up files in non-autogenerated folders), including the 📝 notes.
- `LESSONS.md` in both repos for traps.

**Card rules:**
- About 10–20 cards per problem, covering:
  - the key numbers *with their derivation*, e.g. "2 cmds/ping → 500K ops/s → ~10 shards"
  - the main decisions and *why*
  - each deep-dive resolution
  - pushback answers
  - traps
- **Front:** a question you would be asked in an interview.
- **Back:** at most about 700 characters. Answer first, then **Why:** and **Example:**.
- **Ids:** explicit `{#hld08-...}` ids on every card.
- Front matter: `group: HLD` or `group: LLD`, and `topic: HLD 08 · BookMyShow`.

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** `node scripts/check.mjs` gives 0 errors and lists the warnings.
- [ ] **Step 3:** A fresh reviewer agent checks every card against its source. It looks for factual errors, cards that are too long, missing key decisions and undefined jargon. The writer fixes what it finds.
- [ ] **Step 4:** Commit with `content: cards for studied HLD/LLD problems`.

### Task 9: Content B, unstudied problems

**Files:**
- Create: `cards/hld-06-typeahead.md`, `hld-09-distributed-cache.md`, `hld-10-kv-store.md`, `hld-11-payment-upi.md`, `hld-12-flash-sale.md`, `lld-08-twitter.md`, `lld-09-snake-ladder-chess.md`, `lld-10-amazon-locker.md`
- Update `index.json`.

The rules, the check and the review steps are the same as in Task 8. Commit with `content: cards for remaining HLD/LLD problems`.

### Task 10: Content C, DSA

**Files:**
- Create: `cards/dsa-arrays-hashing.md`, `dsa-two-pointers.md`, `dsa-sliding-window.md`, `dsa-binary-search.md`, `dsa-linked-list-stack.md`, `dsa-trees.md`, `dsa-graphs.md`, `dsa-heap-intervals.md`, `dsa-dp.md`, `dsa-backtracking.md`
- Update `index.json`.

**Card rules:**
- About 50 problems in total, chosen from the most common interview set.
- **Front:** the problem paraphrased in 1–3 lines with one small example input and output.
- **Back:** `**Pattern:**`, `**Insight:**` (one line), `**Complexity:**` (time and space), and a `<details><summary>Code</summary>` block holding a 5–12 line Python skeleton.
- `group: DSA`, `topic: DSA · Two Pointers`.

The check and review steps are the same as in Task 8. The reviewer also confirms each complexity is correct and each insight actually solves the problem. Commit with `content: DSA cards`.

### Task 11: End-to-end QA and final push

- [ ] **Step 1:** `node --test tests/` and `node scripts/check.mjs` both pass. Record the total card count.
- [ ] **Step 2:** Run a browser QA pass on `python3 -m http.server`, at 390×844 (phone) and desktop size:
  - Reveal and grade 15 cards. Check that no topic appears twice in a row and that the counters change.
  - Grade one card Forgot, then open the Forgot filter and check that it is listed.
  - Use the topic filter set to one topic.
  - Export, then import the same file and check that 0 entries were added.
  - Import a garbage file and check that the error appears.
  - Reload and check that progress is kept.
  - Check there is no horizontal scroll at 360 px.
  - Check the console has no errors.
- [ ] **Step 3:** Fix anything found (each fix gets a test where the logic allows), then commit.
- [ ] **Step 4:** Verify the remote, push, and confirm the live site loads the full deck.
