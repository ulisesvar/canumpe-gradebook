#!/bin/sh
# Run any npm script inside the dev image: ./docker-test.sh lint
exec docker compose run --rm --no-deps app npm run "$@"
