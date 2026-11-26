import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFsrs, replay } from '../js/scheduler.js';
import { pickNext, newLeftToday, counts } from '../js/picker.js';

const f = makeFsrs({ fuzz: false });
const now = new Date(2026, 2, 10, 12, 0, 0);
const MIN = 60000, DAY = 86400000;
const ago = (ms) => now.getTime() - ms;
const card = (id, group, topic) => ({ id, group, topic, front: id, back: id, file: 'x.md' });
const filterAll = { queue: 'all' };
const settings = { newPerDay: 10 };
const session = { endlessCount: 0 };

// Graduated review card, last reviewed `days` ago (due before now).
const graduated = (id, days) => [
  { c: id, g: 3, t: ago(days * DAY), d: '' },
  { c: id, g: 3, t: ago(days * DAY) + 10 * MIN, d: '' },
];
const states = (cards, entries) => replay(entries, f, new Set(cards.map((c) => c.id)));
const pick = (over) => pickNext({
  cards: [], states: new Map(), reviews: [], history: [], now, fsrs: f,
  filter: filterAll, settings, session, ...over,
});

test('relearning before due before new', () => {
  const cards = [card('n', 'G', 't1'), card('d', 'G', 't2'), card('r', 'G', 't3')];
  const entries = [...graduated('d', 30), ...graduated('r', 30),
    { c: 'r', g: 1, t: ago(60 * MIN), d: '' }];
  const st = states(cards, entries);
  const reviews = entries;
  assert.equal(pick({ cards, states: st, reviews }).card.id, 'r');
  assert.equal(pick({ cards, states: st, reviews }).queue, 'relearning');
  const cards2 = cards.filter((c) => c.id !== 'r');
  assert.equal(pick({ cards: cards2, states: st, reviews }).card.id, 'd');
  assert.equal(pick({ cards: cards2.filter((c) => c.id === 'n'), states: st, reviews }).queue, 'new');
});

test('never same topic back-to-back when another exists', () => {
  const cards = [card('a1', 'G', 'A'), card('a2', 'G', 'A'), card('a3', 'G', 'A'), card('b1', 'G', 'B')];
  const entries = [...graduated('a1', 40), ...graduated('a2', 30), ...graduated('a3', 20), ...graduated('b1', 10)];
  const history = [{ id: 'zz', at: ago(60 * MIN) }, { id: 'a1', at: ago(30 * MIN) }];
  const r = pick({ cards: [...cards, card('zz', 'G', 'A')], states: states(cards, entries), reviews: entries, history });
  assert.equal(r.card.id, 'b1');
});

test('same topic allowed when only one topic eligible', () => {
  const cards = [card('a1', 'G', 'A'), card('a2', 'G', 'A'), card('b1', 'G', 'B')];
  const entries = [...graduated('a1', 40), ...graduated('a2', 30), ...graduated('b1', 10)];
  const history = [{ id: 'a1', at: ago(60 * MIN) }];
  const r = pick({ cards, states: states(cards, entries), reviews: entries, history,
    filter: { queue: 'all', topics: new Set(['A']) } });
  assert.equal(r.card.topic, 'A');
  assert.equal(r.card.id, 'a2');
});

test('groups take equal turns', () => {
  const cards = [];
  for (let i = 0; i < 10; i++) cards.push(card(`d${i}`, 'DSA', `dt${i}`));
  for (let i = 0; i < 2; i++) cards.push(card(`p${i}`, 'PY', `pt${i}`));
  const history = [];
  const sess = { endlessCount: 0 };
  const groups = [];
  for (let i = 0; i < 4; i++) {
    const r = pick({ cards, history, settings: { newPerDay: 4 }, session: sess });
    groups.push(r.card.group);
    history.push({ id: r.card.id, at: now.getTime() });
    sess.lastGroup = r.card.group;
  }
  assert.deepEqual(groups, ['DSA', 'PY', 'DSA', 'PY']);
});

