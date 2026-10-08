// Contact persistence. All queries are scoped by accountId (tenant isolation
// happens at the database, not in the UI), and every write that must be
// atomic receives the transaction client from the service layer.
import { prisma, type Db, type Tx } from "../../lib/prisma";
import { Prisma } from "../../generated/prisma/client";

export interface ListContactsParams {
  accountId: string;
  search?: string;
  company?: string;
  tagId?: string;
  page: number;
  pageSize: number;
  sortBy: "name" | "createdAt";
  sortOrder: "asc" | "desc";
}

export interface ContactWithRelations {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  tags: Array<{ tag: { id: string; name: string } }>;
}

const contactInclude = {
  tags: {
    include: { tag: { select: { id: true, name: true } } },
    orderBy: { tag: { name: "asc" as const } },
  },
} satisfies Prisma.ContactInclude;

/**
 * Pure query builder - kept side-effect free so it can be unit tested and so
 * that no user input can reach the database without passing through the
 * whitelisted parameters above.
 */
export function buildContactWhere(
  params: Omit<ListContactsParams, "page" | "pageSize" | "sortBy" | "sortOrder">,
): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { accountId: params.accountId };

  if (params.search) {
    const contains = params.search;
    where.OR = [
      { firstName: { contains, mode: "insensitive" } },
      { lastName: { contains, mode: "insensitive" } },
      { email: { contains, mode: "insensitive" } },
      { phone: { contains, mode: "insensitive" } },
    ];

    // "Adan Abbott" spans two columns, so no single-column match above can
    // find it: also match "<first...> <last...>" split at the first space.
    const space = contains.indexOf(" ");
    if (space > 0) {
      const first = contains.slice(0, space);
      const last = contains.slice(space + 1).trim();
      if (last) {
        where.OR.push({
          AND: [
            { firstName: { contains: first, mode: "insensitive" } },
            { lastName: { contains: last, mode: "insensitive" } },
          ],
        });
      }
    }
  }

  if (params.company) {
    where.company = { contains: params.company, mode: "insensitive" };
  }

  if (params.tagId) {
    where.tags = { some: { tagId: params.tagId } };
  }

  return where;
}

function buildOrderBy(
  sortBy: ListContactsParams["sortBy"],
  sortOrder: ListContactsParams["sortOrder"],
): Prisma.ContactOrderByWithRelationInput[] {
  const order = sortOrder;
  // `name` sorts by last name first (matching how a CRM list is scanned);
  // id is appended as a tie-breaker so pagination is stable.
  if (sortBy === "name") {
    return [{ lastName: order }, { firstName: order }, { id: order }];
  }
  return [{ createdAt: order }, { id: order }];
}

export async function listContacts(
  params: ListContactsParams,
): Promise<{ items: ContactWithRelations[]; total: number }> {
  const where = buildContactWhere(params);
  const orderBy = buildOrderBy(params.sortBy, params.sortOrder);
  const skip = (params.page - 1) * params.pageSize;

  // Rows and total are fetched in one transaction so both statements observe
  // the same database snapshot.
  const [items, total] = await prisma.$transaction([
    prisma.contact.findMany({
      where,
      orderBy,
      skip,
      take: params.pageSize,
      include: contactInclude,
    }),
    prisma.contact.count({ where }),
  ]);

  return { items, total };
}

export async function findContact(
  client: Db | Tx,
  accountId: string,
  id: string,
): Promise<ContactWithRelations | null> {
  return client.contact.findFirst({
    where: { id, accountId },
    include: contactInclude,
  });
}

export async function findContactsByIds(
  accountId: string,
  ids: string[],
): Promise<Array<{ id: string }>> {
  return prisma.contact.findMany({
    where: { id: { in: ids }, accountId },
    select: { id: true },
  });
}

export interface UpdateContactCasArgs {
  accountId: string;
  id: string;
  /** Version the client loaded - part of the WHERE clause, never overwritten. */
  version: number;
  data: Prisma.ContactUpdateManyMutationInput;
}

/**
 * Compare-and-swap update. Equivalent to:
 *
 *   UPDATE contacts SET ..., version = version + 1, updated_at = now()
 *   WHERE id = ? AND account_id = ? AND version = ?
 *
 * The version increment happens inside the UPDATE itself - there is no
 * read-then-write race (TOCTOU) because the WHERE clause is the check.
 * Returns the number of affected rows (0 = stale version or missing row).
 */
export async function updateContactCas(tx: Tx, args: UpdateContactCasArgs): Promise<number> {
  const result = await tx.contact.updateMany({
    where: { id: args.id, accountId: args.accountId, version: args.version },
    data: {
      ...args.data,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  return result.count;
}
