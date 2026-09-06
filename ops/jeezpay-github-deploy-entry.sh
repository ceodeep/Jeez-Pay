#!/usr/bin/env bash
set -Eeuo pipefail

PATH="/usr/local/bin:/usr/bin:/bin"

REPO="$HOME/Jeez-Pay"
PROD_BRANCH="hardening/production-v1"

abort() {
  echo "DEPLOY ENTRY DENIED: $*" >&2
  exit 1
}

ORIGINAL="${SSH_ORIGINAL_COMMAND:-}"

test -n "$ORIGINAL" ||
  abort "missing command"

read -r \
  ACTION \
  TARGET_SHA \
  MIGRATIONS \
  EXTRA \
  <<< "$ORIGINAL"

test "$ACTION" = "deploy" ||
  abort "unsupported action"

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  abort "invalid SHA"

case "$MIGRATIONS" in
  YES|NO)
    ;;
  *)
    abort "invalid migration acknowledgement"
    ;;
esac

test -z "${EXTRA:-}" ||
  abort "unexpected extra arguments"

git -C "$REPO" \
  fetch origin "$PROD_BRANCH" \
  >/dev/null

REMOTE_SHA="$(
  git -C "$REPO" \
    rev-parse "origin/$PROD_BRANCH"
)"

test "$REMOTE_SHA" = "$TARGET_SHA" ||
  abort "target is not protected production HEAD"

git -C "$REPO" \
  cat-file -e \
  "${TARGET_SHA}^{commit}"

git -C "$REPO" \
  show \
  "${TARGET_SHA}:ops/deploy-production.sh" |
MIGRATIONS_CONFIRMED="$MIGRATIONS" \
  bash -s -- "$TARGET_SHA"
