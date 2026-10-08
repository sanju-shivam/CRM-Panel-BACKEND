// Shared integration-test harness: the Express app under test plus a
// deterministic database fixture.
//
// Fixture (recreated before every test - see `resetDb`):
//   account: env.DEFAULT_ACCOUNT_ID
//   tags:    Lead, VIP, Customer
//   contacts:
//     c1 Alice Anderson  alice@example.com  Acme Corporation  [Lead]
//     c2 Bob Baker       (no email)        Initech           []
//     c3 Carol Cruz      carol@example.com  Globex            [Lead, VIP]
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/lib/prisma";

export const ACCOUNT_ID = env.DEFAULT_ACCOUNT_ID;

// Safety belt: destructive resets below must never touch a database other
// than the dedicated test one (vitest.config.ts points DATABASE_URL at
// crm_test via test.env; this fails loudly if that wiring ever regresses).
if (!env.DATABASE_URL.includes("crm_test")) {
  throw new Error(
    `Refusing to run tests against non-test database: ${env.DATABASE_URL}`,
  );
}

/** Valid, deterministic UUIDs - distinct from the seed data namespace. */
export const IDS = {
  contact1: "00000000-0000-4000-8000-0000000000c1",
  contact2: "00000000-0000-4000-8000-0000000000c2",
  contact3: "00000000-0000-4000-8000-0000000000c3",
  tagLead: "00000000-0000-4000-8000-0000000000e1",
  tagVip: "00000000-0000-4000-8000-0000000000e2",
  tagCustomer: "00000000-0000-4000-8000-0000000000e3",
  unknownContact: "00000000-0000-4000-8000-000000000999",
  unknownTag: "00000000-0000-4000-8000-000000000998",
  /** Belongs to a different (non-existent) tenant - must never be visible. */
  foreignContact: "00000000-0000-4000-8000-0000000000ff",
} as const;

export const app = createApp();

export async function resetDb(): Promise<void> {
  await prisma.contactActivity.deleteMany({});
  await prisma.contactTag.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.account.deleteMany({});

  await prisma.account.create({
    data: { id: ACCOUNT_ID, name: "Test Account" },
  });

  await prisma.tag.createMany({
    data: [
      { id: IDS.tagLead, accountId: ACCOUNT_ID, name: "Lead" },
      { id: IDS.tagVip, accountId: ACCOUNT_ID, name: "VIP" },
      { id: IDS.tagCustomer, accountId: ACCOUNT_ID, name: "Customer" },
    ],
  });

  await prisma.contact.createMany({
    data: [
      {
        id: IDS.contact1,
        accountId: ACCOUNT_ID,
        firstName: "Alice",
        lastName: "Anderson",
        email: "alice@example.com",
        phone: "555-0101",
        company: "Acme Corporation",
        version: 1,
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
        updatedAt: new Date("2026-01-15T00:00:00.000Z"),
      },
      {
        id: IDS.contact2,
        accountId: ACCOUNT_ID,
        firstName: "Bob",
        lastName: "Baker",
        email: null,
        phone: "555-0102",
        company: "Initech",
        version: 1,
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
        updatedAt: new Date("2026-02-15T00:00:00.000Z"),
      },
      {
        id: IDS.contact3,
        accountId: ACCOUNT_ID,
        firstName: "Carol",
        lastName: "Cruz",
        email: "carol@example.com",
        phone: "555-0103",
        company: "Globex",
        version: 1,
        createdAt: new Date("2026-03-15T00:00:00.000Z"),
        updatedAt: new Date("2026-03-15T00:00:00.000Z"),
      },
    ],
  });

  await prisma.contactTag.createMany({
    data: [
      { contactId: IDS.contact1, tagId: IDS.tagLead, assignedAt: new Date("2026-01-15T00:00:00.000Z") },
      { contactId: IDS.contact3, tagId: IDS.tagLead, assignedAt: new Date("2026-03-15T00:00:00.000Z") },
      { contactId: IDS.contact3, tagId: IDS.tagVip, assignedAt: new Date("2026-03-15T00:00:01.000Z") },
    ],
  });
}
