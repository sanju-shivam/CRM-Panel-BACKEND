// Tag persistence.
//
// The bulk insert deliberately uses `INSERT ... ON CONFLICT DO NOTHING
// RETURNING`: PostgreSQL tells us exactly which rows were created, so
// duplicate assignments are impossible (schema-level idempotency) and the
// caller receives an exact list of newly assigned contacts for activity
// creation.
import { prisma, type Db, type Tx } from "../../lib/prisma";
import { Prisma } from "../../generated/prisma/client";

export interface TagRow {
  id: string;
  accountId: string;
  name: string;
  createdAt: Date;
}

export async function listTags(accountId: string): Promise<TagRow[]> {
  return prisma.tag.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
    select: { id: true, accountId: true, name: true, createdAt: true },
  });
}

export async function findTag(
  client: Db | Tx,
  accountId: string,
  tagId: string,
): Promise<TagRow | null> {
  return client.tag.findFirst({
    where: { id: tagId, accountId },
    select: { id: true, accountId: true, name: true, createdAt: true },
  });
}

export async function createAssignment(
  tx: Tx,
  contactId: string,
  tagId: string,
): Promise<{ contactId: string; tagId: string; assignedAt: Date }> {
  return tx.contactTag.create({ data: { contactId, tagId } });
}

/**
 * Delete an assignment; returns false when no row existed. `deleteMany` keeps
 * the check and the delete in one statement, so two concurrent removals
 * resolve to one success and one "not assigned" instead of a P2025 error.
 */
export async function deleteAssignment(tx: Tx, contactId: string, tagId: string): Promise<boolean> {
  const result = await tx.contactTag.deleteMany({ where: { contactId, tagId } });
  return result.count > 0;
}

/**
 * Atomically assign a tag to many contacts, skipping rows that already exist.
 * Returns the contact ids that were newly inserted (in input order).
 */
export async function insertAssignmentsIfAbsent(
  tx: Tx,
  tagId: string,
  contactIds: string[],
): Promise<string[]> {
  if (contactIds.length === 0) return [];

  const values = Prisma.join(
    contactIds.map((contactId) => Prisma.sql`(${contactId}::uuid, ${tagId}::uuid, NOW())`),
  );

  const rows = await tx.$queryRaw<Array<{ contactId: string }>>`
    INSERT INTO contact_tags (contact_id, tag_id, assigned_at)
    VALUES ${values}
    ON CONFLICT DO NOTHING
    RETURNING contact_id AS "contactId"
  `;

  return rows.map((row) => row.contactId);
}
