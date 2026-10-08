// Tag business logic: assignment, removal and bulk assignment.
//
// Every mutation runs in a transaction together with its activity, and every
// operation is scoped to the current account.
import { AppError, ERROR_CODES, errors } from "../../lib/errors";
import { isForeignKeyViolation, isUniqueConstraintViolation } from "../../lib/prisma-errors";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { createActivity } from "../activities/activities.repository";
import { findContact, findContactsByIds } from "../contacts/contacts.repository";
import {
  createAssignment,
  deleteAssignment,
  findTag,
  insertAssignmentsIfAbsent,
  listTags,
} from "./tags.repository";

const accountId = () => env.DEFAULT_ACCOUNT_ID;

export interface TagDto {
  id: string;
  name: string;
  createdAt: Date;
}

export interface BulkAssignResult {
  tagId: string;
  requested: number;
  newlyAssigned: number;
  alreadyAssigned: number;
}

export async function listAccountTags(): Promise<{ items: TagDto[] }> {
  const tags = await listTags(accountId());
  return { items: tags.map(({ id, name, createdAt }) => ({ id, name, createdAt })) };
}

export async function addTagToContact(
  contactId: string,
  tagId: string,
): Promise<{ contactId: string; tagId: string; assignedAt: Date }> {
  const tenantId = accountId();

  const contact = await findContact(prisma, tenantId, contactId);
  if (!contact) throw errors.contactNotFound(contactId);

  const tag = await findTag(prisma, tenantId, tagId);
  if (!tag) throw errors.tagNotFound(tagId);

  try {
    return await prisma.$transaction(async (tx) => {
      // The composite primary key on contact_tags is the real guard against
      // duplicates; the P2002 it raises is translated to TAG_ALREADY_ASSIGNED.
      const assignment = await createAssignment(tx, contactId, tagId);
      await createActivity(tx, {
        contactId,
        accountId: tenantId,
        type: "TAG_ADDED",
        metadata: { tagName: tag.name, tagId },
      });
      return assignment;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw errors.tagAlreadyAssigned(contactId, tagId);
    }
    // Contact or tag deleted between the existence checks and the insert.
    if (isForeignKeyViolation(error)) {
      throw errors.contactNotFound(contactId);
    }
    throw error;
  }
}

export async function removeTagFromContact(
  contactId: string,
  tagId: string,
): Promise<{ contactId: string; tagId: string }> {
  const tenantId = accountId();

  const contact = await findContact(prisma, tenantId, contactId);
  if (!contact) throw errors.contactNotFound(contactId);

  const tag = await findTag(prisma, tenantId, tagId);
  if (!tag) throw errors.tagNotFound(tagId);

  await prisma.$transaction(async (tx) => {
    const removed = await deleteAssignment(tx, contactId, tagId);
    if (!removed) throw errors.tagNotAssigned(contactId, tagId);

    await createActivity(tx, {
      contactId,
      accountId: tenantId,
      type: "TAG_REMOVED",
      metadata: { tagName: tag.name, tagId },
    });
  });

  return { contactId, tagId };
}

/**
 * Bulk assignment contract (idempotent):
 *  - validates the tag and every contact id before touching the database;
 *  - assigns atomically in one transaction;
 *  - skips rows that already exist (composite PK + ON CONFLICT DO NOTHING);
 *  - writes activities only for newly created rows;
 *  - reports exact counts, so re-running the same request is safe:
 *      { requested: 10, newlyAssigned: 7, alreadyAssigned: 3 } on first run,
 *      { requested: 10, newlyAssigned: 0, alreadyAssigned: 10 } on the second.
 */
export async function bulkAssignTag(input: {
  tagId: string;
  contactIds: string[];
}): Promise<BulkAssignResult> {
  const tenantId = accountId();

  const tag = await findTag(prisma, tenantId, input.tagId);
  if (!tag) throw errors.tagNotFound(input.tagId);

  const contactIds = [...new Set(input.contactIds)];

  const existingContacts = await findContactsByIds(tenantId, contactIds);
  const knownIds = new Set(existingContacts.map((contact) => contact.id));
  const missingIds = contactIds.filter((id) => !knownIds.has(id));
  if (missingIds.length > 0) {
    throw new AppError(
      ERROR_CODES.CONTACT_NOT_FOUND,
      404,
      `${missingIds.length} of ${contactIds.length} contacts do not exist.`,
      { missingIds },
    );
  }

  return prisma.$transaction(async (tx) => {
    const insertedContactIds = await insertAssignmentsIfAbsent(tx, input.tagId, contactIds);

    if (insertedContactIds.length > 0) {
      await tx.contactActivity.createMany({
        data: insertedContactIds.map((contactId) => ({
          contactId,
          accountId: tenantId,
          type: "TAG_ADDED" as const,
          metadata: { tagName: tag.name, tagId: input.tagId },
        })),
      });
    }

    return {
      tagId: input.tagId,
      requested: contactIds.length,
      newlyAssigned: insertedContactIds.length,
      alreadyAssigned: contactIds.length - insertedContactIds.length,
    };
  });
}
