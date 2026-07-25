#!/usr/bin/env bash
set -euo pipefail

# This script is sent by GitHub Actions over SSH. It does not contain secrets:
# production configuration remains in /opt/english-platform/shared/.env.ecs.

: "${RELEASE_ID:?RELEASE_ID is required}"
: "${ARCHIVE_PATH:?ARCHIVE_PATH is required}"
: "${ENV_FILE:?ENV_FILE is required}"

APP_ROOT="/opt/english-platform"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"

if [[ ! "${RELEASE_ID}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_ID must be a full Git commit SHA." >&2
  exit 64
fi

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Release archive is missing: ${ARCHIVE_PATH}" >&2
  exit 66
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Production environment file is missing or unreadable: ${ENV_FILE}" >&2
  exit 66
fi

mkdir -p "${RELEASES_DIR}"
exec 9>"${APP_ROOT}/deploy.lock"
flock -n 9 || {
  echo "Another production deployment is already running." >&2
  exit 75
}

release_dir="${RELEASES_DIR}/${RELEASE_ID}"
staging_dir="$(mktemp -d "${RELEASES_DIR}/.${RELEASE_ID}.XXXXXX")"
cleanup() {
  rm -rf "${staging_dir}"
}
trap cleanup EXIT

tar --extract --gzip --file="${ARCHIVE_PATH}" --directory="${staging_dir}"
test -f "${staging_dir}/deploy/alibaba-cloud/docker-compose.ecs.yml"
test -f "${staging_dir}/apps/api/Dockerfile"
test -f "${staging_dir}/apps/web/Dockerfile"
test -f "${staging_dir}/apps/worker/Dockerfile"

export ECS_ENV_FILE="${ENV_FILE}"
export IMAGE_TAG="${RELEASE_ID}"
compose=(docker compose --env-file "${ENV_FILE}" -f "${staging_dir}/deploy/alibaba-cloud/docker-compose.ecs.yml")

# Build and migrate before replacing the healthy application containers.
"${compose[@]}" build api worker web
"${compose[@]}" up -d postgres redis
"${compose[@]}" run --rm database-roles
"${compose[@]}" run --rm migrate

# The MP3 objects are already in OSS. Register their metadata and the reviewed
# question bank before exposing the new listening page to users.
import_mounts=(
  -v "${staging_dir}/apps/api/scripts:/app/apps/api/scripts:ro"
  -v "${staging_dir}/apps/web/data:/app/apps/web/data:ro"
)
for collection in minute-earth bbc-6-minute-english; do
  "${compose[@]}" run --rm --no-deps "${import_mounts[@]}" --entrypoint node api \
    apps/api/scripts/import-listening-library.mjs \
    "--collection=${collection}" \
    --tenant=019f8d4f-c7ce-77b8-979a-206f28f8fda4 \
    --register-only=true \
    --concurrency=6
done
"${compose[@]}" run --rm --no-deps "${import_mounts[@]}" --entrypoint node api \
  apps/api/scripts/import-listening-question-bank.mjs \
  --tenant=019f8d4f-c7ce-77b8-979a-206f28f8fda4

"${compose[@]}" up -d --no-deps --force-recreate api worker web

web_address="$("${compose[@]}" port web 3000 | head -n 1)"
if [[ -z "${web_address}" ]]; then
  echo "Unable to determine the published web address." >&2
  exit 70
fi
curl --fail --show-error --silent --retry 12 --retry-delay 2 "http://${web_address}/healthz" >/dev/null

rm -rf "${release_dir}"
mv "${staging_dir}" "${release_dir}"
ln -sfn "${release_dir}" "${CURRENT_LINK}"
trap - EXIT
printf '%s\n' "Released ${RELEASE_ID} successfully."
