// DOM wiring only: fetch the deck, run the feed, hand off to store/picker/scheduler.
import { parseCardFile } from './parse.js';
import { renderMarkdown } from './markdown.js';
import { createStore } from './store.js';
import { makeFsrs, replay, effective } from './scheduler.js';
import { pickNext, counts, progress, cardStatus, newLeftToday } from './picker.js';
import { createEmptyCard } from '../vendor/ts-fsrs.mjs';

const $ = (id) => document.getElementById(id);
const UI_KEY = 'nc:v1:ui';
const fsrs = makeFsrs({ fuzz: true });
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

let cards = [];
let store, states;
// ui also holds: installHintDismissed, lastExportAt, reviewsAtExport, lastGroup, roundStart.
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
let backIdx = null; // index into history while looking back at earlier cards; null = the live card
const GRADE_NAMES = ['', 'Forgot', 'Hard', 'Got it', 'Easy'];
const reviews = () => effective(store.reviews()); // without grades that were later changed

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
  const c = counts(cards, states, reviews(), new Date(), store.settings().newPerDay);
  $('counts').textContent = `Due ${c.due} · Forgot ${c.forgot} · New ${c.newLeft}`;
  banner('saveWarn', store.ok ? '' : "Progress isn't being saved on this browser — export a backup.");
  backupNag();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Topic, coloured status line and question; `mode` 'live' counts the upcoming view, 'past' views so far.
// `label` overrides the status text (used for "New · 3 of 10 today").
function cardEl(card, mode, label) {
  const box = el('div', 'card');
  const st = cardStatus(states.get(card.id), reviews().filter((r) => r.c === card.id), new Date(), mode);
  if (label) st.label = label;
  const front = el('div', 'front');
  front.innerHTML = renderMarkdown(card.front);
  box.append(el('div', 'topic', card.topic), el('div', `status s-${st.kind}`, st.label), front);
  return box;
}

function updateNav() {
  $('backBtn').disabled = backIdx === 0 || (backIdx === null && !history.length);
  $('nextBtn').textContent = backIdx === null ? 'Next ›' : 'Forward ›';
}

function showNext() {
  pick = pickNext({
    cards, states, reviews: reviews(), history, now: new Date(), fsrs,
    filter: filter(), settings: store.settings(), session, roundStart: ui.roundStart,
  });
  // Every card in the selection has had its turn: start the next round from here.
  if (pick?.newRound || !ui.roundStart) { ui.roundStart = Date.now(); saveUi(); }
  pickedAt = Date.now();
  renderLive();
}

// The current card, question side up.
function renderLive() {
  backIdx = null;
  revealed = false;
  $('grades').hidden = true;
  $('stage').scrollTop = 0;
  let box;
  if (!pick) {
    box = el('div', 'card');
    box.append(el('div', 'front', {
      due: 'Nothing is due right now. Cards you have learned come back here when it is time to review them; your first ones arrive tomorrow.',
      forgot: 'No forgotten cards right now. Any card you mark Forgot shows up here until you get it right.',
      new: 'No new cards left in the topics you have selected.',
    }[ui.queue] ?? 'No cards in the topics you have selected. Turn some on in the menu.'));
  } else {
    box = cardEl(pick.card, 'live', newLabel(pick.queue));
    box.append(el('div', 'hint', 'tap to reveal'));
  }
  $('round').textContent = pick ? `${pick.round.pos} / ${pick.round.total}` : '';
  $('stage').replaceChildren(box);
  updateNav();
  updateCounts();
}

// Today's new cards are numbered against the daily limit; ones past it are extras.
function newLabel(queue) {
  const cap = store.settings().newPerDay;
  if (queue === 'new' && ui.queue === 'all') {
    return `New · ${cap - newLeftToday(reviews(), cards, new Date(), cap) + 1} of ${cap} today`;
  }
  if (queue === 'endless-new') return "New · extra, beyond today's " + cap;
  return undefined;
}