test('cap counts first reviews today only, ignores x', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, 'G', `t${i}`));
  const rev = (x) => Array.from({ length: 10 }, (_, i) => ({
    c: `c${i}`, g: 3, t: new Date(2026, 2, 10, 9, i).getTime(), d: '', ...(x ? { x: true } : {}),
  }));
  assert.equal(newLeftToday(rev(false), cards, now, 10), 0);
  assert.equal(newLeftToday(rev(true), cards, now, 10), 10);
  // later (non-first) review does not count again
  const old = [{ c: 'c0', g: 3, t: ago(3 * DAY), d: '' }, { c: 'c0', g: 3, t: ago(60 * MIN), d: '' }];
  assert.equal(newLeftToday(old, cards, now, 10), 10);
  // unknown ids ignored
  assert.equal(newLeftToday([{ c: 'gone', g: 3, t: ago(MIN), d: '' }], cards, now, 10), 10);
});

test('cap resets at 4 AM, recomputed per call', () => {
  const cards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, 'G', `t${i}`));
  const reviews = Array.from({ length: 10 }, (_, i) => ({
    c: `c${i}`, g: 3, t: new Date(2026, 2, 10, 3, 0, i).getTime(), d: '',
  }));
  assert.equal(newLeftToday(reviews, cards, new Date(2026, 2, 10, 3, 59), 10), 0);
  assert.equal(newLeftToday(reviews, cards, new Date(2026, 2, 10, 4, 1), 10), 10);
  assert.equal(counts(cards, new Map(), reviews, new Date(2026, 2, 10, 3, 59), 10).newLeft, 0);
});

test('endless: weakest first, every 5th new', () => {
  const studied = [card('s1', 'G', 't1'), card('s2', 'G', 't2'), card('s3', 'G', 't3'), card('s4', 'G', 't4')];
  const cards = [...studied, card('n1', 'G', 't5'), card('n2', 'G', 't6')];
  // s1 oldest (weakest) ... s4 newest; all "later" (not due) so tiers 1-3 empty.
  const entries = [];
  studied.forEach((c, i) => entries.push(
    { c: c.id, g: 4, t: ago((12 - i * 3) * DAY), d: '' },
    { c: c.id, g: 4, t: ago((12 - i * 3) * DAY) + 10 * MIN, d: '' },
  ));
  const st = states(cards, entries);
  for (const c of studied) assert.ok(st.get(c.id).due.getTime() > now.getTime(), 'not due ' + c.id);
  const history = [];
  const sess = { endlessCount: 0 };
  const out = [];
  for (let i = 0; i < 5; i++) {
    const r = pick({ cards, states: st, reviews: [], history, settings: { newPerDay: 0 }, session: sess });
    out.push([r.card.id, r.queue, r.endless]);
    history.push({ id: r.card.id, at: now.getTime() });
    sess.endlessCount++;
  }
  assert.deepEqual(out.slice(0, 4), [['s1', 'weak', true], ['s2', 'weak', true], ['s3', 'weak', true], ['s4', 'weak', true]]);
  assert.equal(out[4][1], 'endless-new');
});

test('no repeat within window', () => {
  const cards = [card('a', 'G', 'A'), card('b', 'G', 'B'), card('c', 'G', 'C'), card('d', 'G', 'D')];
  const entries = [...graduated('a', 40), ...graduated('b', 30), ...graduated('c', 20), ...graduated('d', 10)];
  const history = [{ id: 'b', at: ago(50 * MIN) }, { id: 'a', at: ago(40 * MIN) }];
  // window = min(20, floor(4/2)) = 2 -> a and b excluded though a is oldest due
  const r = pick({ cards, states: states(cards, entries), reviews: entries, history });
  assert.equal(r.card.id, 'c');
  // 10-minute rule: a shown 5 min ago, outside the count window but inside 10 min
  const h2 = [{ id: 'a', at: ago(5 * MIN) }, { id: 'x1', at: ago(4 * MIN) }, { id: 'x2', at: ago(3 * MIN) }];
  assert.equal(pick({ cards, states: states(cards, entries), reviews: entries, history: h2 }).card.id, 'b');
  // exclusion ignored when it would empty everything
  const one = [card('a', 'G', 'A')];
  assert.equal(pick({ cards: one, history: [{ id: 'a', at: ago(MIN) }] }).card.id, 'a');
});

test('learning card whose step is due is exempt from no-repeat', () => {
  const cards = [card('l', 'G', 'A'), card('d', 'G', 'A')];
  const entries = [{ c: 'l', g: 3, t: ago(30 * MIN), d: '' }, ...graduated('d', 20)];
  const st = states(cards, entries);
  const r = pick({ cards, states: st, reviews: entries, history: [{ id: 'l', at: ago(MIN) }] });
  assert.equal(r.card.id, 'l');
});

