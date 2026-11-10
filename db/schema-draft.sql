-- Local prototype only. Apply through a reviewed migration after configuring roles.
-- Keep this schema outside Supabase's exposed Data API schemas.
create schema fintree_private;
revoke all on schema fintree_private from public;

create table fintree_private.merchants (
  id uuid primary key,
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  business_name text not null check (length(business_name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table fintree_private.api_keys (
  id uuid primary key,
  merchant_id uuid not null references fintree_private.merchants(id),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index api_keys_merchant_idx on fintree_private.api_keys (merchant_id);

create table fintree_private.wallet_challenges (
  id uuid primary key,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  origin text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index wallet_challenges_expiry_idx on fintree_private.wallet_challenges (expires_at);

create table fintree_private.webhook_settings (
  merchant_id uuid primary key references fintree_private.merchants(id),
  destination_url text not null check (length(destination_url) between 1 and 2048),
  secret_envelope text not null,
  updated_at timestamptz not null default now()
);

create table fintree_private.invoices (
  id text primary key check (id ~ '^0x[0-9a-f]{64}$' and id <> '0x' || repeat('0', 64)),
  merchant_id uuid not null references fintree_private.merchants(id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  external_order_id text not null check (length(external_order_id) between 1 and 200),
  chain_id numeric(78,0) not null check (chain_id > 0),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  merchant_address text not null check (merchant_address ~ '^0x[0-9a-f]{40}$'),
  invoice_amount numeric(78,0) not null check (invoice_amount > 0),
  merchant_amount numeric(78,0) not null check (merchant_amount > 0),
  protocol_fee numeric(78,0) not null check (protocol_fee >= 0),
  total_payable numeric(78,0) not null check (total_payable = merchant_amount + protocol_fee),
  fee_bps integer not null check (fee_bps between 0 and 10000),
  fee_payer text not null check (fee_payer in ('customer', 'merchant')),
  quote_signature text not null check (quote_signature ~ '^0x[0-9a-f]+$'),
  deadline timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirming', 'paid', 'expired')),
  tx_hash text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number bigint check (block_number >= 0),
  payer_address text check (payer_address ~ '^0x[0-9a-f]{40}$'),
  paid_at timestamptz,
  rechecked_at timestamptz,
  paid_rechecked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (merchant_id, idempotency_key),
  check ((fee_payer = 'customer' and merchant_amount = invoice_amount and total_payable = invoice_amount + protocol_fee)
      or (fee_payer = 'merchant' and total_payable = invoice_amount and merchant_amount + protocol_fee = invoice_amount)),
  check (status <> 'paid' or (tx_hash is not null and block_hash is not null and block_number is not null and payer_address is not null and paid_at is not null))
);
create index invoices_merchant_created_idx on fintree_private.invoices (merchant_id, created_at desc);
create index invoices_active_idx on fintree_private.invoices (status, deadline) where status in ('pending', 'confirming');
create index invoices_confirming_recheck_idx on fintree_private.invoices (chain_id, contract_address, rechecked_at) where status = 'confirming';
create index invoices_paid_recheck_idx on fintree_private.invoices (chain_id, contract_address, paid_rechecked_at) where status = 'paid';

create table fintree_private.payment_incidents (
  invoice_id text primary key references fintree_private.invoices(id),
  kind text not null check (kind = 'paid_block_changed'),
  original_block_hash text not null check (original_block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_block_hash text not null check (observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  detected_at timestamptz not null default now()
);

create table fintree_private.scanner_state (
  chain_id numeric(78,0) not null check (chain_id > 0),
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  start_block bigint not null check (start_block >= 0),
  next_block bigint not null check (next_block >= start_block),
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (chain_id, contract_address),
  check ((lease_token is null) = (lease_until is null))
);

create table fintree_private.webhook_outbox (
  event_id text primary key,
  invoice_id text not null references fintree_private.invoices(id),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_until is null)),
  unique (invoice_id, event_type)
);
create index webhook_outbox_pending_idx on fintree_private.webhook_outbox (next_attempt_at) where status = 'pending';

create table fintree_private.webhook_attempts (
  id uuid primary key,
  event_id text not null references fintree_private.webhook_outbox(event_id),
  attempt_number integer not null check (attempt_number > 0),
  response_status integer check (response_status between 100 and 599),
  outcome text not null check (outcome in ('delivered', 'retry', 'failed')),
  created_at timestamptz not null default now(),
  unique (event_id, attempt_number)
);

alter table fintree_private.merchants enable row level security;
alter table fintree_private.api_keys enable row level security;
alter table fintree_private.wallet_challenges enable row level security;
alter table fintree_private.webhook_settings enable row level security;
alter table fintree_private.invoices enable row level security;
alter table fintree_private.payment_incidents enable row level security;
alter table fintree_private.scanner_state enable row level security;
alter table fintree_private.webhook_outbox enable row level security;
alter table fintree_private.webhook_attempts enable row level security;
revoke all on all tables in schema fintree_private from public;
