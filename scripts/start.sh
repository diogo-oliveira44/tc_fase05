#!/bin/sh

# This scripts execs our migrations and start the server when the container is created
set -eu

echo '{"event":"startup","step":"migrate"}'
bun run db/migrate.ts

if [ -n "${MANAGER_PASSWORD:-}" ]; then
  echo '{"event":"startup","step":"seed"}'
  bun run db/seed.ts
else
  echo '{"event":"startup","step":"seed","skipped":"MANAGER_PASSWORD is not set"}'
fi

exec bun run src/server.ts
