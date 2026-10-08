# CRM Contact Workspace: API

Express 5 + TypeScript + Prisma 7 + PostgreSQL. OpenAPI docs at `/api-docs`.

## Local development

Requires Node 24.15+ (see `.nvmrc`) and PostgreSQL (Docker is easiest).

```bash
cp .env.example .env
npm install
docker compose up -d        # PostgreSQL 16 on localhost:5432
npm run db:generate         # Prisma client (git-ignored)
npm run db:migrate
npm run db:seed             # 1,200 deterministic contacts, 8 tags
npm run dev                 # http://localhost:3000, docs at /api-docs
```

## Tests

```bash
npm test          # Vitest + Supertest, 62 tests
npm run typecheck
```

Tests always use the local `crm_test` database (pinned by `.env.test`). They
create and drop it themselves and refuse to run against Supabase.

## Environment variables

| Key | Purpose |
|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | runtime (Render sets `PORT`) |
| `CORS_ORIGIN` | frontend origin(s), comma-separated |
| `DEFAULT_ACCOUNT_ID` | tenant for every request (no auth) |
| `DATABASE_URL` | runtime connection |
| `DIRECT_URL` | migrations (Prisma CLI) |
| `SEED_CONFIRM=yes` | needed to seed a Supabase database |

## Deploy to Render

`render.yaml` is a Blueprint: Render → **New → Blueprint** → this repo.
Enter these when prompted:

- `DATABASE_URL`: Supabase **transaction pooler** (port 6543) +
  `?pgbouncer=true&connection_limit=5`
- `DIRECT_URL`: Supabase **session pooler** (port 5432)
- `CORS_ORIGIN`: the frontend URL (e.g. `https://crm-web.onrender.com`)

Use the pooler URLs, not `db.<ref>.supabase.co`: that host is IPv6-only and
Render can't reach it. Each deploy runs `prisma migrate deploy` before
starting. Seeding is manual:
`SEED_CONFIRM=yes npm run db:seed` from your machine.

Check: `https://<api>/health` → `{"status":"ok","database":"up"}`.
