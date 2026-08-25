#!/bin/sh
set -eu

profile="${1:-pi-standard}"
profile_file="profiles/${profile}.env"

if [ ! -f "$profile_file" ]; then
  echo "Unknown profile: $profile"
  echo "Choose pi-zero-2, pi-standard, or pi-performance."
  exit 1
fi

if [ -f .env ]; then
  echo ".env already exists; leaving it unchanged."
else
  cp "$profile_file" .env
  echo "Created .env from $profile_file."
fi

mkdir -p data
chmod 775 data

echo "Next: edit .env with your Ambient keys, then run docker compose up -d"
