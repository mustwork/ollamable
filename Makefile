SHELL := /bin/zsh

.PHONY: install clean build test test-unit test-e2e start dev help

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.* ## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

clean: ## Remove build artifacts
	rm -rf .next out test-results

build: ## Clean and build the project
	$(MAKE) clean
	npm run build

test: ## Run all tests (unit + e2e)
	npm run test:unit
	npm run test:e2e

test-unit: ## Run unit tests
	npm run test:unit

test-e2e: ## Run end-to-end tests
	npm run test:e2e

start: build ## Build and start production server (port 3000)
	node --import tsx server/index.ts

dev: ## Clean and start frontend + backend dev servers
	$(MAKE) clean
	npm run dev:auto
