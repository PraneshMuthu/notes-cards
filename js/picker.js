import { dayKey } from './day.js';
import { queueOf, retrievability } from './scheduler.js';

const TEN_MIN = 10 * 60 * 1000;

/** Cap minus distinct cards whose first review is today (4 AM cutoff) and not endless (`x`). */
export function newLeftToday(reviews, cards, now, newPerDay) {
  const known = new Set(cards.map((c) => c.id));
  const first = new Map();
  for (const r of reviews) {
    if (!known.has(r.c)) continue;
    const p = first.get(r.c);
    if (!p || r.t < p.t) first.set(r.c, r);
  }
  const today = dayKey(now);
  let used = 0;
  for (const r of first.values()) if (!r.x && dayKey(new Date(r.t)) === today) used++;
  return Math.max(0, newPerDay - used);
}

export function counts(cards, states, reviews, now, newPerDay) {
  let due = 0, forgot = 0, fresh = 0;
  for (const c of cards) {
    const st = states.get(c.id);
    const q = queueOf(st, now);
    if (q === 'new') fresh++;
    else if (q === 'due' || ((q === 'learning' || q === 'relearning') && st.due <= now)) due++;
    if (q === 'relearning') forgot++;
  }
  return { due, forgot, newLeft: Math.min(newLeftToday(reviews, cards, now, newPerDay), fresh) };
}

/** Cards seen (graded at least once) out of the deck, overall and per group (sorted by group). */
export function progress(cards, states) {
  const by = new Map();
  let seen = 0;
  for (const c of cards) {
    const g = by.get(c.group) ?? { group: c.group, seen: 0, total: 0 };
    g.total++;
    if (states.has(c.id)) { g.seen++; seen++; }
    by.set(c.group, g);
  }
  return { seen, total: cards.length, groups: [...by.values()].sort((a, b) => a.group.localeCompare(b.group)) };
}

function pickMixed(tier, avoidTopic, lastGroup) {
  const groups = [...new Set(tier.map((x) => x.card.group))].sort();
  let start = lastGroup === undefined ? 0 : groups.findIndex((g) => g > lastGroup);
  if (start < 0) start = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[(start + i) % groups.length];
    const hit = tier.find((x) => x.card.group === g && x.card.topic !== avoidTopic);
    if (hit) return hit;
  }
  return null;
}

// Order new cards so each group rotates through its topics (file order, wrapping),
// starting after the topic most recently introduced from that group (derived from reviews).
function rotateTopics(fresh, cards, reviews) {
  const topics = new Map(), byId = new Map(cards.map((c) => [c.id, c]));
  for (const c of cards) {
    if (!topics.has(c.group)) topics.set(c.group, []);
    if (!topics.get(c.group).includes(c.topic)) topics.get(c.group).push(c.topic);
  }
  const first = new Map();
  for (const r of reviews) {
    if (byId.has(r.c) && (!first.has(r.c) || r.t < first.get(r.c))) first.set(r.c, r.t);
  }
  const latest = new Map(); // group -> [time, topic]
  for (const [id, t] of first) {
    const c = byId.get(id);
    if (!latest.has(c.group) || t > latest.get(c.group)[0]) latest.set(c.group, [t, c.topic]);
  }
  const rank = (c) => {
    const list = topics.get(c.group), last = latest.get(c.group)?.[1];
    const i = list.indexOf(c.topic), l = last === undefined ? -1 : list.indexOf(last);
    return (i - l - 1 + list.length) % list.length;
  };
  return fresh.map((x) => ({ x, r: rank(x.card) })).sort((a, b) => a.r - b.r).map((e) => e.x);
}

