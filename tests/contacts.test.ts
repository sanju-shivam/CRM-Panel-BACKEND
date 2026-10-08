// Contacts endpoints: list/filter/sort/pagination, detail fetch and the
// optimistic-concurrency update contract (including the mandatory
// version-conflict test).
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { app, IDS, resetDb } from "./helpers";

describe("GET /api/v1/contacts", () => {
  beforeEach(resetDb);

  it("returns the default page sorted by last name", async () => {
    const res = await request(app).get("/api/v1/contacts").expect(200);

    expect(res.body.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.map((contact: { lastName: string }) => contact.lastName)).toEqual([
      "Anderson",
      "Baker",
      "Cruz",
    ]);
  });

  it("search matches first name, last name, email and phone case-insensitively", async () => {
    const byFirstName = await request(app).get("/api/v1/contacts?search=ALICE").expect(200);
    expect(byFirstName.body.pagination.total).toBe(1);
    expect(byFirstName.body.items[0].id).toBe(IDS.contact1);

    const byEmail = await request(app).get("/api/v1/contacts?search=carol@example").expect(200);
    expect(byEmail.body.pagination.total).toBe(1);
    expect(byEmail.body.items[0].id).toBe(IDS.contact3);

    const byPhone = await request(app).get("/api/v1/contacts?search=555-0102").expect(200);
    expect(byPhone.body.pagination.total).toBe(1);
    expect(byPhone.body.items[0].id).toBe(IDS.contact2);
  });

  it("search matches a full name across first and last name", async () => {
    const res = await request(app).get("/api/v1/contacts?search=alice%20anderson").expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.items[0].id).toBe(IDS.contact1);

    const mismatched = await request(app).get("/api/v1/contacts?search=alice%20cruz").expect(200);
    expect(mismatched.body.pagination.total).toBe(0);
  });

  it("filters by company substring, case-insensitively", async () => {
    const res = await request(app).get("/api/v1/contacts?company=itech").expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.items[0].id).toBe(IDS.contact2);
  });

  it("filters by assigned tag", async () => {
    const res = await request(app)
      .get(`/api/v1/contacts?tagId=${IDS.tagLead}`)
      .expect(200);
    expect(res.body.pagination.total).toBe(2);
    const ids = res.body.items.map((contact: { id: string }) => contact.id);
    expect(ids).toContain(IDS.contact1);
    expect(ids).toContain(IDS.contact3);
  });

  it("sorts by createdAt in both directions", async () => {
    const desc = await request(app)
      .get("/api/v1/contacts?sortBy=createdAt&sortOrder=desc")
      .expect(200);
    expect(desc.body.items.map((contact: { lastName: string }) => contact.lastName)).toEqual([
      "Cruz",
      "Baker",
      "Anderson",
    ]);

    const asc = await request(app)
      .get("/api/v1/contacts?sortBy=createdAt&sortOrder=asc")
      .expect(200);
    expect(asc.body.items[0].lastName).toBe("Anderson");
  });

  it("paginates with stable ordering", async () => {
    const res = await request(app).get("/api/v1/contacts?page=2&pageSize=2").expect(200);
    expect(res.body.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].lastName).toBe("Cruz");
  });

  it("returns an empty page when nothing matches", async () => {
    const res = await request(app).get("/api/v1/contacts?search=zzz-not-found").expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("rejects out-of-range pagination", async () => {
    await request(app).get("/api/v1/contacts?page=0").expect(400);
    await request(app).get("/api/v1/contacts?pageSize=101").expect(400);
    await request(app).get("/api/v1/contacts?page=abc").expect(400);
  });

  it("rejects sort fields outside the whitelist", async () => {
    const res = await request(app).get("/api/v1/contacts?sortBy=email").expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a malformed tagId filter", async () => {
    await request(app).get("/api/v1/contacts?tagId=not-a-uuid").expect(400);
  });
});

