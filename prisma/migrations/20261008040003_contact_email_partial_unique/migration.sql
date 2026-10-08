-- Replace the full (account_id, email) unique index with a PARTIAL unique
-- index that only covers rows where an email actually exists.
--
-- Business rule (unchanged): email must be unique per account when an email
-- exists, while multiple contacts may have NULL email. The partial index
-- enforces this at the database level - the application does not duplicate
-- the check. Index name is matched by the Prisma schema declaration
-- (@@unique(..., map: "uq_contacts_account_email_not_null", where: raw(...)))
-- so `prisma migrate dev` sees no drift.

-- DropIndex
DROP INDEX "contacts_account_id_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "uq_contacts_account_email_not_null" ON "contacts"("account_id", "email") WHERE "email" IS NOT NULL;
