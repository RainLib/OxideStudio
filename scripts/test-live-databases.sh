#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_IMAGE="${OXIDE_LIVE_POSTGRES_IMAGE:-postgres:16-alpine}"
MYSQL_IMAGE="${OXIDE_LIVE_MYSQL_IMAGE:-mysql:8.0}"
REDIS_IMAGE="${OXIDE_LIVE_REDIS_IMAGE:-redis:7-alpine}"
MONGO_IMAGE="${OXIDE_LIVE_MONGODB_IMAGE:-mongo:7}"
ELASTICSEARCH_IMAGE="${OXIDE_LIVE_ELASTICSEARCH_IMAGE:-docker.elastic.co/elasticsearch/elasticsearch:8.15.3}"
PG_PORT="${OXIDE_LIVE_POSTGRES_PORT:-55432}"
MYSQL_PORT="${OXIDE_LIVE_MYSQL_PORT:-53306}"
REDIS_PORT="${OXIDE_LIVE_REDIS_PORT:-56379}"
MONGO_PORT="${OXIDE_LIVE_MONGODB_PORT:-57017}"
ELASTICSEARCH_PORT="${OXIDE_LIVE_ELASTICSEARCH_PORT:-59200}"
RUN_ID="${OXIDE_LIVE_RUN_ID:-$$}"
PG_CONTAINER="oxide-live-postgres-${RUN_ID}"
MYSQL_CONTAINER="oxide-live-mysql-${RUN_ID}"
REDIS_CONTAINER="oxide-live-redis-${RUN_ID}"
MONGO_CONTAINER="oxide-live-mongodb-${RUN_ID}"
ELASTICSEARCH_CONTAINER="oxide-live-elasticsearch-${RUN_ID}"
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
    echo "  ${REDIS_CONTAINER}"
    echo "  ${MONGO_CONTAINER}"
    echo "  ${ELASTICSEARCH_CONTAINER}"
    return
  fi

  docker rm -f \
    "${PG_CONTAINER}" \
    "${MYSQL_CONTAINER}" \
    "${REDIS_CONTAINER}" \
    "${MONGO_CONTAINER}" \
    "${ELASTICSEARCH_CONTAINER}" >/dev/null 2>&1 || true
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

wait_for_redis() {
  for _ in $(seq 1 60); do
    if docker exec "${REDIS_CONTAINER}" redis-cli ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "${REDIS_CONTAINER}" || true
  echo "Redis did not become ready" >&2
  return 1
}

wait_for_mongodb() {
  for _ in $(seq 1 90); do
    if docker exec "${MONGO_CONTAINER}" mongosh --quiet --eval "db.adminCommand({ ping: 1 }).ok" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "${MONGO_CONTAINER}" || true
  echo "MongoDB did not become ready" >&2
  return 1
}

wait_for_elasticsearch() {
  for _ in $(seq 1 180); do
    if curl -fsS "http://127.0.0.1:${ELASTICSEARCH_PORT}/_cluster/health?wait_for_status=yellow&timeout=1s" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  docker logs "${ELASTICSEARCH_CONTAINER}" || true
  echo "Elasticsearch did not become ready" >&2
  return 1
}

if [[ "${OXIDE_LIVE_USE_EXISTING:-0}" == "1" ]]; then
  if [[ -z "${TEST_POSTGRES_URL:-}" || -z "${TEST_MYSQL_URL:-}" ]]; then
    echo "OXIDE_LIVE_USE_EXISTING=1 requires TEST_POSTGRES_URL and TEST_MYSQL_URL" >&2
    exit 1
  fi
  if [[ -z "${TEST_REDIS_URL:-}" ]]; then
    echo "TEST_REDIS_URL is not set; Redis live test will be skipped."
  fi
  if [[ -z "${TEST_MONGODB_URL:-}" ]]; then
    echo "TEST_MONGODB_URL is not set; MongoDB live test will be skipped."
  fi
  if [[ -z "${TEST_ELASTICSEARCH_URL:-}" ]]; then
    echo "TEST_ELASTICSEARCH_URL is not set; Elasticsearch live test will be skipped."
  fi

  run_live_tests
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  echo "Start Docker Desktop, or run with OXIDE_LIVE_USE_EXISTING=1 and provide TEST_POSTGRES_URL plus TEST_MYSQL_URL." >&2
  echo "For full coverage also provide TEST_REDIS_URL, TEST_MONGODB_URL, and TEST_ELASTICSEARCH_URL." >&2
  exit 1
fi

trap cleanup EXIT

docker rm -f \
  "${PG_CONTAINER}" \
  "${MYSQL_CONTAINER}" \
  "${REDIS_CONTAINER}" \
  "${MONGO_CONTAINER}" \
  "${ELASTICSEARCH_CONTAINER}" >/dev/null 2>&1 || true

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

echo "Starting Redis on 127.0.0.1:${REDIS_PORT}"
docker run -d \
  --name "${REDIS_CONTAINER}" \
  -p "127.0.0.1:${REDIS_PORT}:6379" \
  "${REDIS_IMAGE}" >/dev/null

echo "Starting MongoDB on 127.0.0.1:${MONGO_PORT}"
docker run -d \
  --name "${MONGO_CONTAINER}" \
  -p "127.0.0.1:${MONGO_PORT}:27017" \
  "${MONGO_IMAGE}" >/dev/null

echo "Starting Elasticsearch on 127.0.0.1:${ELASTICSEARCH_PORT}"
docker run -d \
  --name "${ELASTICSEARCH_CONTAINER}" \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e xpack.security.enrollment.enabled=false \
  -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
  -p "127.0.0.1:${ELASTICSEARCH_PORT}:9200" \
  "${ELASTICSEARCH_IMAGE}" >/dev/null

wait_for_postgres
wait_for_mysql
wait_for_redis
wait_for_mongodb
wait_for_elasticsearch
grant_mysql_lifecycle_privileges

export TEST_POSTGRES_URL="postgres://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}"
export TEST_MYSQL_URL="mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${MYSQL_PORT}/${DB_NAME}"
export TEST_REDIS_URL="redis://127.0.0.1:${REDIS_PORT}/0"
export TEST_MONGODB_URL="mongodb://127.0.0.1:${MONGO_PORT}/${DB_NAME}"
export TEST_ELASTICSEARCH_URL="http://127.0.0.1:${ELASTICSEARCH_PORT}"

run_live_tests
