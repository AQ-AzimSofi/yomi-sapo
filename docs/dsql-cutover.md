# Moving production from Neon to Aurora DSQL

This runbook moves the production database from Neon (PostgreSQL 17, us-east-1) to an Aurora DSQL cluster in Tokyo (`ap-northeast-1`). The app code for both is already merged. Production stays on Neon until step 8 sets the cluster id in `sst.config.ts`, and nothing in this runbook writes to Neon.

Steps marked **[owner]** need the owner's go-ahead: they create billable AWS resources, read the production database, change what production runs on, or delete something. The other steps run only after the owner has approved the step before them.

## What is already in place

- `lib/db/connection.ts` connects to DSQL only when `DSQL_ENDPOINT` is set. `sst.config.ts` sets it (plus `DSQL_USER=yomi_app`, `DSQL_REGION` and `dsql:DbConnect` on the cluster) only when `PRODUCTION_DSQL_CLUSTER_ID` is not empty. `DATABASE_URL` (Neon) stays set either way, which is what makes rollback a redeploy.
- `scripts/db/apply-schema-dsql.ts` applies `lib/db/schema.ts` as `admin`.
- `scripts/db/copy-to-dsql.ts` copies every app table from PostgreSQL into DSQL, compares every row and moves the id sequences.
- The local tools (`npm run db:sync`, the `npm run dev` sync, `/api/db-sync`, `clean-book-text --prod`) use DSQL when `PROD_DSQL_ENDPOINT` is set in `.env.local`, and `PROD_DATABASE_URL` (Neon) otherwise.

## Before you start

Use Git Bash from the repository root, with AWS credentials for the production account that may create DSQL clusters, AWS Backup resources and IAM roles, and connect to DSQL as admin (`dsql:DbConnectAdmin`). Docker must be running: the `psql` commands run in `postgres:17-alpine`.

```bash
export AWS_REGION=ap-northeast-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export SERVER_FUNCTION=$(aws lambda list-functions --region $AWS_REGION \
  --query "Functions[?starts_with(FunctionName, 'yomi-sapo-production-YomiSapoDefaultFunction')].FunctionName | [0]" --output text)
export SERVER_ROLE_ARN=$(aws lambda get-function-configuration --region $AWS_REGION --function-name "$SERVER_FUNCTION" --query Role --output text)
echo "$SERVER_FUNCTION $SERVER_ROLE_ARN"
```

`SERVER_FUNCTION` is the Next.js server function (`yomi-sapo-production-YomiSapoDefaultFunction-...`), and `SERVER_ROLE_ARN` its role (`arn:aws:iam::<account>:role/yomi-sapo-production-YomiSapoDefaultRole-...`).

## 1. Create the production cluster **[owner]**

```bash
aws dsql create-cluster --region $AWS_REGION --deletion-protection-enabled \
  --tags Name=yomi-sapo-production,App=yomi-sapo
```

Note the `identifier` in the answer, then:

```bash
export CLUSTER_ID=<identifier>
export ENDPOINT=$CLUSTER_ID.dsql.$AWS_REGION.on.aws
export CLUSTER_ARN=arn:aws:dsql:$AWS_REGION:$ACCOUNT_ID:cluster/$CLUSTER_ID
aws dsql wait cluster-active --region $AWS_REGION --identifier $CLUSTER_ID
aws dsql get-cluster --region $AWS_REGION --identifier $CLUSTER_ID \
  --query '{status:status,deletionProtectionEnabled:deletionProtectionEnabled}'
```

Expect `ACTIVE` and `true`. Deletion protection means the cluster cannot be deleted until it is turned off with `aws dsql update-cluster --no-deletion-protection-enabled`.

A helper for the `psql` steps below. It signs an admin token for each call and checks the server certificate:

