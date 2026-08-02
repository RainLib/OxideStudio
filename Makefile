.PHONY: help setup install submodules dev dev-no-watch start web preview build package test test-frontend test-rust test-lsp test-lsp-integration test-live-db driver-conformance check cargo-check lsp-build ai ai-tools ai-manifest ai-inspect ai-mcp-smoke ai-mcp-stdio ai-plan clean info

.DEFAULT_GOAL := help

ifeq ($(OS),Windows_NT)
SHELL := cmd.exe
.SHELLFLAGS := /C
DEV_ENV := set OXIDE_SKIP_SQL_LSP_PREPARE=1&&
LSP_BUILD_COMMAND := node scripts/prepare-sql-lsp.mjs
REMOVE_DIST := if exist dist rmdir /S /Q dist
else
SHELL := /bin/bash
DEV_ENV := OXIDE_SKIP_SQL_LSP_PREPARE=1
LSP_BUILD_COMMAND := node scripts/prepare-sql-lsp.mjs
REMOVE_DIST := rm -rf dist
endif
NPM ?= npm
CARGO ?= cargo
AI_BIN ?= ./node_modules/.bin/tsx
ROOT_DIR := $(CURDIR)
TAURI_MANIFEST := src-tauri/Cargo.toml
LSP_MANIFEST := vendor/sql-lsp/Cargo.toml
AI_MESSAGE ?= list available database providers
AI_TOOL ?= provider.list
TAURI_DEV_ARGS ?=

COLOR_RESET := \033[0m
COLOR_BOLD := \033[1m
COLOR_GREEN := \033[32m
COLOR_YELLOW := \033[33m
COLOR_BLUE := \033[34m

help: ## Show available project commands.
	@node scripts/make-help.mjs $(firstword $(MAKEFILE_LIST))

setup: submodules install ## Prepare submodules and Node dependencies.

install: ## Install Node dependencies.
	$(NPM) install

submodules: ## Initialize and update git submodules.
	git submodule update --init --recursive

dev: lsp-build ## Start the Tauri desktop app in development mode.
	$(DEV_ENV) $(NPM) run tauri -- dev $(TAURI_DEV_ARGS)

dev-no-watch: lsp-build ## Start Tauri dev without the Rust file watcher.
	$(DEV_ENV) $(NPM) run tauri -- dev --no-watch

start: dev ## Alias for make dev.

web: ## Start the Vite web-only dev server.
	$(NPM) run dev

preview: ## Preview the production web build.
	$(NPM) run preview

build: ## Type-check and build the frontend bundle.
	$(NPM) run build

package: ## Build the distributable Tauri application.
	$(NPM) run tauri -- build

test: test-frontend test-rust test-lsp ## Run frontend, Rust, and LSP tests.

test-frontend: ## Run Vitest frontend tests.
	$(NPM) test

test-rust: ## Run Rust unit and integration tests for the Tauri backend.
	$(CARGO) test --manifest-path $(TAURI_MANIFEST)

test-lsp: ## Run tests for the SQL LSP submodule.
	$(CARGO) test --manifest-path $(LSP_MANIFEST)

test-lsp-integration: lsp-build ## Run OxideStudio LSP integration tests against the bundled binary.
	$(CARGO) test --manifest-path $(TAURI_MANIFEST) --test lsp_integration -- --nocapture

test-live-db: ## Run Docker-backed live database tests for all supported drivers.
	$(NPM) run test:live-db

driver-conformance: ## Run a signed-driver conformance fixture. Usage: make driver-conformance ARGS="--manifest ... --fixture ... --out ..."
	$(NPM) run driver:conformance -- $(ARGS)

check: build cargo-check ## Run the standard local checks without live database containers.

cargo-check: ## Check the Tauri backend without producing final binaries.
	$(CARGO) check --manifest-path $(TAURI_MANIFEST)

lsp-build: ## Build or copy the SQL LSP binary into src-tauri/binaries.
	$(LSP_BUILD_COMMAND)

ai: ## Run the Oxide AI CLI. Usage: make ai ARGS="tools list"
	$(NPM) run ai -- $(ARGS)

ai-tools: ## List headless AI tools exposed to CLI and MCP clients.
	$(NPM) run ai -- tools list

ai-manifest: ## Print the policy-aware AI tool manifest.
	$(NPM) run ai -- tools manifest

ai-inspect: ## Print one AI tool definition. Usage: make ai-inspect AI_TOOL=provider.list
	$(NPM) run ai -- tools inspect $(AI_TOOL)

ai-mcp-smoke: ## Verify the AI MCP JSON-RPC tools/list path.
	$(NPM) run ai -- mcp request --json '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

ai-mcp-stdio: ## Start the AI MCP stdio server for editor or agent clients.
	@$(AI_BIN) scripts/oxide-ai.ts mcp stdio

ai-plan: ## Generate a deterministic AI plan. Usage: make ai-plan AI_MESSAGE="inspect metadata"
	$(NPM) run ai -- assistant plan --message "$(AI_MESSAGE)"

clean: ## Remove frontend and Rust build outputs.
	$(REMOVE_DIST)
	$(CARGO) clean --manifest-path $(TAURI_MANIFEST)
	$(CARGO) clean --manifest-path $(LSP_MANIFEST)

info: ## Print toolchain and project information.
ifeq ($(OS),Windows_NT)
	@echo Project: OxideStudio
	@echo Root: $(ROOT_DIR)
	@$(NPM) --version
	@$(CARGO) --version
	@rustc --version
	@echo Tauri manifest: $(TAURI_MANIFEST)
	@echo SQL LSP manifest: $(LSP_MANIFEST)
else
	@printf "$(COLOR_BOLD)$(COLOR_BLUE)Project$(COLOR_RESET): OxideStudio\n"
	@echo "Root: $(ROOT_DIR)"
	@echo "Node: $$($(NPM) --version)"
	@echo "Cargo: $$($(CARGO) --version)"
	@echo "Rust: $$(rustc --version)"
	@echo "Tauri manifest: $(TAURI_MANIFEST)"
	@echo "SQL LSP manifest: $(LSP_MANIFEST)"
endif
