// Contact business logic.
//
// Services own transactions and business rules; they never produce
// HTTP-specific shapes and never touch Express types.
import { env } from "../../config/env";
import { errors } from "../../lib/errors";
import { mapPrismaError } from "../../lib/prisma-errors";
import { prisma } from "../../lib/prisma";
import { createActivity, listActivities } from "../activities/activities.repository";
import {
  findContact,
  listContacts,
  updateContactCas,
} from "./contacts.repository";
import {
  toContactDto,
  type ContactActivityDto,
  type ContactDto,
  type PaginatedContactsDto,
} from "./contacts.mapper";
import type { ListContactsQuery, UpdateContactBody } from "./contacts.schemas";

/** In production this comes from the authenticated principal (see config/env). */
const accountId = () => env.DEFAULT_ACCOUNT_ID;

const ACTIVITY_PAGE_LIMIT = 200;

export async function listContactsPage(query: ListContactsQuery): Promise<PaginatedContactsDto> {
  const { items, total } = await listContacts({ accountId: accountId(), ...query });

  return {
    items: items.map(toContactDto),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    },
  };
}

export async function getContact(id: string): Promise<ContactDto> {
  const contact = await findContact(prisma, accountId(), id);
  if (!contact) throw errors.contactNotFound(id);
  return toContactDto(contact);
}

interface ContactUpdateData {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

function computeChanges(
  before: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    company: string | null;
  },
  input: UpdateContactBody,
): { data: ContactUpdateData; changedFields: string[] } {
  const data: ContactUpdateData = {};
  const changedFields: string[] = [];

  if (input.firstName !== undefined && input.firstName !== before.firstName) {
    data.firstName = input.firstName;
    changedFields.push("firstName");
  }
  if (input.lastName !== undefined && input.lastName !== before.lastName) {
    data.lastName = input.lastName;
    changedFields.push("lastName");
  }
  if (input.email !== undefined && input.email !== before.email) {
    data.email = input.email;
    changedFields.push("email");
  }
  if (input.phone !== undefined && input.phone !== before.phone) {
    data.phone = input.phone;
    changedFields.push("phone");
  }
  if (input.company !== undefined && input.company !== before.company) {
    data.company = input.company;
    changedFields.push("company");
  }

  return { data, changedFields };
}

/**
 * Update a contact with optimistic concurrency control.
 *
 * Correctness invariants:
 *  - the version check and the write are a single atomic UPDATE (no TOCTOU
 *    pre-check), so a stale client can never overwrite newer data;
 *  - the CONTACT_UPDATED activity is created in the same transaction as the
 *    update, so history can never diverge from state;
 *  - a duplicate email surfaces as EMAIL_ALREADY_EXISTS through the database
 *    unique constraint (the DB is the source of truth, not a pre-check).
 */
export async function updateContact(id: string, input: UpdateContactBody): Promise<ContactDto> {
  const tenantId = accountId();

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await findContact(tx, tenantId, id);
      if (!before) throw errors.contactNotFound(id);

      const { data, changedFields } = computeChanges(before, input);
      if (changedFields.length === 0) {
        // No columns change, but a write attempt against a stale version is
        // still a conflict: the client's base state is wrong, so it must
        // reload instead of silently succeeding against the wrong snapshot.
        if (before.version !== input.version) throw errors.versionConflict();
        return toContactDto(before);
      }

      const affected = await updateContactCas(tx, {
        accountId: tenantId,
        id,
        version: input.version,
        data,
      });

      if (affected === 0) {
        // Distinguish "stale write" from "row disappeared mid-transaction".
        const current = await findContact(tx, tenantId, id);
        if (!current) throw errors.contactNotFound(id);
        throw errors.versionConflict();
      }

      await createActivity(tx, {
        contactId: id,
        accountId: tenantId,
        type: "CONTACT_UPDATED",
        metadata: { changedFields },
      });

      const updated = await findContact(tx, tenantId, id);
      if (!updated) throw errors.contactNotFound(id);
      return toContactDto(updated);
    });
  } catch (error) {
    const mapped = mapPrismaError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

export async function getContactActivities(id: string): Promise<{ items: ContactActivityDto[] }> {
  const tenantId = accountId();
  const contact = await findContact(prisma, tenantId, id);
  if (!contact) throw errors.contactNotFound(id);

  const activities = await listActivities(tenantId, id, ACTIVITY_PAGE_LIMIT);

  return {
    items: activities.map((activity) => ({
      id: activity.id,
      type: activity.type as ContactActivityDto["type"],
      metadata:
        activity.metadata && typeof activity.metadata === "object" && !Array.isArray(activity.metadata)
          ? (activity.metadata as Record<string, unknown>)
          : null,
      createdAt: activity.createdAt,
    })),
  };
}
