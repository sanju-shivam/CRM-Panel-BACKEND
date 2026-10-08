// Tag endpoints: listing, single assignment/removal (idempotency + errors)
// and bulk assignment counts.
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app, IDS, resetDb } from "./helpers";

describe("GET /api/v1/tags", () => {
  beforeEach(resetDb);

  it("lists account tags sorted by name", async () => {
    const res = await request(app).get("/api/v1/tags").expect(200);
    expect(res.body.items.map((tag: { name: string }) => tag.name)).toEqual([
      "Customer",
      "Lead",
      "VIP",
    ]);
    expect(res.body.items[0]).toHaveProperty("id");
    expect(res.body.items[0]).toHaveProperty("createdAt");
  });
});

describe("POST /api/v1/contacts/:contactId/tags", () => {
  beforeEach(resetDb);

  it("assigns a tag and returns 201 with the assignment", async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${IDS.contact2}/tags`)
      .send({ tagId: IDS.tagCustomer })
      .expect(201);

    expect(res.body).toMatchObject({
      contactId: IDS.contact2,
      tagId: IDS.tagCustomer,
    });
    expect(typeof res.body.assignedAt).toBe("string");

    const contact = await request(app)
      .get(`/api/v1/contacts/${IDS.contact2}`)
      .expect(200);
    expect(contact.body.tags).toEqual([{ id: IDS.tagCustomer, name: "Customer" }]);
  });

  it("rejects a duplicate assignment with 409", async () => {
    await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({ tagId: IDS.tagVip })
      .expect(201);

    const res = await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({ tagId: IDS.tagVip })
      .expect(409);
    expect(res.body.error.code).toBe("TAG_ALREADY_ASSIGNED");
  });

  it("404s for an unknown tag", async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({ tagId: IDS.unknownTag })
      .expect(404);
    expect(res.body.error.code).toBe("TAG_NOT_FOUND");
  });

  it("404s for an unknown contact", async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${IDS.unknownContact}/tags`)
      .send({ tagId: IDS.tagLead })
      .expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
  });

  it("rejects a missing or malformed tagId", async () => {
    await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({})
      .expect(400);
    await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({ tagId: "nope" })
      .expect(400);
  });

  it("records a TAG_ADDED activity with the tag name", async () => {
    await request(app)
      .post(`/api/v1/contacts/${IDS.contact2}/tags`)
      .send({ tagId: IDS.tagVip })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact2}/activities`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe("TAG_ADDED");
    expect(res.body.items[0].metadata).toEqual({ tagName: "VIP", tagId: IDS.tagVip });
  });
});

describe("DELETE /api/v1/contacts/:contactId/tags/:tagId", () => {
  beforeEach(resetDb);

  it("removes an assigned tag", async () => {
    const res = await request(app)
      .delete(`/api/v1/contacts/${IDS.contact1}/tags/${IDS.tagLead}`)
      .expect(200);
    expect(res.body).toEqual({ contactId: IDS.contact1, tagId: IDS.tagLead });

    const contact = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}`)
      .expect(200);
    expect(contact.body.tags).toEqual([]);
  });

  it("lets exactly one of two concurrent removals succeed", async () => {
    const url = `/api/v1/contacts/${IDS.contact1}/tags/${IDS.tagLead}`;
    const [first, second] = await Promise.all([
      request(app).delete(url),
      request(app).delete(url),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 404]);
    const loser = first.status === 404 ? first : second;
    expect(loser.body.error.code).toBe("TAG_NOT_ASSIGNED");
  });

  it("404s when the tag is not assigned", async () => {
    const res = await request(app)
      .delete(`/api/v1/contacts/${IDS.contact1}/tags/${IDS.tagVip}`)
      .expect(404);
    expect(res.body.error.code).toBe("TAG_NOT_ASSIGNED");
  });

  it("404s for an unknown tag", async () => {
    const res = await request(app)
      .delete(`/api/v1/contacts/${IDS.contact1}/tags/${IDS.unknownTag}`)
      .expect(404);
    expect(res.body.error.code).toBe("TAG_NOT_FOUND");
  });

  it("404s for an unknown contact", async () => {
    const res = await request(app)
      .delete(`/api/v1/contacts/${IDS.unknownContact}/tags/${IDS.tagLead}`)
      .expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
  });

  it("records a TAG_REMOVED activity", async () => {
    await request(app)
      .delete(`/api/v1/contacts/${IDS.contact1}/tags/${IDS.tagLead}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);
    expect(res.body.items[0].type).toBe("TAG_REMOVED");
    expect(res.body.items[0].metadata).toEqual({ tagName: "Lead", tagId: IDS.tagLead });
  });
});

describe("POST /api/v1/contacts/bulk/tags", () => {
  beforeEach(resetDb);

  const bulk = (tagId: string, contactIds: string[]) =>
    request(app).post("/api/v1/contacts/bulk/tags").send({ tagId, contactIds });

  it("assigns to many contacts and counts new vs already-assigned", async () => {
    // contact3 already has VIP; contactIds contains a duplicate entry.
    const res = await bulk(IDS.tagVip, [IDS.contact1, IDS.contact2, IDS.contact3, IDS.contact2]).expect(200);

    expect(res.body).toEqual({
      tagId: IDS.tagVip,
      requested: 3,
      newlyAssigned: 2,
      alreadyAssigned: 1,
    });
  });

  it("is idempotent on re-run", async () => {
    await bulk(IDS.tagVip, [IDS.contact1, IDS.contact2, IDS.contact3]).expect(200);
    const again = await bulk(IDS.tagVip, [IDS.contact1, IDS.contact2, IDS.contact3]).expect(200);

    expect(again.body).toEqual({
      tagId: IDS.tagVip,
      requested: 3,
      newlyAssigned: 0,
      alreadyAssigned: 3,
    });
  });

  it("writes TAG_ADDED activities only for new assignments", async () => {
    await bulk(IDS.tagCustomer, [IDS.contact1, IDS.contact2]).expect(200);
    await bulk(IDS.tagCustomer, [IDS.contact1, IDS.contact2]).expect(200);

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].type).toBe("TAG_ADDED");
    expect(res.body.items[0].metadata.tagName).toBe("Customer");
  });

  it("404s for an unknown tag", async () => {
    const res = await bulk(IDS.unknownTag, [IDS.contact1]).expect(404);
    expect(res.body.error.code).toBe("TAG_NOT_FOUND");
  });

  it("404s and lists missing contacts when some ids do not exist", async () => {
    const res = await bulk(IDS.tagLead, [IDS.contact1, IDS.unknownContact]).expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
    expect(res.body.error.details.missingIds).toEqual([IDS.unknownContact]);
  });

  it("rejects an empty, oversized or malformed payload", async () => {
    await bulk(IDS.tagLead, []).expect(400);

    const manyIds = Array.from({ length: 101 }, (_, index) =>
      `00000000-0000-4000-8000-00000000${String(index).padStart(4, "0")}`,
    );
    await bulk(IDS.tagLead, manyIds).expect(400);

    await request(app)
      .post("/api/v1/contacts/bulk/tags")
      .send({ tagId: "nope", contactIds: [IDS.contact1] })
      .expect(400);
  });
});
