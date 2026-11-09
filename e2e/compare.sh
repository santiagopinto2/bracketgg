#!/bin/sh
# Builds this branch and main, serves both, and runs e2e/api-calls.mjs on each.
# Reports go to e2e-out/. Exits with the branch run's result. Meant for a fleet job or CI, not the VM.
set -u
export NODE_OPTIONS=--max-old-space-size=1536 NG_BUILD_MAX_WORKERS=2
export STARTGG_CLIENT_ID=test STARTGG_CLIENT_SECRET=unused-in-browser STARTGG_REDIRECT_URI=http://localhost/callback
out=e2e-out
mkdir -p $out

npm ci --no-audit --no-fund > $out/npm-ci.log 2>&1 || { tail -30 $out/npm-ci.log; echo "npm ci failed"; exit 1; }
echo "npm ci: ok"

node e2e/gql-cache.mjs > $out/gql-cache.json 2>&1 || { cat $out/gql-cache.json; echo "gql-cache tests failed"; exit 1; }
echo "gql-cache: ok"

node scripts/generate-env.js || exit 1
npx ng build > $out/build-branch.log 2>&1 || { tail -50 $out/build-branch.log; exit 1; }
echo "branch build: ok"
node scripts/check-bundle.js dist/bracketgg/browser unused-in-browser || exit 1
mkdir -p /tmp/leak && echo "const e={clientSecret:'not-the-placeholder'};" > /tmp/leak/main.js
if node scripts/check-bundle.js /tmp/leak unused-in-browser 2> /dev/null; then echo "check-bundle.js missed a leaked secret"; exit 1; fi
echo "check-bundle.js: ok"
cp -r dist/bracketgg/browser /tmp/app-branch

git checkout -q "${BASE_REF:-main}" -- src
npx ng build > $out/build-main.log 2>&1 || { tail -50 $out/build-main.log; exit 1; }
echo "main build: ok"
cp -r dist/bracketgg/browser /tmp/app-main
git checkout -q HEAD -- src

npm install --no-save --no-audit --no-fund --loglevel=error playwright > /dev/null || exit 1
npx playwright install --with-deps chromium webkit > $out/playwright-install.log 2>&1 || { tail -30 $out/playwright-install.log; exit 1; }

PORT=4301 STATIC_DIR=/tmp/app-main node proxy-server.js > $out/server-main.log 2>&1 &
PORT=4302 STATIC_DIR=/tmp/app-branch node proxy-server.js > $out/server-branch.log 2>&1 &
sleep 3

node e2e/api-calls.mjs http://localhost:4301 --report-only > $out/main.json 2> $out/main.err
echo "main run exit: $?"
node e2e/api-calls.mjs http://localhost:4302 > $out/branch.json 2> $out/branch.err
status=$?
echo "branch run exit: $status"
cat $out/branch.json
exit $status