```bash
dsql_psql() {
  PGPASSWORD="$(aws dsql generate-db-connect-admin-auth-token --region $AWS_REGION --hostname "$ENDPOINT" --expires-in 900)" \
    docker run --rm -i -e PGPASSWORD postgres:17-alpine \
    psql "host=$ENDPOINT port=5432 user=admin dbname=postgres sslmode=verify-full sslrootcert=system" -v ON_ERROR_STOP=1 "$@"
}
dsql_psql -c "SELECT current_user, version()"
```

## 2. Back up the cluster with AWS Backup **[owner]**

`pg_dump` does not work against DSQL (it stops at once with `setting configuration parameter "synchronize_seqscans" not supported`), so backups come from AWS Backup. DSQL is opted in for AWS Backup in `ap-northeast-1` (`aws backup describe-region-settings --query ResourceTypeOptInPreference.DSQL` printed `true` on 2026-11-22); if it prints `false`, run `aws backup update-region-settings --region $AWS_REGION --resource-type-opt-in-preference DSQL=true` first.

A vault, a role AWS Backup acts as (the account has no `AWSBackupDefaultServiceRole`; the two AWS managed policies include the DSQL backup and restore actions), and a daily plan kept 35 days:

```bash
aws backup create-backup-vault --region $AWS_REGION --backup-vault-name yomi-sapo-dsql

cat > backup-trust.json <<'EOF'
{"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "backup.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
EOF
aws iam create-role --role-name yomi-sapo-backup --assume-role-policy-document file://backup-trust.json
aws iam attach-role-policy --role-name yomi-sapo-backup \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup
aws iam attach-role-policy --role-name yomi-sapo-backup \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
export BACKUP_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/yomi-sapo-backup

cat > backup-plan.json <<'EOF'
{
  "BackupPlanName": "yomi-sapo-dsql",
  "Rules": [{
    "RuleName": "daily-keep-35-days",
    "TargetBackupVaultName": "yomi-sapo-dsql",
    "ScheduleExpression": "cron(0 4 * * ? *)",
    "ScheduleExpressionTimezone": "Asia/Tokyo",
    "StartWindowMinutes": 60,
    "CompletionWindowMinutes": 360,
    "Lifecycle": {"DeleteAfterDays": 35}
  }]
}
EOF
export BACKUP_PLAN_ID=$(aws backup create-backup-plan --region $AWS_REGION \
  --backup-plan file://backup-plan.json --query BackupPlanId --output text)

cat > backup-selection.json <<EOF
{"SelectionName": "yomi-sapo-production-cluster", "IamRoleArn": "$BACKUP_ROLE_ARN", "Resources": ["$CLUSTER_ARN"]}
EOF
aws backup create-backup-selection --region $AWS_REGION --backup-plan-id $BACKUP_PLAN_ID \
  --backup-selection file://backup-selection.json
rm backup-trust.json backup-plan.json backup-selection.json
```

Step 6 takes the first backup on demand, once the cluster holds data.

## 3. Apply the schema as admin

```bash
npx tsx scripts/db/apply-schema-dsql.ts --endpoint $ENDPOINT
```

It runs each statement in its own transaction and waits for each `CREATE INDEX ASYNC` job. Running it again changes nothing. Change the schema only while the app sends no traffic to the cluster: after DDL, the next statement of an open app session can fail once with `OC001`.

## 4. Create the app role and its grants, before any traffic

The server function connects as `yomi_app` with a token its IAM role signs. `AWS IAM GRANT` maps that role to `yomi_app`. Every statement here is DDL, and an open `yomi_app` session fails its next statement with `OC001` after a `GRANT`, so all of this happens before step 8 sends traffic.

```bash
dsql_psql <<EOF
CREATE ROLE yomi_app WITH LOGIN;
AWS IAM GRANT yomi_app TO '$SERVER_ROLE_ARN';
GRANT SELECT, INSERT, UPDATE, DELETE ON bookmarks, text_entries, narration, vocabulary_entries TO yomi_app;
GRANT USAGE ON SEQUENCE bookmarks_id_seq, text_entries_id_seq, narration_id_seq TO yomi_app;
EOF
```

