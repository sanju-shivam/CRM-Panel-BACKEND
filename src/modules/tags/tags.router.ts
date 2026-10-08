// Tag endpoints.
//
// NOTE: `/contacts/bulk/tags` is registered before `/contacts/:contactId/tags`
// so that "bulk" is never captured as a contactId (Express matches routes in
// registration order).
import type { Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { validate, validated } from "../../middleware/validate";
import {
  addTagBodySchema,
  bulkAssignBodySchema,
  contactIdParamsSchema,
  removeTagParamsSchema,
} from "./tags.schemas";
import type { AddTagBody, BulkAssignBody } from "./tags.schemas";
import * as tagsService from "./tags.service";

const tagsController = {
  list: (async (_req: Request, res: Response) => {
    res.json(await tagsService.listAccountTags());
  }) as RequestHandler,

  bulkAssign: (async (req: Request, res: Response) => {
    const body = validated<BulkAssignBody>(req, "body");
    res.json(await tagsService.bulkAssignTag(body));
  }) as RequestHandler,

  add: (async (req: Request, res: Response) => {
    const { contactId } = validated<{ contactId: string }>(req, "params");
    const { tagId } = validated<AddTagBody>(req, "body");
    const assignment = await tagsService.addTagToContact(contactId, tagId);
    res.status(201).json(assignment);
  }) as RequestHandler,

  remove: (async (req: Request, res: Response) => {
    const { contactId, tagId } = validated<{ contactId: string; tagId: string }>(req, "params");
    res.json(await tagsService.removeTagFromContact(contactId, tagId));
  }) as RequestHandler,
};

const router = Router();

router.get("/tags", tagsController.list);

// Bulk route must come first - see file header.
router.post(
  "/contacts/bulk/tags",
  validate({ body: bulkAssignBodySchema }),
  tagsController.bulkAssign,
);

router.post(
  "/contacts/:contactId/tags",
  validate({ params: contactIdParamsSchema, body: addTagBodySchema }),
  tagsController.add,
);

router.delete(
  "/contacts/:contactId/tags/:tagId",
  validate({ params: removeTagParamsSchema }),
  tagsController.remove,
);

export default router;
