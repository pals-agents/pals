// All configuration comes from environment variables (see .env.example).
// A local .env file is loaded if present; real environment variables always win.
import fs from 'node:fs';
try {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const env = process.env;
const bool = v => v === 'true' || v === '1';
const num = (v, d) => (v === undefined || v === '' || isNaN(+v) ? d : +v);

export const cfg = {
  env: env.NODE_ENV || 'development',
  port: num(env.PORT, 8787),
  baseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:8787').replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || '',

  // brain
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  buildModel: env.ANTHROPIC_BUILD_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  memoryModel: env.ANTHROPIC_MEMORY_MODEL || 'claude-haiku-5-5',
  webSearch: bool(env.ENABLE_WEB_SEARCH),

  // storage
  databaseUrl: env.DATABASE_URL || '',
  memoryKey: env.MEMORY_ENCRYPTION_KEY || '', // 64 hex chars (32 bytes)
  fileStorePath: env.FILE_STORE_PATH || 'data/dev-store.json',

  // solana
  cluster: env.SOLANA_CLUSTER || 'devnet', // devnet | mainnet-beta
  rpcUrl: env.SOLANA_RPC_URL || '', // e.g. https://devnet.helius-rpc.com/?api-key=...
  mintEnabled: bool(env.MINT_ENABLED),
  mintMode: env.MINT_MODE === 'server' ? 'server' : 'user', // user = holder's wallet pays + sends; server = mint authority pays (devnet testing only)
  mintAuthoritySecret: env.MINT_AUTHORITY_SECRET_KEY || '', // base58 or JSON array (64 bytes)
  collection: env.PALS_COLLECTION || '',
  // burn-to-mint: each mint burns this many whole $PALS from the minter (off while either is empty)
  burnMint: (env.PALS_TOKEN_MINT || '').trim(),
  burnAmount: (env.MINT_BURN_AMOUNT || '').trim(),
  burnSymbol: env.PALS_TOKEN_SYMBOL || '$PALS',

  // compute economy (used until the first epoch is recorded; see scripts/epoch.js)
  treasuryWallet: env.TREASURY_WALLET || '',
  econ: {
    costPerMsgUsd: num(env.COST_PER_MSG_USD, 0.004),
    basePct: num(env.BASE_POOL_PCT, 40),
    capMult: num(env.CAP_MULTIPLIER, 3),
    payoutDays: num(env.PAYOUT_DAYS, 7),
    netWeekly: num(env.NETWORK_AVG_WEEKLY_MSGS, 60),
    trial: num(env.TRIAL_MSGS_PER_DAY, 20),
    fallbackBudgetUsd: num(env.FALLBACK_DAILY_BUDGET_USD, 5),
  },
  chatRatePerMin: num(env.CHAT_RATE_PER_MIN, 20),
};

export function checkConfig() {
  const problems = [];
  const prod = cfg.env === 'production';
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) (prod ? problems : []).push('SESSION_SECRET must be at least 32 chars (run npm run keys)');
  if (cfg.databaseUrl && !/^[0-9a-f]{64}$/i.test(cfg.memoryKey)) problems.push('MEMORY_ENCRYPTION_KEY must be 64 hex chars when DATABASE_URL is set (run npm run keys)');
  if (cfg.mintEnabled && (!cfg.mintAuthoritySecret || !cfg.rpcUrl || !cfg.collection)) problems.push('MINT_ENABLED needs MINT_AUTHORITY_SECRET_KEY, SOLANA_RPC_URL and PALS_COLLECTION');
  if (cfg.mintEnabled && cfg.mintMode === 'server' && cfg.cluster === 'mainnet-beta') problems.push('MINT_MODE=server is not allowed on mainnet: anyone could drain the mint wallet. Use MINT_MODE=user.');
  if (cfg.burnMint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cfg.burnMint)) problems.push('PALS_TOKEN_MINT is not a valid Solana address');
  if (cfg.burnAmount && !/^\d+(\.\d+)?$/.test(cfg.burnAmount)) problems.push('MINT_BURN_AMOUNT must be a plain number of whole tokens, e.g. 50000');
  if (cfg.mintEnabled && cfg.mintMode === 'server' && cfg.burnMint && cfg.burnAmount) console.warn('[pals] MINT_MODE=server ignores the $PALS burn (the minter does not sign). Use MINT_MODE=user.');
  if (!cfg.sessionSecret) cfg.sessionSecret = 'dev-only-insecure-secret-change-me-' + 'x'.repeat(16);
  return problems;
}
