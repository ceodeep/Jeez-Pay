#!/usr/bin/env bash
set -Eeuo pipefail

PATH="/usr/sbin:/usr/bin:/sbin:/bin"

ADMIN_ROOT="/var/www/jeezpay-admin"
RELEASES="/home/jeezpay/releases"

abort() {
  echo "ABORT: $*" >&2
  exit 1
}

require_sha() {
  [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]] ||
    abort "invalid SHA"
}

require_stamp() {
  [[ "${1:-}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] ||
    abort "invalid timestamp"
}

assert_not_symlink() {
  local path="$1"

  if [ -L "$path" ]; then
    abort "symlink not allowed: $path"
  fi
}

cmd="${1:-}"

case "$cmd" in
  check)
    test "$#" -eq 1

    test -d /var/www
    assert_not_symlink /var/www

    echo "JEEZPAY ADMIN WEBROOT HELPER: GREEN"
    ;;

  stage)
    test "$#" -eq 2

    target_sha="$2"
    require_sha "$target_sha"

    source_dir="$RELEASES/jeezpay-${target_sha}/admin-dashboard/dist"
    stage_dir="/var/www/.jeezpay-admin-${target_sha}.tmp"

    test -d "$source_dir" ||
      abort "admin dist does not exist"

    assert_not_symlink "$source_dir"

    expected_source="$(
      realpath \
        "$RELEASES/jeezpay-${target_sha}/admin-dashboard/dist"
    )"

    actual_source="$(
      realpath "$source_dir"
    )"

    test "$actual_source" = "$expected_source" ||
      abort "unexpected admin source"

    test ! -e "$stage_dir" ||
      abort "admin stage already exists"

    mkdir -m 0755 "$stage_dir"

    cp -a \
      "$source_dir/." \
      "$stage_dir/"

    chown -R \
      www-data:www-data \
      "$stage_dir"

    find "$stage_dir" \
      -type d \
      -exec chmod 0755 {} +

    find "$stage_dir" \
      -type f \
      -exec chmod 0644 {} +

    echo "ADMIN STAGE: GREEN"
    ;;

  activate)
    test "$#" -eq 4

    target_sha="$2"
    old_sha="$3"
    stamp="$4"

    require_sha "$target_sha"
    require_sha "$old_sha"
    require_stamp "$stamp"

    stage_dir="/var/www/.jeezpay-admin-${target_sha}.tmp"
    previous="/var/www/.jeezpay-admin-rollback-${old_sha}-${stamp}"

    test -d "$ADMIN_ROOT" ||
      abort "live admin root missing"

    test -d "$stage_dir" ||
      abort "admin stage missing"

    test ! -e "$previous" ||
      abort "rollback path already exists"

    assert_not_symlink "$ADMIN_ROOT"
    assert_not_symlink "$stage_dir"

    mv \
      "$ADMIN_ROOT" \
      "$previous"

    mv \
      "$stage_dir" \
      "$ADMIN_ROOT"

    echo "ADMIN ACTIVATE: GREEN"
    ;;

  rollback)
    test "$#" -eq 4

    target_sha="$2"
    old_sha="$3"
    stamp="$4"

    require_sha "$target_sha"
    require_sha "$old_sha"
    require_stamp "$stamp"

    previous="/var/www/.jeezpay-admin-rollback-${old_sha}-${stamp}"
    failed="/var/www/.jeezpay-admin-failed-${target_sha}-${stamp}"

    test -d "$previous" ||
      abort "rollback webroot missing"

    assert_not_symlink "$previous"

    if [ -e "$ADMIN_ROOT" ]; then
      test ! -e "$failed" ||
        abort "failed webroot path already exists"

      assert_not_symlink "$ADMIN_ROOT"

      mv \
        "$ADMIN_ROOT" \
        "$failed"
    fi

    mv \
      "$previous" \
      "$ADMIN_ROOT"

    echo "ADMIN ROLLBACK: GREEN"
    ;;

  cleanup-stage)
    test "$#" -eq 2

    target_sha="$2"
    require_sha "$target_sha"

    stage_dir="/var/www/.jeezpay-admin-${target_sha}.tmp"

    if [ -e "$stage_dir" ]; then
      assert_not_symlink "$stage_dir"

      rm -rf -- "$stage_dir"
    fi

    echo "ADMIN STAGE CLEANUP: GREEN"
    ;;

  *)
    abort "unsupported command"
    ;;
esac
