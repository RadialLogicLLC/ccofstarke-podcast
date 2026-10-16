// Builds the podcast RSS feed (Apple Podcasts + Spotify + Podcasting 2.0 tags).

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // strip characters XML 1.0 forbids
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SERVICE_TIME = { sr: [7, 0], am: [10, 30], ampm: [10, 30], pm: [18, 30] };

/** RFC 2822 date in US Eastern time, DST-correct, without any date library. */
export function rfc2822Eastern(isoDate, slot, plusMinutes = 0) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi0] = SERVICE_TIME[slot] || SERVICE_TIME.am;
  const mi = mi0 + plusMinutes;
  // Find the Eastern offset for that day by asking Intl what time it is in New York.
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const ny = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(probe);
  const offset = Number(ny) - 12; // -4 (EDT) or -5 (EST)
  const utc = new Date(Date.UTC(y, mo - 1, d, h - offset, mi));
  const sign = offset < 0 ? '-' : '+';
  const off = `${sign}${String(Math.abs(offset)).padStart(2, '0')}00`;
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const wd = local.toUTCString().slice(0, 3);
  const mon = local.toUTCString().slice(8, 11);
  return { text: `${wd}, ${String(d).padStart(2, '0')} ${mon} ${y} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00 ${off}`, utc };
}

const GENERIC = /^(message|missionary|sermon|whole service|#ref!|\(?not published\)?|\d+ cds?|)$/i;
const NOT_A_PERSON = /^(whole service|short sermons|recordings lost|missionary|)$/i;

export function serviceLabel(isoDate, slot) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (slot === 'sr') return 'Sunrise service';
  if (slot === 'ampm') return `${day} services`;
  return `${day} ${slot === 'pm' ? 'evening' : 'morning'}`;
}

export function longDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Bookkeeping notes typed into the archive sheet that listeners don't need
const RECORDING_NOTE = /\s*(?:[;(]\s*|\b)(?:no (?:am|pm)\b[^)]*|no published|not published|message not posted online|[^()]*service not (?:recorded|uploaded)|services combine[ds]?[^)]*|am service missed|pm power out)\)?\s*$/i;

export function cleanTitle(t) {
  let s = (t || '').replace(/\s+/g, ' ').trim().replace(/(\w);(ve|ll|re|s|t|d|m)\b/gi, '$1’$2');
  for (let i = 0; i < 3; i++) s = s.replace(RECORDING_NOTE, '').replace(/[\s\-–—;,:]+$/, '').trim();
  return s;
}

export function episodeTitle(e) {
  const person = NOT_A_PERSON.test(e.preacher || '') ? '' : e.preacher;
  const title = cleanTitle(e.title);
  if (GENERIC.test(title)) {
    const label = person || 'Christ’s Church of Starke';
    return `${label} – ${serviceLabel(e.date, e.slot)}, ${longDate(e.date)}`;
  }
  return person ? `${title} | ${person}` : title;
}

export function episodeDescription(e, church) {
  const person = NOT_A_PERSON.test(e.preacher || '') ? '' : e.preacher;
  const parts = [`${serviceLabel(e.date, e.slot)}, ${longDate(e.date)}.`];
  if (person) parts.push(`Preached by ${person} at ${church}.`);
  else parts.push(`Recorded at ${church}.`);
  return parts.join(' ');
}

const fmtDuration = (s) => (s == null ? null : String(Math.max(1, Math.round(s))));

export function buildFeed(episodes, cfg) {
  // "Last changed" = newest episode, so the file only changes when there's something new
  const now = episodes.length ? rfc2822Eastern(episodes[0].date, episodes[0].slot, episodes[0].plusMinutes || 0).text : '';
  const items = episodes.map((e) => {
    const { text: pub } = rfc2822Eastern(e.date, e.slot, e.plusMinutes || 0);
    const url = cfg.audioBase + e.file;
    const dur = fmtDuration(e.seconds);
    return `    <item>
      <title>${esc(episodeTitle(e))}</title>
      <description>${esc(episodeDescription(e, cfg.church))}</description>
      <itunes:summary>${esc(episodeDescription(e, cfg.church))}</itunes:summary>
      <pubDate>${pub}</pubDate>
      <enclosure url="${esc(url)}" length="${e.size}" type="audio/mpeg"/>
      <guid isPermaLink="false">${esc(cfg.guidPrefix + e.key)}</guid>
      <link>${esc(cfg.link)}</link>${e.preacher && !NOT_A_PERSON.test(e.preacher) ? `
      <itunes:author>${esc(e.preacher)}</itunes:author>` : ''}${dur ? `
      <itunes:duration>${dur}</itunes:duration>` : ''}
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(cfg.title)}</title>
    <link>${esc(cfg.link)}</link>
    <atom:link href="${esc(cfg.feedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${esc(cfg.description)}</description>
    <itunes:summary>${esc(cfg.description)}</itunes:summary>
    <language>${esc(cfg.language)}</language>
    <copyright>${esc(cfg.copyright)}</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>ccos-podcast</generator>
    <itunes:author>${esc(cfg.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${esc(cfg.ownerName)}</itunes:name>
      <itunes:email>${esc(cfg.ownerEmail)}</itunes:email>
    </itunes:owner>
    <itunes:image href="${esc(cfg.image)}"/>
    <image>
      <url>${esc(cfg.image)}</url>
      <title>${esc(cfg.title)}</title>
      <link>${esc(cfg.link)}</link>
    </image>
    <itunes:category text="${esc(cfg.category)}">
      <itunes:category text="${esc(cfg.subcategory)}"/>
    </itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <podcast:locked owner="${esc(cfg.ownerEmail)}">yes</podcast:locked>
    <podcast:guid>${esc(cfg.podcastGuid)}</podcast:guid>
    <podcast:medium>podcast</podcast:medium>
${items.join('\n')}
  </channel>
</rss>
`;
}
