#!/usr/bin/env bash
set -euo pipefail

DESTINATION="${ORBIT_BACKUP_DESTINATION:-/var/backups/orbit}"
KEEP_COUNT="${ORBIT_BACKUP_KEEP_COUNT:-30}"
KEEP_DAYS="${ORBIT_BACKUP_KEEP_DAYS:-14}"
MAX_BYTES="${ORBIT_BACKUP_MAX_BYTES:-50GB}"
STALE_ALERT_HOURS="${ORBIT_BACKUP_STALE_ALERT_HOURS:-26}"

echo "[orbit-backup] Starting backup capture into ${DESTINATION}..."
bun run backup:create --destination "${DESTINATION}" "$@"

echo "[orbit-backup] Running retention and pruning..."
bun run backup:prune \
  --destination "${DESTINATION}" \
  --keep-count "${KEEP_COUNT}" \
  --keep-days "${KEEP_DAYS}" \
  --max-bytes "${MAX_BYTES}" \
  --stale-alert-hours "${STALE_ALERT_HOURS}"

echo "[orbit-backup] Completed successfully."
