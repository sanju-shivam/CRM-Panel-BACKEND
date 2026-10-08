// Prisma client singleton.
//
// The application only ever talks to the database through this client (via
// repositories). Prisma 7 requires an explicit driver adapter, which also
// gives us plain `pg` connection tuning knobs later on.
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { Prisma, PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
