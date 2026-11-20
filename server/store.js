// Storage: Postgres in production (DATABASE_URL), a JSON file for local dev.
// Memories and messages are sealed with AES-256-GCM (server/crypto.js).
import fs from 'node:fs';
import path from 'node:path';
import {cfg} from './config.js';
import {seal, open, randomId} from './crypto.js';

const SKILLS_SQL = `create table if not exists skills (
  id          text primary key,
  pal_key     text not null references pals(pal_key) on delete cascade,
  name        text not null,
  description text not null,
  body        text not null,                 -- AES-256-GCM sealed
  size        integer not null,
  added_by    text not null,                 -- wallet that uploaded it
  approved_by text,                          -- wallet it is active for (re-approved after a transfer)
  created_at  timestamptz not null default now(),
  unique (pal_key, name)
);`;
const MAX_MEMORIES = 80, MAX_MESSAGES = 200, MAX_TOOLS = 12;
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- file store (dev) ---------------- */
class FileStore {
  constructor(file) {
    this.kind = 'file';
    this.file = file;
    fs.mkdirSync(path.dirname(file), {recursive: true});
    try { this.d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.d = {}; }
    for (const k of ['pals', 'memories', 'messages', 'tools', 'skills', 'fuel', 'usage', 'nonces', 'epochs']) this.d[k] ||= (k === 'epochs' ? [] : {});
    this._t = null;
  }
  _save() { clearTimeout(this._t); this._t = setTimeout(() => fs.writeFileSync(this.file, JSON.stringify(this.d)), 50); }
  async init() {}
  async getPal(k) { return this.d.pals[k] || null; }
  async ensurePal(k) { this.d.pals[k] ||= {pal_key: k, asset_id: null, mint_sig: null, minted_at: null, xp: 0, created_at: new Date().toISOString()}; this._save(); return this.d.pals[k]; }
  async findPalByAsset(asset) { return Object.values(this.d.pals).find(p => p.asset_id === asset) || null; }
  async setMinted(k, asset, sig) { const p = await this.ensurePal(k); Object.assign(p, {asset_id: asset, mint_sig: sig, minted_at: new Date().toISOString()}); this._save(); return p; }
  async addXp(k, n) { const p = await this.ensurePal(k); p.xp += n; this._save(); return p.xp; }
  async countMinted() { return Object.values(this.d.pals).filter(p => p.asset_id).length; }
  async listMinted() { return Object.values(this.d.pals).filter(p => p.asset_id).map(p => ({pal_key: p.pal_key, asset_id: p.asset_id, xp: p.xp})); }

  async listMemories(k) { return (this.d.memories[k] || []).map(m => ({id: m.id, type: m.type, text: open(m.body), at: m.at})); }
  async addMemory(k, type, text) { const l = (this.d.memories[k] ||= []); const m = {id: randomId('m_'), type, body: seal(text), at: Date.now()}; l.push(m); this.d.memories[k] = l.slice(-MAX_MEMORIES); this._save(); return {id: m.id, type, text, at: m.at}; }
  async deleteMemory(k, id) { this.d.memories[k] = (this.d.memories[k] || []).filter(m => m.id !== id); this._save(); }
  async clearMemories(k) { this.d.memories[k] = []; this._save(); }

  async listMessages(k, limit = 40) { return (this.d.messages[k] || []).slice(-limit).map(m => ({role: m.role, mode: m.mode, content: open(m.body), toolId: m.tool_id || undefined})); }
  async addMessage(k, {role, mode, content, toolId}) { const l = (this.d.messages[k] ||= []); l.push({role, mode: mode || null, body: seal(content), tool_id: toolId || null, at: Date.now()}); this.d.messages[k] = l.slice(-MAX_MESSAGES); this._save(); }
  async clearMessages(k) { this.d.messages[k] = []; this._save(); }

  async listTools(k) { return (this.d.tools[k] || []).map(t => ({...t})); }
  async addTool(k, t) { const l = [{...t, at: Date.now()}, ...(this.d.tools[k] || [])].slice(0, MAX_TOOLS); this.d.tools[k] = l; this._save(); }
  async deleteTool(k, id) { this.d.tools[k] = (this.d.tools[k] || []).filter(t => t.id !== id); this._save(); }

