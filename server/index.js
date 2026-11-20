// PALS server: static frontend + JSON/SSE API. No framework; Node 20+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cfg, checkConfig} from './config.js';
import {createStore} from './store.js';
import {isWallet, verifyWalletSignature, signSession, readSession, randomId, sha256hex} from './crypto.js';
import {hatch, buildSVG, level, palArt, palFace, palTimeline, blinkEyes, MOTION, SKILLS, skillOf, artText} from '../public/pal-core.js';
import {runTurn, extractMemories, extractTool, offlineReply, brainOnline} from './agent.js';
import {refill, spend, econNow, withLock, allowanceFor} from './fuel.js';
import {palGifCached} from './render-gif.js';
import {mintPal, prepareUserMint, verifyMinted, assetOwner, palAssetsOwnedBy, explorer} from './mint.js';
import {burnOn, burnPublic, burnStatus, planBurn} from './burn.js';
import {parseSkill, activeFor, publicSkill, SKILL_LIMITS} from './skills.js';
import {Square, EMOTES} from './square.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const problems = checkConfig();
if (problems.length) { console.error('[pals] config problems:\n - ' + problems.join('\n - ')); process.exit(1); }
const store = await createStore();

/* ---------------- helpers ---------------- */
const MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain'};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' about: data: blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, {'content-type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...headers});
  res.end(isObj ? JSON.stringify(body) : body);
}
const fail = (res, code, msg) => send(res, code, {error: msg});
async function readJson(req, limit = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('body too large'), {status: 413}); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('invalid json'), {status: 400}); }
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])); }
const sessionOf = req => readSession(cookies(req).pals_session);
const secure = cfg.baseUrl.startsWith('https');
const setCookie = (val, maxAge) => `pals_session=${val}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

// who can use a PAL: its hatching wallet until minted, then whoever holds the asset
const ownerCache = new Map();
async function canUse(wallet, key) {
  const pal = await store.getPal(key);
  if (!pal || !pal.asset_id) return wallet === key;
  const hit = ownerCache.get(pal.asset_id);
  let owner = hit && hit.t > Date.now() - 60000 ? hit.owner : null;
  if (!owner) { try { owner = await assetOwner(pal.asset_id); } catch {} if (owner) ownerCache.set(pal.asset_id, {owner, t: Date.now()}); }
  return owner ? owner === wallet : wallet === key;
}

const rate = new Map();
function rateOk(wallet) {
  const now = Date.now(), win = (rate.get(wallet) || []).filter(t => t > now - 60000);
  if (win.length >= cfg.chatRatePerMin) return false;
  win.push(now); rate.set(wallet, win); return true;
}

async function palRecord(key, wallet) {
  const row = await store.ensurePal(key);
  const [memories, history, tools, f, usage, skills] = await Promise.all([store.listMemories(key), store.listMessages(key, 40), store.listTools(key), refill(store, key, row), store.usageDays(key), store.listSkills(key)]);
  return {
    pal_key: key, xp: row.xp, memories, history, tools, usage, skills: skills.map(s => publicSkill(s, wallet)), compute: f.fuel, allowance: f.allowance, week: f.week,
    minted: row.asset_id ? {asset: row.asset_id, sig: row.mint_sig, at: Date.parse(row.minted_at) || Date.now(), explorer: explorer('address', row.asset_id), txExplorer: row.mint_sig ? explorer('tx', row.mint_sig) : null} : null
  };
}

async function metadata(key) {
  const p = await hatch(key), row = await store.getPal(key);
  const xp = row?.xp || 0, memories = row ? await store.listMemories(key) : [];
  const img = `${cfg.baseUrl}/api/pals/${key}/image.gif`, svg = `${cfg.baseUrl}/api/pals/${key}/image.svg`;
  return {
    name: `${p.name} · PAL #${p.id}`, symbol: 'PAL', description: `${p.rarity.label} ${p.species.name} PAL. ${p.species.blurb} Powered by Claude.`,
    image: img, external_url: cfg.baseUrl,
    attributes: [
      {trait_type: 'species', value: p.species.name}, {trait_type: 'rarity', value: p.rarity.label}, {trait_type: 'eyes', value: p.eyes},
      {trait_type: 'hat', value: p.hat.id}, {trait_type: 'shiny', value: p.shiny ? 'yes' : 'no'}, {trait_type: 'signature', value: p.species.sig},
      {trait_type: 'cat', value: p.species.cat ? 'yes' : 'no'}, {trait_type: 'brain', value: 'Claude'}, {trait_type: 'level', value: level(xp)}
    ],
    properties: {category: 'image', files: [{uri: img, type: 'image/gif'}, {uri: svg, type: 'image/svg+xml'}]},
    pals: {
      p: 'pals-v1', seed: 'sha256:' + p.hash, stats: p.stats, xp, level: level(xp), art: palArt(p).split('\n'),
      animation: {renderer: 'ascii-frames-v1', frame_ms: (p.species.speed || 3) * 180, motion: MOTION[p.species.id] || 'bob', blink_eyes: blinkEyes(p), sequence: palTimeline(p).map(s => s.blink ? 'blink' : s.fi), frames: p.species.frames.map((_, i) => artText(p.species, p.eyes, p.hat, i).split('\n'))},
      skills: SKILLS.filter(k => k.stat).map(k => ({id: k.id, affinity: p.stats[k.stat]})),
      compute: {fuel: '$PALS creator fees (100% to the compute treasury)', treasury: cfg.treasuryWallet || null},
      memory: {mode: 'private', root: 'sha256:' + sha256hex(JSON.stringify(memories.map(m => [m.type, m.text]))), count: memories.length, store: 'encrypted-offchain'}
    }
  };
}

