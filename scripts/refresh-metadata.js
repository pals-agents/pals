// Make marketplaces (Tensor, Magic Eden, wallets) re-read PALS metadata.
//
// Marketplaces index an NFT's metadata once and cache it. If the metadata or image changed after
// minting (e.g. the animated GIF was added, or PUBLIC_BASE_URL moved to a new domain), they keep
// showing the old version. Writing a fresh URI on-chain forces every indexer to fetch it again.
//
// This points the collection and every minted PAL at PUBLIC_BASE_URL with a new ?v= version.
// It costs a tiny network fee per NFT, paid by the mint authority wallet.
//
//   npm run metadata:refresh            # show what would change
//   npm run metadata:refresh -- --yes   # do it
import {cfg} from '../server/config.js';
import {parseSecret} from '../server/mint.js';
import {createStore} from '../server/store.js';

const YES = process.argv.includes('--yes');
if (!/^https:\/\//.test(cfg.baseUrl) || /localhost|127\.0\.0\.1/.test(cfg.baseUrl)) { console.error(`PUBLIC_BASE_URL is "${cfg.baseUrl}". Set it to your public https domain first.`); process.exit(1); }
if (!cfg.rpcUrl || !cfg.collection || !cfg.mintAuthoritySecret) { console.error('Need SOLANA_RPC_URL, PALS_COLLECTION and MINT_AUTHORITY_SECRET_KEY in .env'); process.exit(1); }

const {createUmi} = await import('@metaplex-foundation/umi-bundle-defaults');
const {keypairIdentity, publicKey} = await import('@metaplex-foundation/umi');
const {mplCore, update, updateCollection, fetchAsset, fetchCollection} = await import('@metaplex-foundation/mpl-core');
const u = createUmi(cfg.rpcUrl).use(mplCore());
u.use(keypairIdentity(u.eddsa.createKeypairFromSecretKey(parseSecret(cfg.mintAuthoritySecret))));

const v = Date.now().toString(36);
const store = await createStore();
const minted = await store.listMinted();
const collection = await fetchCollection(u, publicKey(cfg.collection));

console.log(`base url:   ${cfg.baseUrl}`);
console.log(`collection: ${cfg.collection}\n  ${collection.uri}\n→ ${cfg.baseUrl}/collection.json?v=${v}`);
console.log(`${minted.length} minted PAL(s)\n`);
if (!YES) console.log('dry run. add --yes to write the new links on-chain.\n');

if (YES) {
  await updateCollection(u, {collection: collection.publicKey, name: collection.name, uri: `${cfg.baseUrl}/collection.json?v=${v}`}).sendAndConfirm(u);
  console.log('✓ collection updated');
}
let ok = 0, failed = 0;
for (const row of minted) {
  const uri = `${cfg.baseUrl}/api/pals/${row.pal_key}/metadata.json?v=${v}`;
  try {
    const asset = await fetchAsset(u, publicKey(row.asset_id));
    console.log(`${asset.name}  ${row.asset_id}\n  ${asset.uri}\n→ ${uri}`);
    if (YES) { await update(u, {asset, collection, name: asset.name, uri}).sendAndConfirm(u); console.log('  ✓ updated'); }
    ok++;
  } catch (e) { failed++; console.log(`  ✗ ${row.asset_id}: ${e.message}`); }
}
console.log(`\n${YES ? 'updated' : 'would update'} ${ok}${failed ? `, ${failed} failed` : ''}. ${YES ? 'Then hit refresh on the NFT in Tensor; indexers can take a few minutes.' : ''}`);
process.exit(0);
