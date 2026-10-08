// OpenAPI 3.0 document served at /api-docs (Swagger UI) and /api-docs.json.
//
// Hand-written on purpose: the document is the contract shown to reviewers,
// so every endpoint, parameter, request body, response and error code from
// the specification is spelled out explicitly.

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "requestId"],
      properties: {
        code: {
          type: "string",
          enum: [
            "INVALID_REQUEST",
            "VALIDATION_ERROR",
            "CONTACT_NOT_FOUND",
            "TAG_NOT_FOUND",
            "EMAIL_ALREADY_EXISTS",
            "CONTACT_VERSION_CONFLICT",
            "TAG_ALREADY_ASSIGNED",
            "TAG_NOT_ASSIGNED",
            "INTERNAL_SERVER_ERROR",
          ],
          description: "Machine-readable error code.",
        },
        message: { type: "string", description: "Human-readable explanation." },
        requestId: {
          type: "string",
          description:
            "Correlates this response with the server log entry (also returned in the x-request-id header).",
        },
        details: {
          type: "object",
          additionalProperties: true,
          description: "Optional structured context, e.g. field-level validation issues.",
        },
      },
    },
  },
} as const;

const validationErrorRef = { $ref: "#/components/responses/ValidationError" };
const notFoundRef = { $ref: "#/components/responses/ContactNotFound" };

const paginationSchema = {
  type: "object",
  required: ["page", "pageSize", "total", "totalPages"],
  properties: {
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 },
    total: { type: "integer", description: "Total rows matching the current filters." },
    totalPages: { type: "integer" },
  },
} as const;

const contactTagSchema = {
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
  },
} as const;