/* ---------------- routes ---------------- */
async function api(req, res, url) {
  const m = (re) => url.pathname.match(re);
  const method = req.method;
  let mm;

  if (url.pathname === '/api/health') return send(res, 200, {ok: true, brain: brainOnline(), store: store.kind, mint: cfg.mintEnabled, mintMode: cfg.mintMode, burn: burnPublic(), cluster: cfg.cluster, live_chain: !!cfg.rpcUrl, web_search: cfg.webSearch});
  if (url.pathname === '/api/econ') { const E = await econNow(store); return send(res, 200, E); }

  if (url.pathname === '/api/auth/nonce' && method === 'POST') {
    const {wallet} = await readJson(req);
    if (!isWallet(wallet)) return fail(res, 400, 'invalid wallet');
    const message = `PALS sign-in\n\nWallet: ${wallet}\nNonce: ${randomId()}\nIssued: ${new Date().toISOString()}\n\nSigning proves you own this wallet. It is free and sends no transaction.`;
    await store.putNonce(wallet, message, 5 * 60000);
    return send(res, 200, {message});
  }
  if (url.pathname === '/api/auth/verify' && method === 'POST') {
    const {wallet, signature} = await readJson(req);
    if (!isWallet(wallet) || typeof signature !== 'string') return fail(res, 400, 'invalid request');
    const message = await store.takeNonce(wallet);
    if (!message) return fail(res, 400, 'sign-in expired, try again');
    let ok = false; try { ok = verifyWalletSignature(wallet, message, signature); } catch {}
    if (!ok) return fail(res, 401, 'signature did not verify');
    const token = signSession({w: wallet, exp: Date.now() + 7 * 864e5});
    return send(res, 200, {wallet}, {'set-cookie': setCookie(token, 7 * 86400)});
  }
  if (url.pathname === '/api/auth/logout' && method === 'POST') return send(res, 200, {ok: true}, {'set-cookie': setCookie('', 0)});

  // public NFT metadata + animated image (what the minted asset's uri points to)
  if ((mm = m(/^\/api\/pals\/([1-9A-HJ-NP-Za-km-z]{32,44})\/metadata\.json$/)) && method === 'GET') {
    if (!isWallet(mm[1])) return fail(res, 404, 'not found');
    return send(res, 200, await metadata(mm[1]), {'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*'});
  }
  if ((mm = m(/^\/api\/pals\/([1-9A-HJ-NP-Za-km-z]{32,44})\/image\.gif$/)) && method === 'GET') {
    if (!isWallet(mm[1])) return fail(res, 404, 'not found');
    const p = await hatch(mm[1]), row = await store.getPal(mm[1]);
    return send(res, 200, palGifCached(p, row?.xp || 0), {'content-type': 'image/gif', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*'});
  }
  if ((mm = m(/^\/api\/pals\/([1-9A-HJ-NP-Za-km-z]{32,44})\/image\.svg$/)) && method === 'GET') {
    if (!isWallet(mm[1])) return fail(res, 404, 'not found');
    const p = await hatch(mm[1]), row = await store.getPal(mm[1]);
    return send(res, 200, buildSVG(p, {xp: row?.xp || 0}), {'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*'});
  }

  // everything below needs a session
  const sess = sessionOf(req);
  if (!sess) return fail(res, 401, 'sign in with your wallet');
  const wallet = sess.w;
  if (url.pathname === '/api/me') return send(res, 200, {wallet});
  if (url.pathname === '/api/pals' && method === 'GET') {
    const keys = new Set();
    if (await canUse(wallet, wallet)) keys.add(wallet);
    try { for (const a of await palAssetsOwnedBy(wallet)) { const p = await store.findPalByAsset(a); if (p) keys.add(p.pal_key); } } catch {}
    return send(res, 200, {pals: [...keys]});
  }

  if (!(mm = m(/^\/api\/pals\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/.*)?$/))) return fail(res, 404, 'not found');
  const key = mm[1], sub = mm[2] || '';
  if (!isWallet(key)) return fail(res, 404, 'not found');
  if (!(await canUse(wallet, key))) return fail(res, 403, 'this wallet does not hold that PAL');

  if (sub === '' && method === 'GET') return send(res, 200, await palRecord(key, wallet));

  // skill files
  if (sub === '/skills' && method === 'GET') return send(res, 200, {skills: (await store.listSkills(key)).map(s => publicSkill(s, wallet)), limits: SKILL_LIMITS});
  if (sub === '/skills' && method === 'POST') {
    const {filename, text} = await readJson(req, SKILL_LIMITS.maxBytes * 2 + 4096);
    let sk; try { sk = parseSkill(filename, text); } catch (e) { return fail(res, 400, e.message); }
    const existing = await store.listSkills(key);
    const others = existing.filter(s => s.name !== sk.name);
    if (others.length >= SKILL_LIMITS.maxSkills) return fail(res, 400, `a PAL can hold ${SKILL_LIMITS.maxSkills} skill files: delete one first`);
    if (others.reduce((n, s) => n + s.size, 0) + sk.size > SKILL_LIMITS.maxTotalBytes) return fail(res, 400, `skill files are limited to ${SKILL_LIMITS.maxTotalBytes / 1000} KB per PAL: delete one first`);
    const replaced = existing.some(s => s.name === sk.name);
    await store.putSkill(key, sk, wallet);
    const xp = replaced ? (await store.getPal(key)).xp : await store.addXp(key, 15);
    await store.addMessage(key, {role: 'learn', content: `✦ ${(await hatch(key)).name} ${replaced ? 'updated' : 'learned'} skill: ${sk.name}`});
    return send(res, 200, {replaced, xp, skills: (await store.listSkills(key)).map(s => publicSkill(s, wallet))});
  }
  if ((mm = sub.match(/^\/skills\/([\w-]+)$/)) && method === 'GET') {
    const s = (await store.listSkills(key, true)).find(x => x.id === mm[1]);
    return s ? send(res, 200, {...publicSkill(s, wallet), body: s.body}) : fail(res, 404, 'skill not found');
  }
  if ((mm = sub.match(/^\/skills\/([\w-]+)\/approve$/)) && method === 'POST') {
    if (!(await store.approveSkill(key, mm[1], wallet))) return fail(res, 404, 'skill not found');
    return send(res, 200, {skills: (await store.listSkills(key)).map(s => publicSkill(s, wallet))});
  }
  if ((mm = sub.match(/^\/skills\/([\w-]+)$/)) && method === 'DELETE') {
    await store.deleteSkill(key, mm[1]);
    return send(res, 200, {skills: (await store.listSkills(key)).map(s => publicSkill(s, wallet))});
  }

  if (sub === '/memories' && method === 'POST') {
    const {text, type} = await readJson(req);
    if (typeof text !== 'string' || !text.trim() || text.length > 200) return fail(res, 400, 'memory must be 1-200 chars');
    const mem = await store.addMemory(key, ['preference', 'fact', 'goal', 'style'].includes(type) ? type : 'fact', text.trim());
    const xp = await store.addXp(key, 10);
    return send(res, 200, {memory: mem, xp, memories: await store.listMemories(key)});
  }
  if (sub === '/memories' && method === 'DELETE') { await store.clearMemories(key); return send(res, 200, {ok: true}); }
  if ((mm = sub.match(/^\/memories\/([\w-]+)$/)) && method === 'DELETE') { await store.deleteMemory(key, mm[1]); return send(res, 200, {ok: true}); }
  if (sub === '/history' && method === 'DELETE') { await store.clearMessages(key); return send(res, 200, {ok: true}); }
  if ((mm = sub.match(/^\/tools\/([\w-]+)$/)) && method === 'DELETE') { await store.deleteTool(key, mm[1]); return send(res, 200, {ok: true}); }

  if (sub === '/mint/burn' && method === 'GET') {
    if (!burnOn()) return send(res, 200, {on: false});
    try { return send(res, 200, {on: true, ...(await burnStatus(key))}); } catch (e) { return fail(res, 502, 'could not read token balance: ' + e.message); }
  }

  if (sub.startsWith('/mint') && method === 'POST') {
    if (!cfg.mintEnabled) return fail(res, 400, 'minting is not enabled on this server');
    if (wallet !== key) return fail(res, 403, 'only the hatching wallet can mint its PAL');
    const p = await hatch(key);
    const name = `${p.name} · PAL #${p.id}`, uri = `${cfg.baseUrl}/api/pals/${key}/metadata.json`;
    const finish = async (asset, signature) => {
      await store.setMinted(key, asset, signature || null);
      ownedCache.delete(key); square.add(key).catch(() => {});
      const xp = await store.addXp(key, 25);
      const r = await refill(store, key, {asset_id: asset});
      if (r.fuel.credits < Math.round(r.allowance.total)) await store.setFuel(key, {credits: Math.round(r.allowance.total), day: r.fuel.day});
      return send(res, 200, {asset, signature: signature || null, xp, explorer: explorer('address', asset), txExplorer: signature ? explorer('tx', signature) : null});
    };
    return withLock('mint:' + key, async () => {
      const row = await store.ensurePal(key);
      if (row.asset_id) return fail(res, 409, 'already minted');

      // recovery: the tx landed earlier but confirm never reached us
      const existing = await verifyMinted(key);
      if (existing) return existing.owner === key ? finish(existing.asset, null) : fail(res, 409, 'this PAL was already minted to another wallet');

      if (sub === '/mint/prepare') {
        if (cfg.mintMode !== 'user') return fail(res, 400, 'server is in MINT_MODE=server; use POST /mint');
        let burn = null;
        if (burnOn()) { try { burn = await planBurn(key); } catch (e) { return fail(res, e.status || 502, e.status ? e.message : 'could not read token balance: ' + e.message); } }
        return send(res, 200, await prepareUserMint({palKey: key, name, uri, burn}));
      }
      if (sub === '/mint/confirm') {
        const {signature} = await readJson(req);
        const ok = await verifyMinted(key, {waitMs: 45000});
        if (!ok) return fail(res, 404, 'mint not found on-chain yet: if your wallet sent it, try confirming again in a minute');
        if (ok.owner !== key) return fail(res, 409, 'asset is owned by another wallet');
        return finish(ok.asset, typeof signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature) ? signature : null);
      }
      if (sub === '/mint') {
        if (cfg.mintMode !== 'server') return fail(res, 400, 'this server uses wallet-paid minting: use /mint/prepare');
        const out = await mintPal({palKey: key, name, uri});
        return finish(out.asset, out.signature);
      }
      return fail(res, 404, 'not found');
    });
  }

  if (sub === '/chat' && method === 'POST') return chat(req, res, wallet, key);
  return fail(res, 404, 'not found');
}

