// Deterministic seed data.
//
// Guarantees:
//  - fixed faker seed => identical names, emails, phones, tags and ordering
//    on every run;
//  - deterministic UUIDs (index-derived) so tooling and E2E tests can address
//    stable records: contact #1 is always 00000000-0000-4000-8000-000000000001;
//  - timestamps are spread over the previous 12 months relative to the start
//    of the current UTC day (so a re-run on the same day is byte-identical);
//  - the whole dataset is written inside one transaction: a failed seed never
//    leaves a half-populated database;
//  - `--if-empty` skips work when contacts already exist (used on container
//    boot so restarts never wipe data).
//
// Contents: 1 account, 8 tags, 1,200 contacts across 20 companies,
// ~10% without email, 0-3 tags per contact with VIP intentionally rare.
import { faker } from "@faker-js/faker";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";

const SEED_FAKER_ID = 20261001;
const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000aa";
const CONTACT_COUNT = 1200;
const BATCH_SIZE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic UUIDs (last group is exactly 12 hex chars):
//   contacts   000000000001 .. 000000001200
//   tags       000000000101 .. 000000000108
//   activities 000100000001 ..
const contactUuid = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
const tagUuid = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const activityUuid = (n: number) => `00000000-0000-4000-8000-0001${String(n).padStart(8, "0")}`;

const TAG_NAMES = [
  "Lead",
  "Customer",
  "VIP",
  "Prospect",
  "Partner",
  "Churned",
  "Hot",
  "Cold",
] as const;

// Weighted per-draw probability. VIP is deliberately ~1% so the tag reads as
// genuinely special in the UI (and so tag-filter tests are meaningful).
const TAG_WEIGHTS: Record<(typeof TAG_NAMES)[number], number> = {
  Lead: 25,
  Customer: 20,
  Prospect: 15,
  Hot: 10,
  Cold: 10,
  Partner: 8,
  Churned: 7,
  VIP: 1,
};

const COMPANIES = [
  "Acme Corporation",
  "Globex",
  "Initech",
  "Umbrella Industries",
  "Stark Solutions",
  "Wayne Enterprises",
  "Hooli",
  "Pied Piper",
  "Vandelay Industries",
  "Soylent Corp",
  "Cyberdyne Systems",
  "Tyrell Corporation",
  "Massive Dynamic",
  "Aperture Science",
  "Nakatomi Trading",
  "Oceanic Airlines",
  "Dunder Mifflin",
  "Sterling Cooper",
  "Venture Bros",
  "Wonka Foods",
] as const;

// Seeding deletes and recreates the demo account's contacts/tags/activities.
// Against Supabase that would silently wipe the demo database, so a Supabase
// DATABASE_URL is only accepted with an explicit SEED_CONFIRM=yes. Local
// development and the E2E database continue to seed normally. Both Supabase
// host families are matched: db.<ref>.supabase.co (direct) and
// *.pooler.supabase.com. `process.env` is read directly because this script
// runs before the Prisma client connects.
function assertSafeToSeed(): void {
  const url = process.env.DATABASE_URL ?? "";
  const looksLikeSupabase = /supabase\.(co|com)\b/.test(url);
  if (looksLikeSupabase && process.env.SEED_CONFIRM !== "yes") {
    throw new Error(
      "Refusing to seed: DATABASE_URL appears to be Supabase. Set SEED_CONFIRM=yes to override.",
    );
  }
}

function pickTagCount(): number {
  const roll = faker.number.int({ min: 1, max: 100 });
  if (roll <= 15) return 0;
  if (roll <= 55) return 1;
  if (roll <= 85) return 2;
  return 3;
}

function pickDistinctTags(count: number): Array<(typeof TAG_NAMES)[number]> {
  const available = TAG_NAMES.map((name) => ({ name, weight: TAG_WEIGHTS[name] }));
  const chosen: Array<(typeof TAG_NAMES)[number]> = [];

  for (let i = 0; i < count && available.length > 0; i += 1) {
    const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = faker.number.int({ min: 1, max: totalWeight });
    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      if (!candidate) continue;
      roll -= candidate.weight;
      if (roll <= 0) {
        chosen.push(candidate.name);
        available.splice(index, 1);
        break;
      }
    }
  }

  return chosen;
}

interface SeedContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string;
  createdAt: Date;
  updatedAt: Date;
  tagIds: string[];
}

