#!/bin/bash
# Compatibility entry point for older development and packaging workflows.
# Keep one implementation of binary copying and provenance generation so the
# executable can never be updated without its adjacent integrity manifest.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec node "${REPO_ROOT}/scripts/prepare-sql-lsp.mjs"
