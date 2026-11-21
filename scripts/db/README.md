# Database Scripts

## sync.ts

Interactive sync between production (Neon PG17) and local (Docker PG15). It shows the differences per table, then pulls, pushes or does both. `npm run dev` runs the same sync when it starts and stops (`scripts/dev-with-sync.ts`).

```bash
npm run db:sync    # npx tsx scripts/db/sync.ts
```

**Tables synced** (`TABLES` in `lib/db/sync-core.ts`): `bookmarks`, `vocabulary_entries`, `text_entries`

Every table is last-write-wins on `updated_at`: a row is copied when the other side lacks it or holds an older copy. Only changed rows are sent. The old Prisma tables (`"Book"`, `"BookImage"`, `"ProcessingHistory"`, `"UserBookmark"`) still exist but are not synced.

**Requirements:**
- `PROD_DATABASE_URL` in `.env.local`
- `DATABASE_URL` in `.env.local` (local Docker)
- Local DB running (`npm run db:start`)

---

## Prod Database Change Log

### 2026-03-08: Add missing columns + backfill text_entries metadata

**What was changed:**
- Added two columns to the `text_entries` table in prod (Neon):
  ```sql
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_pages INT DEFAULT 0;
  ALTER TABLE text_entries ADD COLUMN IF NOT EXISTS total_characters INT DEFAULT 0;
  ```
- Backfilled `total_pages` and `total_characters` for all 23 existing rows

**How it was done:**
1. Connected to prod via `docker run --rm postgres:17-alpine psql '<NEON_URL>'` and ran the ALTER TABLE statements
2. Ran a local script that:
   - Fetched all rows from prod `text_entries` where `total_pages = 0 OR total_pages IS NULL`
   - For each row, ran `computeTextMetadata()` (from `lib/db/queries.ts`) on the content to calculate page count and character count
   - Updated each row in prod with the computed values

**Why:**
The `/api/library-progress` route queries `total_pages` and `total_characters` from `text_entries`. These columns existed locally (added by `init-db`) but were never applied to prod, causing a 500 error on the library page.