test('forgot filter shows relearning cards before their step', () => {
  const cards = [card('r', 'G', 'A'), card('d', 'G', 'B')];
  const entries = [...graduated('r', 30), { c: 'r', g: 1, t: ago(MIN), d: '' }, ...graduated('d', 30)];
  const st = states(cards, entries);
  assert.ok(st.get('r').due.getTime() > now.getTime());
  const r = pick({ cards, states: st, reviews: entries, filter: { queue: 'forgot' } });
  assert.equal(r.card.id, 'r');
  assert.equal(r.queue, 'relearning');
});

test('returns null when filter matches no cards', () => {
  const cards = [card('n', 'G', 'A')];
  assert.equal(pick({ cards, filter: { queue: 'due' } }), null);
  assert.equal(pick({ cards, filter: { queue: 'forgot' } }), null);
  assert.equal(pick({ cards, filter: { queue: 'all', groups: new Set(['Z']) } }), null);
  assert.equal(pick({ cards: [] }), null);
});

test('new filter ignores cap and is not endless', () => {
  const cards = [card('n', 'G', 'A')];
  const r = pick({ cards, filter: { queue: 'new' }, settings: { newPerDay: 0 } });
  assert.deepEqual([r.card.id, r.queue, r.endless], ['n', 'new', false]);
});

test('counts', () => {
  const cards = [card('d', 'G', 'A'), card('r', 'G', 'B'), card('n', 'G', 'C')];
  const entries = [...graduated('d', 30), ...graduated('r', 30), { c: 'r', g: 1, t: ago(60 * MIN), d: '' }];
  const c = counts(cards, states(cards, entries), entries, now, 10);
  assert.deepEqual(c, { due: 2, forgot: 1, newLeft: 1 });
});

test('small deck rotates: no back-to-back repeats, all cards seen', () => {
  const cards = [card('a', 'G', 'T'), card('b', 'G', 'T'), card('c', 'G', 'T')];
  const reviews = [], history = [], seen = {};
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const t = new Date(now.getTime() + i * MIN);
    const r = pickNext({ cards, states: replay(reviews, f, new Set(['a', 'b', 'c'])), reviews, history,
      now: t, fsrs: f, filter: filterAll, settings, session: { endlessCount: 0 } });
    assert.notEqual(r.card.id, prev, `repeat at pick ${i}`);
    prev = r.card.id;
    seen[prev] = (seen[prev] ?? 0) + 1;
    history.push({ id: prev, at: t.getTime() });
    reviews.push({ c: prev, g: 3, t: t.getTime(), d: '' });
  }
  for (const id of ['a', 'b', 'c']) assert.ok(seen[id] >= 8, `${id} seen ${seen[id]}`);
});

test('endless: new cards only on every 5th pick, never bypass cap', () => {
  const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, 'G', `t${i}`));
  // Two capped new cards were first-reviewed today (graduated far into the future via Easy).
  const reviews = ['c0', 'c1'].flatMap((id, i) => [
    { c: id, g: 4, t: new Date(2026, 2, 10, 9, i).getTime(), d: '' },
    { c: id, g: 4, t: new Date(2026, 2, 10, 9, i, 30).getTime() + 10 * MIN, d: '' },
  ]);
  const st = states(cards, reviews);
  assert.equal(newLeftToday(reviews, cards, now, 2), 0);
  const history = [];
  for (let n = 0; n < 5; n++) {
    const r = pick({ cards, states: st, reviews, history, settings: { newPerDay: 2 }, session: { endlessCount: n } });
    if (n < 4) { assert.equal(r.queue, 'weak', `pick ${n}`); history.push({ id: r.card.id, at: now.getTime() }); }
    else assert.equal(r.queue, 'endless-new');
  }
});

test('three groups: round-robin starts after preset lastGroup', () => {
  const cards = [card('a', 'A', 't1'), card('b', 'B', 't2'), card('c', 'C', 't3')];
  const r = pick({ cards, session: { endlessCount: 0, lastGroup: 'B' } });
  assert.equal(r.card.group, 'C');
  assert.equal(pick({ cards, session: { endlessCount: 0, lastGroup: 'C' } }).card.group, 'A');
});
