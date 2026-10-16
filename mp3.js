// Reads an MP3's length from its first few KB, without downloading the file.
// Works in Node and in the browser (no Node-only APIs).

const BITRATES = {
  // [mpeg1][layer] and [mpeg2/2.5][layer], kbps, index 0..14
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Size of a leading ID3v2 tag (0 if none). Needs the first 10 bytes. */
export function id3Size(b) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

function header(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  const layerBits = (b[i + 1] >> 1) & 3; // 3=I, 2=II, 1=III
  const brIdx = b[i + 2] >> 4;
  const srIdx = (b[i + 2] >> 2) & 3;
  if (ver === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const layer = 4 - layerBits;
  const kbps = BITRATES[`${ver === 3 ? 1 : 2}-${layer}`][brIdx];
  const rate = RATES[ver][srIdx];
  const pad = (b[i + 2] >> 1) & 1;
  const mono = b[i + 3] >> 6 === 3;
  const spf = layer === 1 ? 384 : layer === 2 ? 1152 : ver === 3 ? 1152 : 576;
  const len = layer === 1 ? Math.floor((12 * kbps * 1000) / rate + pad) * 4
    : Math.floor(((spf / 8) * kbps * 1000) / rate) + pad;
  return { ver, layer, kbps, rate, mono, spf, len };
}

/**
 * bytes: Uint8Array starting at `offset` in the file. total: full file size.
 * Returns { seconds } or { needOffset } if the audio starts past the bytes given.
 */
export function mp3Duration(bytes, total, offset = 0) {
  let start = offset === 0 ? id3Size(bytes) : offset;
  if (start - offset + 4096 > bytes.length) return { needOffset: start };
  for (let i = start - offset; i < bytes.length - 4; i++) {
    const h = header(bytes, i);
    if (!h || h.len < 24) continue;
    const next = header(bytes, i + h.len); // confirm it's a real frame, not noise
    if (i + h.len + 4 <= bytes.length && !next) continue;
    // VBR files carry a frame count in a Xing/Info or VBRI header
    const side = h.layer !== 3 ? 0 : h.ver === 3 ? (h.mono ? 17 : 32) : h.mono ? 9 : 17;
    const x = i + 4 + side;
    const tag = String.fromCharCode(...bytes.slice(x, x + 4));
    if (tag === 'Xing' || tag === 'Info') {
      const flags = (bytes[x + 4] << 24) | (bytes[x + 5] << 16) | (bytes[x + 6] << 8) | bytes[x + 7];
      if (flags & 1) {
        const frames = ((bytes[x + 8] << 24) | (bytes[x + 9] << 16) | (bytes[x + 10] << 8) | bytes[x + 11]) >>> 0;
        if (frames > 0) return { seconds: Math.round((frames * h.spf) / h.rate) };
      }
    }
    const v = i + 4 + 32;
    if (String.fromCharCode(...bytes.slice(v, v + 4)) === 'VBRI') {
      const frames = ((bytes[v + 14] << 24) | (bytes[v + 15] << 16) | (bytes[v + 16] << 8) | bytes[v + 17]) >>> 0;
      if (frames > 0) return { seconds: Math.round((frames * h.spf) / h.rate) };
    }
    // Constant bitrate: size / bitrate
    const audioBytes = total - (offset + i);
    return { seconds: Math.round((audioBytes * 8) / (h.kbps * 1000)) };
  }
  return { seconds: null };
}

const CHUNK = 16384;

/** Look up size + length of one MP3 by URL using two small range requests at most. */
export async function probe(url, fetchImpl = fetch) {
  const get = async (from) => {
    const r = await fetchImpl(url, { headers: { Range: `bytes=${from}-${from + CHUNK - 1}` } });
    if (r.status === 404 || r.status === 403) return { missing: true, status: r.status };
    if (r.status !== 206 && r.status !== 200) throw new Error(`${url}: HTTP ${r.status}`);
    const cr = r.headers.get('content-range');
    const total = cr ? Number(cr.split('/')[1]) : Number(r.headers.get('content-length'));
    const type = r.headers.get('content-type') || '';
    // Read only what we need even if the server ignored the Range header
    const reader = r.body.getReader();
    const parts = []; let got = 0;
    while (got < CHUNK) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; }
    reader.cancel().catch(() => {});
    const bytes = new Uint8Array(Math.min(got, CHUNK)); let o = 0;
    for (const p of parts) { const n = Math.min(p.length, bytes.length - o); bytes.set(p.subarray(0, n), o); o += n; if (o >= bytes.length) break; }
    return { bytes, total, type };
  };
  const first = await get(0);
  if (first.missing) return { missing: true };
  let d = mp3Duration(first.bytes, first.total);
  if (d.needOffset != null && d.needOffset < first.total) {
    const second = await get(d.needOffset);
    if (!second.missing) d = mp3Duration(second.bytes, first.total, d.needOffset);
  }
  return { size: first.total, seconds: d.seconds ?? null, type: first.type };
}
