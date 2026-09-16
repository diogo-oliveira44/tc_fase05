#!/bin/sh

set -eu

echo '{"event":"startup","step":"migrate"}'
bun run db/migrate.ts

if [ -n "${MANAGER_PASSWORD:-}${ADMIN_PASSWORD:-}" ]; then
  echo '{"event":"startup","step":"seed"}'
  bun run db/seed.ts
else
  echo '{"event":"startup","step":"seed","skipped":"MANAGER_PASSWORD and ADMIN_PASSWORD are not set"}'
fi

exec bun run src/server.ts
