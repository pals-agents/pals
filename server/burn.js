// Burn-to-mint: each mint burns a fixed amount of $PALS from the minter's wallet.
// The burn instructions go into the same transaction as the NFT mint, which the server
// co-signs. Changing or removing them invalidates the server's signatures, so an NFT
// can only exist if its burn happened too.
//
// Switched on by PALS_TOKEN_MINT + MINT_BURN_AMOUNT, in MINT_MODE=user only.
// Works with both the SPL Token and Token-2022 programs (BurnChecked is the same in both).
import {cfg} from './config.js';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const burnOn = () => !!(cfg.mintEnabled && cfg.burnMint && cfg.burnAmount && cfg.mintMode === 'user');
export const burnPublic = () => burnOn() ? {mint: cfg.burnMint, amount: cfg.burnAmount, symbol: cfg.burnSymbol} : null;

async function rpc(method, params) {
  const r = await fetch(cfg.rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}), signal: AbortSignal.timeout(12000)});
  const j = await r.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message || 'error'}`);
  return j.result;
}

let mintCache = null;
export async function tokenInfo() {
  if (mintCache && mintCache.mint === cfg.burnMint) return mintCache;
  const res = await rpc('getAccountInfo', [cfg.burnMint, {encoding: 'jsonParsed'}]);
  const v = res && res.value;
  if (!v) throw new Error(`token mint ${cfg.burnMint} not found on ${cfg.cluster}`);
  if (v.owner !== TOKEN_PROGRAM && v.owner !== TOKEN_2022_PROGRAM) throw new Error('PALS_TOKEN_MINT is not an SPL token mint');
  const decimals = v.data?.parsed?.info?.decimals;
  if (!Number.isInteger(decimals)) throw new Error('could not read token decimals');
  mintCache = {mint: cfg.burnMint, program: v.owner, decimals};
  return mintCache;
}

// "50000" or "1234.5" whole tokens → raw base units
export function toRaw(amount, decimals) {
  const m = String(amount).trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error('MINT_BURN_AMOUNT must be a positive number');
  const frac = (m[2] || '').slice(0, decimals).padEnd(decimals, '0');
  const raw = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac || '0');
  if (raw <= 0n) throw new Error('MINT_BURN_AMOUNT must be greater than zero');
  return raw;
}
export function fromRaw(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals), frac = decimals ? s.slice(-decimals).replace(/0+$/, '') : '';
  return BigInt(whole).toLocaleString('en-US') + (frac ? '.' + frac : '');
}

// The owner's spendable balance across all their token accounts for the mint.
export async function balanceOf(owner) {
  const info = await tokenInfo();
  const res = await rpc('getTokenAccountsByOwner', [owner, {mint: cfg.burnMint}, {encoding: 'jsonParsed'}]);
  const accounts = (res?.value || []).map(a => ({account: a.pubkey, amount: BigInt(a.account.data.parsed.info.tokenAmount.amount), frozen: a.account.data.parsed.info.state === 'frozen'}))
    .filter(a => !a.frozen && a.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const total = accounts.reduce((s, a) => s + a.amount, 0n);
  return {info, accounts, total};
}

export async function burnStatus(owner) {
  const {info, total} = await balanceOf(owner);
  const need = toRaw(cfg.burnAmount, info.decimals);
  return {symbol: cfg.burnSymbol, required: fromRaw(need, info.decimals), balance: fromRaw(total, info.decimals), enough: total >= need};
}

// Which accounts to burn from (largest first) to reach the required amount.
export async function planBurn(owner) {
  const {info, accounts, total} = await balanceOf(owner);
  const need = toRaw(cfg.burnAmount, info.decimals);
  if (total < need) throw Object.assign(new Error(`You need ${fromRaw(need, info.decimals)} ${cfg.burnSymbol} to mint. This wallet has ${fromRaw(total, info.decimals)}.`), {status: 402});
  const parts = [];
  let left = need;
  for (const a of accounts) { if (left <= 0n) break; const take = a.amount < left ? a.amount : left; parts.push({account: a.account, amount: take}); left -= take; }
  return {...info, raw: need, display: fromRaw(need, info.decimals), parts};
}

// BurnChecked (instruction 15): [15, amount u64 LE, decimals u8]; accounts: source (w), mint (w), owner (signer)
export function burnCheckedData(amount, decimals) {
  const d = new Uint8Array(10);
  d[0] = 15;
  new DataView(d.buffer).setBigUint64(1, BigInt(amount), true);
  d[9] = decimals;
  return d;
}
