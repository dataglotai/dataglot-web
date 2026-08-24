#!/usr/bin/env bash
# Full production build: Zola → llms.txt pipeline → Pagefind indexes.
# Output lands in ./public, ready to rsync to the hosting bucket.
set -euo pipefail
cd "$(dirname "$0")"

zola --config config.prod.toml build

npm install --no-fund --no-audit
node build-pipeline.js

npx --yes pagefind@1 --site public --glob "docs/**/*.html" --output-subdir pagefind-docs
npx --yes pagefind@1 --site public --glob "guides/**/*.html" --output-subdir pagefind-guides
npx --yes pagefind@1 --site public --glob "blog/**/*.html" --output-subdir pagefind-blog

echo "Build complete: ./public"