function buildContacts(): { contacts: SeedContact[]; assignmentCount: number } {
  const usedEmails = new Set<string>();
  const anchor = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const contacts: SeedContact[] = [];
  let assignmentCount = 0;

  for (let n = 1; n <= CONTACT_COUNT; n += 1) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    // ~10% of contacts intentionally have no email (email is nullable).
    let email: string | null = null;
    if (faker.number.int({ min: 1, max: 10 }) > 1) {
      const base = faker.internet.email({ firstName, lastName, provider: "example.com" }).toLowerCase();
      email = base;
      let dedupe = 1;
      while (usedEmails.has(email)) {
        const [local, domain] = base.split("@") as [string, string];
        email = `${local}${dedupe}@${domain}`;
        dedupe += 1;
      }
      usedEmails.add(email);
    }

    const phone = faker.phone.number();
    const company = COMPANIES[faker.number.int({ min: 0, max: COMPANIES.length - 1 })] ?? "Acme Corporation";

    const createdDaysAgo = faker.number.int({ min: 0, max: 364 });
    const createdAt = new Date(anchor - createdDaysAgo * DAY_MS - faker.number.int({ min: 0, max: 86_399 }) * 1000);
    const updatedAt = new Date(
      Math.min(anchor, createdAt.getTime() + faker.number.int({ min: 0, max: 90 }) * DAY_MS),
    );

    const tagNames = pickDistinctTags(pickTagCount());
    const tagIds = tagNames.map((name) => tagUuid(TAG_NAMES.indexOf(name) + 1));
    assignmentCount += tagIds.length;

    contacts.push({
      id: contactUuid(n),
      firstName,
      lastName,
      email,
      phone,
      company,
      createdAt,
      updatedAt,
      tagIds,
    });
  }

  return { contacts, assignmentCount };
}

async function main(): Promise<void> {
  assertSafeToSeed();
  const ifEmpty = process.argv.includes("--if-empty");
  faker.seed(SEED_FAKER_ID);

  const existing = await prisma.contact.count({ where: { accountId: ACCOUNT_ID } });
  if (ifEmpty && existing > 0) {
    logger.info({ existing }, "seed skipped: database already contains contacts");
    return;
  }

  const { contacts, assignmentCount } = buildContacts();
  const startedAt = Date.now();

  await prisma.$transaction(
    async (tx) => {
      await tx.account.upsert({
        where: { id: ACCOUNT_ID },
        create: { id: ACCOUNT_ID, name: "Demo Account" },
        update: { name: "Demo Account" },
      });

      // Wipe previous seed output for this account (cascade removes
      // contact_tags/activities when contacts/tags are deleted; explicit
      // order keeps the intent readable).
      await tx.contactActivity.deleteMany({ where: { accountId: ACCOUNT_ID } });
      await tx.contactTag.deleteMany({
        where: { contact: { accountId: ACCOUNT_ID } },
      });
      await tx.contact.deleteMany({ where: { accountId: ACCOUNT_ID } });
      await tx.tag.deleteMany({ where: { accountId: ACCOUNT_ID } });

      await tx.tag.createMany({
        data: TAG_NAMES.map((name, index) => ({
          id: tagUuid(index + 1),
          accountId: ACCOUNT_ID,
          name,
        })),
      });

      for (let offset = 0; offset < contacts.length; offset += BATCH_SIZE) {
        const batch = contacts.slice(offset, offset + BATCH_SIZE);
        await tx.contact.createMany({
          data: batch.map((contact) => ({
            id: contact.id,
            accountId: ACCOUNT_ID,
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email,
            phone: contact.phone,
            company: contact.company,
            version: 1,
            createdAt: contact.createdAt,
            updatedAt: contact.updatedAt,
          })),
        });
      }

      const tagNameById = new Map<string, string>(
        TAG_NAMES.map((name, index) => [tagUuid(index + 1), name]),
      );

      const assignments: Array<{ contactId: string; tagId: string; assignedAt: Date }> = [];
      const activities: Array<{
        id: string;
        contactId: string;
        accountId: string;
        type: "TAG_ADDED";
        metadata: { tagName: string; tagId: string };
        createdAt: Date;
      }> = [];
      let activityIndex = 0;

      for (const contact of contacts) {
        for (const tagId of contact.tagIds) {
          const tagName = tagNameById.get(tagId) ?? "Unknown";
          assignments.push({ contactId: contact.id, tagId, assignedAt: contact.updatedAt });
          activityIndex += 1;
          activities.push({
            id: activityUuid(activityIndex),
            contactId: contact.id,
            accountId: ACCOUNT_ID,
            type: "TAG_ADDED",
            metadata: { tagName, tagId },
            createdAt: contact.updatedAt,
          });
        }
      }

      for (let offset = 0; offset < assignments.length; offset += BATCH_SIZE) {
        await tx.contactTag.createMany({
          data: assignments.slice(offset, offset + BATCH_SIZE),
        });
      }
      for (let offset = 0; offset < activities.length; offset += BATCH_SIZE) {
        await tx.contactActivity.createMany({
          data: activities.slice(offset, offset + BATCH_SIZE),
        });
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  logger.info(
    {
      accountId: ACCOUNT_ID,
      contacts: contacts.length,
      tags: TAG_NAMES.length,
      tagAssignments: assignmentCount,
      companies: COMPANIES.length,
      durationMs: Date.now() - startedAt,
      fakerSeed: SEED_FAKER_ID,
    },
    "seed completed",
  );
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "seed failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
