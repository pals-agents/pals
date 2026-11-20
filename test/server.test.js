// Integration test: boots the server with the file store and an offline brain.
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pals-'));
Object.assign(process.env, {PORT: '0', FILE_STORE_PATH: path.join(tmp, 'store.json'), ANTHROPIC_API_KEY: process.env.TEST_ANTHROPIC_KEY || '', DATABASE_URL: '', SOLANA_RPC_URL: '', MINT_ENABLED: 'false', SESSION_SECRET: 'x'.repeat(40)});
const {server} = await import('../server/index.js');
const {b58encode} = await import('../server/crypto.js');
await new Promise(r => server.listening ? r() : server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

function newWallet() {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
  const address = b58encode(Buffer.from(publicKey.export({format: 'jwk'}).x, 'base64url'));
  return {address, sign: msg => crypto.sign(null, Buffer.from(msg), privateKey).toString('base64')};
}
async function signIn(w) {
  const {message} = await (await fetch(base + '/api/auth/nonce', {method: 'POST', body: JSON.stringify({wallet: w.address})})).json();
  const r = await fetch(base + '/api/auth/verify', {method: 'POST', body: JSON.stringify({wallet: w.address, signature: w.sign(message)})});
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
async function sse(cookie, key, body) {
  const r = await fetch(`${base}/api/pals/${key}/chat`, {method: 'POST', headers: {cookie}, body: JSON.stringify(body)});
  const text = await r.text();
  return text.split('\n\n').filter(Boolean).map(b => ({event: b.match(/^event: (.*)$/m)?.[1], data: JSON.parse(b.match(/^data: (.*)$/m)?.[1] || 'null')}));
}

test('health + static', async () => {
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.ok, true); assert.equal(h.store, 'file');
  const r = await fetch(base + '/');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/../server/config.js')).status, 404);
});

test('public NFT metadata + animated svg', async () => {
  const w = newWallet();
  const meta = await (await fetch(`${base}/api/pals/${w.address}/metadata.json`)).json();
  assert.match(meta.name, /PAL #[0-9A-F]{6}/);
  assert.ok(meta.pals.animation.frames.length >= 2);
  const svg = await (await fetch(`${base}/api/pals/${w.address}/image.svg`)).text();
  assert.match(svg, /<animate attributeName="opacity"/);
  assert.match(meta.image, /image\.gif$/);
  const gif = Buffer.from(await (await fetch(`${base}/api/pals/${w.address}/image.gif`)).arrayBuffer());
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a'); assert.ok(gif.length > 5000);
});

test('sign-in rejects a bad signature and replays', async () => {
  const w = newWallet(), other = newWallet();
  const {message} = await (await fetch(base + '/api/auth/nonce', {method: 'POST', body: JSON.stringify({wallet: w.address})})).json();
  const bad = await fetch(base + '/api/auth/verify', {method: 'POST', body: JSON.stringify({wallet: w.address, signature: other.sign(message)})});
  assert.equal(bad.status, 401);
  const replay = await fetch(base + '/api/auth/verify', {method: 'POST', body: JSON.stringify({wallet: w.address, signature: w.sign(message)})});
  assert.equal(replay.status, 400, 'nonce is single-use');
});

test('pal record, ownership, memories, offline chat, mint gate', async () => {
  const w = newWallet(), stranger = newWallet();
  const cookie = await signIn(w);
  assert.equal((await fetch(base + '/api/me')).status, 401);
  const rec = await (await fetch(`${base}/api/pals/${w.address}`, {headers: {cookie}})).json();
  assert.equal(rec.compute.credits, 20); assert.equal(rec.allowance.trial, true);

  const sc = await signIn(stranger);
  assert.equal((await fetch(`${base}/api/pals/${w.address}`, {headers: {cookie: sc}})).status, 403);

  const m = await (await fetch(`${base}/api/pals/${w.address}/memories`, {method: 'POST', headers: {cookie}, body: JSON.stringify({text: 'Building a Solana NFT project', type: 'goal'})})).json();
  assert.equal(m.memories.length, 1); assert.equal(m.xp, 10);

  const events = await sse(cookie, w.address, {text: 'I prefer short answers', mode: 'chat'});
  const done = events.find(e => e.event === 'done').data;
  assert.equal(done.offline, true);
  assert.ok(done.learned.some(x => /short answers/i.test(x.text)), 'heuristic memory extraction');

  const chain = await sse(cookie, w.address, {text: 'a 100\nb 50\nc 25\nd 5', mode: 'chain'});
  assert.match(chain.find(e => e.event === 'done').data.reply, /top 1: 55\.56%/);

  const rec2 = await (await fetch(`${base}/api/pals/${w.address}`, {headers: {cookie}})).json();
  assert.ok(rec2.history.length >= 4); assert.equal(rec2.memories.length, 2);
  await fetch(`${base}/api/pals/${w.address}/memories/${rec2.memories[0].id}`, {method: 'DELETE', headers: {cookie}});
  assert.equal((await (await fetch(`${base}/api/pals/${w.address}`, {headers: {cookie}})).json()).memories.length, 1);

  const mint = await fetch(`${base}/api/pals/${w.address}/mint`, {method: 'POST', headers: {cookie}});
  assert.equal(mint.status, 400);
});

test.after(() => { server.close(); setTimeout(() => process.exit(0), 100); });

test('burn-to-mint: amounts, instruction data, burn plan', async () => {
  const {cfg} = await import('../server/config.js');
  const burn = await import('../server/burn.js');
  assert.equal(burn.toRaw('50000', 6), 50000000000n);
  assert.equal(burn.toRaw('1.5', 9), 1500000000n);
  assert.equal(burn.fromRaw(50000000000n, 6), '50,000');
  assert.equal(burn.fromRaw(1234500000n, 6), '1,234.5');
  assert.throws(() => burn.toRaw('0', 6));
  const d = burn.burnCheckedData(50000000000n, 6);
  assert.deepEqual([...d], [15, 0x00, 0x74, 0x3b, 0xa4, 0x0b, 0, 0, 0, 6]);

  // fake RPC: mint with 6 decimals on Token-2022; owner has 30k + 25k + 5k (frozen) in three accounts
  const realFetch = globalThis.fetch;
  const mint = 'PALSmint1111111111111111111111111111111111', owner = 'Owner11111111111111111111111111111111111111';
  Object.assign(cfg, {mintEnabled: true, mintMode: 'user', rpcUrl: 'http://rpc.test', burnMint: mint, burnAmount: '50000'});
  const acct = (pubkey, amount, state = 'initialized') => ({pubkey, account: {data: {parsed: {info: {state, tokenAmount: {amount: String(amount)}}}}}});
  globalThis.fetch = async (url, opts) => {
    if (url !== 'http://rpc.test') return realFetch(url, opts);
    const {method} = JSON.parse(opts.body);
    const result = method === 'getAccountInfo'
      ? {value: {owner: burn.TOKEN_2022_PROGRAM, data: {parsed: {info: {decimals: 6}}}}}
      : {value: [acct('A', 30000e6), acct('B', 25000e6), acct('C', 5000e6, 'frozen')]};
    return new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result}));
  };
  try {
    assert.equal(burn.burnOn(), true);
    const plan = await burn.planBurn(owner);
    assert.equal(plan.program, burn.TOKEN_2022_PROGRAM);
    assert.deepEqual(plan.parts.map(p => [p.account, p.amount]), [['A', 30000000000n], ['B', 20000000000n]]);
    const st = await burn.burnStatus(owner);
    assert.deepEqual(st, {symbol: '$PALS', required: '50,000', balance: '55,000', enough: true});
    cfg.burnAmount = '60000';
    await assert.rejects(burn.planBurn(owner), e => e.status === 402 && /need 60,000 \$PALS/.test(e.message) && /has 55,000/.test(e.message));
    cfg.mintMode = 'server';
    assert.equal(burn.burnOn(), false);
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(cfg, {mintEnabled: false, mintMode: 'user', rpcUrl: '', burnMint: '', burnAmount: ''});
  }
});

