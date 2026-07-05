.PHONY: help setup install submodules dev start web preview build package test test-frontend test-rust test-lsp test-lsp-integration test-live-db check cargo-check lsp-build clean info

.DEFAULT_GOAL := help

SHELL := /bin/bash
NPM ?= npm
CARGO ?= cargo
ROOT_DIR := $(CURDIR)
TAURI_MANIFEST := src-tauri/Cargo.toml
LSP_MANIFEST := vendor/sql-lsp/Cargo.toml

COLOR_RESET := \033[0m
COLOR_BOLD := \033[1m
COLOR_GREEN := \033[32m
COLOR_YELLOW := \033[33m
COLOR_BLUE := \033[34m

help: ## Show available project commands.
	@printf "$(COLOR_BOLD)$(COLOR_BLUE)OxideStudio project commands$(COLOR_RESET)\n\n"
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target>\n\n"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  $(COLOR_GREEN)%-20s$(COLOR_RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

setup: submodules install ## Prepare submodules and Node dependencies.

install: ## Install Node dependencies.
	$(NPM) install

submodules: ## Initialize and update git submodules.
	git submodule update --init --recursive

dev: ## Start the Tauri desktop app in development mode.
	$(NPM) run tauri -- dev

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

check: build cargo-check ## Run the standard local checks without live database containers.

cargo-check: ## Check the Tauri backend without producing final binaries.
	$(CARGO) check --manifest-path $(TAURI_MANIFEST)

lsp-build: ## Build or copy the SQL LSP binary into src-tauri/binaries.
	bash src-tauri/build_prepare.sh

clean: ## Remove frontend and Rust build outputs.
	rm -rf dist
	$(CARGO) clean --manifest-path $(TAURI_MANIFEST)
	$(CARGO) clean --manifest-path $(LSP_MANIFEST)

info: ## Print toolchain and project information.
	@printf "$(COLOR_BOLD)$(COLOR_BLUE)Project$(COLOR_RESET): OxideStudio\n"
	@echo "Root: $(ROOT_DIR)"
	@echo "Node: $$($(NPM) --version)"
	@echo "Cargo: $$($(CARGO) --version)"
	@echo "Rust: $$(rustc --version)"
	@echo "Tauri manifest: $(TAURI_MANIFEST)"
	@echo "SQL LSP manifest: $(LSP_MANIFEST)"
