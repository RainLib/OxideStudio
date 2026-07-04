#!/bin/bash
# Build preparation script - builds or copies the SQL LSP binary for bundling.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LSP_SOURCE_DIR="${REPO_ROOT}/vendor/sql-lsp"
BINARIES_DIR="${SCRIPT_DIR}/binaries"

if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    BINARY_NAME="sql-lsp.exe"
else
    BINARY_NAME="sql-lsp"
fi

TARGET_BINARY="${BINARIES_DIR}/${BINARY_NAME}"

echo "=== SQL LSP Build Preparation ==="
echo "Target: ${TARGET_BINARY}"

mkdir -p "${BINARIES_DIR}"

if [[ -n "${OXIDE_SQL_LSP_BINARY:-}" ]]; then
    if [[ ! -f "${OXIDE_SQL_LSP_BINARY}" ]]; then
        echo "OXIDE_SQL_LSP_BINARY does not exist: ${OXIDE_SQL_LSP_BINARY}" >&2
        exit 1
    fi

    echo "Using override binary: ${OXIDE_SQL_LSP_BINARY}"
    cp "${OXIDE_SQL_LSP_BINARY}" "${TARGET_BINARY}"
else
    if [[ ! -f "${LSP_SOURCE_DIR}/Cargo.toml" ]]; then
        echo "SQL LSP submodule is missing at ${LSP_SOURCE_DIR}" >&2
        echo "Run: git submodule update --init --recursive" >&2
        exit 1
    fi

    echo "Building SQL LSP from submodule: ${LSP_SOURCE_DIR}"
    cargo build --release --manifest-path "${LSP_SOURCE_DIR}/Cargo.toml"

    BUILT_BINARY="${LSP_SOURCE_DIR}/target/release/${BINARY_NAME}"
    if [[ ! -f "${BUILT_BINARY}" ]]; then
        echo "Built SQL LSP binary not found: ${BUILT_BINARY}" >&2
        exit 1
    fi

    cp "${BUILT_BINARY}" "${TARGET_BINARY}"
fi

chmod +x "${TARGET_BINARY}" 2>/dev/null || true
echo "SQL LSP binary ready at ${TARGET_BINARY}"
