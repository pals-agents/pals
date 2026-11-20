// Applies db/schema.sql to DATABASE_URL.
import fs from 'node:fs';
import {cfg} from '../server/config.js';

if (!cfg.databaseUrl) { console.log('DATABASE_URL not set: the server will use the local file store. Nothing to migrate.'); process.exit(0); }
const {default: pg} = await import('pg');
const client = new pg.Client({connectionString: cfg.databaseUrl, ssl: /localhost|127\.0\.0\.1/.test(cfg.databaseUrl) ? false : {rejectUnauthorized: false}});
await client.connect();
await client.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await client.end();
console.log('schema applied');
