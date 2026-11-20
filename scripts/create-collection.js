// Creates the PALS Metaplex Core collection (run once per cluster), then prints PALS_COLLECTION.
import {cfg} from '../server/config.js';
import {createCollection} from '../server/mint.js';

if (!cfg.rpcUrl || !cfg.mintAuthoritySecret) { console.error('Set SOLANA_RPC_URL and MINT_AUTHORITY_SECRET_KEY in .env first.'); process.exit(1); }
if (!/^https:\/\//.test(cfg.baseUrl) || /localhost|127\.0\.0\.1/.test(cfg.baseUrl)) { console.error(`PUBLIC_BASE_URL is "${cfg.baseUrl}": set it to your public https domain first, or marketplaces can't read the collection.`); process.exit(1); }
console.log(`creating collection on ${cfg.cluster}...`);
const address = await createCollection({name: 'PALS', uri: `${cfg.baseUrl}/collection.json`});
console.log(`\ndone. add this to .env:\nPALS_COLLECTION=${address}\n`);