`GRANT USAGE ON SCHEMA public` is not needed, and DSQL refuses it (`feature not supported on system entity`). `USAGE` on a sequence is enough for the `nextval()` id defaults. A table added to the schema later needs its own `GRANT`.

Check:

```bash
dsql_psql <<'EOF'
SELECT pg_role_name, arn FROM sys.iam_pg_role_mappings;
SELECT t.name,
  has_table_privilege('yomi_app', t.name, 'SELECT') AS can_select,
  has_table_privilege('yomi_app', t.name, 'INSERT') AS can_insert,
  has_table_privilege('yomi_app', t.name, 'UPDATE') AS can_update,
  has_table_privilege('yomi_app', t.name, 'DELETE') AS can_delete
FROM (VALUES ('bookmarks'), ('text_entries'), ('narration'), ('vocabulary_entries')) AS t(name);
SELECT s.name, has_sequence_privilege('yomi_app', s.name, 'USAGE') AS can_use
FROM (VALUES ('bookmarks_id_seq'), ('text_entries_id_seq'), ('narration_id_seq')) AS s(name);
EOF
```

Every column must be `t`, and the mapping must name `$SERVER_ROLE_ARN`. If SST ever replaces the server role, its ARN changes and the `AWS IAM GRANT` has to be run again for the new one.

## 5. Read-only checks on Neon **[owner]**

Use Neon's direct endpoint: the host name of `DATABASE_URL` without `-pooler`. The copy refuses the pooled endpoint; it reads with postgres.js like the app, so the rest of the URL works as it is. Keep the URL out of files and chat:

```bash
export NEON_DIRECT_URL="$(MSYS_NO_PATHCONV=1 aws ssm get-parameter --region $AWS_REGION \
  --name yomi-sapo-production-DATABASE_URL --with-decryption --query Parameter.Value --output text | sed 's/-pooler\././')"

docker run --rm -i postgres:17-alpine psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 <<'EOF'
BEGIN TRANSACTION READ ONLY;
SELECT 'bookmarks' AS table_name, count(*) FROM bookmarks
UNION ALL SELECT 'text_entries', count(*) FROM text_entries
UNION ALL SELECT 'narration', count(*) FROM narration
UNION ALL SELECT 'vocabulary_entries', count(*) FROM vocabulary_entries;
SELECT max(octet_length(content)) AS largest_book_bytes,
       count(*) FILTER (WHERE octet_length(content) > 3500000) AS books_over_3_5_mb,
       count(*) FILTER (WHERE content_bytes IS NOT NULL AND content_bytes <> octet_length(content)) AS stale_content_bytes
FROM text_entries;
SELECT max(unit_count) AS largest_narration FROM narration;
COMMIT;
EOF
```

Note the row counts. The checks pass when:

- `largest_book_bytes` is under 3,900,000. DSQL stores at most 1 MiB per value after compression; real book text fit at 3.90 MB and did not at 3.95 MB. Each book over 3.5 MB is checked again by the copy, which estimates its compressed size and refuses to write anything if one does not fit.
- `largest_narration` is far below 72,000 units, where the cue list reaches the same 1 MiB.

`stale_content_bytes` needs no action: the copy writes those as NULL, so the library recounts those books on its first load.

## 6. Dry run: copy and verify **[owner]**

This only reads Neon. It writes only to the new cluster.

```bash
SOURCE_URL="$NEON_DIRECT_URL" npx tsx scripts/db/copy-to-dsql.ts --endpoint $ENDPOINT
```

It prints one line per table, then the verification, which reads every row of both databases again, and the new sequence positions. It ends with `Every row is identical.` and exit code 0, or lists the keys of the rows that are missing, extra or different, and exits 1. The app keeps writing to Neon during the dry run, so a bookmark saved between the copy and the verification shows up as different. Running the command again copies just that row.

Then take the first backup and check it completes:

