// Thin HTTP layer: parse input (already validated by middleware), call the
// service, serialise the result. Controllers never touch Prisma.
import type { Request, RequestHandler, Response } from "express";
import { validated } from "../../middleware/validate";
import type { ContactIdParams, ListContactsQuery, UpdateContactBody } from "./contacts.schemas";
import * as contactsService from "./contacts.service";

export const contactsController = {
  list: (async (req: Request, res: Response) => {
    const query = validated<ListContactsQuery>(req, "query");
    res.json(await contactsService.listContactsPage(query));
  }) as RequestHandler,

  get: (async (req: Request, res: Response) => {
    const { id } = validated<ContactIdParams>(req, "params");
    res.json(await contactsService.getContact(id));
  }) as RequestHandler,

  update: (async (req: Request, res: Response) => {
    const { id } = validated<ContactIdParams>(req, "params");
    const body = validated<UpdateContactBody>(req, "body");
    res.json(await contactsService.updateContact(id, body));
  }) as RequestHandler,

  activities: (async (req: Request, res: Response) => {
    const { id } = validated<ContactIdParams>(req, "params");
    res.json(await contactsService.getContactActivities(id));
  }) as RequestHandler,
};
