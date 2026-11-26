import { fsrs, generatorParameters, createEmptyCard, State } from '../vendor/ts-fsrs.mjs';

/** @param {{fuzz?: boolean}} [opts] */
export function makeFsrs({ fuzz = true } = {}) {
  return fsrs(generatorParameters({
    request_retention: 0.9,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m', '1d'],
    enable_fuzz: fuzz,
  }));
}

/**
 * Rebuild each card's FSRS state from the review log. Unknown ids are skipped.
 * @returns {Map<string, object>}
 */
export function replay(entries, f, knownIds) {
  const sorted = effective(entries).filter((e) => knownIds.has(e.c)).sort((a, b) => a.t - b.t);
  const cards = new Map();
  for (const e of sorted) {
    const now = new Date(e.t);
    const card = cards.get(e.c) ?? createEmptyCard(now);
    cards.set(e.c, f.next(card, now, e.g).card);
  }
  return cards;
}

/**
 * The log minus reviews that a later "change grade" replaced. A correction is a normal entry
 * plus `r` = the time of the entry it replaces (same card and device), so the log stays append-only.
 */
export function effective(entries) {
  const replaced = new Set();
  for (const e of entries) if (Number.isFinite(e.r)) replaced.add(`${e.c}|${e.r}|${e.d}`);
  return replaced.size ? entries.filter((e) => !replaced.has(`${e.c}|${e.t}|${e.d}`)) : entries;
}

export function retrievability(f, card, now) {
  return f.get_retrievability(card, now, false);
}

export function queueOf(card, now) {
  if (!card) return 'new';
  if (card.state === State.Learning) return 'learning';
  if (card.state === State.Relearning) return 'relearning';
  if (card.state === State.Review && card.due.getTime() <= now.getTime()) return 'due';
  return 'later';
}