async function chat(req, res, wallet, key) {
  const {text, mode: rawMode} = await readJson(req);
  if (typeof text !== 'string' || !text.trim() || text.length > 12000) return fail(res, 400, 'message must be 1-12000 chars');
  const mode = SKILLS.some(s => s.id === rawMode) ? rawMode : 'chat';
  if (!rateOk(wallet)) return fail(res, 429, 'slow down a little');

  res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no'});
  const ev = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  try {
    const pal = await hatch(key);
    const row = await store.ensurePal(key);
    const [memories, history, allSkills] = await Promise.all([store.listMemories(key), store.listMessages(key, 30), store.listSkills(key, true)]);
    const skills = activeFor(allSkills, wallet);
    await store.addMessage(key, {role: 'user', mode, content: text});
    const cost = skillOf(mode).cost;
    let reply, empty = false, charged = false;

    if (brainOnline()) {
      const s = await spend(store, key, row, cost);
      if (s.ok) charged = true; else empty = true;
    }
    if (brainOnline() && !empty) {
      try {
        const r = await runTurn({pal, xp: row.xp, memories, history, text, mode, skills, signal: ac.signal, onDelta: t => ev('delta', {text: t}), onTool: n => ev('tool', {name: n})});
        reply = r.text;
      } catch (e) {
        if (charged) await withLock('fuel:' + key, async () => { const f = await store.getFuel(key); if (f) await store.setFuel(key, {credits: f.credits + cost, day: f.day}); });
        console.error('[pals] turn failed:', e.status || '', e.message);
        reply = `${palFace(pal)} Something went wrong on my side${e.status === 429 ? ' (too busy)' : ''}. Your ⚡ was refunded, try again in a moment.`;
      }
    } else if (empty && !['chain', 'market'].includes(mode)) {
      reply = `${palFace(pal)} *yawns* My ⚡ battery is empty for today, so I'm resting until the 00:00 UTC refill from the $PALS compute treasury.${row.asset_id ? '' : ' Mint me to get a bigger daily allowance.'} I can still remember things you tell me.`;
    } else {
      reply = offlineReply(pal, mode, text, memories);
    }

    let tool = null, content = reply;
    if (mode === 'build') {
      const t = extractTool(reply);
      if (t) { tool = {id: randomId('tl_'), name: t.title, html: t.html, prompt: text.slice(0, 200), at: Date.now()}; await store.addTool(key, tool); content = t.rest || `Built ${t.title}.`; await store.addXp(key, 5); }
    }
    await store.addMessage(key, {role: 'assistant', mode, content, toolId: tool?.id});

    const learned = [];
    if ((mode === 'chat' || mode === 'research') && !empty) {
      const items = await extractMemories(text, memories);
      const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      const seen = new Set(memories.map(x => norm(x.text)));
      for (const it of items) {
        const t = String(it.text || '').trim().slice(0, 160);
        if (!t || seen.has(norm(t))) continue;
        seen.add(norm(t));
        const type = ['preference', 'fact', 'goal', 'style'].includes(it.type) ? it.type : 'fact';
        learned.push(await store.addMemory(key, type, t));
        await store.addMessage(key, {role: 'learn', content: `✦ ${pal.name} learned: ${t}`});
      }
      if (learned.length) await store.addXp(key, learned.length * 10);
    }
    const fresh = await store.getPal(key);
    const f = await refill(store, key, fresh);
    ev('done', {reply: content, tool, learned, xp: fresh.xp, credits: f.fuel.credits, compute: f.fuel, allowance: f.allowance, week: f.week, offline: !brainOnline()});
  } catch (e) {
    console.error('[pals] chat error', e);
    ev('error', {error: 'server error'});
  }
  res.end();
}

