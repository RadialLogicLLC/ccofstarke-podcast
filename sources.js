// Turns the church's two sermon lists into one clean episode list:
//  1. the published Google Sheet (archive, 2011 onward)
//  2. the "Weekly Sermons" page on the website (newest sermons)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');

// Speakers as they appear on the website/sheet -> one consistent name
export const PREACHERS = [
  ['Evangelist Dana Williams', 'Dana Williams'],
  ['Evangelist Dave Summerdorf', 'Dave Summerdorf'],
  ['Bro Allen Gullick', 'Allen Gullick'],
  ['Bro Kermit Matthews', 'Kermit Matthews'],
  ['Bro Bob Doom', 'Bob Doom'],
  ['Bro. Jason', 'Jason Crawford'],
  ['Bro Jason', 'Jason Crawford'],
  ['Bro. Lester', 'Bro Lester'],
  ['Bro Lester', 'Bro Lester'],
  ['Bro Chance', 'Chance Johnson'],
  ['Bro Matthew', 'Bro Matthew'],
  ['Bill Richberg', 'Bill Richburg'],
  ['gene Burnsed', 'Gene Burnsed'],
];
const PREFIX = /^(Bro\.?|Brother|Evangelist|Pastor|Missionary)\s+\S+/;

export function canonicalPreacher(name) {
  const n = (name || '').trim().replace(/\s+/g, ' ');
  for (const [alias, canon] of PREACHERS) if (n.toLowerCase() === alias.toLowerCase()) return canon;
  return n;
}

function splitPreacher(text) {
  const t = text.trim();
  for (const [alias, canon] of PREACHERS) {
    if (t.toLowerCase().startsWith(alias.toLowerCase())) {
      const rest = t.slice(alias.length);
      if (rest === '' || /^[\s\-–—:,]/.test(rest)) return { preacher: canon, rest: rest.replace(/^[\s\-–—:,]+/, '').trim() };
    }
  }
  const m = t.match(PREFIX);
  if (m && (t.length === m[0].length || /^\s*[-–—:]/.test(t.slice(m[0].length)))) {
    return { preacher: canonicalPreacher(m[0]), rest: t.slice(m[0].length).replace(/^[\s\-–—:,]+/, '').trim() };
  }
  return { preacher: null, rest: t };
}

export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const normSlot = (s) => (s || '').trim().toLowerCase().replace(/[^a-z]/g, '');

/** Sheet rows -> episodes. Key = file name without .mp3, e.g. "101126am". */
export function fromSheet(csvText) {
  const out = [];
  for (const r of parseCsv(csvText).slice(1)) {
    const [date, slotRaw, preacher, title] = r.map((x) => (x || '').trim());
    const m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    const slot = normSlot(slotRaw);
    out.push({
      key: `${pad(m[1])}${pad(m[2])}${m[3].slice(2)}${slot}`,
      date: `${m[3]}-${pad(m[1])}-${pad(m[2])}`,
      slot,
      preacher: canonicalPreacher(preacher),
      title,
      source: 'sheet',
    });
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
export function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\u00a0/g, ' ');
}

const DATE_RE = new RegExp(`^(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s*(\\d{4})\\s*(AM|PM|SR)?\\b`, 'i');

/**
 * Website sermons page -> episodes. The page is hand-edited, so this reads it as a
 * stream: a date line starts a new sermon; the speaker and title come from the text
 * and link labels that follow it, until the next date line.
 */
export function fromPage(html, audioHost = 'sermons.ccofstarke.com') {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const start = body.search(/Recent Messages/i);
  const src = start >= 0 ? body.slice(start) : body;
  const tokens = [];
  const re = /<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>|<(?:br|\/p|\/div|\/li|\/h\d)\b[^>]*>|<[^>]+>|([^<]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) tokens.push({ link: decode(m[1]).trim(), text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
    else if (m[3] !== undefined) { const t = decode(m[3]).replace(/\s+/g, ' ').trim(); if (t) tokens.push({ text: t }); }
    else if (/^<(br|\/p|\/div|\/li|\/h)/i.test(m[0])) tokens.push({ brk: true });
  }
  const entries = []; let cur = null;
  for (const t of tokens) {
    if (t.text && !t.link) {
      const d = t.text.match(DATE_RE);
      if (d) {
        cur = { date: `${d[3]}-${pad(MONTHS.indexOf(d[1].toLowerCase()) + 1)}-${pad(d[2])}`, slot: (d[4] || '').toLowerCase(), texts: [], links: [] };
        entries.push(cur);
        const rest = t.text.slice(d[0].length).trim();
        if (rest) cur.texts.push(rest);
        continue;
      }
      if (/our location|sermon links|contact information/i.test(t.text)) cur = null;
      if (cur) cur.texts.push(t.text);
    } else if (t.link && cur) {
      const f = t.link.match(new RegExp(`^https?://${audioHost.replace(/\./g, '\\.')}/([^/?#]+)\\.mp3`, 'i'));
      if (!f) continue;
      const isUrlText = !t.text || /^https?:\/\//i.test(t.text);
      cur.links.push({ key: f[1], text: isUrlText ? '' : t.text });
    }
  }
  const out = [];
  for (const e of entries) {
    const named = e.links.filter((l) => l.text);
    const keys = [...new Set((named.length ? named : e.links).map((l) => l.key))];
    for (const key of keys) {
      let preacher = null; const parts = []; let note = '';
      const items = [...e.texts.map((t) => ({ t })), ...e.links.filter((l) => l.key === key && l.text).map((l) => ({ t: l.text }))];
      for (const { t } of items) {
        if (/^sunrise service$/i.test(t)) { note = 'sunrise'; continue; }
        const s = splitPreacher(t);
        if (s.preacher && !preacher) preacher = s.preacher;
        if (s.rest) parts.push(s.rest);
      }
      const slotFromKey = (key.match(/[a-z]+$/i) || [''])[0].toLowerCase();
      out.push({
        key,
        date: e.date,
        slot: note === 'sunrise' ? 'sr' : slotFromKey || e.slot || 'am',
        preacher: preacher || '',
        title: [...new Set(parts)].join(' – '),
        source: 'page',
      });
    }
  }
  return out;
}

/** Sheet first (cleaner), then anything only on the website. Overrides last. */
export function merge(sheet, page, overrides = {}) {
  const byKey = new Map();
  for (const e of sheet) {
    const prev = byKey.get(e.key);
    if (!prev) { byKey.set(e.key, e); continue; }
    // Two sheet rows for one recording (two speakers in one service): combine them
    const join = (a, b) => (a && b && a !== b ? `${a} & ${b}` : a || b);
    byKey.set(e.key, { ...prev, preacher: join(prev.preacher, e.preacher), title: [prev.title, e.title].filter(Boolean).join(' / ') });
  }
  for (const e of page) if (!byKey.has(e.key)) byKey.set(e.key, e);
  for (const x of overrides.extra || []) byKey.set(x.key, { ...x, source: 'override' });
  for (const [key, patch] of Object.entries(overrides.episodes || {})) {
    if (byKey.has(key)) byKey.set(key, { ...byKey.get(key), ...patch });
  }
  for (const key of overrides.skip || []) byKey.delete(key);
  return [...byKey.values()];
}
