-- PGlite local-testnet migration only; this is not a Supabase migration.
alter table fintree_private.merchants add column updated_at timestamptz not null default now();
