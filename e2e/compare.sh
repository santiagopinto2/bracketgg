#!/bin/sh
# CI's checks, in four parts that run side by side as separate jobs (.github/workflows/ci.yml):
#   sh e2e/compare.sh branch   unit-style checks (gql-cache, prefetch-plan), this branch's build, e2e/api-calls.mjs, and e2e/auth.mjs
#   sh e2e/compare.sh main     the base branch's build through e2e/api-calls.mjs, as a report only
#   sh e2e/compare.sh visual   both builds' screenshots, pixel for pixel (e2e/visual-diff.mjs)
#   sh e2e/compare.sh live     the checks against the real start.gg, then a browser walk through real brackets
#                              (needs STARTGG_TOKEN; the walk never fails the run)
# With no part it runs all four, one after another. Reports go to e2e-out/.
# Meant for a fleet job or CI, not the VM.
set -u
part=${1:-all}
export NODE_OPTIONS=--max-old-space-size=1536 NG_BUILD_MAX_WORKERS=2
# The secret is only for older generate-env.js versions (the base branch), which still require it
export STARTGG_CLIENT_ID=test STARTGG_CLIENT_SECRET=unused-in-browser STARTGG_REDIRECT_URI=http://localhost/callback
out=e2e-out
mkdir -p $out

install() {
  npm ci --no-audit --no-fund > $out/npm-ci.log 2>&1 || { tail -30 $out/npm-ci.log; echo "npm ci failed"; exit 1; }
  echo "npm ci: ok"
}

build_branch() {
  [ -d /tmp/app-branch ] && return
  node scripts/generate-env.js || exit 1
  npx ng build > $out/build-branch.log 2>&1 || { tail -50 $out/build-branch.log; exit 1; }
  echo "branch build: ok"
  cp -r dist/bracketgg/browser /tmp/app-branch
}

# The base branch builds from its own checkout with its own dependencies and Angular config, so an
# upgrade or a config change shows up as a difference instead of being built into both
build_main() {
  [ -d /tmp/app-main ] && return
  git worktree add -q --detach /tmp/main-src "${BASE_REF:-main}" || exit 1
  (cd /tmp/main-src && npm ci --no-audit --no-fund > /dev/null 2>&1 && node scripts/generate-env.js > /dev/null && npx ng build) > $out/build-main.log 2>&1 || { tail -50 $out/build-main.log; exit 1; }
  echo "main build: ok"
  cp -r /tmp/main-src/dist/bracketgg/browser /tmp/app-main
  git worktree remove --force /tmp/main-src
}

browsers() {
  [ -n "${browsers_ready:-}" ] && return
  npm install --no-save --no-audit --no-fund --loglevel=error playwright pixelmatch pngjs > /dev/null || exit 1
  npx playwright install --with-deps chromium webkit > $out/playwright-install.log 2>&1 || { tail -30 $out/playwright-install.log; exit 1; }
  browsers_ready=1
}

# serve <build dir> <port>: the site's own server for that build, in the background
serve() {
  PORT=$2 STATIC_DIR=$1 node proxy-server.js > $out/server-$2.log 2>&1 &
  sleep 3
}

status=0

run_branch() {
  # Without the token here: its live part runs in the live job
  env -u STARTGG_TOKEN node e2e/gql-cache.mjs > $out/gql-cache.json 2>&1 || { cat $out/gql-cache.json; echo "gql-cache tests failed"; exit 1; }
  echo "gql-cache: ok"
  node e2e/prefetch-plan.mjs > $out/prefetch-plan.json 2>&1 || { cat $out/prefetch-plan.json; echo "prefetch-plan tests failed"; exit 1; }
  echo "prefetch-plan: ok"
  build_branch
  node scripts/check-bundle.js dist/bracketgg/browser unused-in-browser || exit 1
  mkdir -p /tmp/leak && echo "const e={clientSecret:'not-the-placeholder'};" > /tmp/leak/main.js
  if node scripts/check-bundle.js /tmp/leak unused-in-browser 2> /dev/null; then echo "check-bundle.js missed a leaked secret"; exit 1; fi
  echo "check-bundle.js: ok"


  browsers
  serve /tmp/app-branch 4302
  node e2e/api-calls.mjs http://localhost:4302 > $out/branch.json 2> $out/branch.err
  branch=$?
  echo "branch run exit: $branch"
  cat $out/branch.json
  [ $branch -ne 0 ] && status=1

  # The server's login, sessions, site token, query allowlist and security headers, against a fake start.gg
  node e2e/auth.mjs /tmp/app-branch 4303 > $out/auth.json 2> $out/auth.err
  auth=$?
  echo "auth run exit: $auth"
  cat $out/auth.json; tail -20 $out/auth.err
  [ $auth -ne 0 ] && status=1
}

