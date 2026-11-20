# PALS — Productive Agent Learning System

Wallet-hatched, animated AI agents on Solana, powered by Claude. Connect a wallet and it hatches a one-of-one ASCII PAL from your address. Teach it, give it skill files, let it build tools, research, and read the chain and markets, then mint it as an animated NFT. Whoever holds the NFT holds the agent and its memory.

- **Live:** https://pals-production-7f4a6683.up.railway.app
- **$PALS CA:** `CAwfVJ5p5UCogGSVDaF4b6AJfE8mB1WocbUcqXN4pump`
- **License:** MIT

> PALS is an independent project. It uses Claude through Anthropic's API and is not affiliated with or endorsed by Anthropic.

## $PALS

```
CAwfVJ5p5UCogGSVDaF4b6AJfE8mB1WocbUcqXN4pump
```

[pump.fun](https://pump.fun/coin/CAwfVJ5p5UCogGSVDaF4b6AJfE8mB1WocbUcqXN4pump) · [DexScreener](https://dexscreener.com/solana/CAwfVJ5p5UCogGSVDaF4b6AJfE8mB1WocbUcqXN4pump) · [Solscan](https://solscan.io/token/CAwfVJ5p5UCogGSVDaF4b6AJfE8mB1WocbUcqXN4pump)

- **100% of creator fees** go to the compute treasury, which pays for every PAL's Claude compute. None go to the team.
- **Burn to mint:** once switched on, each new PAL burns a fixed amount of $PALS in the same transaction as the mint.
- Always check the CA against this README or the site before buying. Not financial advice.

## Code layout

```
public/            the site (index.html), shared PAL core (pal-core.js), API client (api.js)
server/            Node server, no framework
  index.js         routes: static site, wallet sign-in, PAL API, streaming chat, mint, NFT metadata
  agent.js         the PAL brain: persona, skill modes, Claude tool loop, memory extraction
  tools.js         live tools: token_overview, wallet_overview, asset_info, token_market (+ local maths)
  fuel.js          daily ⚡ allowance from the treasury epoch
  store.js         Postgres (production) or a JSON file (local dev); memories encrypted at rest
  mint.js          Metaplex Core minting (wallet-paid), ownership checks via DAS
  burn.js          burn-to-mint: $PALS BurnChecked in the same transaction as the mint
  skills.js        SKILL.md skill files: parsing, review on transfer, load_skill tool
  square.js        the live square: shared simulation streamed over SSE
  render-gif.js    animated GIF card for marketplaces (gif.js encoder, glyphs.js font)
  crypto.js        ed25519 signature check, signed sessions, AES-256-GCM, base58
scripts/           keys, migrate, collection, epoch
db/schema.sql      Postgres schema
test/              npm test (boots the server, signs in with a real ed25519 key, exercises the API)
```

Everything degrades gracefully. With no keys at all it runs locally with the offline brain and a file store. Each section below switches one real piece on.

---

## 1. Run it locally (5 minutes)

You need Node 20.6+ (`node -v`).

```bash
cd ~/dev && unzip ~/Downloads/pals.zip && cd pals
cp .env.example .env
npm run keys          # prints SESSION_SECRET, MEMORY_ENCRYPTION_KEY and a mint wallet: paste them into .env
npm install
npm test              # 4 passing
npm run dev           # http://localhost:8787
```

Open http://localhost:8787 and connect Phantom. The site asks you to **sign a message** (free, no transaction). That is your login: the server checks the ed25519 signature and sets a session cookie. Your PAL, memories, toolbox and ⚡ battery now live on the server.

The status bar at the bottom shows what's on: `brain`, `mem: synced`, `fuel`.

## 2. Turn on the brain (Claude)

1. Go to https://console.anthropic.com → **API keys** → create a key.
2. In the console, set a **monthly spend limit** before anything else.
3. Add to `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Restart `npm run dev`. The status bar should show `brain: claude`.

Models are set in `.env` (`ANTHROPIC_MODEL`, `ANTHROPIC_BUILD_MODEL`, `ANTHROPIC_MEMORY_MODEL`). The memory step uses the small model to keep costs down.

**Research with live web search:** set `ENABLE_WEB_SEARCH=true`. This uses Claude's server-side web search tool, which is billed per search on top of tokens. Check that it's available on your account in the Anthropic docs before turning it on.

## 3. Turn on live chain data (Helius)

1. Create a free account at https://helius.dev and copy the **devnet** RPC URL.
2. Add it to `.env`:
   ```
   SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=...
   ```
3. Restart the server. The on-chain skill now gets `token_overview` (supply, mint/freeze authority, largest accounts), `wallet_overview` and `asset_info` (DAS). The market skill's `token_market` (DexScreener) works without a key.

Use the mainnet RPC URL instead when you want PALs to analyse real tokens. The mint cluster is set separately (`SOLANA_CLUSTER`).

## 4. Database (Postgres)

The file store is fine for local dev. For anything shared, use Postgres.

**Railway** (you already use it): in your project, click **+ New → Database → PostgreSQL** and copy `DATABASE_URL`. Supabase or Neon work the same way.

```
DATABASE_URL=postgres://...
MEMORY_ENCRYPTION_KEY=<64 hex chars from npm run keys>
```
```bash
npm run migrate
```

Memories and chat messages are encrypted with AES-256-GCM using `MEMORY_ENCRYPTION_KEY`. **Back up that key.** If you lose it, memories can't be read.

## 5. Mint on devnet

1. `npm run keys` printed a **mint authority** address. Fund it with devnet SOL at https://faucet.solana.com.
2. In `.env`: `MINT_AUTHORITY_SECRET_KEY`, `SOLANA_RPC_URL` (devnet), `SOLANA_CLUSTER=devnet`.
3. Create the collection once:
   ```bash
   npm run collection        # prints PALS_COLLECTION=...
   ```
4. Add `PALS_COLLECTION=...` and `MINT_ENABLED=true`, then restart.
5. On the **Mint** page, click **Mint … on devnet**. With the default `MINT_MODE=user`:
   1. The server re-derives your PAL's traits from your wallet, so nobody can mint traits they didn't roll.
   2. The server builds the Core mint transaction and co-signs it as collection authority.
   3. **Your wallet pays the fee and the NFT rent and sends it.**
   4. The server confirms the asset on-chain before recording it.

   The asset address is derived from the PAL's wallet, so each PAL can only ever be minted once.

   `MINT_MODE=server` makes the mint wallet pay instead. That's handy for devnet tests, and the server refuses it on mainnet.

The asset's `uri` points at `PUBLIC_BASE_URL/api/pals/<wallet>/metadata.json`. Its `image` is an animated GIF (`/image.gif`), which renders everywhere, including marketplace image proxies. The animated SVG (`/image.svg`) is listed as an extra file. **Wallets and marketplaces can only load these if `PUBLIC_BASE_URL` is a public https URL.** Deploy first (step 6), or for a quick test run `cloudflared tunnel --url http://localhost:8787` and use that URL.

After minting, the PAL belongs to whoever **holds the asset**. The server checks the owner with DAS before every session. Sell or send the NFT and the agent and its memory go with it.

## 6. Deploy (Railway)

```bash
git init && git add . && git commit -m "pals starter"
railway init                 # or link an existing project
railway add --database postgres
railway up
```

In the service's **Variables**, add everything from your `.env`, and set `NODE_ENV=production`. Set `PUBLIC_BASE_URL` to the Railway domain (Settings → Networking → Generate Domain), or to your own domain once it's attached. Then run `railway run npm run migrate` once.

Add a second service from the same repo for the **daily epoch**:
- Start command: `npm run epoch`
- Cron schedule: `0 0 * * *`

Netlify isn't a fit for this backend because the chat streams over a long-lived connection. Keep the whole app on Railway.

## 7. $PALS and the compute treasury

The code reads the treasury. Moving the money is an operational job you control:

1. **Treasury:** create a Squads multisig and set `TREASURY_WALLET` to its vault address.
2. **Launch $PALS** with the treasury as the creator-fee recipient **from day one**. Pump.fun limits changing the fee recipient after launch. Bags supports a fee claimer wallet in its SDK.
3. **Daily epoch** (`npm run epoch`): reads the treasury SOL balance, prices it, and records `budget_usd = balance × price / PAYOUT_DAYS`. Every PAL's ⚡ allowance comes from that.
4. **Fund the API:** fees arrive in SOL, but Anthropic bills in USD. On a schedule (weekly is fine): claim fees → swap SOL to USDC (Jupiter) → off-ramp through an exchange → add credit to your Anthropic account. Keep 2–4 weeks of runway prepaid and a spend limit set.

Until the first epoch runs, allowances use `FALLBACK_DAILY_BUDGET_USD`.

### Burn to mint

Once $PALS is live, make every mint burn a fixed amount of it:

```
PALS_TOKEN_MINT=<the $PALS mint address>
MINT_BURN_AMOUNT=50000        # whole tokens per mint
PALS_TOKEN_SYMBOL=$PALS       # label shown in the app
```

Set them in Railway (`railway variables --set ...`) and redeploy. Leave either empty to mint without a burn.

- The burn (`BurnChecked`) goes into the same transaction as the NFT mint, which the server co-signs. If anyone removes or changes the burn, the server's signatures no longer match and the mint fails. No burn, no PAL.
- Tokens are destroyed, not sent to a wallet, so supply goes down with every mint.
- Works with SPL Token and Token-2022 mints (pump.fun uses either). If a wallet's $PALS is split across several token accounts, it burns from as many as needed.
- The Mint page shows the burn amount and the wallet's balance, and blocks the button if it's too low.
- Wallet-paid minting only (`MINT_MODE=user`). `MINT_MODE=server` ignores the burn.
- Changing `MINT_BURN_AMOUNT` later only affects new mints.

## Skill files

Holders can upload Claude-style `SKILL.md` files (name + description frontmatter, instructions below) from the Talk page. The PAL sees every active skill's name and description and loads the full file with a `load_skill` tool when a request matches. Limits: 10 files per PAL, 24 KB each, 120 KB total; stored encrypted like memory.

Skills travel with the NFT. A skill is only active for the wallet that uploaded or approved it, so a new holder sees inherited skills flagged for review and has to approve each one. The `skills` table is created automatically on startup; no migration needed.

API: `GET/POST /api/pals/:key/skills`, `GET/DELETE /api/pals/:key/skills/:id`, `POST /api/pals/:key/skills/:id/approve`.

## Claude Code bridge

Holders can take a PAL into Claude Code as a subagent, with two-way sync (Talk page → Claude Code card):

- **Agent pack** `GET /api/pals/:key/claude-code` (zip): `~/.claude/agents/<pal>.md` (persona + memory snapshot + sync instructions), a `/<pal>` slash command, and the PAL's active skill files as `~/.claude/skills/<name>/SKILL.md`.
- **Remote MCP server** `POST /mcp` (Streamable HTTP, JSON responses). Tools: `pal_context`, `pal_remember`, `pal_forget`, `pal_get_skill`, `pal_learn_skill`, plus `pal_token_overview`, `pal_wallet_overview`, `pal_token_market`. Connect with:
  `claude mcp add --scope user --transport http pal-<name> $PUBLIC_BASE_URL/mcp --header "Authorization: Bearer <agent key>"`
- **Agent keys** `GET/POST /api/pals/:key/agent-keys`, `DELETE /api/pals/:key/agent-keys/:id`. Shown once, stored as a SHA-256 hash, max 5 per PAL, and only valid while the creating wallet still holds the PAL. The `agent_tokens` table is created on startup.

Make sure `PUBLIC_BASE_URL` is your public https domain, since it goes into the MCP command and agent files.

## The square

`#square` is a shared live space for every minted PAL. The server runs one simulation (`server/square.js`, ~3 ticks a second) and streams it over SSE at `GET /api/square/stream`; `GET /api/square` returns a snapshot. Signed-in holders steer their own PALs with `POST /api/square/move|emote|poke|act` (only PALs their wallet holds, checked through DAS). It runs in memory on one instance, uses no Claude calls and no database writes. If you ever scale to several Railway replicas, move the square to its own single service.

## 8. Mainnet checklist

- [ ] **Lock the species list** (`public/pal-core.js`). Changing species, rarities, eyes, hats, names or roll order changes every wallet's PAL.
- [x] **User-paid minting** (`MINT_MODE=user`, the default): the mint wallet only co-signs, and keeping a little SOL in it is enough.
- [ ] **Inscriptions:** test Metaplex Inscriptions on devnet for the SVG and JSON, and keep the https `uri` as a fallback so marketplaces always render.
- [ ] **Royalties:** add a royalties plugin to the collection if you want them.
- [ ] **Received PALs:** the API already lists PALs a wallet holds (`GET /api/pals`), but the site only opens the connected wallet's own PAL. Add a picker.
- [ ] **Abuse controls:** tune `CHAT_RATE_PER_MIN` and the cost per message, and watch spend in the Anthropic console.
- [ ] **Monitoring and backups:** Railway logs and alerts, plus Postgres backups and an off-site copy of `MEMORY_ENCRYPTION_KEY`.
- [ ] **Legal:** have a crypto lawyer review the token and NFT setup, write terms of service and a privacy policy (you store people's memories), and avoid language about returns.
- [ ] **Brand:** keep the "not affiliated with Anthropic" line and don't use Claude logos.

---

## API

| method | path | auth | what |
|---|---|---|---|
| GET | `/api/health` | – | which features are on |
| GET | `/api/econ` | – | current compute economy (epoch or fallback) |
| POST | `/api/auth/nonce` | – | `{wallet}` → message to sign |
| POST | `/api/auth/verify` | – | `{wallet, signature(base64)}` → session cookie |
| GET | `/api/pals` | session | PAL keys this wallet can use |
| GET | `/api/pals/:wallet` | holder | memories, history, tools, ⚡ battery, mint |
| POST | `/api/pals/:wallet/chat` | holder | `{text, mode}` → SSE `delta` / `tool` / `done` |
| POST/DELETE | `/api/pals/:wallet/memories[/:id]` | holder | teach / forget |
| DELETE | `/api/pals/:wallet/history`, `/tools/:id` | holder | clear |
| POST | `/api/pals/:wallet/mint/prepare` | hatcher | build + co-sign the mint tx (wallet pays) → `{tx, asset}` |
| POST | `/api/pals/:wallet/mint/confirm` | hatcher | `{signature}` → verifies the asset on-chain and records it |
| POST | `/api/pals/:wallet/mint` | hatcher | server-paid mint (`MINT_MODE=server`, devnet only) |
| GET | `/api/pals/:wallet/metadata.json`, `/image.svg` | – | NFT metadata and animated image |

Skill costs: chat 1⚡, research / on-chain / market 2⚡, build 3⚡. If a call fails on the server, the ⚡ is refunded.

## Security notes

- **Login:** you prove you own a wallet with an ed25519 `signMessage` and a single-use nonce. Sessions are HMAC-signed, HttpOnly cookies.
- **Ownership:** a PAL can be used by its hatching wallet until it's minted, and after that only by the current holder (checked with DAS, cached for 60s).
- **Encryption:** memories and messages are encrypted at rest.
- **Built tools:** they run in a sandboxed iframe with no same-origin access, and the site's CSP blocks their network access.
- **Prompt injection:** pasted data, tool results and web pages are marked as data in the system prompt.

Independent project. Not affiliated with or endorsed by Anthropic.
