// Points the PALS collection's metadata link at PUBLIC_BASE_URL/collection.json.
// Run after creating the collection with the wrong PUBLIC_BASE_URL (e.g. localhost).
import {cfg} from '../server/config.js';
import {parseSecret} from '../server/mint.js';

const uri = `${cfg.baseUrl}/collection.json`;
if (!/^https:\/\//.test(cfg.baseUrl) || /localhost|127\.0\.0\.1/.test(cfg.baseUrl)) {
  console.error(`PUBLIC_BASE_URL in .env is "${cfg.baseUrl}". Set it to your public https domain first.`);
  process.exit(1);
}
if (!cfg.rpcUrl || !cfg.collection || !cfg.mintAuthoritySecret) { console.error('Need SOLANA_RPC_URL, PALS_COLLECTION and MINT_AUTHORITY_SECRET_KEY in .env'); process.exit(1); }

const {createUmi} = await import('@metaplex-foundation/umi-bundle-defaults');
const {keypairIdentity, publicKey} = await import('@metaplex-foundation/umi');
const {mplCore, updateCollection, fetchCollection} = await import('@metaplex-foundation/mpl-core');
const u = createUmi(cfg.rpcUrl).use(mplCore());
u.use(keypairIdentity(u.eddsa.createKeypairFromSecretKey(parseSecret(cfg.mintAuthoritySecret))));

const col = await fetchCollection(u, publicKey(cfg.collection));
console.log(`collection ${cfg.collection}\n  current uri: ${col.uri}\n  new uri:     ${uri}`);
if (col.uri === uri) { console.log('already correct.'); process.exit(0); }
await updateCollection(u, {collection: publicKey(cfg.collection), name: col.name, uri}).sendAndConfirm(u);
const after = await fetchCollection(u, publicKey(cfg.collection));
console.log(`done. uri is now: ${after.uri}`);
