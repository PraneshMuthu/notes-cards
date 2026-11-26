// DOM wiring only: fetch the deck, run the feed, hand off to store/picker/scheduler.
import { parseCardFile } from './parse.js';
import { renderMarkdown } from './markdown.js';
import { createStore } from './store.js';
import { makeFsrs, replay } from './scheduler.js';
import { pickNext, counts, progress } from './picker.js';
import { createEmptyCard } from '../vendor/ts-fsrs.mjs';

const $ = (id) => document.getElementById(id);
const UI_KEY = 'nc:v1:ui';
const fsrs = makeFsrs({ fuzz: true });
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

let cards = [];
let store, states;
// ui also holds: installHintDismissed, lastExportAt, reviewsAtExport, lastGroup.
let ui = { queue: 'all', offGroups: [], offTopics: [] };
const history = [];
const session = { endlessCount: 0 };
let pick = null;
let revealed = false;
let pickedAt = 0;
let revealedAt = -Infinity, gradedAt = -Infinity; // double-tap guard (performance.now ms)
const TAP_GUARD = 350;
const DAY = 86400000;
let backupSnoozed = false;

function banner(id, text, onDismiss) {
  let el = $(id);
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'banner'; $('banners').append(el); }
  el.textContent = text;
  if (onDismiss) {
    const b = document.createElement('button');
    b.textContent = '✕'; b.setAttribute('aria-label', 'Dismiss');
    b.onclick = () => { el.remove(); if (typeof onDismiss === 'function') onDismiss(); };
    el.append(b);
  }
}

// "N reviews since your last backup": after 7 days or 100 reviews, never before the first review.
function backupNag() {
  const reviews = store.reviews();
  const n = reviews.length - (ui.reviewsAtExport ?? 0);
  const since = ui.lastExportAt ?? reviews.reduce((m, r) => Math.min(m, r.t), Infinity);
  const due = n > 0 && (n >= 100 || Date.now() - since >= 7 * DAY);
  banner('backupNag', due && !backupSnoozed
    ? `${n} review${n === 1 ? '' : 's'} since your last backup — Export (menu ☰).` : '',
  () => { backupSnoozed = true; });
}

function filter() {
  const f = { queue: ui.queue };
  if (ui.offGroups.length) f.groups = new Set(cards.map((c) => c.group).filter((g) => !ui.offGroups.includes(g)));
  if (ui.offTopics.length) f.topics = new Set(cards.map((c) => c.topic).filter((t) => !ui.offTopics.includes(t)));
  return f;
}

function updateCounts() {
  const c = counts(cards, states, store.reviews(), new Date(), store.settings().newPerDay);
  $('counts').textContent = `Due ${c.due} · Forgot ${c.forgot} · New ${c.newLeft}`;
  banner('saveWarn', store.ok ? '' : "Progress isn't being saved on this browser — export a backup.");
  backupNag();
}

function showNext() {
  pick = pickNext({
    cards, states, reviews: store.reviews(), history, now: new Date(), fsrs,
    filter: filter(), settings: store.settings(), session,
  });
  revealed = false;
  pickedAt = Date.now();
  $('grades').hidden = true;
  $('stage').scrollTop = 0;
  const el = document.createElement('div');
  el.className = 'card';
  if (!pick) {
    $('chip').textContent = 'Notes Cards';
    const f = document.createElement('div');
    f.className = 'front';
    f.textContent = {
      due: 'Nothing is due right now. Cards you have learned come back here when it is time to review them; your first ones arrive tomorrow.',
      forgot: 'No forgotten cards right now. Any card you mark Forgot shows up here until you get it right.',
      new: 'No new cards left in the topics you have selected.',
    }[ui.queue] ?? 'No cards in the topics you have selected. Turn some on in the menu.';
    el.append(f);
  } else {
    $('chip').textContent = pick.card.topic;
    const topic = document.createElement('div');
    topic.className = 'topic';
    topic.textContent = pick.card.topic;
    const f = document.createElement('div');
    f.className = 'front';
    f.innerHTML = renderMarkdown(pick.card.front);
    el.append(topic);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'tap to reveal';
    el.append(f, hint);
  }
  $('stage').replaceChildren(el);
  updateCounts();
}

function reveal() {
  if (!pick || revealed || performance.now() - gradedAt < TAP_GUARD) return;
  revealed = true;
  revealedAt = performance.now();
  const back = document.createElement('div');
  back.className = 'back';
  back.innerHTML = renderMarkdown(pick.card.back);
  const card = $('stage').firstChild;
  card.querySelector('.hint').replaceWith(back);
  $('grades').hidden = false;
}