test('skill files: parse, upload, replace, review on transfer, delete', async () => {
  const {parseSkill, publicSkill, skillPrompt, loadSkillTool, activeFor} = await import('../server/skills.js');
  const md = '---\nname: Token Vetting\ndescription: Use when I ask you to vet a Solana token.\n---\n# Token vetting\n1. run token_overview\n';
  const p = parseSkill('SKILL.md', md);
  assert.equal(p.name, 'token-vetting');
  assert.equal(p.description, 'Use when I ask you to vet a Solana token.');
  assert.match(p.body, /^# Token vetting/);
  const plain = parseSkill('thread-style.txt', 'Write threads in lowercase.\nMax 5 tweets.');
  assert.equal(plain.name, 'thread-style');
  assert.equal(plain.description, 'Write threads in lowercase.');
  assert.throws(() => parseSkill('x.md', ''), /empty/);
  assert.throws(() => parseSkill('x.md', 'a'.repeat(25000)), /too big/);
  assert.throws(() => parseSkill('x.md', 'ok\u0000\u0001'), /binary/);

  // inherited skills are off for a new holder until approved
  const s = {id: 's1', name: 'a', description: 'd', size: 10, added_by: 'OLD', approved_by: 'OLD'};
  assert.deepEqual([publicSkill(s, 'NEW').active, publicSkill(s, 'NEW').inherited], [false, true]);
  assert.equal(activeFor([s], 'NEW').length, 0);
  assert.equal(activeFor([s], 'OLD').length, 1);
  assert.match(skillPrompt([{name: 'a', description: 'd'}]), /load_skill/);
  assert.deepEqual(loadSkillTool([{name: 'a'}, {name: 'b'}]).input_schema.properties.name.enum, ['a', 'b']);

  // API flow
  const w = newWallet(), cookie = await signIn(w);
  const H = {cookie, 'content-type': 'application/json'};
  let r = await fetch(`${base}/api/pals/${w.address}/skills`, {method: 'POST', headers: H, body: JSON.stringify({filename: 'SKILL.md', text: md})});
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.replaced, false); assert.equal(j.skills.length, 1); assert.equal(j.skills[0].active, true); assert.equal(j.xp, 15);
  r = await fetch(`${base}/api/pals/${w.address}/skills`, {method: 'POST', headers: H, body: JSON.stringify({filename: 'SKILL.md', text: md + '2. check holders\n'})});
  j = await r.json(); assert.equal(j.replaced, true); assert.equal(j.skills.length, 1);
  const id = j.skills[0].id;
  j = await (await fetch(`${base}/api/pals/${w.address}/skills/${id}`, {headers: H})).json();
  assert.match(j.body, /check holders/);
  j = await (await fetch(`${base}/api/pals/${w.address}`, {headers: H})).json();
  assert.equal(j.skills[0].name, 'token-vetting');
  r = await fetch(`${base}/api/pals/${w.address}/skills`, {method: 'POST', headers: H, body: JSON.stringify({filename: 'x.md', text: ''})});
  assert.equal(r.status, 400);
  // another wallet cannot touch it
  const w2 = newWallet(), c2 = await signIn(w2);
  r = await fetch(`${base}/api/pals/${w.address}/skills`, {headers: {cookie: c2}});
  assert.equal(r.status, 403);
  j = await (await fetch(`${base}/api/pals/${w.address}/skills/${id}`, {method: 'DELETE', headers: H})).json();
  assert.equal(j.skills.length, 0);
});