/* ---------------- static ---------------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return fail(res, 403, 'forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(file);
    send(res, 200, buf, {'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300', ...(ext === '.html' ? {'content-security-policy': CSP} : {})});
  });
}

/* ---------------- the square ---------------- */
const ownedCache = new Map();
async function mintedOwnedBy(wallet) {
  const hit = ownedCache.get(wallet);
  if (hit && hit.t > Date.now() - 120000) return hit.keys;
  const keys = new Set();
  const own = await store.getPal(wallet);
  if (cfg.rpcUrl) {
    try { for (const a of await palAssetsOwnedBy(wallet)) { const p = await store.findPalByAsset(a); if (p) keys.add(p.pal_key); } }
    catch { if (own && own.asset_id) keys.add(wallet); }
  } else if (own && own.asset_id) keys.add(wallet);
  ownedCache.set(wallet, {keys, t: Date.now()});
  return keys;
}
export const square = new Square({listMinted: () => store.listMinted(), ownedBy: mintedOwnedBy, isCat: async k => !!(await hatch(k)).species.cat});
const squareRate = new Map();
async function squareApi(req, res, url, method) {
  if (url.pathname === '/api/square/stream' && method === 'GET') {
    const sess = sessionOf(req);
    res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no'});
    await square.join(res, sess ? sess.w : null);
    return;
  }
  if (url.pathname === '/api/square' && method === 'GET') return send(res, 200, {...square.rosterPayload(), ...square.snapshot(), emotes: EMOTES});
  const sess = sessionOf(req);
  if (!sess) return fail(res, 401, 'sign in with your wallet');
  if (method !== 'POST') return fail(res, 405, 'method not allowed');
  const now = Date.now(), win = (squareRate.get(sess.w) || []).filter(t => t > now - 2000);
  if (win.length >= 8) return fail(res, 429, 'slow down a little');
  win.push(now); squareRate.set(sess.w, win);
  const body = await readJson(req);
  const owned = await mintedOwnedBy(sess.w);
  if (!owned.has(body.key)) return fail(res, 403, 'you can only steer a minted PAL you hold');
  let ok = false;
  if (url.pathname === '/api/square/move') ok = square.move(body.key, body.x, body.y);
  else if (url.pathname === '/api/square/emote') { ok = EMOTES.includes(body.emote) && square.pals.has(body.key); if (ok) square.emote(body.key, body.emote, 3500); }
  else if (url.pathname === '/api/square/poke') ok = square.poke(body.key, body.target);
  else if (url.pathname === '/api/square/act') ok = square.act(body.key, body.act);
  else return fail(res, 404, 'not found');
  return ok ? send(res, 200, {ok: true}) : fail(res, 400, 'that PAL is not in the square right now');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/square')) return await squareApi(req, res, url, req.method);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/favicon.ico') { res.writeHead(301, {location: '/favicon.svg'}); return res.end(); }
    if (url.pathname === '/collection.json') return send(res, 200, {name: 'PALS', symbol: 'PAL', description: 'PALS: Productive Agent Learning System. Wallet-hatched, animated AI agents on Solana, powered by Claude.', image: `${cfg.baseUrl}/api/pals/11111111111111111111111111111111/image.gif`, external_url: cfg.baseUrl}, {'access-control-allow-origin': '*'});
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'server error');
    if (!e.status) console.error('[pals]', e);
  }
});
server.listen(cfg.port, () => console.log(`[pals] http://localhost:${cfg.port}  store=${store.kind}  brain=${brainOnline() ? cfg.model : 'offline'}  live_chain=${!!cfg.rpcUrl}  mint=${cfg.mintEnabled ? cfg.cluster + '/' + cfg.mintMode : 'off'}`));
square.start();
export {server, store};
