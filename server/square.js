// The PALS square: one shared, live space where every minted PAL wanders, naps and plays.
// The simulation runs on the server (one world for everyone) and streams to viewers over SSE.
// Holders who are watching with their wallet signed in can steer their own PAL, emote and poke others.

export const WORLD = {w: 1400, h: 660};
const FOUNTAIN = {x: 700, y: 330, r: 105};
const BENCHES = [{x: 330, y: 150}, {x: 1070, y: 150}, {x: 330, y: 520}, {x: 1070, y: 520}];
const SUN = [{x: 180, y: 330}, {x: 1220, y: 330}, {x: 700, y: 590}];
export const EMOTES = ['gm', 'gn', '♥', '!', '?', '♪', 'lol', 'wagmi', 'zzz', '✦'];
const TICK_MS = 340;
const MAX_IN_SQUARE = 80;
const CONTROL_MS = 25000;   // a steered PAL stays put this long before going back to its own routine

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Square {
  constructor({listMinted, ownedBy, isCat}) {
    this.listMinted = listMinted;   // async () => [{pal_key, asset_id, xp}]
    this.ownedBy = ownedBy;         // async wallet => Set(pal_key) of minted PALs this wallet holds
    this.isCat = isCat;             // async key => bool
    this.pals = new Map();          // key -> state
    this.order = [];                // keys in roster order (index = id on the wire)
    this.total = 0;
    this.clients = new Set();       // {res, wallet, owned:Set}
    this.toys = {ball: {x: 520, y: 420, vx: 0, vy: 0}, yarn: {x: 900, y: 260, vx: 0, vy: 0}};
    this.rosterVersion = 0;
    this.started = false;
  }

  start() {
    if (this.started) return; this.started = true;
    this.refresh().catch(e => console.error('[square] roster', e.message));
    this._roster = setInterval(() => this.refresh().catch(() => {}), 60000);
    this._tick = setInterval(() => this.tick(), TICK_MS);
    this._ping = setInterval(() => { for (const c of this.clients) c.res.write(': ping\n\n'); }, 15000);
    for (const t of [this._roster, this._tick, this._ping]) t.unref?.();
  }
  stop() { clearInterval(this._roster); clearInterval(this._tick); clearInterval(this._ping); this.started = false; }

  spawn() {
    let best = {x: 120, y: 120}, bestGap = -1;
    for (let i = 0; i < 24; i++) {
      const x = rnd(60, WORLD.w - 60), y = rnd(90, WORLD.h - 40);
      if (Math.hypot(x - FOUNTAIN.x, y - FOUNTAIN.y) < FOUNTAIN.r + 40) continue;
      let gap = 1e9; for (const p of this.pals.values()) gap = Math.min(gap, Math.hypot((p.tx ?? p.x) - x, ((p.ty ?? p.y) - y) * 1.6));
      if (gap > bestGap) { best = {x, y}; bestGap = gap; }
      if (gap > 160) break;
    }
    return best;
  }

  // keep PALs from piling on top of each other
  separate() {
    const list = [...this.pals.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], dx = b.x - a.x, dy = (b.y - a.y) * 1.6, d = Math.hypot(dx, dy) || .01;
      if (d >= 95) continue;
      const push = (95 - d) / 2 * .35, ux = dx / d, uy = dy / d / 1.6;
      for (const [p, s] of [[a, -1], [b, 1]]) {
        if (p.act === 'poke') continue;
        p.x = clamp(p.x + ux * push * s, 40, WORLD.w - 40); p.y = clamp(p.y + uy * push * s, 60, WORLD.h - 30);
      }
    }
  }

  async refresh() {
    const rows = await this.listMinted();
    this.total = rows.length;
    // online holders' PALs first, then the most experienced, capped so the square stays readable
    const online = new Set([...this.clients].flatMap(c => [...(c.owned || [])]));
    rows.sort((a, b) => (online.has(b.pal_key) - online.has(a.pal_key)) || (b.xp - a.xp));
    const keep = rows.slice(0, MAX_IN_SQUARE).map(r => r.pal_key);
    let changed = keep.length !== this.order.length || keep.some(k => !this.pals.has(k));
    for (const k of keep) if (!this.pals.has(k)) {
      const p = this.spawn();
      this.pals.set(k, {key: k, x: p.x, y: p.y, tx: p.x, ty: p.y, act: 'idle', until: Date.now() + rnd(1000, 5000), face: Math.random() < .5 ? -1 : 1, emote: null, emoteUntil: 0, ctrlUntil: 0, cat: await this.isCat(k).catch(() => false), speed: rnd(14, 22)});
    }
    for (const k of [...this.pals.keys()]) if (!keep.includes(k)) { this.pals.delete(k); changed = true; }
    if (changed) { this.order = keep; this.rosterVersion++; this.broadcast('roster', this.rosterPayload()); }
  }

  async add(key) { await this.refresh(); this.emote(key, '✦', 4000); }

  rosterPayload() { return {v: this.rosterVersion, keys: this.order, total: this.total, world: WORLD}; }

  onlineKeys() { const s = new Set(); for (const c of this.clients) for (const k of c.owned || []) if (this.pals.has(k)) s.add(k); return s; }

  // ---------- simulation ----------
  choose(p, now) {
    const r = Math.random();
    if (r < .38) { const t = this.spawn(); Object.assign(p, {act: 'walk', tx: t.x, ty: t.y, until: now + 15000}); }
    else if (r < .55) Object.assign(p, {act: 'idle', until: now + rnd(2500, 7000)});
    else if (r < .66) { const s = pick(SUN); Object.assign(p, {act: 'tonap', tx: s.x + rnd(-60, 60), ty: s.y + rnd(-25, 25), until: now + 15000}); }
    else if (r < .76) { const b = pick(BENCHES); Object.assign(p, {act: 'tosit', tx: b.x + rnd(-40, 40), ty: b.y - 6, until: now + 15000}); }
    else { const toy = p.cat && Math.random() < .7 ? 'yarn' : 'ball'; Object.assign(p, {act: 'play', toy, until: now + rnd(6000, 12000)}); }
    if (Math.random() < .12) this.emote(p.key, pick(['♪', '✦', '!', 'gm', '?']), 2500);
  }

  step(p) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 6) return true;
    const s = Math.min(d, p.speed);
    p.x += dx / d * s; p.y += dy / d * s;
    if (Math.abs(dx) > 2) p.face = dx > 0 ? 1 : -1;
    const fd = Math.hypot(p.x - FOUNTAIN.x, p.y - FOUNTAIN.y);
    if (fd < FOUNTAIN.r) { p.x = FOUNTAIN.x + (p.x - FOUNTAIN.x) / fd * FOUNTAIN.r; p.y = FOUNTAIN.y + (p.y - FOUNTAIN.y) / fd * FOUNTAIN.r; }
    p.x = clamp(p.x, 40, WORLD.w - 40); p.y = clamp(p.y, 60, WORLD.h - 30);
    return false;
  }

  tick() {
    const now = Date.now();
    for (const p of this.pals.values()) {
      if (p.emote && now > p.emoteUntil) p.emote = null;
      const steered = now < p.ctrlUntil;
      if (p.act === 'walk' || p.act === 'tonap' || p.act === 'tosit' || p.act === 'poke') {
        const arrived = this.step(p);
        if (arrived) {
          if (p.act === 'tonap') Object.assign(p, {act: 'nap', until: now + rnd(9000, 20000)}), this.emote(p.key, 'zzz', 6000);
          else if (p.act === 'tosit') Object.assign(p, {act: 'sit', until: now + rnd(6000, 14000)});
          else if (p.act === 'poke') { const t = this.pals.get(p.target); if (t) { this.emote(t.key, '!', 2500); Object.assign(t, {act: 'hop', until: now + 1200}); } this.emote(p.key, '♥', 2500); Object.assign(p, {act: 'idle', until: now + 3000}); }
          else Object.assign(p, {act: 'idle', until: steered ? p.ctrlUntil : now + rnd(1500, 5000)});
        } else if (now > p.until && !steered) p.act = 'idle';
        continue;
      }
      if (p.act === 'play') {
        const toy = this.toys[p.toy];
        p.tx = toy.x - p.face * 26; p.ty = toy.y + 4;
        if (this.step(p) || Math.hypot(toy.x - p.x, toy.y - p.y) < 34) {
          const a = Math.atan2(toy.y - p.y, toy.x - p.x) + rnd(-.6, .6), f = rnd(16, 30);
          toy.vx += Math.cos(a) * f; toy.vy += Math.sin(a) * f;
        }
      }
      if (now > p.until && !steered) this.choose(p, now);
    }
    this.separate();
    for (const toy of Object.values(this.toys)) {
      toy.x += toy.vx; toy.y += toy.vy; toy.vx *= .82; toy.vy *= .82;
      if (toy.x < 40 || toy.x > WORLD.w - 40) { toy.vx *= -1; toy.x = clamp(toy.x, 40, WORLD.w - 40); }
      if (toy.y < 70 || toy.y > WORLD.h - 30) { toy.vy *= -1; toy.y = clamp(toy.y, 70, WORLD.h - 30); }
      const fd = Math.hypot(toy.x - FOUNTAIN.x, toy.y - FOUNTAIN.y);
      if (fd < FOUNTAIN.r - 20) { toy.x = FOUNTAIN.x + (toy.x - FOUNTAIN.x) / fd * (FOUNTAIN.r - 20); toy.y = FOUNTAIN.y + (toy.y - FOUNTAIN.y) / fd * (FOUNTAIN.r - 20); toy.vx *= -1; toy.vy *= -1; }
    }
    if (this.clients.size) this.broadcast('tick', this.snapshot());
  }

  snapshot() {
    const online = this.onlineKeys(), now = Date.now();
    return {
      p: this.order.map(k => { const p = this.pals.get(k); return p ? [Math.round(p.x), Math.round(p.y), p.act, p.face, p.emote && now < p.emoteUntil ? p.emote : 0, online.has(k) ? 1 : 0] : null; }),
      b: [Math.round(this.toys.ball.x), Math.round(this.toys.ball.y)], y: [Math.round(this.toys.yarn.x), Math.round(this.toys.yarn.y)],
      w: this.clients.size, o: online.size
    };
  }

  emote(key, e, ms = 3000) { const p = this.pals.get(key); if (p && EMOTES.includes(e)) Object.assign(p, {emote: e, emoteUntil: Date.now() + ms}); }

  // ---------- holder actions ----------
  move(key, x, y) {
    const p = this.pals.get(key); if (!p) return false;
    Object.assign(p, {act: 'walk', tx: clamp(+x || 0, 40, WORLD.w - 40), ty: clamp(+y || 0, 60, WORLD.h - 30), until: Date.now() + 15000, ctrlUntil: Date.now() + CONTROL_MS});
    return true;
  }
  poke(key, target) {
    const p = this.pals.get(key), t = this.pals.get(target); if (!p || !t || key === target) return false;
    Object.assign(p, {act: 'poke', target, tx: t.x - 40 * Math.sign(t.x - p.x || 1), ty: t.y, until: Date.now() + 15000, ctrlUntil: Date.now() + CONTROL_MS});
    return true;
  }
  act(key, a) {
    const p = this.pals.get(key); if (!p) return false;
    const now = Date.now();
    if (a === 'nap') Object.assign(p, {act: 'nap', until: now + 20000, ctrlUntil: now + 20000}), this.emote(key, 'zzz', 6000);
    else if (a === 'play') Object.assign(p, {act: 'play', toy: p.cat ? 'yarn' : 'ball', until: now + 12000, ctrlUntil: 0});
    else if (a === 'hop') Object.assign(p, {act: 'hop', until: now + 1400, ctrlUntil: now + 1400});
    else return false;
    return true;
  }

  // ---------- streaming ----------
  async join(res, wallet) {
    const c = {res, wallet, owned: new Set()};
    if (wallet) { try { c.owned = await this.ownedBy(wallet); } catch {} }
    this.clients.add(c);
    res.on('close', () => this.clients.delete(c));
    const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    if (c.owned.size && [...c.owned].some(k => !this.pals.has(k))) await this.refresh().catch(() => {});
    send('roster', this.rosterPayload());
    send('me', {wallet: wallet || null, owned: [...c.owned].filter(k => this.pals.has(k)), emotes: EMOTES});
    send('tick', this.snapshot());
    return c;
  }
  broadcast(ev, data) { const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of this.clients) c.res.write(msg); }
}
