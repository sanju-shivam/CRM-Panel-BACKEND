// Activity persistence. Activities are only ever created through the same
// transaction as the mutation they describe, which is why every helper here
// requires a transaction client (`Tx`) for writes.
import { prisma, type Tx } from "../../lib/prisma";
import { Prisma, type ContactActivityType } from "../../generated/prisma/client";

export interface CreateActivityArgs {
  contactId: string;
  accountId: string;
  type: ContactActivityType;
  metadata?: Prisma.InputJsonValue;
}

export async function createActivity(tx: Tx, args: CreateActivityArgs): Promise<void> {
  await tx.contactActivity.create({
    data: {
      contactId: args.contactId,
      accountId: args.accountId,
      type: args.type,
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    },
  });
}

export interface ActivityRow {
  id: string;
  contactId: string;
  type: ContactActivityType;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

/** Newest first; `id` breaks timestamp ties so ordering is total and stable. */
export async function listActivities(
  accountId: string,
  contactId: string,
  take: number,
): Promise<ActivityRow[]> {
  return prisma.contactActivity.findMany({
    where: { contactId, accountId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, contactId: true, type: true, metadata: true, createdAt: true },
  });
}