function grade(g) {
  if (!pick || !revealed || performance.now() - revealedAt < TAP_GUARD) return;
  revealed = false; // guards against double taps
  gradedAt = performance.now();
  const { card, endless } = pick;
  const now = new Date();
  store.add({ c: card.id, g, t: now.getTime(), d: store.deviceId, ...(endless && { x: true }) });
  states.set(card.id, fsrs.next(states.get(card.id) ?? createEmptyCard(now), now, g).card);
  history.push({ id: card.id, at: now.getTime() });
  session.lastGroup = ui.lastGroup = card.group;
  saveUi();
  if (endless) session.endlessCount++;
  document.activeElement?.blur();
  showNext();
}

// Move on without grading: nothing is logged, so the card's schedule and the daily new-card
// count are untouched; the picker keeps it away for ~10 minutes.
function skip() {
  if (!pick || performance.now() - gradedAt < TAP_GUARD) return;
  gradedAt = performance.now();
  history.push({ id: pick.card.id, at: Date.now(), skip: true });
  session.lastGroup = pick.card.group;
  document.activeElement?.blur();
  showNext();
}

function saveUi() { safe(() => localStorage.setItem(UI_KEY, JSON.stringify(ui))); }
function loadUi() {
  const s = safe(() => JSON.parse(localStorage.getItem(UI_KEY)), null);
  if (!s || typeof s !== 'object') return;
  if (['all', 'due', 'forgot', 'new'].includes(s.queue)) ui.queue = s.queue;
  if (Array.isArray(s.offGroups)) ui.offGroups = s.offGroups.filter((x) => typeof x === 'string');
  if (Array.isArray(s.offTopics)) ui.offTopics = s.offTopics.filter((x) => typeof x === 'string');
  if (s.installHintDismissed === true) ui.installHintDismissed = true;
  if (Number.isFinite(s.lastExportAt)) ui.lastExportAt = s.lastExportAt;
  if (Number.isInteger(s.reviewsAtExport)) ui.reviewsAtExport = s.reviewsAtExport;
  if (typeof s.lastGroup === 'string') session.lastGroup = ui.lastGroup = s.lastGroup;
}

function checkbox(label, checked, cls, onChange) {
  const l = document.createElement('label');
  if (cls) l.className = cls;
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = checked; i.onchange = () => onChange(i.checked, i);
  l.append(i, document.createTextNode(label));
  return { l, i };
}

function buildMenu() {
  for (const r of document.querySelectorAll('input[name=queue]')) {
    r.checked = r.value === ui.queue;
    r.onchange = () => { ui.queue = r.value; saveUi(); showNext(); };
  }
  const tree = new Map();
  for (const c of cards) {
    if (!tree.has(c.group)) tree.set(c.group, new Set());
    tree.get(c.group).add(c.topic);
  }
  const toggle = (arr, v, on) => { const i = arr.indexOf(v); if (on && i >= 0) arr.splice(i, 1); if (!on && i < 0) arr.push(v); };
  $('topics').replaceChildren(...[...tree].sort().map(([group, topics]) => {
    const box = document.createElement('div');
    box.className = 'grp';
    const subs = [];
    const g = checkbox(group, !ui.offGroups.includes(group), '', (on) => {
      toggle(ui.offGroups, group, on);
      subs.forEach((s) => { s.disabled = !on; });
      saveUi(); showNext();
    });
    box.append(g.l);
    for (const t of [...topics].sort()) {
      const s = checkbox(t, !ui.offTopics.includes(t), 'sub', (on) => { toggle(ui.offTopics, t, on); saveUi(); showNext(); });
      s.i.disabled = ui.offGroups.includes(group);
      subs.push(s.i);
      box.append(s.l);
    }
    return box;
  }));
  const n = $('newPerDay');
  n.value = store.settings().newPerDay;
  n.onchange = () => {
    const v = Math.max(0, Math.min(200, Math.floor(Number(n.value)) || 0));
    n.value = v;
    store.saveSettings({ ...store.settings(), newPerDay: v });
    if (revealed) updateCounts(); else showNext();
  };
}

