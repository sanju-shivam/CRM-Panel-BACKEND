// Request validation schemas for tag endpoints.
//
// Bulk assignment is hard-bounded (100 contacts) so a single request can
// never pin a transaction open for an unreasonable amount of time.
import { z } from "zod";

export const contactIdParamsSchema = z.object({
  contactId: z.uuid(),
});

export const removeTagParamsSchema = z.object({
  contactId: z.uuid(),
  tagId: z.uuid(),
});

export const addTagBodySchema = z.strictObject({
  tagId: z.uuid(),
});
export type AddTagBody = z.output<typeof addTagBodySchema>;

export const bulkAssignBodySchema = z.strictObject({
  tagId: z.uuid(),
  contactIds: z.array(z.uuid()).min(1).max(100),
});
export type BulkAssignBody = z.output<typeof bulkAssignBodySchema>;
