-- Index-backed search and stable-sort indexes.
--
-- Search and the company filter use ILIKE '%term%' (Prisma `contains`,
-- mode insensitive). A B-tree index cannot serve a leading wildcard, so
-- without these GIN trigram indexes every search scans the whole account.
-- With them PostgreSQL combines the per-column indexes (BitmapOr) for terms
-- of 3+ characters.
--
-- pg_trgm lives in the `extensions` schema (Supabase's convention; the
-- opclass is schema-qualified so local PostgreSQL behaves identically). On
-- Supabase the extension is already enabled, so the CREATE is a no-op.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX "contacts_first_name_trgm_idx" ON "contacts" USING gin ("first_name" extensions.gin_trgm_ops);
CREATE INDEX "contacts_last_name_trgm_idx" ON "contacts" USING gin ("last_name" extensions.gin_trgm_ops);
CREATE INDEX "contacts_email_trgm_idx" ON "contacts" USING gin ("email" extensions.gin_trgm_ops);
CREATE INDEX "contacts_phone_trgm_idx" ON "contacts" USING gin ("phone" extensions.gin_trgm_ops);
CREATE INDEX "contacts_company_trgm_idx" ON "contacts" USING gin ("company" extensions.gin_trgm_ops);

-- The list query orders by (last_name, first_name, id) or (created_at, id);
-- including the id tie-breaker lets an index scan return rows already in
-- order, with no extra sort step.
DROP INDEX "contacts_account_id_last_name_first_name_idx";
CREATE INDEX "contacts_account_id_last_name_first_name_id_idx" ON "contacts"("account_id", "last_name", "first_name", "id");

DROP INDEX "contacts_account_id_created_at_idx";
CREATE INDEX "contacts_account_id_created_at_id_idx" ON "contacts"("account_id", "created_at", "id");
