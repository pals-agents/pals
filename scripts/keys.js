// Generates secrets for .env and a fresh Solana keypair for the mint authority. No network, no deps.
import crypto from 'node:crypto';
import {b58encode} from '../server/crypto.js';

const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
const seed = privateKey.export({format: 'jwk'}).d; // 32-byte seed, base64url
const pub = publicKey.export({format: 'jwk'}).x;
const secret = Buffer.concat([Buffer.from(seed, 'base64url'), Buffer.from(pub, 'base64url')]); // Solana 64-byte secret

console.log(`# paste into .env (keep this private)
SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}
MEMORY_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}

# mint authority wallet: fund it with devnet SOL, then set MINT_AUTHORITY_SECRET_KEY
# address: ${b58encode(Buffer.from(pub, 'base64url'))}
MINT_AUTHORITY_SECRET_KEY=${b58encode(secret)}
`);