function buildTiers(pool, ctx, skip, holdStep = () => false) {
  const { states, now, fsrs, filter, session, newCount, shown, cards, reviews } = ctx;
  const byAge = (a, b) => (shown.get(a.id) ?? 0) - (shown.get(b.id) ?? 0);
  const q = new Map(pool.map((c) => [c.id, queueOf(states.get(c.id), now)]));
  const cand = (queue) => (c) => ({ card: c, queue });
  const studied = pool.filter((c) => states.has(c.id));
  const fresh = rotateTopics(
    pool.filter((c) => !states.has(c.id)).filter((c) => !skip(c)).map(cand('new')), cards, reviews);
  const stepDue = studied.filter((c) => {
    const k = q.get(c.id);
    return (k === 'learning' || k === 'relearning') && states.get(c.id).due <= now && !holdStep(c);
  });
  const t1 = stepDue.sort((a, b) => states.get(a.id).due - states.get(b.id).due)
    .map((c) => ({ card: c, queue: q.get(c.id) }));
  const t2 = studied.filter((c) => q.get(c.id) === 'due' && !skip(c))
    .sort((a, b) => states.get(a.id).due - states.get(b.id).due || byAge(a, b)).map(cand('due'));

  if (filter.queue === 'due') return [t1, t2];
  if (filter.queue === 'forgot') {
    return [studied.filter((c) => q.get(c.id) === 'relearning' && !skip(c))
      .sort((a, b) => states.get(a.id).due - states.get(b.id).due).map(cand('relearning'))];
  }
  if (filter.queue === 'new') return [fresh];

  const t3 = newCount > 0 ? fresh : [];
  // Learning/relearning cards wait for their step; showing them early would grade them early.
  const stepPending = (c) => {
    const k = q.get(c.id);
    return (k === 'learning' || k === 'relearning') && states.get(c.id).due > now;
  };
  const settled = studied.filter((c) => !stepPending(c));
  const weak = settled.filter((c) => !skip(c))
    .map((c) => ({ card: c, queue: 'weak', r: retrievability(fsrs, states.get(c.id), now) }))
    .sort((a, b) => a.r - b.r || byAge(a.card, b.card));
  const endlessNew = fresh.map((x) => ({ ...x, queue: 'endless-new' }));
  // Fallback when no settled card is eligible (and, with nothing settled, no new card exists):
  // early steps, soonest first, rather than a repeat or an empty screen.
  const early = studied.filter((c) => stepPending(c) && !skip(c))
    .sort((a, b) => states.get(a.id).due - states.get(b.id).due).map(cand('weak'));
  const t4 = session.endlessCount % 5 === 4 && endlessNew.length ? endlessNew
    : settled.length ? (weak.length ? weak : early)
    : pool.some((c) => !states.has(c.id)) ? endlessNew : early;
  return [t1, t2, t3, t4];
}

/** Choose the next card to show, or null if the filter matches nothing. */
export function pickNext({ cards, states, reviews, history, now, fsrs, filter, settings, session }) {
  const pool = cards.filter((c) =>
    (!filter.groups || filter.groups.has(c.group)) && (!filter.topics || filter.topics.has(c.topic)));
  if (!pool.length) return null;

  const newCount = newLeftToday(reviews, cards, now, settings.newPerDay);
  const window = Math.min(20, Math.floor(pool.length / 2));
  const shown = new Map();
  for (const r of reviews) shown.set(r.c, Math.max(shown.get(r.c) ?? 0, r.t));
  for (const h of history) shown.set(h.id, Math.max(shown.get(h.id) ?? 0, h.at));
  const ctx = { states, now, fsrs, filter, session, newCount, shown, cards, reviews };
  const last = history.length ? history[history.length - 1].id : null;
  const counted = history.slice(history.length - window).map((h) => h.id);
  const timed = history.filter((h) => now.getTime() - h.at < TEN_MIN).map((h) => h.id);

  // Cards the user skipped in the last 10 minutes; unlike graded ones, they lose the
  // step-due exemption so a skipped "forgot" card doesn't bounce straight back.
  const skipped = new Set(history.filter((h) => h.skip && now.getTime() - h.at < TEN_MIN).map((h) => h.id));

  // Stepwise relaxation: full exclusion, count window only, last shown only, nothing.
  // (T1 cards whose step is due are exempt inside buildTiers, unless recently skipped.)
  let tiers = [];
  const levels = [[new Set([...counted, ...timed]), skipped], [new Set(counted), skipped],
    [new Set([last]), new Set()], [new Set(), new Set()]];
  for (const [ex, hold] of levels) {
    tiers = buildTiers(pool, ctx, (c) => ex.has(c.id), (c) => hold.has(c.id));
    if (tiers.some((t) => t.length)) break;
  }
  tiers = tiers.filter((t) => t.length);
  if (!tiers.length) return null;

  const byId = new Map(cards.map((c) => [c.id, c]));
  const lastTopic = history.length ? byId.get(history[history.length - 1].id)?.topic : undefined;
  let hit = null;
  for (const t of tiers) { hit = pickMixed(t, lastTopic, session.lastGroup); if (hit) break; }
  hit ??= pickMixed(tiers[0], undefined, session.lastGroup);
  return { card: hit.card, queue: hit.queue, endless: hit.queue === 'weak' || hit.queue === 'endless-new' };
}