// An earlier card from this session: answer open, read-only, with a small "change grade" row.
function renderPast(i) {
  backIdx = i;
  revealed = false;
  $('grades').hidden = true;
  $('stage').scrollTop = 0;
  const h = history[i];
  const card = cards.find((c) => c.id === h.id);
  if (!card) { renderLive(); return; }
  if (h.skip) { // never graded: same as a fresh card — question first, then the grade buttons
    const box = cardEl(card, 'live');
    box.append(el('div', 'hint', 'tap to reveal'));
    $('stage').replaceChildren(box);
    updateNav();
    return;
  }
  const box = cardEl(card, 'past');
  const back = el('div', 'back');
  back.innerHTML = renderMarkdown(card.back);
  box.append(back);
  const row = el('div', 'regrade');
  {
    // Only the card's latest grade can be changed (a later review would already have built on it).
    const latest = reviews().filter((r) => r.c === h.id).reduce((a, b) => (!a || b.t >= a.t ? b : a), null);
    const editable = latest && latest.t === h.t && latest.d === store.deviceId;
    row.append(el('span', '', editable ? 'Your grade · change:' : `You graded it ${GRADE_NAMES[h.g]}.`));
    if (editable) {
      for (let g = 1; g <= 4; g++) {
        const b = el('button', `mini g${g}${g === h.g ? ' on' : ''}`, GRADE_NAMES[g]);
        b.onclick = (e) => { e.stopPropagation(); changeGrade(i, g); };
        row.append(b);
      }
    }
  }
  box.append(row);
  $('stage').replaceChildren(box);
  updateNav();
}

function back() {
  if (backIdx === null) { if (history.length) renderPast(history.length - 1); }
  else if (backIdx > 0) renderPast(backIdx - 1);
}

function next() {
  if (backIdx === null) { skip(); return; }
  if (backIdx + 1 < history.length) renderPast(backIdx + 1);
  else renderLive(); // back to the current card, unchanged
}

// Replace the grade given to an earlier card: append a correction entry (r = replaced time) and rebuild.
function changeGrade(i, g) {
  const h = history[i];
  if (!h || h.skip || g === h.g) return;
  store.add({ c: h.id, g, t: h.t + 1, d: store.deviceId, r: h.t, ...(h.x && { x: true }) });
  h.t += 1; h.g = g;
  states = replay(store.reviews(), fsrs, new Set(cards.map((c) => c.id)));
  renderPast(i);
  updateCounts();
}

// The card on screen that can be revealed and graded: the live pick, or a skipped card looked back at.
function gradeable() {
  if (backIdx === null) return pick ? { card: pick.card, endless: pick.endless } : null;
  const h = history[backIdx];
  const card = h?.skip && cards.find((c) => c.id === h.id);
  return card ? { card, endless: !!h.x, histIdx: backIdx } : null;
}

function reveal() {
  const cur = gradeable();
  if (!cur || revealed || performance.now() - gradedAt < TAP_GUARD) return;
  revealed = true;
  revealedAt = performance.now();
  const b = el('div', 'back');
  b.innerHTML = renderMarkdown(cur.card.back);
  $('stage').firstChild.querySelector('.hint').replaceWith(b);
  $('grades').hidden = false;
}

function grade(g) {
  const cur = gradeable();
  if (!cur || !revealed || performance.now() - revealedAt < TAP_GUARD) return;
  revealed = false; // guards against double taps
  gradedAt = performance.now();
  const { card, endless } = cur;
  const now = new Date();
  store.add({ c: card.id, g, t: now.getTime(), d: store.deviceId, ...(endless && { x: true }) });
  states.set(card.id, fsrs.next(states.get(card.id) ?? createEmptyCard(now), now, g).card);
  const entry = { id: card.id, at: now.getTime(), t: now.getTime(), g, ...(endless && { x: true }) };
  if (cur.histIdx !== undefined) { // graded a card that was skipped earlier: record it there, then move on
    history[cur.histIdx] = entry;
    if (endless) session.endlessCount++;
    document.activeElement?.blur();
    next();
    return;
  }
  history.push(entry);
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
  history.push({ id: pick.card.id, at: Date.now(), skip: true, ...(pick.endless && { x: true }) });
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
  if (Number.isFinite(s.roundStart)) ui.roundStart = s.roundStart;
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
  else if ('1234'.includes(e.key)) { if (backIdx === null || history[backIdx]?.skip) grade(Number(e.key)); else changeGrade(backIdx, Number(e.key)); }
  else if (e.key === 's' || e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') back();
});
$('backBtn').onclick = () => { back(); document.activeElement?.blur(); };
$('nextBtn').onclick = () => { next(); document.activeElement?.blur(); };
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
    if (backIdx === null && !revealed && Date.now() - pickedAt > 5 * 60000) showNext(); else updateCounts();
  });
}
main();