```bash
aws backup start-backup-job --region $AWS_REGION --backup-vault-name yomi-sapo-dsql \
  --resource-arn $CLUSTER_ARN --iam-role-arn $BACKUP_ROLE_ARN
aws backup list-recovery-points-by-backup-vault --region $AWS_REGION --backup-vault-name yomi-sapo-dsql \
  --query 'RecoveryPoints[].{created:CreationDate,status:Status}'
```

Optional rehearsal **[owner]**: run the app locally against the new cluster as admin with `DSQL_ENDPOINT=$ENDPOINT DSQL_REGION=$AWS_REGION DSQL_USER=admin npx next dev --port 3333` (not `npm run dev`, whose sync would push to Neon), and read a few books. The copy in step 7 overwrites whatever this writes, such as the library's recounts, and deletes any row it adds.

## 7. Cut-over: final copy **[owner]**

1. Stop every writer: no reading in the app (bookmarks are saved while reading), no `npm run dev` (its startup and shutdown sync pushes to Neon), no book pipeline, no `clean-book-text`.
2. Copy again, now deleting rows that were deleted on Neon since the dry run:

   ```bash
   SOURCE_URL="$NEON_DIRECT_URL" npx tsx scripts/db/copy-to-dsql.ts --endpoint $ENDPOINT --delete-extra
   ```

   It writes only the rows that changed since the dry run. Go on only after `Every row is identical.` The row counts in its verification must match step 5 plus any rows added since.

## 8. Switch production to the cluster **[owner]**

1. On a branch from `main`, set the cluster id in `sst.config.ts`, then open a pull request:

   ```ts
   const PRODUCTION_DSQL_CLUSTER_ID = "<CLUSTER_ID>";
   ```

2. Merging it runs `.github/workflows/deploy.yml`, which grants the server function `dsql:DbConnect` on the cluster and sets `DSQL_ENDPOINT`, `DSQL_USER=yomi_app` and `DSQL_REGION`.
3. Confirm the deployed function points at the cluster (this prints only that one variable):

   ```bash
   aws lambda get-function-configuration --region $AWS_REGION --function-name "$SERVER_FUNCTION" \
     --query Environment.Variables.DSQL_ENDPOINT --output text
   ```

4. Point the local tools at the cluster: add `PROD_DSQL_ENDPOINT=<CLUSTER_ID>.dsql.ap-northeast-1.on.aws` to `.env.local`. Keep `PROD_DATABASE_URL` for now; the DSQL endpoint wins while it is set. The tools sign an admin token with the local AWS profile (set `PROD_DSQL_USER` to use another role).

## 9. Smoke tests

Run these on https://yomi-sapo.click right after the deploy, signed in. The database checks use `dsql_psql`.

| Check | Expected |
| --- | --- |
| Library | Every book appears, with page counts and reading progress. The first load recounts books whose `content_bytes` is NULL. |
| Reader | A long book opens; paging and the furigana work. |
| Bookmark written and read back | Move a bookmark in the reader, reload the page and land on it. In the database, `dsql_psql -c "SELECT directory, file_name, bookmark_page, updated_at FROM bookmarks ORDER BY updated_at DESC LIMIT 1"` shows that book with the new page and a fresh `updated_at` (UTC). |
| Vocabulary add and delete | Add a word from the reader: it shows on `/vocabulary` and in `dsql_psql -c "SELECT word, created_at FROM vocabulary_entries ORDER BY created_at DESC LIMIT 1"`. Delete it: it is gone from both. |
| Narration | Open the narrated book (`dsql_psql -c "SELECT directory, file_name FROM narration"`) and press play: the recording plays, not the TTS voice. |
| Ruby lookup | Tap a word with ruby: the lookup sidebar shows its readings. |

After the smoke tests, `npm run db:sync` must connect to the cluster and show its dashboard. Push only what it lists as local-only and wanted.

## 10. Watch during the soak

