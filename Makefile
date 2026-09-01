# Thin delegation to the canonical bun scripts in package.json.
# `make` is optional on this project; every target below has a `bun run` equivalent.
.PHONY: check test cli-smoke db-migrate lint typecheck

check:      ; bun run check
lint:       ; bun run lint
typecheck:  ; bun run typecheck
test:       ; bun test
cli-smoke:  ; bun run smoke
db-migrate: ; bun run src/cli/main.ts db migrate
