# Database Scripts

## migrate.ts

Brings the local database to the current schema. It applies `schemaStatementsFor('postgres')` from `lib/db/schema.ts` through `lib/db/schemaRunner.ts`, one statement per call, the same as `GET /api/init-db`, against `DATABASE_URL` in `.env.local`. Every statement is idempotent, so running it again changes nothing.

```bash
npm run db:migrate    # npx tsx scripts/db/migrate.ts
```

It prints the target host and refuses any host other than `localhost` or `127.0.0.1`, so production schema changes stay a deliberate manual step (see the change log below).

The statements are written for Aurora DSQL, and the runner drops `ASYNC` from `CREATE INDEX ASYNC` on PostgreSQL. A new database gets `INT` ids from `CACHE 1` sequences and one index per `UNIQUE (file_name, directory)`. A database an older schema created keeps its `SERIAL` ids and extra indexes, and `POSTGRES_UPGRADE_STATEMENTS` brings its columns up to date on PostgreSQL only. A new column must also work on DSQL: a bare `ADD COLUMN IF NOT EXISTS`, then `ALTER COLUMN ... SET DEFAULT`, then a backfill in batches, each its own statement. DSQL refuses `ADD COLUMN` with a `DEFAULT` or `NOT NULL`, any `ADD CONSTRAINT`, and two DDL statements (or DDL and DML) in one transaction.

Run the DSQL integration tests one file at a time (`npx vitest run --no-file-parallelism lib/db scripts/db`): each creates and drops a scratch schema, and on DSQL a catalog change fails every other open session's next statement with OC001.

`lib/db/schemaRunner.integration.test.ts` applies the schema twice into a scratch schema it drops afterwards. It runs only when `SCHEMA_TEST_DATABASE_URL` names a throwaway PostgreSQL database or `DSQL_TEST_ENDPOINT` names a DSQL test cluster.

---

## apply-schema-dsql.ts

Applies the same statements to an Aurora DSQL cluster as `admin`, waiting for each `CREATE INDEX ASYNC` job. The app's `yomi_app` role cannot run DDL, so `GET /api/init-db` answers `409` on DSQL and schema changes go through this script.

```bash
npx tsx scripts/db/apply-schema-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws
```

It signs an admin IAM token with the default AWS credentials, which need `dsql:DbConnectAdmin` on the cluster, and refuses anything but a DSQL endpoint. Run it while the app serves no traffic: after a DDL statement, the next statement of an app session can fail once with `OC001`.

---

## copy-to-dsql.ts

Copies every app table (`COPY_TABLES` in `copyTables.ts`: `bookmarks`, `text_entries`, `narration`, `vocabulary_entries`) from a PostgreSQL database into an Aurora DSQL cluster, compares every row of the two, then moves the cluster's id sequences past the copied ids. It is the data step of the move to DSQL; see [../../docs/dsql-cutover.md](../../docs/dsql-cutover.md). Apply the schema first with `apply-schema-dsql.ts`.

```bash
SOURCE_URL='<postgres url>' npx tsx scripts/db/copy-to-dsql.ts --endpoint <cluster id>.dsql.<region>.on.aws [--delete-extra]
```

- It reads the source only in `REPEATABLE READ READ ONLY` transactions, and refuses a Neon pooled (`-pooler`) host. It refuses any target but a DSQL endpoint, and connects there as `admin` with a token from the default AWS credentials.
- It first checks that both databases hold the same columns for each table, and that the target has no table that neither `COPY_TABLES` nor `IMPORTED_TABLES` names. A table added to the schema later needs an entry in one of them before the copy runs again.
- It leaves the tables in `IMPORTED_TABLES` alone and names the script that fills each: `ruby_registry_entries`, which Neon does not have, comes from `import-ruby-registry.ts`.
- Every value travels as text (`::text`) and is cast to the target column's type, so timestamps are not shifted by the machine's time zone and `jsonb` is not stored as a JSON string.
- A book too large for one DSQL value stops it before anything is written. A book's `content_bytes` is copied only while it equals the size of its text, and as NULL otherwise, so the library recounts that book.
- Rows are upserted on their `id` in transactions of at most 1,000 rows and 4 MiB of text, each run again on a write conflict (40001). Only rows that are missing or different in the target are written, so a second run sends just what changed.
- Rows the target holds and the source does not are reported, and deleted only with `--delete-extra`.
- The verification reads every row of both databases again and compares a hash of each. It ends with `Every row is identical.` and exit code 0, or lists the keys of the missing, extra and different rows and exits 1.

`copy-to-dsql.integration.test.ts` copies a database into a scratch schema of a DSQL test cluster, which it drops afterwards. It runs only when `COPY_TEST_SOURCE_URL` names a throwaway PostgreSQL database and `DSQL_TEST_ENDPOINT` names a DSQL test cluster.

---

## import-ruby-registry.ts

Loads every `ruby-registry.json` under a folder (`public` by default) into `ruby_registry_entries`, the table the reader's word lookup panel, its sticky notes and the `/ruby-registry` page read through `/api/ruby-registry`. A file at `<folder>/bookv2-furigana/<book>/ruby-registry.json` becomes the registry with directory `bookv2-furigana` and book name `<book>`, the key the reader uses (`rubyRegistryKey` in `lib/books/bookRef.ts`). `public/` never deploys, so this is how a registry reaches production.

