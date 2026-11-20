// Devnet minting with Metaplex Core. The server re-derives the PAL from the wallet
// (so nobody can mint traits they didn't roll) and mints a Core asset into the PALS collection.
//
// Two modes (MINT_MODE):
//   user   (default): server builds the tx, signs as collection authority + asset, the holder's wallet
//                     pays the fee/rent and sends it. The mint wallet never pays, so it can't be drained.
//   server (devnet):  the mint authority pays and sends. Handy for testing; refused on mainnet.
// The asset address is derived from the PAL's wallet, so each PAL can only ever be minted once.
import crypto from 'node:crypto';
import {cfg} from './config.js';
import {b58decode} from './crypto.js';
import {burnCheckedData} from './burn.js';

let umiP = null;
async function umi() {
  if (umiP) return umiP;
  umiP = (async () => {
    const {createUmi} = await import('@metaplex-foundation/umi-bundle-defaults');
    const {keypairIdentity} = await import('@metaplex-foundation/umi');
    const {mplCore} = await import('@metaplex-foundation/mpl-core');
    const u = createUmi(cfg.rpcUrl).use(mplCore());
    const kp = u.eddsa.createKeypairFromSecretKey(parseSecret(cfg.mintAuthoritySecret));
    u.use(keypairIdentity(kp));
    return u;
  })();
  return umiP;
}

export function parseSecret(s) {
  s = (s || '').trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : new Uint8Array(b58decode(s));
  if (bytes.length !== 64) throw new Error('MINT_AUTHORITY_SECRET_KEY must be a 64-byte secret key');
  return bytes;
}

export async function createCollection({name, uri}) {
  const u = await umi();
  const {generateSigner} = await import('@metaplex-foundation/umi');
  const {createCollection} = await import('@metaplex-foundation/mpl-core');
  const collection = generateSigner(u);
  await createCollection(u, {collection, name, uri}).sendAndConfirm(u);
  return collection.publicKey.toString();
}

// deterministic asset keypair seed: one possible asset address per PAL per collection
function assetSeed(palKey) {
  return new Uint8Array(crypto.createHmac('sha256', Buffer.from(parseSecret(cfg.mintAuthoritySecret))).update(`pals-asset-v1:${cfg.collection}:${palKey}`).digest());
}
async function assetSigner(u, palKey) {
  const {createSignerFromKeypair} = await import('@metaplex-foundation/umi');
  return createSignerFromKeypair(u, u.eddsa.createKeypairFromSeed(assetSeed(palKey)));
}
export async function derivedAsset(palKey) { const u = await umi(); return (await assetSigner(u, palKey)).publicKey.toString(); }

// Returns the on-chain asset if it exists, is in our collection and is owned by `owner`.
export async function verifyMinted(palKey, {waitMs = 0} = {}) {
  const u = await umi();
  const {publicKey} = await import('@metaplex-foundation/umi');
  const {fetchAsset} = await import('@metaplex-foundation/mpl-core');
  const id = (await assetSigner(u, palKey)).publicKey;
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const a = await fetchAsset(u, id);
      const inCollection = a.updateAuthority?.type === 'Collection' && String(a.updateAuthority.address) === cfg.collection;
      if (!inCollection) throw Object.assign(new Error('asset is not in the PALS collection'), {fatal: true});
      return {asset: String(id), owner: String(a.owner)};
    } catch (e) {
      if (e.fatal) throw e;
      if (Date.now() >= until) return null;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// user mode: build + partially sign. Returns a base64 wire transaction for the wallet to sign and send.
// If `burn` is given (see burn.js planBurn), the $PALS burn goes into the same transaction.
export async function prepareUserMint({palKey, name, uri, burn = null}) {
  const u = await umi();
  const {publicKey, createNoopSigner, transactionBuilder} = await import('@metaplex-foundation/umi');
  const {create, fetchCollection} = await import('@metaplex-foundation/mpl-core');
  const collection = await fetchCollection(u, publicKey(cfg.collection));
  const asset = await assetSigner(u, palKey);
  const payer = createNoopSigner(publicKey(palKey));
  let b = transactionBuilder();
  if (burn) for (const part of burn.parts) b = b.add({
    instruction: {programId: publicKey(burn.program), data: burnCheckedData(part.amount, burn.decimals), keys: [
      {pubkey: publicKey(part.account), isSigner: false, isWritable: true},
      {pubkey: publicKey(burn.mint), isSigner: false, isWritable: true},
      {pubkey: payer.publicKey, isSigner: true, isWritable: false}]},
    signers: [payer], bytesCreatedOnChain: 0});
  const tx = await b.add(create(u, {asset, collection, name: name.slice(0, 32), uri, owner: publicKey(palKey), payer, authority: u.identity}))
    .setFeePayer(payer)
    .buildAndSign(u);
  return {tx: Buffer.from(u.transactions.serialize(tx)).toString('base64'), asset: asset.publicKey.toString(), burn: burn ? {amount: burn.display, symbol: cfg.burnSymbol} : null};
}

// server mode (devnet only): mint authority pays and sends
export async function mintPal({palKey, name, uri}) {
  const u = await umi();
  const {publicKey} = await import('@metaplex-foundation/umi');
  const {create, fetchCollection} = await import('@metaplex-foundation/mpl-core');
  const {base58} = await import('@metaplex-foundation/umi/serializers');
  const collection = await fetchCollection(u, publicKey(cfg.collection));
  const asset = await assetSigner(u, palKey);
  const res = await create(u, {asset, collection, name: name.slice(0, 32), uri, owner: publicKey(palKey)}).sendAndConfirm(u);
  return {asset: asset.publicKey.toString(), signature: base58.deserialize(res.signature)[0]};
}

export async function assetOwner(assetId) {
  if (!cfg.rpcUrl) return null;
  const r = await fetch(cfg.rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getAsset', params: {id: assetId}}), signal: AbortSignal.timeout(10000)});
  const j = await r.json();
  return j?.result?.ownership?.owner || null;
}

export async function palAssetsOwnedBy(wallet) {
  if (!cfg.rpcUrl || !cfg.collection) return [];
  const r = await fetch(cfg.rpcUrl, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: {ownerAddress: wallet, page: 1, limit: 1000}}), signal: AbortSignal.timeout(15000)});
  const j = await r.json();
  return (j?.result?.items || []).filter(a => (a.grouping || []).some(g => g.group_key === 'collection' && g.group_value === cfg.collection)).map(a => a.id);
}

export const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}${cfg.cluster === 'mainnet-beta' ? '' : '?cluster=' + cfg.cluster}`;
