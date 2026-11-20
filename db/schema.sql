-- PALS database schema (Postgres 14+). Run with: npm run migrate
create table if not exists pals (
  pal_key     text primary key,              -- the wallet that hatched it
  asset_id    text unique,                   -- Core asset address once minted
  mint_sig    text,
  minted_at   timestamptz,
  xp          integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists memories (
  id          text primary key,
  pal_key     text not null references pals(pal_key) on delete cascade,
  type        text not null,
  body        text not null,                 -- AES-256-GCM sealed
  created_at  timestamptz not null default now()
);
create index if not exists memories_pal on memories(pal_key, created_at);

create table if not exists messages (
  id          bigserial primary key,
  pal_key     text not null references pals(pal_key) on delete cascade,
  role        text not null,                 -- user | assistant | sys | learn
  mode        text,
  body        text not null,                 -- sealed
  tool_id     text,
  created_at  timestamptz not null default now()
);
create index if not exists messages_pal on messages(pal_key, id desc);

create table if not exists tools (
  id          text primary key,
  pal_key     text not null references pals(pal_key) on delete cascade,
  name        text not null,
  html        text not null,
  prompt      text,
  created_at  timestamptz not null default now()
);

create table if not exists fuel (
  pal_key     text primary key references pals(pal_key) on delete cascade,
  credits     real not null,
  day         date not null
);

create table if not exists usage (
  pal_key     text not null references pals(pal_key) on delete cascade,
  day         date not null,
  n           integer not null default 0,
  primary key (pal_key, day)
);

create table if not exists nonces (
  wallet      text primary key,
  message     text not null,
  expires_at  timestamptz not null
);

create table if not exists epochs (
  day           date primary key,
  treasury_sol  double precision not null,
  sol_usd       double precision not null,
  budget_usd    double precision not null,
  minted_pals   integer not null,
  created_at    timestamptz not null default now()
);

create table if not exists skills (
  id          text primary key,
  pal_key     text not null references pals(pal_key) on delete cascade,
  name        text not null,
  description text not null,
  body        text not null,                 -- AES-256-GCM sealed
  size        integer not null,
  added_by    text not null,                 -- wallet that uploaded it
  approved_by text,                          -- wallet it is active for (re-approved after a transfer)
  created_at  timestamptz not null default now(),
  unique (pal_key, name)
);