function wireMenu() {
  const open = (on) => {
    if (on) {
      const p = progress(cards, states);
      $('seen').textContent = `Seen ${p.seen} of ${p.total} cards`;
      $('seenGroups').textContent = p.groups.map((g) => `${g.group} ${g.seen}/${g.total}`).join(' · ');
    }
    $('menu').hidden = !on;
  };
  $('menuBtn').onclick = () => open(true);
  $('menuClose').onclick = () => open(false);
  $('menu').onclick = (e) => { if (e.target === $('menu')) open(false); };
  const msg = (t) => { $('msg').textContent = t; };
  $('exportBtn').onclick = async () => {
    const json = store.exportJson();
    const count = store.reviews().length;
    const n = new Date();
    const p2 = (x) => String(x).padStart(2, '0');
    const name = `notes-cards-progress-${n.getFullYear()}-${p2(n.getMonth() + 1)}-${p2(n.getDate())}.json`;
    const file = safe(() => new File([json], name, { type: 'application/json' }));
    // iOS standalone ignores <a download>; the share sheet can "Save to Files".
    let shared = false;
    const touch = safe(() => matchMedia('(pointer: coarse)').matches, false); // laptop: plain download
    if (file && touch && safe(() => navigator.canShare?.({ files: [file] }), false)) {
      try { await navigator.share({ files: [file] }); shared = true; }
      catch (err) { if (err?.name === 'AbortError') { msg('Export cancelled.'); return; } } // else: download below
    }
    if (!shared) {
      try {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch { msg('Export failed.'); return; }
    }
    ui.lastExportAt = Date.now(); ui.reviewsAtExport = count; saveUi();
    backupSnoozed = false;
    msg('Exported.');
    updateCounts();
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { added } = store.importJson(await file.text());
      states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
      msg(`Imported ${added} new review${added === 1 ? '' : 's'}.`);
      showNext();
    } catch (err) { msg(err.message || 'Import failed.'); }
  };
}

/** Loads cards; returns how many topic files failed. */
async function loadDeck() {
  const files = await (await fetch('./cards/index.json')).json();
  const parsed = await Promise.all(files.map(async (f) => {
    try {
      const res = await fetch('./cards/' + encodeURIComponent(f));
      if (!res.ok) throw new Error(res.status);
      return parseCardFile(await res.text(), f);
    } catch (err) { console.warn(`Could not load cards/${f}`, err); return null; }
  }));
  const seen = new Set();
  const failed = parsed.filter((p) => !p).length;
  for (const p of parsed.filter(Boolean)) {
    p.warnings.forEach((w) => console.warn(w));
    for (const c of p.cards) {
      if (seen.has(c.id)) { console.warn(`Duplicate card id ${c.id} in ${c.file}, ignored`); continue; }
      seen.add(c.id); cards.push(c);
    }
  }
  return failed;
}

document.addEventListener('keydown', (e) => {
  if (!$('menu').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('button, input, select, label, summary, a')) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
  else if ('1234'.includes(e.key)) grade(Number(e.key));
  else if (e.key === 's' || e.key === 'ArrowRight') skip();
});
$('skipBtn').onclick = skip;
$('stage').addEventListener('click', (e) => { if (!e.target.closest('summary, a')) reveal(); });
for (const b of document.querySelectorAll('#grades button')) b.onclick = () => grade(Number(b.dataset.g));

function installHint() {
  const standalone = safe(() => matchMedia('(display-mode: standalone)').matches, false) || navigator.standalone;
  // Only iOS evicts storage of non-installed sites; laptops don't need this hint.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || standalone || ui.installHintDismissed) return;
  banner('installHint', "Add to Home Screen so iOS keeps your progress. If you've studied here already, " +
    'Export first, then Import in the installed app.', () => { ui.installHintDismissed = true; saveUi(); });
}

async function main() {
  store = createStore(safe(() => localStorage));
  if (store.recovered) banner('recovered', 'Your saved progress was damaged; a backup copy was kept in this browser.', true);
  // Ask the browser not to evict our storage (iOS wipes script-writable storage after ~7 idle days otherwise).
  try { navigator.storage?.persist?.()?.catch?.(() => {}); } catch { /* optional */ }
  loadUi();
  installHint();
  wireMenu();
  if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./sw.js').catch(() => {}); } catch { /* optional */ }
  }
  let failed = 0;
  try { failed = await loadDeck(); } catch (err) { console.warn('Could not load cards/index.json', err); }
  if (!cards.length) { banner('noDeck', 'Could not load any cards. Check your connection and reload.'); return; }
  if (failed) banner('deckPartial', `${failed} topic file${failed === 1 ? '' : 's'} didn't load.`, true);
  states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
  buildMenu();
  showNext();
  // Another tab wrote reviews: merge them in so neither tab overwrites the other.
  window.addEventListener('storage', (e) => {
    if (e.key !== 'nc:v1:log') return;
    store.reload();
    states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
    updateCounts();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!revealed && Date.now() - pickedAt > 5 * 60000) showNext(); else updateCounts();
  });
}
main();