  async listSkills(k, withBody = false) { return (this.d.skills[k] || []).map(s => ({id: s.id, name: s.name, description: s.description, size: s.size, added_by: s.added_by, approved_by: s.approved_by, at: s.at, ...(withBody ? {body: open(s.body)} : {})})); }
  async putSkill(k, sk, wallet) {
    const l = (this.d.skills[k] ||= []);
    const old = l.find(x => x.name === sk.name);
    const row = {id: old ? old.id : randomId('sk_'), name: sk.name, description: sk.description, body: seal(sk.body), size: sk.size, added_by: wallet, approved_by: wallet, at: Date.now()};
    if (old) Object.assign(old, row); else l.push(row);
    this._save(); return row.id;
  }
  async approveSkill(k, id, wallet) { const s = (this.d.skills[k] || []).find(x => x.id === id); if (s) { s.approved_by = wallet; this._save(); } return !!s; }
  async deleteSkill(k, id) { this.d.skills[k] = (this.d.skills[k] || []).filter(s => s.id !== id); this._save(); }

  async getFuel(k) { return this.d.fuel[k] || null; }
  async setFuel(k, f) { this.d.fuel[k] = f; this._save(); }
  async addUsage(k, n) { const u = (this.d.usage[k] ||= {}); const t = today(); u[t] = (u[t] || 0) + n; this._save(); }
  async weekUsage(k) { const u = this.d.usage[k] || {}; const cut = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); return Object.entries(u).filter(([d]) => d > cut).reduce((a, [, n]) => a + n, 0); }
  async usageDays(k) { return Object.entries(this.d.usage[k] || {}).sort().slice(-8).map(([d, n]) => ({d, n})); }

  async putNonce(w, message, ms) { this.d.nonces[w] = {message, exp: Date.now() + ms}; this._save(); }
  async takeNonce(w) { const n = this.d.nonces[w]; delete this.d.nonces[w]; this._save(); return n && n.exp > Date.now() ? n.message : null; }

  async latestEpoch() { return this.d.epochs[this.d.epochs.length - 1] || null; }
  async saveEpoch(e) { this.d.epochs = this.d.epochs.filter(x => x.day !== e.day).concat([e]).slice(-60); this._save(); }
}

/* ---------------- postgres store ---------------- */
class PgStore {
  constructor(url) { this.kind = 'postgres'; this.url = url; }
  async init() {
    const {default: pg} = await import('pg');
    this.pool = new pg.Pool({connectionString: this.url, ssl: /localhost|127\.0\.0\.1/.test(this.url) ? false : {rejectUnauthorized: false}, max: 10});
    await this.pool.query('select 1');
    await this.pool.query(SKILLS_SQL); // added after launch: create without needing npm run migrate
  }
  q(sql, args) { return this.pool.query(sql, args); }
  async getPal(k) { return (await this.q('select * from pals where pal_key=$1', [k])).rows[0] || null; }
  async ensurePal(k) { await this.q('insert into pals(pal_key) values($1) on conflict do nothing', [k]); return this.getPal(k); }
  async findPalByAsset(a) { return (await this.q('select * from pals where asset_id=$1', [a])).rows[0] || null; }
  async setMinted(k, a, sig) { await this.ensurePal(k); await this.q('update pals set asset_id=$2, mint_sig=$3, minted_at=now() where pal_key=$1', [k, a, sig]); return this.getPal(k); }
  async addXp(k, n) { await this.ensurePal(k); return (await this.q('update pals set xp=xp+$2 where pal_key=$1 returning xp', [k, n])).rows[0].xp; }
  async countMinted() { return +(await this.q('select count(*) from pals where asset_id is not null')).rows[0].count; }
  async listMinted() { return (await this.q('select pal_key, asset_id, xp from pals where asset_id is not null')).rows; }

  async listMemories(k) { return (await this.q('select id,type,body,created_at from memories where pal_key=$1 order by created_at', [k])).rows.map(r => ({id: r.id, type: r.type, text: open(r.body), at: +r.created_at})); }
  async addMemory(k, type, text) {
    await this.ensurePal(k);
    const id = randomId('m_');
    await this.q('insert into memories(id,pal_key,type,body) values($1,$2,$3,$4)', [id, k, type, seal(text)]);
    await this.q(`delete from memories where pal_key=$1 and id not in (select id from memories where pal_key=$1 order by created_at desc limit ${MAX_MEMORIES})`, [k]);
    return {id, type, text, at: Date.now()};
  }
  async deleteMemory(k, id) { await this.q('delete from memories where pal_key=$1 and id=$2', [k, id]); }
  async clearMemories(k) { await this.q('delete from memories where pal_key=$1', [k]); }

  async listMessages(k, limit = 40) { return (await this.q('select role,mode,body,tool_id from messages where pal_key=$1 order by id desc limit $2', [k, limit])).rows.reverse().map(r => ({role: r.role, mode: r.mode, content: open(r.body), toolId: r.tool_id || undefined})); }
  async addMessage(k, {role, mode, content, toolId}) { await this.ensurePal(k); await this.q('insert into messages(pal_key,role,mode,body,tool_id) values($1,$2,$3,$4,$5)', [k, role, mode || null, seal(content), toolId || null]); }
  async clearMessages(k) { await this.q('delete from messages where pal_key=$1', [k]); }

