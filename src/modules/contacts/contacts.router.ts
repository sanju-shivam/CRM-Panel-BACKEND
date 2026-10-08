import { Router } from "express";
import { validate } from "../../middleware/validate";
import { contactsController } from "./contacts.controller";
import {
  contactIdParamsSchema,
  listContactsQuerySchema,
  updateContactBodySchema,
} from "./contacts.schemas";

const router = Router();

router.get("/contacts", validate({ query: listContactsQuerySchema }), contactsController.list);

router.get(
  "/contacts/:id",
  validate({ params: contactIdParamsSchema }),
  contactsController.get,
);

router.patch(
  "/contacts/:id",
  validate({ params: contactIdParamsSchema, body: updateContactBodySchema }),
  contactsController.update,
);

router.get(
  "/contacts/:id/activities",
  validate({ params: contactIdParamsSchema }),
  contactsController.activities,
);

export default router;
