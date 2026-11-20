// Tools a PAL can call. Analysis maths is shared with the browser (pal-core.js);
// live tools read Solana RPC/DAS (SOLANA_RPC_URL, e.g. Helius) and DexScreener.
import {cfg} from './config.js';
import {holderConcentration, priceIndicators} from '../public/pal-core.js';
import {isWallet} from './crypto.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

async function rpc(method, params) {
  if (!cfg.rpcUrl) throw new Error('live chain data is not configured (SOLANA_RPC_URL)');
  const r = await fetch(cfg.rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(15000)});
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
const need = (v, what) => { if (!isWallet(v)) throw new Error(`${what} must be a valid Solana address`); return v; };

async function tokenOverview({mint}) {
  need(mint, 'mint');
  const info = await rpc('getAccountInfo', [mint, {encoding: 'jsonParsed'}]);
  const parsed = info?.value?.data?.parsed;
  if (!parsed || parsed.type !== 'mint') throw new Error('address is not a token mint');
  const m = parsed.info, supply = +m.supply / 10 ** m.decimals;
  const largest = (await rpc('getTokenLargestAccounts', [mint])).value || [];
  const accts = largest.map(a => ({address: a.address, ui_amount: +a.uiAmountString || a.uiAmount || 0}));
  const pct = x => supply ? +(x / supply * 100).toFixed(2) : null;
  let meta = {};
  try { const a = await rpc('getAsset', {id: mint}); meta = {name: a?.content?.metadata?.name, symbol: a?.content?.metadata?.symbol}; } catch {}
  return {
    mint, ...meta, program: info.value.owner === TOKEN_2022 ? 'token-2022' : 'token', decimals: m.decimals, supply,
    mint_authority: m.mintAuthority || null, freeze_authority: m.freezeAuthority || null,
    top_accounts: accts.slice(0, 10).map(a => ({...a, pct_supply: pct(a.ui_amount)})),
    top1_pct_supply: pct(accts.slice(0, 1).reduce((s, a) => s + a.ui_amount, 0)),
    top10_pct_supply: pct(accts.slice(0, 10).reduce((s, a) => s + a.ui_amount, 0)),
    top20_concentration: accts.length >= 2 ? holderConcentration({balances: accts.map(a => a.ui_amount)}) : null,
    note: 'Largest TOKEN ACCOUNTS (max 20), not wallets. Pools, LPs, CEX and burn accounts appear here: identify them before calling it whale risk.'
  };
}

async function walletOverview({address}) {
  need(address, 'address');
  const bal = await rpc('getBalance', [address]);
  const all = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022]) {
    try {
      const r = await rpc('getTokenAccountsByOwner', [address, {programId}, {encoding: 'jsonParsed'}]);
      for (const a of r.value || []) { const t = a.account.data.parsed.info; const ui = +t.tokenAmount.uiAmountString; if (ui > 0) all.push({mint: t.mint, ui_amount: ui}); }
    } catch {}
  }
  all.sort((a, b) => b.ui_amount - a.ui_amount);
  return {address, sol: (bal?.value ?? 0) / 1e9, token_accounts: all.length, largest_positions: all.slice(0, 15), note: 'Amounts are raw token units, not USD.'};
}

async function assetInfo({id}) {
  need(id, 'id');
  const a = await rpc('getAsset', {id});
  return {
    id, interface: a.interface, name: a?.content?.metadata?.name, symbol: a?.content?.metadata?.symbol,
    owner: a?.ownership?.owner, frozen: a?.ownership?.frozen, mutable: a.mutable, burnt: a.burnt,
    authorities: (a.authorities || []).map(x => ({address: x.address, scopes: x.scopes})),
    collection: (a.grouping || []).find(g => g.group_key === 'collection')?.group_value || null,
    royalty_bps: a?.royalty?.basis_points ?? null, supply: a?.token_info?.supply ?? null
  };
}

async function tokenMarket({mint}) {
  need(mint, 'mint');
  let pairs = [];
  for (const url of [`https://api.dexscreener.com/tokens/v1/solana/${mint}`, `https://api.dexscreener.com/latest/dex/tokens/${mint}`]) {
    try {
      const r = await fetch(url, {signal: AbortSignal.timeout(10000)});
      if (!r.ok) continue;
      const j = await r.json();
      pairs = Array.isArray(j) ? j : (j.pairs || []);
      if (pairs.length) break;
    } catch {}
  }
  if (!pairs.length) throw new Error('no DEX pairs found for this mint (or the price API is unreachable)');
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return {
    mint, pairs_found: pairs.length,
    top_pairs: pairs.slice(0, 3).map(p => ({dex: p.dexId, pair: p.pairAddress, quote: p.quoteToken?.symbol, price_usd: p.priceUsd, liquidity_usd: p.liquidity?.usd, volume_24h_usd: p.volume?.h24, txns_24h: p.txns?.h24, price_change_pct: p.priceChange, fdv: p.fdv, market_cap: p.marketCap, created_at: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null})),
    note: 'Snapshot from DexScreener. No candle history: ask the owner to paste closes for indicators.'
  };
}

const addrSchema = (k, d) => ({type: 'object', properties: {[k]: {type: 'string', description: d}}, required: [k]});
export const TOOLS = {
  holder_concentration: {local: true, description: 'Compute holder concentration from a list of balances: top 1/5/10 share %, HHI and Gini. Pass every balance.', input_schema: {type: 'object', properties: {balances: {type: 'array', items: {type: 'number'}}}, required: ['balances']}, run: holderConcentration},
  price_indicators: {local: true, description: 'Indicators from closing prices ordered oldest to newest: % change, SMA7, SMA25, RSI14, high/low, max drawdown, per-step volatility.', input_schema: {type: 'object', properties: {closes: {type: 'array', items: {type: 'number'}}}, required: ['closes']}, run: priceIndicators},
  token_overview: {description: 'Live Solana token check: supply, decimals, mint/freeze authority, largest token accounts and their share of supply.', input_schema: addrSchema('mint', 'token mint address'), run: tokenOverview},
  wallet_overview: {description: 'Live Solana wallet check: SOL balance and largest token positions.', input_schema: addrSchema('address', 'wallet address'), run: walletOverview},
  asset_info: {description: 'Live DAS lookup of an NFT or token asset: owner, authorities, collection, mutability, royalties.', input_schema: addrSchema('id', 'asset or mint address'), run: assetInfo},
  token_market: {description: 'Live DEX market snapshot for a Solana token: price, liquidity, 24h volume and price change for its top pairs.', input_schema: addrSchema('mint', 'token mint address'), run: tokenMarket}
};

export function toolsForMode(mode) {
  const live = !!cfg.rpcUrl;
  const names = mode === 'chain' ? ['holder_concentration', ...(live ? ['token_overview', 'wallet_overview', 'asset_info'] : [])]
    : mode === 'market' ? ['price_indicators', 'token_market']
    : [];
  const defs = names.map(n => ({name: n, description: TOOLS[n].description, input_schema: TOOLS[n].input_schema}));
  if (mode === 'research' && cfg.webSearch) defs.push({type: 'web_search_20250305', name: 'web_search', max_uses: 4});
  return defs;
}

export async function runTool(name, input) {
  const t = TOOLS[name];
  if (!t) throw new Error('unknown tool ' + name);
  const out = await t.run(input || {});
  const s = JSON.stringify(out);
  return s.length > 8000 ? s.slice(0, 8000) + '…(truncated)' : s;
}