run_main() {
  build_main
  browsers
  serve /tmp/app-main 4301
  node e2e/api-calls.mjs http://localhost:4301 --report-only > $out/main.json 2> $out/main.err
  echo "main run exit: $?"
}

# The same pages from both builds, pixel for pixel. A PR that changes the look on purpose gets the
# visual-change label (VISUAL_CHANGES_OK=true), which keeps the report but doesn't fail on it.
run_visual() {
  build_branch
  build_main
  browsers
  serve /tmp/app-main 4311
  serve /tmp/app-branch 4312
  # One after the other: two browsers at once on a small runner could change what the screenshots catch
  node e2e/api-calls.mjs http://localhost:4311 --screenshots $out/visual/main > $out/visual-main.log 2>&1
  node e2e/api-calls.mjs http://localhost:4312 --screenshots $out/visual/branch > $out/visual-branch.log 2>&1
  node e2e/visual-diff.mjs $out/visual/main $out/visual/branch $out/visual/diff > $out/visual-diff.json 2>&1
  visual=$?
  cat $out/visual-diff.json
  if [ $visual -ne 0 ]; then
    if [ "${VISUAL_CHANGES_OK:-false}" = true ]; then echo "visual differences allowed by the visual-change label"
    else echo "visual differences from the base branch (diff images in e2e-out/visual/diff)"; status=1; fi
  fi
}

# With Santi's start.gg token, the checks against the real start.gg. Only the live part runs them, so
# one job per CI run talks to start.gg and the parallel jobs don't trip its rate limit together.
live_api_checks() {
  # The shared cache against the real start.gg (e2e/gql-cache.mjs runs its live part when the token is set)
  node e2e/gql-cache.mjs > $out/gql-cache-live.json 2>&1 || { cat $out/gql-cache-live.json; echo "live gql-cache check failed"; exit 1; }
  echo "live gql-cache: ok"
  # With Santi's start.gg token: a real multi-pool phase fetched in pool slices must match each pool fetched alone
  node e2e/live-phase-sets.mjs > $out/live-phase-sets.json 2>&1 || { cat $out/live-phase-sets.json; echo "live phase sets check failed"; exit 1; }
  echo "live phase sets: $(head -c 80 $out/live-phase-sets.json | tr -d '\n')"
  # With the token: scores read from displayScore must equal start.gg's own score fields on real sets
  node --experimental-strip-types e2e/live-display-score.mjs > $out/live-display-score.json 2> $out/live-display-score.err || { cat $out/live-display-score.json $out/live-display-score.err; echo "live displayScore check failed"; exit 1; }
  echo "live displayScore: ok"
  # With the token: a phase's players, profile pictures only, and the top 8's losses, from the real start.gg
  node --experimental-strip-types e2e/live-players.mjs > $out/live-players.json 2> $out/live-players.err || { cat $out/live-players.json $out/live-players.err; echo "live players check failed"; exit 1; }
  echo "live players: ok"
  # With the token: the next phase's seeds for a real pool, what asking costs, each player's last set, and that a player keeps their entrant id in the next phase
  node --experimental-strip-types e2e/live-progression.mjs > $out/live-progression.json 2> $out/live-progression.err || { cat $out/live-progression.json $out/live-progression.err; echo "live progression check failed"; exit 1; }
  echo "live progression: ok"
}

# With the token: a browser walk through real brackets (Genesis X) for the progression tags, in dark mode.
# Screenshots and a report in e2e-out/live-bracket; it never fails the run.
run_live() {
  [ -n "${STARTGG_TOKEN:-}" ] || { echo "no STARTGG_TOKEN: live checks skipped"; return; }
  live_api_checks
  build_branch
  browsers
  PORT=4304 STATIC_DIR=/tmp/app-branch STARTGG_SITE_TOKEN="$STARTGG_TOKEN" node proxy-server.js > $out/server-live.log 2>&1 &
  sleep 3
  node e2e/live-bracket.mjs http://localhost:4304 $out/live-bracket > $out/live-bracket.json 2> $out/live-bracket.err
  cat $out/live-bracket.json
}

install
case $part in
  branch) run_branch ;;
  main) run_main ;;
  visual) run_visual ;;
  live) run_live ;;
  all) run_branch; run_main; run_visual; run_live ;;
  *) echo "unknown part: $part (branch, main, visual, live, or nothing for all)"; exit 2 ;;
esac
exit $status
