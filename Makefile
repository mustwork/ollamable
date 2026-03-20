SHELL := /bin/zsh

.PHONY: install clean build test test-unit test-e2e run

install:
	npm install

clean:
	rm -rf .next out test-results

build:
	$(MAKE) clean
	npm run build

test:
	npm run test:unit
	npm run test:e2e

test-unit:
	npm run test:unit

test-e2e:
	npm run test:e2e

run:
	$(MAKE) clean
	npm run dev:auto
