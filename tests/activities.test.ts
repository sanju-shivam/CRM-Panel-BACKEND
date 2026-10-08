// Activity feed: ordering, metadata shape, limit and error handling.
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma";
import { ACCOUNT_ID, app, IDS, resetDb } from "./helpers";

describe("GET /api/v1/contacts/:id/activities", () => {
  beforeEach(resetDb);

  it("returns an empty feed before anything happened", async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("returns newest first across mutation types", async () => {
    await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .send({ tagId: IDS.tagVip })
      .expect(201);
    await request(app)
      .patch(`/api/v1/contacts/${IDS.contact1}`)
      .send({ firstName: "Alicia", version: 1 })
      .expect(200);
    await request(app)
      .delete(`/api/v1/contacts/${IDS.contact1}/tags/${IDS.tagVip}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);

    expect(res.body.items.map((activity: { type: string }) => activity.type)).toEqual([
      "TAG_REMOVED",
      "CONTACT_UPDATED",
      "TAG_ADDED",
    ]);
    expect(res.body.items[0]).toMatchObject({
      metadata: { tagName: "VIP", tagId: IDS.tagVip },
    });
    expect(res.body.items[1].metadata.changedFields).toEqual(["firstName"]);
    for (const activity of res.body.items) {
      expect(typeof activity.id).toBe("string");
      expect(typeof activity.createdAt).toBe("string");
    }
  });

  it("caps the feed at 200 entries, newest first", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 250 }, (_, index) => ({
      contactId: IDS.contact1,
      accountId: ACCOUNT_ID,
      type: "CONTACT_UPDATED" as const,
      metadata: { changedFields: [`field${index}`] },
      createdAt: new Date(now - index * 1000),
    }));
    await prisma.contactActivity.createMany({ data: rows });

    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.contact1}/activities`)
      .expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.items[0].metadata.changedFields).toEqual(["field0"]);
    expect(res.body.items[199].metadata.changedFields).toEqual(["field199"]);
  });

  it("404s for an unknown contact", async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${IDS.unknownContact}/activities`)
      .expect(404);
    expect(res.body.error.code).toBe("CONTACT_NOT_FOUND");
  });

  it("400s for a non-uuid id", async () => {
    await request(app).get("/api/v1/contacts/nope/activities").expect(400);
  });
});
