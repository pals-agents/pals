// pal-core.js: shared by the browser and the server.
// Deterministic hatching, species art, animation frames, NFT SVG and analysis maths.
// Changing SPECIES, RARITIES, EYES, HATS, NAME_* or the roll order changes every wallet's PAL:
// lock it before mainnet mint.
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const isAddr = a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '');
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const level = xp => 1 + Math.floor(Math.sqrt(xp / 20));
const lvlFloor = l => 20 * (l - 1) * (l - 1);
/* ---------------- data ---------------- */
const STATS = ['FOCUS', 'RECALL', 'CURIOSITY', 'CHAOS', 'WIT'];
const RARITIES = [
  {id:'common',    label:'Common',    p:60, lo:5,  hi:55,  hat:.15, color:'var(--common)'},
  {id:'uncommon',  label:'Uncommon',  p:25, lo:15, hi:65,  hat:.35, color:'var(--uncommon)'},
  {id:'rare',      label:'Rare',      p:10, lo:25, hi:75,  hat:.6,  color:'var(--rare)'},
  {id:'epic',      label:'Epic',      p:4,  lo:35, hi:85,  hat:.85, color:'var(--epic)'},
  {id:'legendary', label:'Legendary', p:1,  lo:50, hi:100, hat:1,   color:'var(--legendary)'}
];
const EYES = ['•', '°', '^', '◉', '-', '×', '✦', 'o', '@', 'ˇ'];
const HATS = [
  {id:'none', art:''},
  {id:'crown', art:'/\\/\\/\\'},
  {id:'tophat', art:'_▄█▄_'},
  {id:'party', art:'/^\\'},
  {id:'beanie', art:'(~~~)'},
  {id:'halo', art:'-===-'},
  {id:'antenna', art:'\\ /'},
  {id:'propeller', art:'-+-'}
];
const SPECIES = [
  {id:'pebble', name:'Pebble', sig:'RECALL', blurb:'Never forgets. Never hurries.', speed:4, frames:[String.raw`
   .-----.
  ( E   E )
  (   ‿   )
   '-----'`, String.raw`
   .-----.
  ( E   E )
  (   ▿   )
   '-----'`, String.raw`
  .-------.
  ( E   E )
  (   ‿   )
   '-----'`]},
  {id:'moth', name:'Moth', sig:'CURIOSITY', blurb:'Drawn to every open tab.', speed:2, frames:[String.raw`
  \  ,  /
 /\\(EE)//\
 \/ /  \ \/
     ''`, String.raw`
   \ , /
 _/\(EE)/\_
 \_/ /\ \_/
     ''`]},
  {id:'kettle', name:'Kettle', sig:'FOCUS', blurb:'Brews ideas. Whistles when done.', speed:3, frames:[String.raw`
     _     ~
  .-(_)-. ~
 / E   E \_/
|   ---   |
 '-------'`, String.raw`
     _    ~
  .-(_)-.  ~
 / E   E \_/
|   ---   |
 '-------'`, String.raw`
     _   ~ ~
  .-(_)-.
 / E   E \_/
|   ---   |
 '-------'`]},
  {id:'sprout', name:'Sprout', sig:'CURIOSITY', blurb:'Grows a little every chat.', speed:3, frames:[String.raw`
    \|/
   .-'-.
  ( E E )
   '-.-'
   /   \ `, String.raw`
     \|/
   .-'-.
  ( E E )
   '-.-'
   /   \ `, String.raw`
    \|/
   .-'-.
  ( E E )
   '-.-'
   /   \ `, String.raw`
   \|/
   .-'-.
  ( E E )
   '-.-'
   /   \ `]},
  {id:'jelly', name:'Jelly', sig:'WIT', blurb:'Floats between contexts.', speed:3, frames:[String.raw`
   .-""-.
  / E  E \
  \  ~~  /
   )||||(
   ' '' '`, String.raw`
   .-""-.
  / E  E \
  \  ~~  /
   (||||)
    '' ''`]},
  {id:'frog', name:'Frog', sig:'CHAOS', blurb:'Leaps to conclusions. Usually lands.', speed:4, frames:[String.raw`
   (E)_(E)
  /       \
 (  \___/  )
  \_______/
   ^^   ^^`, String.raw`
   (E)_(E)
  /       \
 (  \_O_/  )
  \_______/
   ^^   ^^`]},
  {id:'lantern', name:'Lantern', sig:'FOCUS', blurb:'Lights up the 3am debug session.', speed:2, frames:[String.raw`
     _|_
    [___]
   |E   E|
   |  v  |
    [___]`, String.raw`
     _|_
    [___] '
   |E   E|
   |  ~  |
    [___]`, String.raw`
     _|_
    [___]  .
   |E   E|
   |  v  |
    [___] '`]},
  {id:'bean', name:'Bean', sig:'WIT', blurb:'Fully caffeinated opinions.', speed:3, frames:[String.raw`
      ~
   .-"""-.
  /  E E  \
 |  ) ‿ (  |
  \  ) (  /
   '-...-'`, String.raw`
     ~
   .-"""-.
  /  E E  \
 |  ) o (  |
  \  ) (  /
   '-...-'`]},
  {id:'cloudlet', name:'Cloudlet', sig:'CHAOS', blurb:'Lives in the cloud. Literally.', speed:2, frames:[String.raw`
    .--.
 .-(    ).
(  E    E )
 '-.____.-'
   ' ' '`, String.raw`
    .--.
 .-(    ).
(  E    E )
 '-.____.-'
    ' ' '`, String.raw`
    .--.
 .-(    ).
(  E    E )
 '-.____.-'
  '  '  '`]},
  {id:'tardi', name:'Tardi', sig:'RECALL', blurb:'Water bear. Survives any deploy.', speed:2, frames:[String.raw`
   .-----.
  ( E   E )
 (  .---.  )
  (_______)
  /\/\/\/\ `, String.raw`
   .-----.
  ( E   E )
 (  .---.  )
  (_______)
  \/\/\/\/`]},
  {id:'kiwi', name:'Kiwi', sig:'FOCUS', blurb:'Small, flightless, unstoppable.', speed:3, frames:[String.raw`
     ___
   /E   \__
  (       _>
   \____/
    |  |`, String.raw`
     ___
   /E   \__
  (       _>.
   \____/
    /  \ `]},
  {id:'comet', name:'Comet', sig:'CHAOS', blurb:'Passes through once per epoch.', speed:2, frames:[String.raw`
 *  .  ___
  .:  (E E)
 ::::=( ◡ )
  ':   '-'
 *    .`, String.raw`
 .  *  ___
  .:  (E E)
 :::==( ◡ )
  ':   '-'
 .    *`, String.raw`
 *  .  ___
  ::  (E E)
 :::::( ◡ )
  :'   '-'
    * .`]},
  {id:'loaf', name:'Loaf', cat:true, sig:'RECALL', blurb:'Fully loafed. Remembers everything, moves for nothing.', speed:4, frames:[String.raw`
  /\_/\
 ( E E )____
 (  w      )~
  '-------'`, String.raw`
  /\_/\
 ( E E )____
 (  w      )_
  '-------'  ~`, String.raw`
  /\_/|
 ( E E )____
 (  w      )~
  '-------'`]},
  {id:'void', name:'Void', cat:true, sig:'CURIOSITY', blurb:'Stares into the backlog. The backlog blinks first.', speed:3, frames:[String.raw`
  /\___/\
 (▓E▓▓▓E▓)
 (▓▓▓^▓▓▓)  )
  (▓▓▓▓▓)  /
   ▓▓ ▓▓--'`, String.raw`
  /\___/\
 (▓E▓▓▓E▓)   (
 (▓▓▓^▓▓▓)  /
  (▓▓▓▓▓)  /
   ▓▓ ▓▓--'`]},
  {id:'keeb', name:'Keeb', cat:true, sig:'CHAOS', blurb:'Sits on the keyboard. Ships anyway.', speed:2, frames:[String.raw`
   /\_/\
  ( E E )
  /  ^  \
 [#][#][#]
 [_][_][_]`, String.raw`
   /\_/\
  ( E E )
  /  ^  \
 [#][_][#]
 [_][_][_]`, String.raw`
   /\_/\
  ( E E )
  /  ^  \
 [_][#][#]
 [_][_][_]`]},
  {id:'boxcat', name:'Boxcat', cat:true, sig:'FOCUS', blurb:'If it fits, it commits.', speed:4, frames:[String.raw`
   /\_/\
  ( E E )
 +-------+
 | ~~~~~ |
 +-------+`, String.raw`

   /\_/\
 +( E E )+
 | ~~~~~ |
 +-------+`]},
  {id:'yarnkit', name:'Yarnkit', cat:true, sig:'CURIOSITY', blurb:'Untangles any thread. Then tangles it again.', speed:2, frames:[String.raw`
  /\_/\
 ( E E )
 =( Y )=   @
  (")(")`, String.raw`
  /\_/\
 ( E E )  @
 =( Y )=/
  (")(")`, String.raw`
  /\_/\
 ( E E )
 =( Y )=_
  (")(") @`]},
  {id:'lucky', name:'Lucky', cat:true, sig:'WIT', blurb:'Waves at every green candle.', speed:3, frames:[String.raw`
  /\_/\  _
 ( E E )| |
 ( =ω= )/ /
 |  $  |_/
 '-----'`, String.raw`
  /\_/\
 ( E E )
 ( =ω= )\_
 |  $  | _)
 '-----'`]}

];
// normalise frames: drop leading blank line, strip shared indent, equalise line counts, record max width
SPECIES.forEach(s => {
  const fr = s.frames.map(f => { const l = f.split('\n'); if (l[0].trim() === '') l.shift(); return l.map(x => x.replace(/\s+$/, '')); });
  const ind = Math.min(...fr.flat().filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  const n = Math.max(...fr.map(f => f.length));
  s.frames = fr.map(f => { const o = f.map(l => l.slice(ind)); while (o.length < n) o.push(''); return o; });
  s.lines = s.frames[0];
  s.w = Math.max(...s.frames.flat().map(l => [...l].length));
});
const NAME_A = ['Pip','Nib','Mox','Bix','Lu','Zet','Kip','Rue','Tam','Vex','Oz','Fen','Jun','Sol','Pax','Wren','Ivo','Dot','Quill','Nov','Mabel','Ori','Taro','Yuz'];
const NAME_B = ['','by','let','o','ix','ee','ble','kin','zo','ra','sy','nu','ette','ly'];

/* ---------------- art ---------------- */
const len = s => [...s].length;
function artText(sp, eyes, hat, fi = 0) {
  const raw = sp.frames[fi % sp.frames.length];
  const lines = raw.map(l => l.split('E').join(eyes));
  const w = sp.w;
  const out = lines.map(l => l + ' '.repeat(Math.max(0, w - len(l))));
  if (hat && hat.art) {
    let first = -1, last = -1;
    raw.forEach(l => { [...l].forEach((c, i) => { if (c === 'E') { if (first < 0 || i < first) first = i; if (i > last) last = i; } }); });
    const center = first < 0 ? w / 2 : (first + last) / 2;
    const pad = Math.max(0, Math.round(center - (len(hat.art) - 1) / 2));
    out.unshift(' '.repeat(pad) + hat.art);
  }
  return out.join('\n');
}


/* ---------------- hashing / hatch ---------------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  try { return new Uint8Array(await crypto.subtle.digest('SHA-256', data)); }
  catch (e) { // fallback (non-crypto) for contexts without subtle
    const out = new Uint8Array(32); let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let k = 0; k < 8; k++) { for (const b of data) { h1 = Math.imul(h1 ^ b ^ k, 2654435761); h2 = Math.imul(h2 ^ b, 1597334677); } h1 ^= h2 >>> 13; out.set([h1 & 255, h1 >>> 8 & 255, h1 >>> 16 & 255, h1 >>> 24 & 255], k * 4); }
    return out;
  }
}
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
async function hatch(addr) {
  const b = await sha256('pals-v1:' + addr.trim());
  const r = mulberry32((b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0);
  const roll = r() * 100; let acc = 0, rarity = RARITIES[0];
  for (const x of RARITIES) { acc += x.p; if (roll < acc) { rarity = x; break; } }
  const species = SPECIES[Math.floor(r() * SPECIES.length)];
  const eyes = EYES[Math.floor(r() * EYES.length)];
  const hatRoll = r(), hatPick = HATS[1 + Math.floor(r() * (HATS.length - 1))];
  const hat = hatRoll < rarity.hat ? hatPick : HATS[0];
  const shiny = r() < 0.01;
  const stats = {};
  STATS.forEach(k => { let v = Math.round(rarity.lo + r() * (rarity.hi - rarity.lo)); if (k === species.sig) v += 15; stats[k] = Math.max(1, Math.min(100, v)); });
  const name = NAME_A[Math.floor(r() * NAME_A.length)] + NAME_B[Math.floor(r() * NAME_B.length)];
  const h = hex(b);
  return {addr, rarity, species, eyes, hat, shiny, stats, name, hash: h, id: h.slice(0, 6).toUpperCase()};
}
const palArt = p => artText(p.species, p.eyes, p.hat);
const palFace = p => `(${p.eyes}‿${p.eyes})`;


/* ---------------- nft svg ---------------- */
const RHEX = {common: '#b8b2a3', uncommon: '#8fbf7f', rare: '#7aa7e0', epic: '#c08ae6', legendary: '#f0b84a'};
const MOTION = {frog: 'hop', jelly: 'float', cloudlet: 'float', comet: 'drift', moth: 'flutter', void: 'float', yarnkit: 'hop'};
const MOTION_SVG = {
  bob: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4" calcMode="discrete" dur="1.4s" repeatCount="indefinite"/>`,
  hop: `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -10;0 -14;0 -5;0 0" keyTimes="0;.72;.78;.84;.9;1" dur="2.4s" repeatCount="indefinite"/>`,
  float: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="3.2s" repeatCount="indefinite"/>`,
  drift: `<animateTransform attributeName="transform" type="translate" values="0 0;5 -4;0 0" keyTimes="0;.5;1" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1" dur="2.6s" repeatCount="indefinite"/>`,
  flutter: `<animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 -1;0 0" keyTimes="0;.33;.66;1" calcMode="discrete" dur=".9s" repeatCount="indefinite"/>`
};
const blinkEyes = p => p.eyes === '-' ? '_' : '-';
// the loop a minted PAL plays: species frames cycled ~2.4s+, then one blink frame
function palTimeline(p) {
  const sp = p.species, ms = (sp.speed || 3) * 180;
  const loops = Math.max(2, Math.ceil(2400 / (ms * sp.frames.length)));
  const seq = [];
  for (let l = 0; l < loops; l++) sp.frames.forEach((_, i) => seq.push({fi: i, blink: false, ms}));
  seq.push({fi: 0, blink: true, ms: 180});
  return seq;
}
function buildSVG(p, r) {
  const sp = p.species, color = RHEX[p.rarity.id], seq = palTimeline(p);
  const total = seq.reduce((a, s) => a + s.ms, 0);
  const fs = 26, lh = 31;
  const n = artText(sp, p.eyes, p.hat, 0).split('\n').length;
  const top = 228 - (n * lh) / 2 + fs * 0.75;
  const x0 = (256 - sp.w * fs * 0.6 / 2).toFixed(1); // monospace glyphs ≈ 0.6em wide
  let t = 0;
  const frames = seq.map(s => {
    const lines = artText(sp, s.blink ? blinkEyes(p) : p.eyes, p.hat, s.fi).split('\n');
    const a = t / total, b = (t + s.ms) / total; t += s.ms;
    const kt = a === 0 ? `values="1;0" keyTimes="0;${b.toFixed(4)}"` : b > 0.99999 ? `values="0;1" keyTimes="0;${a.toFixed(4)}"` : `values="0;1;0" keyTimes="0;${a.toFixed(4)};${b.toFixed(4)}"`;
    return `<g opacity="${a === 0 ? 1 : 0}"><animate attributeName="opacity" ${kt} calcMode="discrete" dur="${total}ms" repeatCount="indefinite"/>` +
      lines.map((l, i) => `<text x="${x0}" y="${(top + i * lh).toFixed(1)}">${esc(l.replace(/\s+$/, '').replace(/ /g, '\u00a0'))}</text>`).join('') + `</g>`;
  });
  const badge = `[${p.rarity.label.toUpperCase()}]`, bw = badge.length * 8.2 + 14;
  const sub = `${p.rarity.label.toLowerCase()} ${sp.name.toLowerCase()} · lvl ${level(r.xp)} · ${sp.sig} ${p.stats[sp.sig]}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`,
    `<title>${esc(p.name)} · PAL #${p.id}</title>`,
    `<defs>`,
    `<pattern id="sc" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".3"/></pattern>`,
    `<filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feComponentTransfer in="b" result="c"><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    p.shiny ? `<linearGradient id="sh" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="300" y2="0" spreadMethod="repeat"><stop offset="0" stop-color="#f0b84a"/><stop offset=".25" stop-color="#d97757"/><stop offset=".5" stop-color="#c08ae6"/><stop offset=".75" stop-color="#7aa7e0"/><stop offset="1" stop-color="#f0b84a"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="300 0" dur="4s" repeatCount="indefinite"/></linearGradient>` : '',
    `</defs>`,
    `<rect width="512" height="512" fill="#0f0e0b"/>`,
    `<rect x="18.5" y="18.5" width="475" height="475" fill="none" stroke="#48443b" stroke-dasharray="4 4"/>`,
    `<g font-family="'JetBrains Mono','DejaVu Sans Mono',Menlo,Consolas,monospace">`,
    `<text x="13" y="24" fill="#d97757" font-size="14">+</text><text x="489" y="499" fill="#d97757" font-size="14">+</text>`,
    `<text x="38" y="54" fill="#a29c8f" font-size="14">PAL #${p.id}</text>`,
    `<rect x="${(474 - bw).toFixed(1)}" y="38" width="${bw.toFixed(1)}" height="22" fill="${color}"/><text x="${(474 - bw / 2).toFixed(1)}" y="54" fill="#0f0e0b" font-size="13" font-weight="700" text-anchor="middle">${badge}</text>`,
    p.shiny ? `<text x="${(466 - bw).toFixed(1)}" y="54" fill="#f0b84a" font-size="13" text-anchor="end">✦ shiny</text>` : '',
    `<g font-size="${fs}" xml:space="preserve" style="white-space:pre" fill="${p.shiny ? 'url(#sh)' : color}" filter="url(#gl)"><g>${MOTION_SVG[MOTION[sp.id] || 'bob']}`,
    ...frames,
    `</g></g>`,
    `<line x1="38" y1="392" x2="474" y2="392" stroke="#48443b" stroke-dasharray="4 4"/>`,
    `<text x="38" y="432" fill="#efece3" font-size="30" font-weight="700">${esc(p.name)}</text>`,
    `<text x="38" y="458" fill="#a29c8f" font-size="13">${esc(sub)}</text>`,
    `<text x="474" y="458" fill="#706b61" font-size="11" text-anchor="end">pals-v1 ◆ solana</text>`,
    `</g>`,
    `<rect width="512" height="512" fill="url(#sc)"/>`,
    `</svg>`
  ].filter(Boolean).join('\n');
}

