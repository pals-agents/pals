// Compute fuel: daily ⚡ allowance per PAL, funded by the $PALS treasury payout.
// Same formula as the Fuel page and docs:
//   budget_msgs = epoch.budget_usd / cost_per_msg
//   allowance   = min(cap, base_pool/minted + activity_pool * sqrt(week)/(minted*sqrt(network_avg_week)))
import {cfg} from './config.js';

const today = () => new Date().toISOString().slice(0, 10);
const locks = new Map();
export async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release; const next = new Promise(r => (release = r));
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
}

export async function econNow(store) {
  const e = cfg.econ, ep = await store.latestEpoch();
  const minted = Math.max(1, ep ? +ep.minted_pals : await store.countMinted());
  const budgetUsd = ep ? +ep.budget_usd : e.fallbackBudgetUsd;
  const msgs = budgetUsd / e.costPerMsgUsd;
  const basePool = msgs * e.basePct / 100, actPool = msgs - basePool;
  return {source: ep ? 'epoch' : 'fallback', treasury: cfg.treasuryWallet || null, day: ep?.day || null, treasurySol: ep ? +ep.treasury_sol : null, solUsd: ep ? +ep.sol_usd : null,
    budgetUsd, minted, msgs, basePool, actPool, base: basePool / minted, avg: msgs / minted, cap: msgs / minted * e.capMult,
    costPerMsgUsd: e.costPerMsgUsd, basePct: e.basePct, capMult: e.capMult, payoutDays: e.payoutDays, trial: e.trial};
}

export function allowanceFor(isMinted, week, E) {
  if (!isMinted) return {base: cfg.econ.trial, bonus: 0, total: cfg.econ.trial, trial: true};
  const bonus = E.actPool * Math.sqrt(week) / (E.minted * Math.sqrt(cfg.econ.netWeekly));
  const total = Math.max(1, Math.min(E.cap, E.base + bonus));
  return {base: Math.min(E.base, total), bonus: Math.max(0, total - E.base), total, trial: false};
}

export async function refill(store, key, pal) {
  const E = await econNow(store);
  const week = await store.weekUsage(key);
  const a = allowanceFor(!!pal.asset_id, week, E);
  let f = await store.getFuel(key);
  const t = today();
  if (!f) { f = {credits: Math.round(a.total), day: t}; await store.setFuel(key, f); }
  else if (f.day !== t) { f = {credits: Math.min(Math.round(a.total * 2), Math.round(f.credits + a.total)), day: t}; await store.setFuel(key, f); }
  return {fuel: f, allowance: a, week, econ: E};
}

export async function spend(store, key, pal, n) {
  return withLock('fuel:' + key, async () => {
    const r = await refill(store, key, pal);
    if (r.fuel.credits < n) return {ok: false, ...r};
    r.fuel = {credits: r.fuel.credits - n, day: r.fuel.day};
    await store.setFuel(key, r.fuel);
    await store.addUsage(key, n);
    return {ok: true, ...r};
  });
}