test('square: simulation, stream and holder controls', async () => {
  const {Square, WORLD} = await import('../server/square.js');
  const sq = new Square({listMinted: async () => [{pal_key: 'A', xp: 5}, {pal_key: 'B', xp: 9}], ownedBy: async w => new Set(w === 'A' ? ['A'] : []), isCat: async k => k === 'A'});
  await sq.refresh();
  assert.deepEqual(sq.order, ['B', 'A']);
  for (let i = 0; i < 60; i++) sq.tick();
  for (const p of sq.pals.values()) { assert.ok(p.x >= 40 && p.x <= WORLD.w - 40); assert.ok(p.y >= 60 && p.y <= WORLD.h - 30); }
  Object.assign(sq.pals.get('B'), {x: 1200, y: 500, tx: 1200, ty: 500, act: 'nap', until: Date.now() + 60000});
  assert.ok(sq.move('A', 100, 100));
  for (let i = 0; i < 80; i++) sq.tick();
  const a = sq.pals.get('A'); assert.ok(Math.hypot(a.x - 100, a.y - 100) < 8, 'steered PAL arrives');
  assert.ok(sq.poke('A', 'B')); assert.equal(sq.poke('A', 'A'), false);
  sq.emote('A', 'gm'); assert.equal(sq.snapshot().p[1][4], 'gm');
  sq.emote('A', '<script>'); assert.equal(sq.pals.get('A').emote, 'gm', 'only whitelisted emotes');

  // HTTP: anyone can read; steering needs a session and a held, minted PAL
  const j = await (await fetch(`${base}/api/square`)).json();
  assert.ok(Array.isArray(j.keys)); assert.ok(j.emotes.includes('gm'));
  let r = await fetch(`${base}/api/square/move`, {method: 'POST', body: JSON.stringify({key: 'x', x: 1, y: 1})});
  assert.equal(r.status, 401);
  const w = newWallet(), cookie = await signIn(w);
  r = await fetch(`${base}/api/square/move`, {method: 'POST', headers: {cookie}, body: JSON.stringify({key: w.address, x: 1, y: 1})});
  assert.equal(r.status, 403, 'unminted PAL cannot be steered');
  const ac = new AbortController();
  r = await fetch(`${base}/api/square/stream`, {signal: ac.signal});
  assert.match(r.headers.get('content-type'), /event-stream/);
  const reader = r.body.getReader(); const {value} = await reader.read();
  assert.match(new TextDecoder().decode(value), /event: roster/);
  ac.abort();
});

