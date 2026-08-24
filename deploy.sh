#!/usr/bin/env bash
# Deploy ./public to the dataglot.ai hosting bucket and invalidate the CDN.
# Prereq: the hosting infrastructure (bucket + LB + CDN) provisioned, and
# gcloud authenticated with write access to the bucket.
#
#   ./build.sh && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${DATAGLOT_GCP_PROJECT:-peaka-dataglot}"
BUCKET="${DATAGLOT_SITE_BUCKET:-dataglot-ai-site}"
URL_MAP="${DATAGLOT_SITE_URL_MAP:-dataglot-site-https}"

[ -d public ] || { echo "No ./public — run ./build.sh first." >&2; exit 1; }

# --delete-unmatched-destination-objects keeps the bucket an exact mirror.
gcloud storage rsync ./public "gs://${BUCKET}" \
  --project "${PROJECT}" \
  --recursive \
  --delete-unmatched-destination-objects

# Short cache for HTML (so deploys show up fast); assets keep the CDN default.
gcloud storage objects update "gs://${BUCKET}/**/*.html" \
  --project "${PROJECT}" \
  --cache-control="public, max-age=300" 2>/dev/null || true

gcloud compute url-maps invalidate-cdn-cache "${URL_MAP}" \
  --project "${PROJECT}" \
  --path "/*" \
  --async

echo "Deployed to gs://${BUCKET}; CDN invalidation started."
