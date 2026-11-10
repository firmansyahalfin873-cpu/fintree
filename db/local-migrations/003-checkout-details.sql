-- Local PGlite development only; not a Supabase migration.
alter table fintree_private.invoices add column return_url text;
alter table fintree_private.invoices add column metadata jsonb;