test('claude code bridge: agent key, MCP tools, agent pack, revoke', async () => {
  const {looksSecret} = await import('../server/claude-code.js');
  assert.equal(looksSecret('my seed phrase is in a drawer'), true);
  assert.equal(looksSecret('abandon ability able about above absent absorb abstract absurd abuse access accident'), true);
  assert.equal(looksSecret('Prefers short answers with bullet points'), false);

  const w = newWallet(), cookie = await signIn(w);
  const H = {cookie, 'content-type': 'application/json'};
  const k = await (await fetch(`${base}/api/pals/${w.address}/agent-keys`, {method: 'POST', headers: H, body: JSON.stringify({label: 'laptop'})})).json();
  assert.match(k.token, /^pals_/); assert.match(k.command, /claude mcp add --scope user --transport http pal-/);
  const mcp = async (body, token = k.token) => fetch(`${base}/mcp`, {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream'}, body: JSON.stringify(body)});
  let r = await mcp({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '1'}}});
  let j = await r.json();
  assert.equal(j.result.protocolVersion, '2025-06-18'); assert.equal(j.result.serverInfo.name, 'pals');
  r = await mcp({jsonrpc: '2.0', method: 'notifications/initialized'}); assert.equal(r.status, 202);
  j = await (await mcp({jsonrpc: '2.0', id: 2, method: 'tools/list'})).json();
  const names = j.result.tools.map(t => t.name);
  for (const n of ['pal_context', 'pal_remember', 'pal_forget', 'pal_get_skill', 'pal_learn_skill', 'pal_token_market']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('pal_token_overview'), 'rpc tools hidden without SOLANA_RPC_URL');
  const callTool = async (name, args) => (await (await mcp({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name, arguments: args}})).json()).result;
  let res = await callTool('pal_remember', {text: 'Deploys everything on Railway', type: 'fact'});
  assert.match(res.content[0].text, /Saved/);
  res = await callTool('pal_remember', {text: 'my private key is 5abc', type: 'fact'}); assert.equal(res.isError, true);
  res = await callTool('pal_learn_skill', {content: '---\nname: pr-review\ndescription: Use when I ask for a PR review.\n---\nCheck tests first.', filename: 'SKILL.md'});
  assert.match(res.content[0].text, /Learned skill "pr-review"/);
  res = await callTool('pal_context', {});
  const ctx = JSON.parse(res.content[0].text);
  assert.equal(ctx.memories[0].text, 'Deploys everything on Railway'); assert.equal(ctx.skills[0].name, 'pr-review');
  res = await callTool('pal_get_skill', {name: 'pr-review'}); assert.match(res.content[0].text, /Check tests first/);
  // the platform sees what was learned in Claude Code
  const pal = await (await fetch(`${base}/api/pals/${w.address}`, {headers: H})).json();
  assert.ok(pal.memories.some(m => m.text === 'Deploys everything on Railway'));
  assert.ok(pal.skills.some(s => s.name === 'pr-review' && s.active));
  // agent pack
  r = await fetch(`${base}/api/pals/${w.address}/claude-code`, {headers: H});
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const zipBuf = Buffer.from(await r.arrayBuffer());
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50);
  const listing = zipBuf.toString('latin1');
  assert.match(listing, /\.claude\/agents\/[a-z0-9-]+\.md/); assert.match(listing, /\.claude\/skills\/pr-review\/SKILL\.md/); assert.match(listing, /Deploys everything on Railway/);
  // bad / revoked keys
  r = await mcp({jsonrpc: '2.0', id: 9, method: 'tools/list'}, 'pals_' + 'x'.repeat(30)); assert.equal(r.status, 401);
  await fetch(`${base}/api/pals/${w.address}/agent-keys/${k.id}`, {method: 'DELETE', headers: H});
  r = await mcp({jsonrpc: '2.0', id: 10, method: 'tools/list'}); assert.equal(r.status, 401);
});
