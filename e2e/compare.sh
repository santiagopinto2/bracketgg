#!/bin/sh
# Builds this branch and main, serves both, and runs e2e/api-calls.mjs on each.
# Reports go to e2e-out/. Exits with the branch run's result. Meant for a fleet job or CI, not the VM.
set -u
export NODE_OPTIONS=--max-old-space-size=1536 NG_BUILD_MAX_WORKERS=2
export STARTGG_CLIENT_ID=test STARTGG_CLIENT_SECRET=unused-in-browser STARTGG_REDIRECT_URI=http://localhost/callback
out=e2e-out
mkdir -p $out

if npm ci --no-audit --no-fund > $out/npm-ci.log 2>&1; then echo "npm ci: ok" | tee $out/npm-ci-result.txt
else
  echo "npm ci: FAILED" | tee $out/npm-ci-result.txt
  git checkout -q -- package-lock.json
  npm install --no-audit --no-fund --loglevel=error || exit 1
fi

node scripts/generate-env.js || exit 1
npx ng build > $out/build-branch.log 2>&1 || { tail -50 $out/build-branch.log; exit 1; }
echo "branch build: ok"
cp -r dist/bracketgg/browser /tmp/app-branch

git checkout -q main -- src
npx ng build > $out/build-main.log 2>&1 || { tail -50 $out/build-main.log; exit 1; }
echo "main build: ok"
cp -r dist/bracketgg/browser /tmp/app-main
git checkout -q HEAD -- src

npm install --no-save --no-audit --no-fund --loglevel=error playwright > /dev/null || exit 1
npx playwright install --with-deps chromium > $out/playwright-install.log 2>&1 || { tail -30 $out/playwright-install.log; exit 1; }

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
