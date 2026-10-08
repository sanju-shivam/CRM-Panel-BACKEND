// Request validation schemas for the contacts endpoints.
//
// Sorting fields are whitelisted (never interpolated into SQL), pagination is
// bounded, and unknown body keys are rejected instead of silently ignored.
import { z } from "zod";

export const listContactsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  company: z.string().trim().max(255).optional(),
  tagId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
export type ListContactsQuery = z.output<typeof listContactsQuerySchema>;

export const contactIdParamsSchema = z.object({
  id: z.uuid(),
});
export type ContactIdParams = z.output<typeof contactIdParamsSchema>;

const optionalTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .transform((value) => (value === "" ? null : value));

// Emails are stored lowercased so the (account_id, email) unique index treats
// "John@X.com" and "john@x.com" as the same address.
const optionalEmail = z
  .union([z.string().trim().toLowerCase().pipe(z.email().max(255)), z.literal(""), z.null()])
  .optional()
  .transform((value): string | null | undefined =>
    value === undefined ? undefined : value === "" || value === null ? null : value,
  );

export const updateContactBodySchema = z.strictObject({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: optionalEmail,
  phone: optionalTrimmedText(50),
  company: optionalTrimmedText(255),
  // Optimistic-concurrency token: the version the client loaded.
  version: z.number().int().min(1),
});
export type UpdateContactBody = z.output<typeof updateContactBodySchema>;
