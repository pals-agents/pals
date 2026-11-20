// Daily epoch (run once a day, e.g. Railway cron at 00:00 UTC).
// Reads the compute treasury balance, prices it, and records today's compute budget:
//   budget_usd = treasury_sol * sol_usd / PAYOUT_DAYS
// The server's fuel allowances read the latest epoch.
//
// This records the budget. Actually moving money (claiming creator fees into the treasury,
// converting SOL to USDC and topping up your Anthropic balance) is an operational step: see README.
import {cfg} from '../server/config.js';
import {createStore} from '../server/store.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
async function rpc(method, params) {
  const r = await fetch(cfg.rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
async function solUsd() {
  if (process.env.SOL_USD) return +process.env.SOL_USD;
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${SOL_MINT}`);
  const pairs = await r.json();
  const best = (Array.isArray(pairs) ? pairs : []).filter(p => /USD/.test(p.quoteToken?.symbol || '')).sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  if (!best) throw new Error('could not price SOL; set SOL_USD');
  return +best.priceUsd;
}

if (!cfg.rpcUrl || !cfg.treasuryWallet) { console.error('Set SOLANA_RPC_URL and TREASURY_WALLET.'); process.exit(1); }
const store = await createStore();
const treasurySol = (await rpc('getBalance', [cfg.treasuryWallet])).value / 1e9;
const px = await solUsd();
const minted = await store.countMinted();
const day = new Date().toISOString().slice(0, 10);
const budget = treasurySol * px / cfg.econ.payoutDays;
await store.saveEpoch({day, treasury_sol: treasurySol, sol_usd: px, budget_usd: budget, minted_pals: minted});
console.log(`epoch ${day}: treasury ${treasurySol.toFixed(3)} SOL @ $${px.toFixed(2)} → budget $${budget.toFixed(2)} for ${minted} minted PALs (${Math.round(budget / cfg.econ.costPerMsgUsd)} msgs)`);
setTimeout(() => process.exit(0), 200);
