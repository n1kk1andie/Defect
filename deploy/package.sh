#!/usr/bin/env bash
#
# Build a SELF-CONTAINED deployment bundle for vmbs-defect that runs on a plain
# GICT Linux server with `node server.js` — NO npm install needed on the target.
#
# Output: dist/vmbs-defect.zip  (unzip, then run `node server.js`, or use the
#         bundled systemd unit). See DEPLOYMENT.md for the full runbook.
#
set -euo pipefail
cd "$(dirname "$0")/.."          # repo root

APP="vmbs-defect"
OUT="dist"
STAGE="$OUT/$APP"

echo "==> Cleaning previous output"
rm -rf "$STAGE" "$OUT/$APP.zip" .next
mkdir -p "$STAGE"

echo "==> Installing dependencies (locked)"
npm ci --no-audit --no-fund

echo "==> Building standalone Next.js bundle"
BUILD_STANDALONE=1 npm run build

echo "==> Assembling self-contained runtime"
# The standalone folder already carries a minimal node_modules + server.js.
cp -r .next/standalone/. "$STAGE/"
# Static assets and public/ are NOT included by Next automatically — add them.
mkdir -p "$STAGE/.next"
cp -r .next/static "$STAGE/.next/static"
[ -d public ] && cp -r public "$STAGE/public"
# Ship the ops docs and service file inside the bundle so it is self-describing.
cp deploy/vmbs-defect.service "$STAGE/" 2>/dev/null || true
cp deploy/nginx.conf.example "$STAGE/" 2>/dev/null || true
cp DEPLOYMENT.md "$STAGE/" 2>/dev/null || true

echo "==> Zipping"
( cd "$OUT" && rm -f "$APP.zip" && zip -qr "$APP.zip" "$APP" )

echo ""
echo "==> Done."
echo "    Bundle: $OUT/$APP.zip"
echo "    Run:    unzip $APP.zip && cd $APP && PORT=3003 node server.js"
