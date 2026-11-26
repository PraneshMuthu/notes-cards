// Progress store: review log + settings in a localStorage-like object. No DOM, no FSRS.
const LOG = 'nc:v1:log';
const DEVICE = 'nc:v1:device';
const SETTINGS = 'nc:v1:settings';
const DEFAULT_SETTINGS = { newPerDay: 10 };

const key = (r) => `${r.c}|${r.t}|${r.d}`;
const validReview = (r) =>
  r && typeof r === 'object' && typeof r.c === 'string' && Number.isInteger(r.g) && r.g >= 1 && r.g <= 4 &&
  Number.isFinite(r.t) && typeof r.d === 'string';

export function createStore(storage) {
  let ok = !!storage;
  const read = (k) => {
    if (!storage) return null;
    try { return storage.getItem(k); } catch { ok = false; return null; }
  };
  const write = (k, v) => {
    if (!storage) return;
    try { storage.setItem(k, v); } catch { ok = false; }
  };
  const parse = (text, fallback) => {
    if (text == null) return fallback;
    try { return JSON.parse(text) ?? fallback; } catch { return fallback; }
  };

  let blockLog = false; // never write LOG when true
  let recovered = false;
  let log = [];
  let raw = null;
  if (storage) {
    try { raw = storage.getItem(LOG); } catch { ok = false; blockLog = true; }
  }
  if (raw != null) {
    let parsed;
    let bad = false;
    try { parsed = JSON.parse(raw); } catch { bad = true; }
    if (!bad && !Array.isArray(parsed)) bad = true;
    if (!bad) {
      log = parsed.filter(validReview);
      if (log.length !== parsed.length) bad = true;
    }
    if (bad) {
      try { storage.setItem(`${LOG}:corrupt-${Date.now()}`, raw); recovered = true; }
      catch { ok = false; blockLog = true; }
    }
  }
  let deviceId = read(DEVICE);
  if (!deviceId) { deviceId = crypto.randomUUID(); write(DEVICE, deviceId); }
  const stored = parse(read(SETTINGS), {});
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  let cfg = { ...DEFAULT_SETTINGS, ...(isObj(stored) ? stored : {}) };

  const persist = () => { if (!blockLog) write(LOG, JSON.stringify(log)); };

  return {
    get ok() { return ok; },
    deviceId,
    get recovered() { return recovered; },
    reviews: () => log.slice(),
    add(review) {
      if (!validReview(review)) throw new Error('Invalid review');
      const e = { c: review.c, g: review.g, t: review.t, d: review.d };
      if (review.x) e.x = true;
      log.push(e); persist();
    },
    settings: () => ({ ...cfg }),
    saveSettings(s) { cfg = { ...DEFAULT_SETTINGS, ...(isObj(s) ? s : {}) }; write(SETTINGS, JSON.stringify(cfg)); },
    exportJson: () => JSON.stringify({ app: 'notes-cards', version: 1, reviews: log }),
    importJson(text) {
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('Not a notes-cards export'); }
      if (!data || data.app !== 'notes-cards' || data.version !== 1 || !Array.isArray(data.reviews) ||
          !data.reviews.every(validReview)) throw new Error('Not a notes-cards export');
      const seen = new Set(log.map(key));
      let added = 0;
      for (const r of data.reviews) {
        if (seen.has(key(r))) continue;
        seen.add(key(r));
        const e = { c: r.c, g: r.g, t: r.t, d: r.d };
        if (r.x) e.x = true;
        log.push(e);
        added++;
      }
      if (added) persist();
      return { added };
    },
  };
}
