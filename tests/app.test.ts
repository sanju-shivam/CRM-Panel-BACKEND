// Cross-cutting HTTP behaviour: health checks, error envelope, unknown
// routes and the Swagger document.
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app, IDS } from "./helpers";

describe("health", () => {
  it("GET /health reports the database as up", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  it("GET /api/v1/health is mounted under the API prefix too", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("error envelope", () => {
  it("unknown routes return INVALID_REQUEST with a request id", async () => {
    const res = await request(app).get("/api/v1/nope").expect(404);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error.message).toContain("/api/v1/nope");
  });

  it("methods outside the contract are not registered", async () => {
    await request(app).post("/api/v1/contacts").send({}).expect(404);
    await request(app).delete(`/api/v1/contacts/${IDS.contact1}`).expect(404);
  });

  it("malformed JSON bodies return INVALID_REQUEST", async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${IDS.contact1}/tags`)
      .set("Content-Type", "application/json")
      .send("{definitely not json")
      .expect(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
    expect(res.body.error.message).toContain("JSON");
  });

  it("never leaks stack traces", async () => {
    const res = await request(app).get("/api/v1/contacts/not-a-uuid").expect(400);
    expect(JSON.stringify(res.body)).not.toContain("at ");
    expect(JSON.stringify(res.body)).not.toContain(".ts:");
  });
});

describe("swagger", () => {
  it("serves the OpenAPI document", async () => {
    const res = await request(app).get("/api-docs.json").expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toHaveProperty("/api/v1/contacts");
    expect(res.body.paths).toHaveProperty("/api/v1/contacts/bulk/tags");
    expect(res.body.paths).toHaveProperty("/api/v1/contacts/{id}/activities");
  });

  it("serves the interactive UI", async () => {
    const res = await request(app).get("/api-docs/").expect(200);
    expect(res.text).toContain("swagger-ui");
  });
});