const contactSchema = {
  type: "object",
  required: ["id", "firstName", "lastName", "email", "phone", "company", "version", "createdAt", "updatedAt", "tags"],
  properties: {
    id: { type: "string", format: "uuid" },
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string", format: "email", nullable: true },
    phone: { type: "string", nullable: true },
    company: { type: "string", nullable: true },
    version: {
      type: "integer",
      description: "Optimistic-concurrency token. Must be echoed back on PATCH.",
      example: 3,
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    tags: { type: "array", items: { $ref: "#/components/schemas/ContactTag" } },
  },
} as const;

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "CRM Contact Workspace API",
    version: "1.0.0",
    description: [
      "REST API backing the CRM Contact Workspace assignment.",
      "",
      "**Design notes:**",
      "- All list operations (search, filtering, sorting, pagination) are performed by the database.",
      "- `PATCH /contacts/{id}` uses optimistic concurrency: send the `version` you loaded; a stale version returns `409 CONTACT_VERSION_CONFLICT`.",
      "- Email uniqueness is enforced by a PostgreSQL unique constraint on `(accountId, email)`; NULL emails are allowed many times.",
      "- Every mutation writes a `ContactActivity` row inside the same transaction.",
      "- Error responses always use the `{ \"error\": { code, message, requestId } }` envelope.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "Current host" }],
  tags: [
    { name: "Health", description: "Liveness/readiness" },
    { name: "Contacts", description: "Contact list, detail and updates" },
    { name: "Tags", description: "Tag catalogue and assignments" },
    { name: "Activities", description: "Per-contact activity history" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Returns 200 when the API and database are reachable, 503 otherwise.",
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok", "degraded"] },
                    database: { type: "string", enum: ["up", "down"] },
                    uptimeSeconds: { type: "integer" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "503": { description: "Database unreachable" },
        },
      },
    },
    "/api/v1/contacts": {
      get: {
        tags: ["Contacts"],
        summary: "List contacts",
        description:
          "Server-side search across firstName/lastName/email/phone (case-insensitive), filtering by company and tag, whitelisted sorting and offset pagination.",
        parameters: [
          {
            name: "search",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 200 },
            description: "Case-insensitive substring match on first name, last name, email or phone.",
          },
          {
            name: "company",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 255 },
            description: "Case-insensitive substring match on company.",
          },
          {
            name: "tagId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
            description: "Only contacts assigned to this tag.",
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "pageSize",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "sortBy",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["name", "createdAt"], default: "name" },
            description: "Whitelisted sort field - arbitrary fields are rejected.",
          },
          {
            name: "sortOrder",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["asc", "desc"], default: "asc" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated contact list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "pagination"],
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/Contact" } },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "400": validationErrorRef,
        },
      },
    },
    "/api/v1/contacts/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      get: {
        tags: ["Contacts"],
        summary: "Get one contact",
        responses: {
          "200": {
            description: "Contact with assigned tags",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Contact" } },
            },
          },
          "400": validationErrorRef,
          "404": notFoundRef,
        },
      },
      patch: {
        tags: ["Contacts"],
        summary: "Update a contact (optimistic concurrency)",
        description: [
          "Partial update. Omit fields you are not changing.",
          "",
          "- `version` is required and must be the version you loaded.",
          "- The version check and the write happen in a single UPDATE, so a concurrent edit by another client returns `409 CONTACT_VERSION_CONFLICT` instead of silently overwriting.",
          "- Duplicate emails return `409 EMAIL_ALREADY_EXISTS` (database constraint).",
          "- A `CONTACT_UPDATED` activity is recorded in the same transaction.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateContactRequest" },
              example: {
                firstName: "Ada",
                lastName: "Lovelace",
                email: "ada@example.com",
                phone: "+1 555 0100",
                company: "Analytical Engines",
                version: 3,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated contact (version incremented)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Contact" } },
            },
          },
          "400": validationErrorRef,
          "404": notFoundRef,
          "409": {
            description: "CONTACT_VERSION_CONFLICT or EMAIL_ALREADY_EXISTS",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
                examples: {
                  versionConflict: {
                    summary: "Stale version",
                    value: {
                      error: {
                        code: "CONTACT_VERSION_CONFLICT",
                        message:
                          "This contact was modified by another user. Reload the latest version and try again.",
                        requestId: "9f0f6f7e-...",
                      },
                    },
                  },
                  duplicateEmail: {
                    summary: "Email already exists",
                    value: {
                      error: {
                        code: "EMAIL_ALREADY_EXISTS",
                        message: "A contact with this email already exists for this account.",
                        requestId: "9f0f6f7e-...",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/contacts/{id}/activities": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      get: {
        tags: ["Activities"],
        summary: "Activity history for a contact",
        description: "Newest activities first (max 200).",
        responses: {
          "200": {
            description: "Activity list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ContactActivity" },
                    },
                  },
                },
              },
            },
          },
          "400": validationErrorRef,
          "404": notFoundRef,
        },
      },
    },
    "/api/v1/tags": {
      get: {
        tags: ["Tags"],
        summary: "List tags",
        responses: {
          "200": {
            description: "All tags for the current account, sorted by name",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/contacts/{contactId}/tags": {
      parameters: [
        {
          name: "contactId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      post: {
        tags: ["Tags"],
        summary: "Assign a tag to a contact",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tagId"],
                properties: { tagId: { type: "string", format: "uuid" } },
              },
              example: { tagId: "00000000-0000-4000-8000-000000000101" },
            },
          },
        },
        responses: {
          "201": {
            description: "Tag assigned (TAG_ADDED activity written in the same transaction)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagAssignment" },
              },
            },
          },
          "400": validationErrorRef,
          "404": {
            description: "CONTACT_NOT_FOUND or TAG_NOT_FOUND",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "409": {
            description: "TAG_ALREADY_ASSIGNED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/v1/contacts/{contactId}/tags/{tagId}": {
      parameters: [
        {
          name: "contactId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "tagId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      delete: {
        tags: ["Tags"],
        summary: "Remove a tag from a contact",
        responses: {
          "200": {
            description: "Tag removed (TAG_REMOVED activity written in the same transaction)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contactId: { type: "string", format: "uuid" },
                    tagId: { type: "string", format: "uuid" },
                  },
                },
              },
            },
          },
          "404": {
            description: "CONTACT_NOT_FOUND, TAG_NOT_FOUND or TAG_NOT_ASSIGNED",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/v1/contacts/bulk/tags": {
      post: {
        tags: ["Tags"],
        summary: "Assign one tag to many contacts (idempotent)",
        description: [
          "Validates the tag and every contact id, then assigns atomically in a single transaction.",
          "Rows that already have the assignment are skipped (composite primary key + ON CONFLICT DO NOTHING),",
          "activities are written only for newly created rows, and counts are exact.",
          "Repeating the same request is safe: `newlyAssigned` becomes 0.",
        ].join("\n"),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BulkTagRequest" },
              example: {
                tagId: "00000000-0000-4000-8000-000000000101",
                contactIds: [
                  "00000000-0000-4000-8000-000000000001",
                  "00000000-0000-4000-8000-000000000002",
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Assignment result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BulkTagResult" },
                example: {
                  tagId: "00000000-0000-4000-8000-000000000101",
                  requested: 10,
                  newlyAssigned: 7,
                  alreadyAssigned: 3,
                },
              },
            },
          },
          "400": validationErrorRef,
          "404": {
            description:
              "TAG_NOT_FOUND, or CONTACT_NOT_FOUND when any requested contact id does not exist (details.missingIds lists them)",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: errorSchema,
      Pagination: paginationSchema,
      ContactTag: contactTagSchema,
      Contact: contactSchema,
      Tag: {
        type: "object",
        required: ["id", "name", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TagAssignment: {
        type: "object",
        required: ["contactId", "tagId", "assignedAt"],
        properties: {
          contactId: { type: "string", format: "uuid" },
          tagId: { type: "string", format: "uuid" },
          assignedAt: { type: "string", format: "date-time" },
        },
      },
      ContactActivity: {
        type: "object",
        required: ["id", "type", "metadata", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string", enum: ["CONTACT_UPDATED", "TAG_ADDED", "TAG_REMOVED"] },
          metadata: {
            type: "object",
            nullable: true,
            additionalProperties: true,
            examples: [{ changedFields: ["email", "phone"] }, { tagName: "VIP" }],
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      UpdateContactRequest: {
        type: "object",
        required: ["version"],
        additionalProperties: false,
        properties: {
          firstName: { type: "string", minLength: 1, maxLength: 100 },
          lastName: { type: "string", minLength: 1, maxLength: 100 },
          email: {
            type: "string",
            format: "email",
            nullable: true,
            description: "Send null or an empty string to clear the email.",
          },
          phone: { type: "string", maxLength: 50, nullable: true },
          company: { type: "string", maxLength: 255, nullable: true },
          version: {
            type: "integer",
            minimum: 1,
            description: "Version returned by GET /contacts/{id}.",
          },
        },
      },
      BulkTagRequest: {
        type: "object",
        required: ["tagId", "contactIds"],
        additionalProperties: false,
        properties: {
          tagId: { type: "string", format: "uuid" },
          contactIds: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { type: "string", format: "uuid" },
          },
        },
      },
      BulkTagResult: {
        type: "object",
        required: ["tagId", "requested", "newlyAssigned", "alreadyAssigned"],
        properties: {
          tagId: { type: "string", format: "uuid" },
          requested: { type: "integer", description: "Distinct contacts requested." },
          newlyAssigned: { type: "integer", description: "Assignments created by this call." },
          alreadyAssigned: { type: "integer", description: "Assignments that already existed." },
        },
      },
    },
    responses: {
      ValidationError: {
        description: "VALIDATION_ERROR - request input failed schema validation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid request query.",
                requestId: "9f0f6f7e-...",
                details: {
                  issues: [{ path: "page", message: "Too small: expected number to be >= 1" }],
                },
              },
            },
          },
        },
      },
      ContactNotFound: {
        description: "CONTACT_NOT_FOUND",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Error" },
            example: {
              error: {
                code: "CONTACT_NOT_FOUND",
                message: "Contact '00000000-0000-4000-8000-000000000001' does not exist.",
                requestId: "9f0f6f7e-...",
              },
            },
          },
        },
      },
    },
  },
};

export type OpenApiDocument = typeof openApiDocument;
