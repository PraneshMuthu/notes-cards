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

  let log = parse(read(LOG), []);
  if (!Array.isArray(log)) log = [];
  let deviceId = read(DEVICE);
  if (!deviceId) { deviceId = crypto.randomUUID(); write(DEVICE, deviceId); }
  let cfg = { ...DEFAULT_SETTINGS, ...(parse(read(SETTINGS), {}) || {}) };

  const persist = () => write(LOG, JSON.stringify(log));

  return {
    get ok() { return ok; },
    deviceId,
    reviews: () => log.slice(),
    add(review) { log.push(review); persist(); },
    settings: () => ({ ...cfg }),
    saveSettings(s) { cfg = { ...DEFAULT_SETTINGS, ...s }; write(SETTINGS, JSON.stringify(cfg)); },
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
