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
stamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$backup_root/weather-data-$stamp.tgz"

cd "$project_dir"
mkdir -p "$backup_root"

old_image_id="$($docker_bin inspect --format '{{.Image}}' ws2000-dashboard 2>/dev/null || true)"
echo "Checking $image for an update."
$docker_bin compose pull ws2000-dashboard
new_image_id="$($docker_bin image inspect --format '{{.Id}}' "$image")"

if [ -n "$old_image_id" ] && [ "$old_image_id" = "$new_image_id" ]; then
  echo "Already current."
  exit 0
fi

echo "Creating database backup $backup_file."
$docker_bin compose stop ws2000-dashboard
tar -czf "$backup_file" data

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
