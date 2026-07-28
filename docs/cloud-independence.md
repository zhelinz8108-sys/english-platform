# Cloud independence and disaster recovery

The production system must remain operable and recoverable if any developer
workstation is lost.

## Source of truth

| Data                                            | Source of truth                               | Recovery path                                             |
| ----------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Application source and structured learning data | GitHub `main`                                 | `git clone`, then `scripts/bootstrap-dev.ps1`             |
| Production runtime                              | Alibaba Cloud ECS                             | GitHub Actions deploys an immutable release               |
| Student accounts and learning progress          | PostgreSQL on ECS                             | Daily custom-format dump in private OSS                   |
| Listening audio                                 | Private OSS bucket                            | Application metadata import during deployment             |
| Original books and authoring deliverables       | `private-archive/workstation/` in OSS         | `scripts/sync-private-assets.ps1 -Action download`        |
| Production environment                          | GitHub `production` secret `ECS_ENV_FILE_B64` | Deployment writes `/opt/english-platform/shared/.env.ecs` |

Never commit `.env`, AccessKey exports, temporary student passwords, database
dumps, or the original source books.

## First-time workstation setup

```powershell
git clone https://github.com/zhelinz8108-sys/english-platform.git
cd english-platform
.\scripts\bootstrap-dev.ps1
```

To restore private source material, obtain a fresh least-privilege credential
outside Git and run:

```powershell
.\scripts\sync-private-assets.ps1 `
  -Action download `
  -CredentialsCsv C:\secure\temporary-archive-access.csv
```

Remove the temporary credential export after the download and revoke or rotate
it when it is no longer required.

## Production database backup

The `backup` Compose service runs `pg_dump` immediately after it starts and then
once every `BACKUP_INTERVAL_SECONDS`. Dumps and SHA-256 metadata are uploaded to
`BACKUP_S3_PREFIX`. The fixed `latest.json` pointer identifies the newest dump,
so verification and recovery do not require permission to list the bucket.
Cleanup of objects older than `BACKUP_RETENTION_DAYS` is best-effort so a
missing list or delete permission can never invalidate a successful backup.

The production OSS RAM policy needs these permissions:

- read/write objects below `private-archive/workstation/`;
- read/write objects below `private-archive/database-backups/`;
- optionally list and delete only the backup prefix for retention cleanup.

Verify at least monthly that a dump can be downloaded, its SHA-256 matches the
metadata object, and `pg_restore --list` can read it. Perform full restoration
only into an isolated database. The production release script performs the
non-destructive download, checksum, and `pg_restore --list` checks on every
deployment.

Run the non-destructive verification inside the production API image:

```bash
docker compose --env-file /opt/english-platform/shared/.env.ecs \
  -f /opt/english-platform/current/deploy/alibaba-cloud/docker-compose.ecs.yml \
  run --rm --no-deps backup \
  node apps/api/scripts/verify-production-database-backup.mjs
```

## GitHub environment recovery secret

Store the entire production environment file as one base64-encoded GitHub
Environment secret named `ECS_ENV_FILE_B64`. The workflow never prints it. When
the secret exists, every production deployment securely replaces the ECS copy
before releasing the application.

On ECS, generate the value without adding a newline:

```bash
base64 -w0 /opt/english-platform/shared/.env.ecs
```

Paste the result directly into GitHub **Settings → Environments → production →
Environment secrets**. Do not paste it into a chat, issue, commit, or log.

## Recovery drill

1. Clone the repository on a second computer.
2. Run `scripts/bootstrap-dev.ps1` and the full test suite.
3. Restore the private asset archive and verify the manifest.
4. Push a harmless branch and merge it to `main`.
5. Confirm the GitHub deployment and `/healthz`.
6. Download the latest database dump and perform an isolated restore test.
7. Only after all checks pass, revoke the workstation RAM key and remove its CSV.
