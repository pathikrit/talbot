.DEFAULT_GOAL := build
# Native and WASM builds share generated source copies.
.NOTPARALLEL:
.PHONY: bootstrap engine native dev gh-page build test test-browser bench preview clean help

bootstrap:
	sh scripts/bootstrap.sh
	npm ci

engine:
	sh scripts/build-engine.sh

native:
	sh scripts/build-engine.sh native

dev: engine
	npm run dev

build: engine
	npm run build

# GitHub Actions uploads the resulting dist/ directory to GitHub Pages.
gh-page: build

test: engine native
	npm test
	npm run test:engine

test-browser: build
	npm run test:browser

bench: engine native
	npm run bench

preview:
	npm run preview

clean:
	node scripts/clean.mjs

help:
	@echo "bootstrap    Install the pinned local SDK, engine sources, and npm dependencies"
	@echo "dev          Compile Patricia and run the local development server"
	@echo "gh-page      Build the static dist/ site for GitHub Actions / Pages"
	@echo "build        Alias build output used by gh-page"
	@echo "test         Unit tests, WASM smoke tests, and native parity checks"
	@echo "test-browser Browser tests (first: npx playwright install)"
	@echo "bench        Report native and WASM search performance"
	@echo "preview      Serve dist locally"
	@echo "clean        Remove generated engine/build/test artifacts, retaining dependencies"
