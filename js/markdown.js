// Safe Markdown subset renderer. Pure: no DOM, no Node APIs.
// All user text is escaped before any inline formatting is applied.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function inline(text) {
  return esc(text)
    .split(/(`[^`]+`)/)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${part.slice(1, -1)}</code>`;
      return part
        .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(?=\S)([^*]+?)\*/g, '<em>$1</em>');
    })
    .join('');
}

const splitRow = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
};
const isSep = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const isRowLine = (line) => line.includes('|');
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;
const FENCE = /^\s*```/;
const SUMMARY = /^\s*<summary>(.*)<\/summary>\s*$/;

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    if (FENCE.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or EOF)
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const t = line.trim();
    if (t === '<details>' || t === '</details>') { out.push(t); i++; continue; }
    const sm = SUMMARY.exec(line);
    if (sm) { out.push(`<summary>${esc(sm[1])}</summary>`); i++; continue; }

    if (isRowLine(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && isRowLine(lines[i])) rows.push(splitRow(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    const re = UL.test(line) ? UL : OL.test(line) ? OL : null;
    if (re) {
      const items = [];
      let m;
      while (i < lines.length && (m = re.exec(lines[i]))) { items.push(m[1]); i++; }
      const tag = re === UL ? 'ul' : 'ol';
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // paragraph: consecutive non-blank lines that don't start another block
    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      const lt = l.trim();
      if (lt === '' || FENCE.test(l) || lt === '<details>' || lt === '</details>' || SUMMARY.test(l)) break;
      if (para.length && (UL.test(l) || OL.test(l))) break;
      if (para.length && isRowLine(l) && i + 1 < lines.length && isSep(lines[i + 1])) break;
      para.push(l.trim());
      i++;
    }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}
