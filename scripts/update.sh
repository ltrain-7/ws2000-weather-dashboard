#!/bin/sh
set -eu

project_dir="${PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
if [ -n "${DOCKER_BIN:-}" ]; then
  docker_bin="$DOCKER_BIN"
elif command -v docker >/dev/null 2>&1; then
  docker_bin="$(command -v docker)"
elif [ -x /usr/local/bin/docker ]; then
  docker_bin=/usr/local/bin/docker
else
  echo "Docker was not found. Set DOCKER_BIN to its absolute path." >&2
  exit 1
fi
image="${WS2000_IMAGE:-ghcr.io/ltrain-7/ws2000-weather-dashboard:stable}"
backup_root="${BACKUP_DIR:-$project_dir/backups}"
backup_retention_days="${BACKUP_RETENTION_DAYS:-90}"
backup_max_files="${BACKUP_MAX_FILES:-12}"
stamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$backup_root/weather-data-$stamp.tgz"
backup_name="weather-data-$stamp.tgz"
backup_pattern='weather-data-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].tgz'

case "$backup_retention_days:$backup_max_files" in
  *[!0-9:]*|:*|*:)
    echo "BACKUP_RETENTION_DAYS and BACKUP_MAX_FILES must be non-negative integers." >&2
    exit 1
    ;;
esac

prune_backups() {
  if [ "$backup_retention_days" -gt 0 ]; then
    find "$backup_root" -maxdepth 1 -type f -name "$backup_pattern" \
      -mtime "+$backup_retention_days" -delete
  fi

  if [ "$backup_max_files" -gt 0 ]; then
    # Only fixed-format names may enter this newline-delimited pipeline.
    find "$backup_root" -maxdepth 1 -type f -name "$backup_pattern" -print \
      | sort -r \
      | awk -v keep="$backup_max_files" 'NR > keep' \
      | while IFS= read -r expired_backup; do
          rm -f -- "$expired_backup"
        done
  fi
}

cd "$project_dir"
if [ -L "$project_dir/data" ] || [ ! -d "$project_dir/data" ] || [ -L "$backup_root" ]; then
  echo "Data and backup directories must be real directories, not symbolic links." >&2
  exit 1
fi
mkdir -p "$backup_root"
chmod 775 "$backup_root"
chown 1000:1000 "$backup_root" 2>/dev/null || true

old_image_id="$($docker_bin inspect --format '{{.Image}}' ws2000-dashboard 2>/dev/null || true)"
echo "Checking $image for an update."
$docker_bin compose pull ws2000-dashboard
new_image_id="$($docker_bin image inspect --format '{{.Id}}' "$image")"
new_image_digest="$($docker_bin image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$image")"
new_revision="$($docker_bin image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null || true)"

if [ -n "$old_image_id" ] && [ "$old_image_id" = "$new_image_id" ]; then
  prune_backups
  echo "Already current."
  exit 0
fi

echo "Creating database backup $backup_file."
# The project directory must be host-owned and not writable by the container.
# Never open, chmod, or chown a file under a container-writable directory.
update_workdir="$(mktemp -d "$project_dir/.ws2000-update.XXXXXXXX")"
trap 'rm -f -- "$update_workdir/deployment.json" "$update_workdir/$backup_name"; rmdir -- "$update_workdir"' EXIT
trap 'exit 1' HUP INT TERM
$docker_bin compose stop ws2000-dashboard
tar -czf "$update_workdir/$backup_name" data
chmod 644 "$update_workdir/$backup_name"
mv -f "$update_workdir/$backup_name" "$backup_root/"

if [ -n "$old_image_id" ]; then
  $docker_bin image tag "$old_image_id" ws2000-weather-dashboard:rollback-local
fi

healthy=false
if $docker_bin compose up -d --force-recreate ws2000-dashboard; then
  attempt=1
  while [ "$attempt" -le 18 ]; do
    if [ "$($docker_bin inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ws2000-dashboard 2>/dev/null || true)" = "healthy" ]; then
      healthy=true
      break
    fi
    sleep 5
    attempt=$((attempt + 1))
  done
fi

if [ "$healthy" = true ]; then
  deployment_tmp="$update_workdir/deployment.json"
  deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"image":"%s","digest":"%s","revision":"%s","updatedAt":"%s"}\n' \
    "$image" "$new_image_digest" "$new_revision" "$deployed_at" > "$deployment_tmp"
  chmod 644 "$deployment_tmp"
  # A directory destination makes mv replace the final entry itself (including
  # a symlink), instead of treating a symlink to a directory as the destination.
  mv -f "$deployment_tmp" "$project_dir/data/"
  prune_backups
  echo "Update succeeded and passed its health check."
  exit 0
fi

echo "Update failed its health check; rolling back."
if [ -z "$old_image_id" ]; then
  echo "No prior image is available. Database backup: $backup_file"
  exit 1
fi

if ! WS2000_IMAGE=ws2000-weather-dashboard:rollback-local \
  $docker_bin compose up -d --force-recreate ws2000-dashboard; then
  echo "Rollback could not start the prior image. Database backup: $backup_file"
  exit 1
fi

attempt=1
while [ "$attempt" -le 18 ]; do
  if [ "$($docker_bin inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ws2000-dashboard 2>/dev/null || true)" = "healthy" ]; then
    echo "Rollback succeeded. Database backup: $backup_file"
    exit 1
  fi
  sleep 5
  attempt=$((attempt + 1))
done

echo "Rollback did not recover service. Database backup: $backup_file"
exit 1
