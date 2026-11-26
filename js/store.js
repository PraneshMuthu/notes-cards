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
  const backup = (raw) => {
    try { storage.setItem(`${LOG}:corrupt-${Date.now()}`, raw); recovered = true; return true; }
    catch { ok = false; blockLog = true; return false; }
  };
  // Valid entries currently in storage. Anything invalid is backed up raw first (and marks `dirty`).
  let dirty = false;
  const readLog = () => {
    if (!storage) return [];
    let raw;
    try { raw = storage.getItem(LOG); } catch { ok = false; blockLog = true; return []; }
    if (raw == null) return [];
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* corrupt */ }
    const list = Array.isArray(parsed) ? parsed.filter(validReview) : [];
    if ((!Array.isArray(parsed) || list.length !== parsed.length) && backup(raw)) dirty = true;
    return list;
  };
  // Union by key (c|t|d), sorted by time: the stored log only ever grows.
  const merge = (a, b) => {
    const m = new Map();
    for (const r of [...a, ...b]) if (!m.has(key(r))) m.set(key(r), r);
    return [...m.values()].sort((x, y) => x.t - y.t);
  };
  let log = readLog();
  if (dirty && !blockLog) { write(LOG, JSON.stringify(log)); dirty = false; } // so the backup isn't remade every load
  let deviceId = read(DEVICE);
  if (!deviceId) { deviceId = crypto.randomUUID(); write(DEVICE, deviceId); }
  const stored = parse(read(SETTINGS), {});
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  let cfg = { ...DEFAULT_SETTINGS, ...(isObj(stored) ? stored : {}) };

  // Re-read before writing so another tab's entries are merged, not overwritten.
  const persist = () => {
    if (blockLog) return;
    const disk = readLog();
    if (blockLog) return;
    log = merge(disk, log);
    dirty = false;
    write(LOG, JSON.stringify(log));
  };
  const corruptBackups = () => {
    const out = [];
    try {
      if (!storage || typeof storage.key !== 'function') return out;
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(`${LOG}:corrupt-`)) out.push({ key: k, raw: storage.getItem(k) });
      }
    } catch { /* export what we have */ }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  };

  return {
    get ok() { return ok; },
    deviceId,
    get recovered() { return recovered; },
    reviews: () => log.slice(),
    /** Merge in entries another tab has written since we last read. */
    reload() { log = merge(readLog(), log); if (dirty && !blockLog) persist(); },
    add(review) {
      if (!validReview(review)) throw new Error('Invalid review');
      const e = { c: review.c, g: review.g, t: review.t, d: review.d };
      if (review.x) e.x = true;
      log.push(e); persist();
    },
    settings: () => ({ ...cfg }),
    saveSettings(s) { cfg = { ...DEFAULT_SETTINGS, ...(isObj(s) ? s : {}) }; write(SETTINGS, JSON.stringify(cfg)); },
    exportJson() {
      const out = { app: 'notes-cards', version: 1, reviews: log };
      const bad = corruptBackups();
      if (bad.length) out.corruptBackups = bad; // optional; importJson ignores it
      return JSON.stringify(out);
    },
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