describe("GET /api/v1/contacts/:id", () => {
  beforeEach(resetDb);

  it("returns the contact with assigned tags", async () => {
    const res = await request(app).get(`/api/v1/contacts/${IDS.contact3}`).expect(200);

    expect(res.body).toMatchObject({
      id: IDS.contact3,
      firstName: "Carol",
      lastName: "Cruz",
      email: "carol@example.com",
      company: "Globex",
      version: 1,
    });
    expect(res.body.tags).toEqual([
      { id: IDS.tagLead, name: "Lead" },
      { id: IDS.tagVip, name: "VIP" },
    ]);
  });

  it("returns null email for contacts without one", async () => {
    const res = await request(app).get(`/api/v1/contacts/${IDS.contact2}`).expect(200);
    expect(res.body.email).toBeNull();
  });

  it("404s for an unknown id", async () => {
    const res = await request(app).get(`/api/v1/contacts/${IDS.unknownContact}`).expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("400s for a non-uuid id", async () => {
    const res = await request(app).get("/api/v1/contacts/not-a-uuid").expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/v1/contacts/:id", () => {
  beforeEach(resetDb);

  it("updates fields, bumps the version and keeps untouched fields", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact2}`)
      .send({ firstName: "Robert", version: 1 })
      .expect(200);

    expect(res.body).toMatchObject({ firstName: "Robert", lastName: "Baker", version: 2 });

    const stored = await prisma.contact.findUnique({ where: { id: IDS.contact2 } });
    expect(stored?.firstName).toBe("Robert");
    expect(stored?.version).toBe(2);
  });

  it("rejects a stale write with 409 and does not overwrite newer data", async () => {
    // First writer wins.
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ lastName: "Updated", version: 1 })
      .expect(200);

    // Second writer still holds version 1 - must conflict.
    const stale = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ lastName: "Clobbered", version: 1 })
      .expect(409);
    expect(stale.body.error.code).toBe("CONTACT_VERSION_CONFLICT");

    // The stale write must not have touched anything.
    const stored = await prisma.contact.findUnique({ where: { id: IDS.contact1 } });
    expect(stored?.lastName).toBe("Updated");
    expect(stored?.version).toBe(2);
  });

  it("lets exactly one of two concurrent writes win", async () => {
    const [first, second] = await Promise.all([
      request(app)
        .patch(`/api/v1/contacts/${IDS.contact1}`)
        .send({ lastName: "WriterA", version: 1 }),
      request(app)
        .patch(`/api/v1/contacts/${IDS.contact1}`)
        .send({ lastName: "WriterB", version: 1 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    expect(winner.body.version).toBe(2);

    const stored = await prisma.contact.findUnique({ where: { id: IDS.contact1 } });
    expect(stored?.version).toBe(2);
    expect(["WriterA", "WriterB"]).toContain(stored?.lastName);
  });

  it("treats a no-op write with the current version as success", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alice", version: 1 })
      .expect(200);

    expect(res.body.version).toBe(1);
    const activities = await prisma.contactActivity.count({
      where: { contactId: IDS.contact1 },
    });
    expect(activities).toBe(0);
  });

  it("still rejects a no-op write when the version is stale", async () => {
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ lastName: "Renamed", version: 1 })
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alice", version: 1 })
      .expect(409);
    expect(res.body.error.code).toBe("CONTACT_VERSION_CONFLICT");
  });

  it("rejects a duplicate email with 409 and rolls back the version", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact2}`)
      .send({ email: "alice@example.com", version: 1 })
      .expect(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_EXISTS");

    const stored = await prisma.contact.findUnique({ where: { id: IDS.contact2 } });
    expect(stored?.email).toBeNull();
    expect(stored?.version).toBe(1);
  });

  it("treats emails differing only in case as duplicates", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact2}`)
      .send({ email: "  Alice@Example.COM ", version: 1 })
      .expect(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("stores emails trimmed and lowercased", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact2}`)
      .send({ email: " Bob.Baker@Example.com ", version: 1 })
      .expect(200);
    expect(res.body.email).toBe("bob.baker@example.com");
  });

  it("allows setting email to null", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ email: null, version: 1 })
      .expect(200);
    expect(res.body.email).toBeNull();
    expect(res.body.version).toBe(2);
  });

  it("rejects a malformed email", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ email: "not-an-email", version: 1 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires the version field", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alice" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown body keys", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alice", version: 1, sneaky: true })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("404s for an unknown contact", async () => {
    const res = await request(app)
      .patch(`/api/v1/contacts/${IDS.unknownContact}`)
      .send({ firstName: "Ghost", version: 1 })
      .expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
  });

  it("records a CONTACT_UPDATED activity with the changed fields", async () => {
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alicia", company: "Acme Intl", version: 1 })
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe("CONTACT_UPDATED");
    expect(res.body.items[0].metadata.changedFields.sort()).toEqual(["company", "firstName"]);
  });

  it("does not record an activity for a conflicted write", async () => {
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ lastName: "First", version: 1 })
      .expect(200);
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ lastName: "Second", version: 1 })
      .expect(409);

    const activities = await prisma.contactActivity.findMany({
      where: { contactId: IDS.contact1 },
    });
    expect(activities).toHaveLength(1);
  });
});
