#!/bin/sh
# Builds this branch and main, serves both, and runs e2e/api-calls.mjs on each.
# Reports go to e2e-out/. Exits with the branch run's result. Meant for a fleet job or CI, not the VM.
set -u
export NODE_OPTIONS=--max-old-space-size=1536 NG_BUILD_MAX_WORKERS=2
# The secret is only for older generate-env.js versions (the base branch), which still require it
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

# The base branch builds from its own checkout with its own dependencies and Angular config, so an
# upgrade or a config change shows up as a difference instead of being built into both
git worktree add -q --detach /tmp/main-src "${BASE_REF:-main}" || exit 1
(cd /tmp/main-src && npm ci --no-audit --no-fund > /dev/null 2>&1 && node scripts/generate-env.js > /dev/null && npx ng build) > $out/build-main.log 2>&1 || { tail -50 $out/build-main.log; exit 1; }
echo "main build: ok"
cp -r /tmp/main-src/dist/bracketgg/browser /tmp/app-main
git worktree remove --force /tmp/main-src

# Bundle sizes in bytes, base then branch
size_of() { find "$1" -maxdepth 1 -name "$2" -exec cat {} + | wc -c; }
for f in 'main-*.js' 'styles-*.css' '*.js'; do
  echo "$f: main $(size_of /tmp/app-main "$f"), branch $(size_of /tmp/app-branch "$f")"
done | tee $out/bundle-sizes.txt

# With Santi's start.gg token: a real multi-pool phase fetched whole must match each pool fetched alone
node e2e/live-phase-sets.mjs > $out/live-phase-sets.json 2>&1 || { cat $out/live-phase-sets.json; echo "live phase sets check failed"; exit 1; }
echo "live phase sets: $(head -c 80 $out/live-phase-sets.json | tr -d '\n')"
# With the token: scores read from displayScore must equal start.gg's own score fields on real sets
node --experimental-strip-types e2e/live-display-score.mjs > $out/live-display-score.json 2> $out/live-display-score.err || { cat $out/live-display-score.json $out/live-display-score.err; echo "live displayScore check failed"; exit 1; }
echo "live displayScore: ok"

npm install --no-save --no-audit --no-fund --loglevel=error playwright pixelmatch pngjs > /dev/null || exit 1
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

# The server's login, sessions, site token, query allowlist and security headers, against a fake start.gg
node e2e/auth.mjs /tmp/app-branch 4303 > $out/auth.json 2> $out/auth.err
auth=$?
echo "auth run exit: $auth"
cat $out/auth.json; tail -20 $out/auth.err
[ $auth -ne 0 ] && status=1

# The same pages from both builds, pixel for pixel. A PR that changes the look on purpose gets the
# visual-change label (VISUAL_CHANGES_OK=true), which keeps the report but doesn't fail on it.
node e2e/api-calls.mjs http://localhost:4301 --screenshots $out/visual/main > /dev/null 2>&1
node e2e/api-calls.mjs http://localhost:4302 --screenshots $out/visual/branch > /dev/null 2>&1
node e2e/visual-diff.mjs $out/visual/main $out/visual/branch $out/visual/diff > $out/visual-diff.json 2>&1
visual=$?
cat $out/visual-diff.json
if [ $visual -ne 0 ]; then
  if [ "${VISUAL_CHANGES_OK:-false}" = true ]; then echo "visual differences allowed by the visual-change label"
  else echo "visual differences from the base branch (diff images in e2e-out/visual/diff)"; [ $status -eq 0 ] && status=1; fi
fi
exit $status
