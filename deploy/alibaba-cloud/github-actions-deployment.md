# GitHub Actions production deployment

The repository workflow deploys only after the `verify` job succeeds on a push
to `main`. It sends an immutable source archive to the ECS instance, builds the
three application images there, runs database migrations, recreates the API,
Worker, and Web containers, and checks `/healthz`.

## One-time ECS setup

1. Create a dedicated SSH key pair for GitHub Actions. Keep the private half
   outside this repository.
2. Log in to the ECS instance as `root` and run
   `bootstrap-github-actions-deploy.sh`, passing that key's public half as its
   only argument. This creates the non-root `deploy` user and grants it Docker
   access.
3. As `deploy`, create `/opt/english-platform/shared/.env.ecs` from
   `.env.ecs.example`, filling in the existing production database, JWT, and
   OSS values. The file must be mode `0600` and must never be committed.
4. Ensure the ECS security group permits TCP 22 from GitHub Actions runners, or
   use a self-hosted runner/VPN if a fixed source IP allowlist is required.

## GitHub configuration

In **Settings → Environments**, create `production` and restrict deployments to
the `main` branch. Add these environment secrets:

- `ECS_HOST` — the ECS host or IP address.
- `ECS_USER` — `deploy`.
- `ECS_SSH_PRIVATE_KEY` — the private half of the dedicated deployment key.
- `ECS_KNOWN_HOSTS` — the pinned `known_hosts` line for the ECS host, generated
  from a trusted connection rather than accepted automatically by CI.

After this setup, each successful push to `main` deploys automatically. The
workflow uses a concurrency lock so a later push waits for an active production
deployment instead of canceling it.
