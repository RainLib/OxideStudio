#!/bin/bash
# Build preparation script - Downloads LSP binary for bundling
set -e

LSP_VERSION="0.1.3"
LSP_REPO="LikeRainDay/lsp_sqls"
BINARIES_DIR="$(dirname "$0")/binaries"

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS-$ARCH" in
    Linux-x86_64)
        PLATFORM="x86_64-unknown-linux-gnu"
        BINARY_NAME="sql-lsp"
        ;;
    Linux-aarch64)
        PLATFORM="aarch64-unknown-linux-gnu"
        BINARY_NAME="sql-lsp"
        ;;
    Darwin-x86_64)
        PLATFORM="x86_64-apple-darwin"
        BINARY_NAME="sql-lsp"
        ;;
    Darwin-arm64)
        PLATFORM="aarch64-apple-darwin"
        BINARY_NAME="sql-lsp"
        ;;
    MINGW*-x86_64|MSYS*-x86_64)
        PLATFORM="x86_64-pc-windows-msvc"
        BINARY_NAME="sql-lsp.exe"
        ;;
    *)
        echo "Unsupported platform: $OS-$ARCH"
        exit 1
        ;;
esac

DOWNLOAD_URL="https://github.com/${LSP_REPO}/releases/download/v${LSP_VERSION}/sql-lsp-${PLATFORM}-v${LSP_VERSION}.tar.gz"
BINARY_PATH="${BINARIES_DIR}/${BINARY_NAME}"

echo "=== LSP Binary Download Script ==="
echo "Platform: $PLATFORM"
echo "Version: $LSP_VERSION"
echo "URL: $DOWNLOAD_URL"
echo "Target: $BINARY_PATH"

# Check if binary already exists
if [ -f "$BINARY_PATH" ]; then
    echo "✓ Binary already exists at $BINARY_PATH"
    exit 0
fi

# Create binaries directory
mkdir -p "$BINARIES_DIR"

# Download archive
echo "Downloading LSP binary..."
TEMP_ARCHIVE="${BINARIES_DIR}/sql-lsp-${PLATFORM}-v${LSP_VERSION}.tar.gz"
curl -L -o "$TEMP_ARCHIVE" "$DOWNLOAD_URL"

# Extract binary
echo "Extracting binary..."
tar -xzf "$TEMP_ARCHIVE" -C "$BINARIES_DIR"

# Set executable permissions (Unix-like systems)
if [ "$OS" != "MINGW"* ] && [ "$OS" != "MSYS"* ]; then
    chmod +x "$BINARY_PATH"
fi

# Clean up
rm "$TEMP_ARCHIVE"

echo "✓ LSP binary downloaded successfully to $BINARY_PATH"
