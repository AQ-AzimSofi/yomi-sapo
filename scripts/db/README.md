# Database Scripts

## migrate.ts

Brings the local database to the current schema. It runs `CREATE_TABLES_SQL` and then `MIGRATIONS_SQL` from `lib/db/schema.ts`, the same SQL as `GET /api/init-db`, against `DATABASE_URL` in `.env.local`. Every statement is idempotent, so running it again changes nothing.

```bash
npm run db:migrate    # npx tsx scripts/db/migrate.ts
```

It prints the target host and refuses any host other than `localhost` or `127.0.0.1`, so production schema changes stay a deliberate manual step (see the change log below). A new column goes in `MIGRATIONS_SQL` as an `ADD COLUMN IF NOT EXISTS` statement.

---

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

**Publishing a processed book:** the book pipeline (`scripts/epub-to-book.ts`) writes each book into the local `text_entries` only. Choose `[2] Push missing to prod` to copy it to production: every write to a `text_entries` row sets its `updated_at`, so a new or re-processed book is always pushed.

---

## sync-narration.ts

Loads a narration build into the `narration` table, paired with the S3 key of its recording. See "Audiobook Narration" in [../README.md](../README.md) for the whole workflow. It imports the server-only `lib/db/connection.ts`, so it needs the react-server condition:

```bash
npx tsx --conditions=react-server scripts/db/sync-narration.ts --manifest "<book>.narration.json" \
  --audio-key "<book>.m4a" --directory "bookv2-furigana" --file-name "<book>"
```

---

## sync-text-entry.ts

Upserts one book file into `text_entries` on the local database, through `upsertTextEntry` in `lib/db/queries.ts`. The book pipeline runs it after every chunk; run it by hand after editing a book file. It refuses any host other than `localhost` or `127.0.0.1`; use `sync.ts` to push to production. Like `sync-narration.ts`, it needs the react-server condition:

```bash
npx tsx --conditions=react-server scripts/db/sync-text-entry.ts --directory "bookv2-furigana/<book>" \
  --file-name "<book>-rephrase-furigana" --file "public/bookv2-furigana/<book>/<book>-rephrase-furigana.txt"
```

---

## clean-book-text.ts

Normalizes the stored book text in `text_entries`, and every `bookmarks.bookmark_text` the same way so bookmarks keep matching: Windows line endings become LF, and markup junk left by EPUB extraction or the rephrase model is removed. It is a dry run unless `--apply` is given, targets `DATABASE_URL` unless `--prod` is given (then `PROD_DATABASE_URL`), and leaves `updated_at` unchanged so the sync does not treat the cleaned rows as newer.

```bash
npx tsx scripts/db/clean-book-text.ts                  # local, dry run
npx tsx scripts/db/clean-book-text.ts --apply          # local, write
npx tsx scripts/db/clean-book-text.ts --prod --apply   # production, write
```

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

**Today:** `MIGRATIONS_SQL` adds both columns, and `/api/library-progress` recounts any row whose `content_bytes` no longer matches its stored text (including rows never counted), so a database needs no separate backfill.