/* ---------------- analysis tools ---------------- */
// page-side tools the PAL can call (real computations, no network)
const numsOf = a => (a || []).map(x => typeof x === 'string' ? +x.replace(/,/g, '') : +x).filter(n => isFinite(n));
function holderConcentration({balances}) {
  const b = numsOf(balances).filter(x => x > 0).sort((x, y) => y - x);
  if (b.length < 2) throw new Error('need at least 2 positive balances');
  const tot = b.reduce((a, x) => a + x, 0), sh = b.map(x => x / tot);
  const top = n => +(sh.slice(0, n).reduce((a, x) => a + x, 0) * 100).toFixed(2);
  const hhi = Math.round(sh.reduce((a, x) => a + x * x, 0) * 10000);
  const asc = [...b].reverse(), n = asc.length;
  const wsum = asc.reduce((a, x, i) => a + (i + 1) * x, 0);
  const gini = +((2 * wsum) / (n * tot) - (n + 1) / n).toFixed(3);
  return {holders: n, total: +tot.toPrecision(10), top1_pct: top(1), top5_pct: top(5), top10_pct: top(10), hhi, gini, read: hhi > 2500 ? 'highly concentrated' : hhi > 1500 ? 'moderately concentrated' : 'dispersed'};
}
function priceIndicators({closes}) {
  const c = numsOf(closes).filter(x => x > 0);
  if (c.length < 3) throw new Error('need at least 3 positive closes');
  const sma = k => c.length >= k ? +(c.slice(-k).reduce((a, x) => a + x, 0) / k).toPrecision(6) : null;
  const p = Math.min(14, c.length - 1); let g = 0, l = 0;
  for (let i = c.length - p; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  const rsi = l === 0 ? 100 : +(100 - 100 / (1 + g / l)).toFixed(1);
  let peak = c[0], mdd = 0; c.forEach(x => { peak = Math.max(peak, x); mdd = Math.max(mdd, (peak - x) / peak); });
  const r = c.slice(1).map((x, i) => Math.log(x / c[i])), mu = r.reduce((a, x) => a + x, 0) / r.length;
  const vol = Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / r.length);
  const last = c[c.length - 1];
  return {points: c.length, first: c[0], last, change_pct: +((last / c[0] - 1) * 100).toFixed(2), sma7: sma(7), sma25: sma(25), rsi14: rsi, high: Math.max(...c), low: Math.min(...c), max_drawdown_pct: +(mdd * 100).toFixed(2), volatility_per_step_pct: +(vol * 100).toFixed(2)};
}

