#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_IMAGE="${OXIDE_LIVE_POSTGRES_IMAGE:-postgres:16-alpine}"
MYSQL_IMAGE="${OXIDE_LIVE_MYSQL_IMAGE:-mysql:8.0}"
PG_PORT="${OXIDE_LIVE_POSTGRES_PORT:-55432}"
MYSQL_PORT="${OXIDE_LIVE_MYSQL_PORT:-53306}"
RUN_ID="${OXIDE_LIVE_RUN_ID:-$$}"
PG_CONTAINER="oxide-live-postgres-${RUN_ID}"
MYSQL_CONTAINER="oxide-live-mysql-${RUN_ID}"
DB_USER="oxide"
DB_PASSWORD="oxide"
DB_NAME="oxide"

run_live_tests() {
  export OXIDE_LIVE_DB_TESTS=1

  echo "Running live database integration tests"
  cargo test --manifest-path "${ROOT_DIR}/src-tauri/Cargo.toml" --test live_database -- --nocapture

  echo "Running existing ignored live driver smoke tests"
  cargo test --manifest-path "${ROOT_DIR}/src-tauri/Cargo.toml" test_get_schemas -- --ignored --nocapture
}

cleanup() {
  if [[ "${KEEP_LIVE_DBS:-0}" == "1" ]]; then
    echo "Keeping live DB containers:"
    echo "  ${PG_CONTAINER}"
    echo "  ${MYSQL_CONTAINER}"
    return
  fi

  docker rm -f "${PG_CONTAINER}" "${MYSQL_CONTAINER}" >/dev/null 2>&1 || true
}

wait_for_postgres() {
  for _ in $(seq 1 90); do
    if docker exec "${PG_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "${PG_CONTAINER}" || true
  echo "PostgreSQL did not become ready" >&2
  return 1
}

wait_for_mysql() {
  for _ in $(seq 1 120); do
    if docker exec "${MYSQL_CONTAINER}" mysqladmin ping -h 127.0.0.1 -u"${DB_USER}" -p"${DB_PASSWORD}" --silent >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "${MYSQL_CONTAINER}" || true
  echo "MySQL did not become ready" >&2
  return 1
}

grant_mysql_lifecycle_privileges() {
  docker exec -e MYSQL_PWD="${DB_PASSWORD}" "${MYSQL_CONTAINER}" \
    mysql -uroot \
    -e "GRANT ALL PRIVILEGES ON *.* TO '${DB_USER}'@'%' WITH GRANT OPTION; FLUSH PRIVILEGES;"
}

if [[ "${OXIDE_LIVE_USE_EXISTING:-0}" == "1" ]]; then
  if [[ -z "${TEST_POSTGRES_URL:-}" || -z "${TEST_MYSQL_URL:-}" ]]; then
    echo "OXIDE_LIVE_USE_EXISTING=1 requires TEST_POSTGRES_URL and TEST_MYSQL_URL" >&2
    exit 1
  fi

  run_live_tests
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  echo "Start Docker Desktop, or run with OXIDE_LIVE_USE_EXISTING=1 and provide TEST_POSTGRES_URL plus TEST_MYSQL_URL." >&2
  exit 1
fi

trap cleanup EXIT

docker rm -f "${PG_CONTAINER}" "${MYSQL_CONTAINER}" >/dev/null 2>&1 || true

echo "Starting PostgreSQL on 127.0.0.1:${PG_PORT}"
docker run -d \
  --name "${PG_CONTAINER}" \
  -e POSTGRES_USER="${DB_USER}" \
  -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
  -e POSTGRES_DB="${DB_NAME}" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  "${PG_IMAGE}" >/dev/null

echo "Starting MySQL on 127.0.0.1:${MYSQL_PORT}"
docker run -d \
  --name "${MYSQL_CONTAINER}" \
  -e MYSQL_ROOT_PASSWORD="${DB_PASSWORD}" \
  -e MYSQL_DATABASE="${DB_NAME}" \
  -e MYSQL_USER="${DB_USER}" \
  -e MYSQL_PASSWORD="${DB_PASSWORD}" \
  -p "127.0.0.1:${MYSQL_PORT}:3306" \
  "${MYSQL_IMAGE}" \
  --default-authentication-plugin=mysql_native_password >/dev/null

wait_for_postgres
wait_for_mysql
grant_mysql_lifecycle_privileges

export TEST_POSTGRES_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}"
export TEST_MYSQL_URL="mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${MYSQL_PORT}/${DB_NAME}"

run_live_tests