```bash
npx tsx scripts/db/import-ruby-registry.ts [folder]                  # local, dry run
npx tsx scripts/db/import-ruby-registry.ts [folder] --apply          # local, write
npx tsx scripts/db/import-ruby-registry.ts [folder] --prod --apply   # Aurora DSQL production, write
```

- It reads and checks every file before it connects, and stops at a file the table could not store: a word or reading longer than 255 characters, an unknown `source`, a word listed twice, or a file outside a book folder.
- It only inserts the words the table lacks (`ON CONFLICT DO NOTHING`), in statements of at most 500 rows, each sent again on a write conflict (40001). It never overwrites a row: a reading the owner edited stays, and a word the owner deleted or ignored stays hidden, because those rows are kept with `ignored` set. Running it again inserts nothing.
- It prints one line per book and the totals: new, unchanged, deleted or ignored by the owner, and different in the database (kept).
- Without `--prod` it writes to `DATABASE_URL` and refuses any host but `localhost` or `127.0.0.1`. `--prod` needs `PROD_DSQL_ENDPOINT`: production on Neon has no registry table, so the script refuses it.
- A database without the table gets a message to apply the schema first (`npm run db:migrate`, or `apply-schema-dsql.ts` on DSQL).

The registry table is not part of the dev sync, so a registry edit stays in the database it was made in.

`import-ruby-registry.integration.test.ts` imports into a scratch schema of a throwaway PostgreSQL database (`REGISTRY_IMPORT_TEST_LOCAL_URL`) and of a DSQL test cluster (`DSQL_TEST_ENDPOINT`). `lib/db/rubyRegistryQueries.integration.test.ts` runs the app's registry queries in a scratch schema, first without the table, on `DSQL_TEST_ENDPOINT` or else `REGISTRY_TEST_DATABASE_URL`.

---

## sync.ts

Interactive sync between production and local (Docker PG15). Production is Neon (PG17), or Aurora DSQL when `PROD_DSQL_ENDPOINT` is set. It shows the differences per table, then pulls, pushes or does both. `npm run dev` runs the same sync when it starts and stops (`scripts/dev-with-sync.ts`).

```bash
npm run db:sync    # npx tsx scripts/db/sync.ts
```

**Tables synced** (`TABLES` in `lib/db/sync-core.ts`): `bookmarks`, `vocabulary_entries`, `text_entries`

Every table is last-write-wins on `updated_at`: a row is copied when the other side lacks it or holds an older copy. Only changed rows are sent. The old Prisma tables (`"Book"`, `"BookImage"`, `"ProcessingHistory"`, `"UserBookmark"`) still exist but are not synced.

How rows are written, on Neon and DSQL alike:
- Each statement carries at most 1 MiB of parameters and 25 rows, so most books go one per statement, under DSQL's 10 MiB message and transaction limits.
- A statement that hits a write conflict (40001) is sent again. An over-long message (08P01), after which DSQL drops the connection, stops the sync with that error. A dropped connection is logged instead of crashing the process.
- A new row gets its `id` from the target's sequence; rows are matched on `(file_name, directory)` or the vocabulary `id`, never on the serial id. Earlier versions of the sync sent the local ids, which never moved Neon's sequences, so a target sequence that lags behind the table's largest id is first moved past it. One that is ahead is left alone.
- A book's `content_bytes` is copied only while it equals the size of its text, and as NULL otherwise.
- A push leaves out a book too large for one DSQL value and counts it as failed; a pull takes it.

**Requirements:**
- `PROD_DSQL_ENDPOINT` (with AWS credentials in the local profile) or `PROD_DATABASE_URL` in `.env.local`
- `DATABASE_URL` in `.env.local` (local Docker)
- Local DB running (`npm run db:start`)

`lib/db/sync-core.integration.test.ts` pushes and pulls between a throwaway PostgreSQL database (`SYNC_TEST_LOCAL_URL`, which the pull writes to) and a scratch schema of a DSQL test cluster (`DSQL_TEST_ENDPOINT`), and drops the schema afterwards.

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

Normalizes the stored book text in `text_entries`, and every `bookmarks.bookmark_text` the same way so bookmarks keep matching: Windows line endings become LF, and markup junk left by EPUB extraction or the rephrase model is removed. It is a dry run unless `--apply` is given, targets `DATABASE_URL` unless `--prod` is given (then `PROD_DSQL_ENDPOINT` or `PROD_DATABASE_URL`, as the sync does), and leaves `updated_at` unchanged so the sync does not treat the cleaned rows as newer. It clears `content_bytes` of each book it rewrites, so the library recounts it. Each book is written by its own compare-and-set statement, which skips a book that changed after it was read, and the bookmarks by one more; each statement is sent again on a write conflict (40001).

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

**Today:** `POSTGRES_UPGRADE_STATEMENTS` in `lib/db/schema.ts` adds both columns, and `/api/library-progress` recounts any row whose `content_bytes` is NULL or no longer matches its stored text, so a database needs no separate backfill.