// last number on each line ("wallet  12,345.6" → 12345.6)
function extractNums(text) {
  return text.split('\n').map(l => { const m = l.replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi); return m ? +m[m.length - 1] : NaN; }).filter(n => isFinite(n));
}

const SKILLS = [
  {id: 'chat', label: 'chat', cost: 1, stat: null, ph: 'Ask, assign a task, or tell it a preference…  (/help)'},
  {id: 'build', label: 'build', cost: 3, stat: 'FOCUS', ph: 'Describe a tool to build, e.g. "a SOL position size calculator"'},
  {id: 'research', label: 'research', cost: 2, stat: 'CURIOSITY', ph: 'What should it research? e.g. "how Metaplex Core plugins work"'},
  {id: 'chain', label: 'on-chain', cost: 2, stat: 'RECALL', ph: 'Paste holder balances or tx data to analyse (shift+enter = new line)'},
  {id: 'market', label: 'market', cost: 2, stat: 'WIT', ph: 'Paste closing prices oldest→newest, one per line, or describe the setup'}
];
const skillOf = id => SKILLS.find(s => s.id === id) || SKILLS[0];
const stars = v => '★'.repeat(Math.max(1, Math.round(v / 20))).padEnd(5, '☆');

export {esc, B58, isAddr, short, level, lvlFloor, STATS, RARITIES, EYES, HATS, SPECIES, NAME_A, NAME_B, len, artText,
  mulberry32, sha256, hex, hatch, palArt, palFace, RHEX, MOTION, MOTION_SVG, blinkEyes, palTimeline, buildSVG,
  numsOf, holderConcentration, priceIndicators, extractNums, SKILLS, skillOf, stars};