For the first week, check once a day. Write conflicts and the DPU the cluster bills:

```bash
for METRIC in OccConflicts TotalDPU; do
  aws cloudwatch get-metric-statistics --region $AWS_REGION --namespace AWS/AuroraDSQL --metric-name $METRIC \
    --dimensions Name=ClusterId,Value=$CLUSTER_ID --statistics Sum --period 86400 \
    --start-time $(date -u -d '-1 day' +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
    --query "Datapoints[].[Timestamp,Sum]" --output text | sed "s/^/$METRIC /"
done
```

Database errors in the server function's logs: write conflicts (`40001`, `OC000`, `OC001`), size limits (`54000`), an over-long message (`08P01`), and dead connections after a long freeze:

```bash
MSYS_NO_PATHCONV=1 aws logs filter-log-events --region $AWS_REGION --log-group-name /aws/lambda/$SERVER_FUNCTION \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) \
  --filter-pattern '?40001 ?OC000 ?OC001 ?54000 ?08P01 ?CONNECTION_CLOSED ?ECONNRESET' \
  --query 'events[].message' --output text
```

Writes retry a conflict on their own, so a few `OccConflicts` are expected. A `54000` or `08P01` means a write was too large and failed. A conflict that kept failing after five attempts reaches the log as a `40001` error. A `CONNECTION_CLOSED` or `ECONNRESET` on the first query after a quiet hour would be the Lambda freeze case, which the test did not cover: report it.

Until the soak ends, change the schema only with the app idle (step 3), and never `TRUNCATE`: DSQL has no `TRUNCATE`, and `pg_dump` does not work against it.

## 11. Rollback **[owner]**

1. Set `PRODUCTION_DSQL_CLUSTER_ID = ""` in `sst.config.ts`, open a pull request, merge. The deploy points the app at `DATABASE_URL` again: Neon, which nothing in this runbook wrote to.
2. Writes made on DSQL since step 8 are not on Neon. To carry bookmarks, vocabulary and new books back, use the dev sync: with `PROD_DSQL_ENDPOINT` set, `npm run db:sync` and `[1] Pull all from prod -> local`; then remove `PROD_DSQL_ENDPOINT` from `.env.local`, so the tools use `PROD_DATABASE_URL` (Neon) again, and `npm run db:sync` with `[2] Push missing to prod`. The sync is last-write-wins on `updated_at`, does not copy deletions (a word deleted on DSQL comes back) and does not carry `narration`.
3. Leave the cluster as it is until the cause is understood.

## 12. After the soak: remove Neon **[owner]**

The order matters: every deploy reads the `DATABASE_URL` SSM parameter, so deleting it before the code stops reading it breaks every deploy.

1. A pull request that removes the `yomi-sapo-production-DATABASE_URL` `aws.ssm.getParameter` call and the `DATABASE_URL` and `POSTGRES_URL` entries from `sst.config.ts`, and the Neon paths of the local tools (`PROD_DATABASE_URL` in `lib/db/prodDatabase.ts` and the docs that name it). Keep the `DATABASE_URL` mode of `lib/db/connection.ts`: local development runs on it. Update README, `scripts/db/README.md` and `CLAUDE.md`: production is DSQL, there is no `TRUNCATE` or `pg_dump`, and `psql` signs in with `aws dsql generate-db-connect-admin-auth-token`.
2. Merge, and check that the deploy succeeds and the app still works.
3. Only then delete the parameter: `MSYS_NO_PATHCONV=1 aws ssm delete-parameter --region $AWS_REGION --name yomi-sapo-production-DATABASE_URL`.
4. Keep a last archive of Neon, then delete the Neon project in the Neon console:

   ```bash
   docker run --rm postgres:17-alpine pg_dump "$NEON_DIRECT_URL" --no-owner --no-acl > neon-final.sql
   ```

5. Remove `PROD_DATABASE_URL` from `.env.local`, and `unset NEON_DIRECT_URL`.