  async listTools(k) { return (await this.q('select id,name,html,prompt,created_at from tools where pal_key=$1 order by created_at desc', [k])).rows.map(r => ({id: r.id, name: r.name, html: r.html, prompt: r.prompt, at: +r.created_at})); }
  async addTool(k, t) {
    await this.ensurePal(k);
    await this.q('insert into tools(id,pal_key,name,html,prompt) values($1,$2,$3,$4,$5)', [t.id, k, t.name, t.html, t.prompt || null]);
    await this.q(`delete from tools where pal_key=$1 and id not in (select id from tools where pal_key=$1 order by created_at desc limit ${MAX_TOOLS})`, [k]);
  }
  async deleteTool(k, id) { await this.q('delete from tools where pal_key=$1 and id=$2', [k, id]); }

  async listSkills(k, withBody = false) { return (await this.q('select id,name,description,size,added_by,approved_by,body,created_at from skills where pal_key=$1 order by created_at', [k])).rows.map(r => ({id: r.id, name: r.name, description: r.description, size: r.size, added_by: r.added_by, approved_by: r.approved_by, at: +r.created_at, ...(withBody ? {body: open(r.body)} : {})})); }
  async putSkill(k, sk, wallet) {
    await this.ensurePal(k);
    const r = await this.q(`insert into skills(id,pal_key,name,description,body,size,added_by,approved_by) values($1,$2,$3,$4,$5,$6,$7,$7)
      on conflict (pal_key,name) do update set description=$4, body=$5, size=$6, added_by=$7, approved_by=$7, created_at=now() returning id`, [randomId('sk_'), k, sk.name, sk.description, seal(sk.body), sk.size, wallet]);
    return r.rows[0].id;
  }
  async approveSkill(k, id, wallet) { return (await this.q('update skills set approved_by=$3 where pal_key=$1 and id=$2', [k, id, wallet])).rowCount > 0; }
  async deleteSkill(k, id) { await this.q('delete from skills where pal_key=$1 and id=$2', [k, id]); }

  async getFuel(k) { const r = (await this.q("select credits, to_char(day,'YYYY-MM-DD') as day from fuel where pal_key=$1", [k])).rows[0]; return r ? {credits: +r.credits, day: r.day} : null; }
  async setFuel(k, f) { await this.ensurePal(k); await this.q('insert into fuel(pal_key,credits,day) values($1,$2,$3) on conflict (pal_key) do update set credits=$2, day=$3', [k, f.credits, f.day]); }
  async addUsage(k, n) { await this.q('insert into usage(pal_key,day,n) values($1,current_date,$2) on conflict (pal_key,day) do update set n=usage.n+$2', [k, n]); }
  async weekUsage(k) { return +(await this.q("select coalesce(sum(n),0) as s from usage where pal_key=$1 and day > current_date - 7", [k])).rows[0].s; }
  async usageDays(k) { return (await this.q("select to_char(day,'YYYY-MM-DD') as d, n from usage where pal_key=$1 order by day desc limit 8", [k])).rows.reverse(); }

  async putNonce(w, message, ms) { await this.q("insert into nonces(wallet,message,expires_at) values($1,$2,now()+($3||' milliseconds')::interval) on conflict (wallet) do update set message=$2, expires_at=now()+($3||' milliseconds')::interval", [w, message, String(ms)]); }
  async takeNonce(w) { const r = (await this.q('delete from nonces where wallet=$1 returning message, expires_at', [w])).rows[0]; return r && new Date(r.expires_at) > new Date() ? r.message : null; }

  async latestEpoch() { const r = (await this.q("select to_char(day,'YYYY-MM-DD') as day, treasury_sol, sol_usd, budget_usd, minted_pals from epochs order by day desc limit 1")).rows[0]; return r || null; }
  async saveEpoch(e) { await this.q('insert into epochs(day,treasury_sol,sol_usd,budget_usd,minted_pals) values($1,$2,$3,$4,$5) on conflict (day) do update set treasury_sol=$2, sol_usd=$3, budget_usd=$4, minted_pals=$5', [e.day, e.treasury_sol, e.sol_usd, e.budget_usd, e.minted_pals]); }
}

export async function createStore() {
  const s = cfg.databaseUrl ? new PgStore(cfg.databaseUrl) : new FileStore(cfg.fileStorePath);
  await s.init();
  return s;
}
