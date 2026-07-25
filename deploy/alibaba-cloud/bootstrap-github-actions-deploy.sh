#!/usr/bin/env bash
set -euo pipefail

# Run once as root on the ECS instance. Pass the public key that corresponds to
# the GitHub Actions deployment private key as the only argument.

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this one-time bootstrap script as root." >&2
  exit 77
fi

: "${1:?Pass the GitHub Actions deployment public key as the first argument.}"
deploy_public_key="$1"
deploy_user="deploy"
app_root="/opt/english-platform"

if ! getent group docker >/dev/null; then
  echo "Docker is not installed or its group is unavailable." >&2
  exit 69
fi

if ! id "${deploy_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${deploy_user}"
fi

usermod -aG docker "${deploy_user}"
install -d -o "${deploy_user}" -g "${deploy_user}" -m 0750 \
  "${app_root}" "${app_root}/releases" "${app_root}/shared"
install -d -o "${deploy_user}" -g "${deploy_user}" -m 0700 \
  "/home/${deploy_user}/.ssh"
printf '%s\n' "${deploy_public_key}" \
  | install -o "${deploy_user}" -g "${deploy_user}" -m 0600 /dev/stdin \
      "/home/${deploy_user}/.ssh/authorized_keys"

cat <<'EOF'
Bootstrap complete.

Before the first GitHub deployment, create this file as the deploy user:
  /opt/english-platform/shared/.env.ecs

Use deploy/alibaba-cloud/.env.ecs.example as the template. Keep this real file
off GitHub and make it readable only by the deploy user.
EOF
