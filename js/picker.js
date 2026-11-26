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

function buildTiers(pool, ctx, skip) {
  const { states, now, fsrs, filter, session, newCount } = ctx;
  const cand = (queue) => (c) => ({ card: c, queue });
  const studied = pool.filter((c) => states.has(c.id));
  const fresh = pool.filter((c) => !states.has(c.id)).filter((c) => !skip(c)).map(cand('new'));
  const stepDue = studied.filter((c) => {
    const q = queueOf(states.get(c.id), now);
    return (q === 'learning' || q === 'relearning') && states.get(c.id).due <= now;
  });
  const t1 = stepDue.sort((a, b) => states.get(a.id).due - states.get(b.id).due)
    .map((c) => ({ card: c, queue: queueOf(states.get(c.id), now) }));
  const t2 = studied.filter((c) => queueOf(states.get(c.id), now) === 'due' && !skip(c))
    .sort((a, b) => states.get(a.id).due - states.get(b.id).due).map(cand('due'));

  if (filter.queue === 'due') return [t1, t2];
  if (filter.queue === 'forgot') {
    return [studied.filter((c) => queueOf(states.get(c.id), now) === 'relearning' && !skip(c))
      .sort((a, b) => states.get(a.id).due - states.get(b.id).due).map(cand('relearning'))];
  }
  if (filter.queue === 'new') return [fresh];

  const t3 = newCount > 0 ? fresh : [];
  const weak = studied.filter((c) => !skip(c))
    .map((c) => ({ card: c, queue: 'weak', r: retrievability(fsrs, states.get(c.id), now) }))
    .sort((a, b) => a.r - b.r);
  const endlessNew = fresh.map((x) => ({ ...x, queue: 'endless-new' }));
  const t4 = session.endlessCount % 5 === 4 && endlessNew.length ? endlessNew
    : weak.length ? weak : endlessNew;
  return [t1, t2, t3, t4];
}

/** Choose the next card to show, or null if the filter matches nothing. */
export function pickNext({ cards, states, reviews, history, now, fsrs, filter, settings, session }) {
  const pool = cards.filter((c) =>
    (!filter.groups || filter.groups.has(c.group)) && (!filter.topics || filter.topics.has(c.topic)));
  if (!pool.length) return null;

  const newCount = newLeftToday(reviews, cards, now, settings.newPerDay);
  const window = Math.min(20, Math.floor(pool.length / 2));
  const recent = new Set(history.slice(history.length - window).map((h) => h.id));
  for (const h of history) if (now.getTime() - h.at < TEN_MIN) recent.add(h.id);
  const ctx = { states, now, fsrs, filter, session, newCount };

  // T1 cards (step due) are exempt from exclusion inside buildTiers.
  let tiers = buildTiers(pool, ctx, (c) => recent.has(c.id));
  if (!tiers.some((t) => t.length)) tiers = buildTiers(pool, ctx, () => false);
  tiers = tiers.filter((t) => t.length);
  if (!tiers.length) return null;

  const byId = new Map(cards.map((c) => [c.id, c]));
  const lastTopic = history.length ? byId.get(history[history.length - 1].id)?.topic : undefined;
  let hit = null;
  for (const t of tiers) { hit = pickMixed(t, lastTopic, session.lastGroup); if (hit) break; }
  hit ??= pickMixed(tiers[0], undefined, session.lastGroup);
  return { card: hit.card, queue: hit.queue, endless: hit.queue === 'weak' || hit.queue === 'endless-new' };
}
