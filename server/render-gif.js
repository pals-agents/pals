// Renders a PAL as an animated GIF (512x512) that matches the SVG card.
// GIFs display everywhere (marketplace image proxies, wallets, X), unlike animated SVG.
import glyphs from './glyphs.js';
import {encodeGif} from './gif.js';
import {artText, palTimeline, blinkEyes, level, MOTION, RHEX} from '../public/pal-core.js';

const S = 512;
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const C = {bg: hexRgb('#0f0e0b'), scan: hexRgb('#0b0a08'), line: hexRgb('#48443b'), accent: hexRgb('#d97757'), text: hexRgb('#efece3'), muted: hexRgb('#a29c8f'), dim: hexRgb('#706b61'), gold: hexRgb('#f0b84a')};
const SHINY = ['#f0b84a', '#d97757', '#c08ae6', '#7aa7e0', '#8fbf7f'].map(hexRgb);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// decode atlases once
const atlas = {};
for (const [name, a] of Object.entries(glyphs)) {
  const g = {};
  for (const [ch, b64] of Object.entries(a.glyphs)) {
    const raw = Buffer.from(b64, 'base64'), px = new Uint8Array(a.w * a.h);
    for (let i = 0; i < px.length; i++) px[i] = i & 1 ? raw[i >> 1] & 15 : raw[i >> 1] >> 4;
    g[ch] = px;
  }
  atlas[name] = {...a, g};
}

class Frame {
  constructor(pal) { this.pal = pal; this.px = new Uint8Array(S * S); }
  fill(x, y, w, h, rgb) { const c = this.pal.idx(rgb); for (let j = Math.max(0, y); j < Math.min(S, y + h); j++) this.px.fill(c, j * S + Math.max(0, x), j * S + Math.min(S, x + w)); }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < S && y < S) this.px[y * S + x] = c; }
  dashH(x1, x2, y, rgb) { const c = this.pal.idx(rgb); for (let x = x1; x <= x2; x++) if ((x - x1) % 8 < 4) this.set(x, y, c); }
  dashV(x, y1, y2, rgb) { const c = this.pal.idx(rgb); for (let y = y1; y <= y2; y++) if ((y - y1) % 8 < 4) this.set(x, y, c); }
  // draws text with its top-left at (x, y); colorAt(i) gives the fg colour of char i; bg is what's behind it
  text(name, x, y, str, colorAt, bg) {
    const A = atlas[name];
    [...str].forEach((ch, i) => {
      const g = A.g[ch]; if (!g || ch === ' ') return;
      const fg = colorAt(i), ox = Math.round(x + i * A.w);
      for (let j = 0; j < A.h; j++) for (let k = 0; k < A.w; k++) {
        const a = g[j * A.w + k]; if (a < 2) continue;
        const q = Math.min(4, Math.round(a / 15 * 4)) / 4;
        this.set(ox + k, Math.round(y) + j, this.pal.idx(q >= 1 ? fg : mix(bg, fg, q)));
      }
    });
  }
}
class Palette {
  constructor() { this.list = []; this.map = new Map(); }
  idx(rgb) { const k = rgb.join(','); let i = this.map.get(k); if (i === undefined) { if (this.list.length >= 256) return this.nearest(rgb); i = this.list.length; this.list.push(rgb); this.map.set(k, i); } return i; }
  nearest(rgb) { let best = 0, bd = 1e9; this.list.forEach((c, i) => { const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; }
}

function motion(kind, t) {
  if (kind === 'hop') { const p = (t % 2400) / 2400; return [0, p < .72 ? 0 : p < .78 ? -10 : p < .84 ? -14 : p < .9 ? -5 : 0]; }
  if (kind === 'float') return [0, Math.round(-8 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / 3200)))];
  if (kind === 'drift') { const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / 2600); return [Math.round(5 * s), Math.round(-4 * s)]; }
  if (kind === 'flutter') { const p = (t % 900) / 900; return [0, p < .33 ? 0 : p < .66 ? -5 : -1]; }
  return [0, Math.floor(t / 700) % 2 ? -4 : 0];
}

function drawCard(f, p, xp) {
  f.fill(0, 0, S, S, C.bg);
  for (let y = 0; y < S; y += 4) f.fill(0, y, S, 1, C.scan);
  f.dashH(18, 493, 18, C.line); f.dashH(18, 493, 493, C.line); f.dashV(18, 18, 493, C.line); f.dashV(493, 18, 493, C.line);
  const U = atlas.ui, B = atlas.badge, T = atlas.title;
  f.text('ui', 9, 9, '+', () => C.accent, C.bg); f.text('ui', 488, 485, '+', () => C.accent, C.bg);
  f.text('ui', 38, 54 - U.asc, `PAL #${p.id}`, () => C.muted, C.bg);
  const rc = hexRgb(RHEX[p.rarity.id]), badge = `[${p.rarity.label.toUpperCase()}]`, bw = badge.length * B.w + 14, bx = 474 - bw;
  f.fill(bx, 38, bw, 22, rc);
  f.text('badge', bx + 7, 38 + Math.round((22 - B.h) / 2), badge, () => C.bg, rc);
  if (p.shiny) { const s = '✦ shiny'; f.text('ui', bx - 8 - s.length * U.w, 54 - U.asc, s, () => C.gold, C.bg); }
  f.dashH(38, 474, 392, C.line);
  f.text('title', 38, 432 - T.asc, p.name, () => C.text, C.bg);
  const sub = `${p.rarity.label.toLowerCase()} ${p.species.name.toLowerCase()} · lvl ${level(xp)} · ${p.species.sig} ${p.stats[p.species.sig]}`;
  f.text('ui', 38, 458 - U.asc, sub, () => C.muted, C.bg);
  const tag = 'pals-v1 ◆ solana';
  f.text('ui', 474 - tag.length * U.w, 458 - U.asc, tag, () => C.dim, C.bg);
}

export function renderPalGif(p, xp = 0) {
  const pal = new Palette();
  pal.idx(C.bg);
  const sp = p.species, A = atlas.art, kind = MOTION[sp.id] || 'bob';
  const rc = hexRgb(RHEX[p.rarity.id]);
  const frames = [];
  let t = 0, step = 0;
  for (const s of palTimeline(p)) {
    const f = new Frame(pal);
    drawCard(f, p, xp);
    const lines = artText(sp, s.blink ? blinkEyes(p) : p.eyes, p.hat, s.fi).split('\n');
    const lh = A.h - 1, x0 = 256 - sp.w * A.w / 2, top = 228 - lines.length * lh / 2;
    const [mx, my] = motion(kind, t);
    lines.forEach((l, li) => {
      const color = p.shiny ? (i => mix(SHINY[(i + li + step) % 5], SHINY[(i + li + step + 1) % 5], 0.5)) : (() => rc);
      f.text('art', x0 + mx, top + li * lh + my, l, color, C.bg);
    });
    frames.push({pixels: f.px, delay: s.ms / 10});
    t += s.ms; step++;
  }
  return encodeGif(S, S, pal.list, frames);
}

const cache = new Map();
export function palGifCached(p, xp) {
  const key = `${p.addr}:${p.shiny}:${level(xp)}`;
  let buf = cache.get(key);
  if (!buf) { buf = renderPalGif(p, xp); cache.set(key, buf); if (cache.size > 300) cache.delete(cache.keys().next().value); }
  return buf;
}
