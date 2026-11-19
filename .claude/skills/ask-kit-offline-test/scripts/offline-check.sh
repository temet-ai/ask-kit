#!/usr/bin/env bash
# Prove ask-kit test files keep the project's test rules: each one is in `npm test`, names no real
# machine path or outside host, and passes with no network, an empty home, no API keys and a time
# limit, without writing to the home's ask-kit config or state.
#
#   bash .claude/skills/ask-kit-offline-test/scripts/offline-check.sh test/<name>.mjs [...]
#
# Run from the repository root. OFFLINE_TIMEOUT (seconds, default 60) bounds each file.
set -u
[ $# -ge 1 ] || { echo "usage: offline-check.sh test/<name>.mjs [...]" >&2; exit 2; }
[ -f package.json ] && [ -f bin/ask-kit.mjs ] || { echo "run from the ask-kit repository root" >&2; exit 2; }
limit=${OFFLINE_TIMEOUT:-60}
isolate=1
unshare -rn true 2>/dev/null || { isolate=0; echo "warn: unshare -rn is not available here; the network is NOT isolated" >&2; }
fails=0

for f in "$@"; do
  before=$fails
  bad() { echo "FAIL $f: $1"; fails=$((fails + 1)); }
  [ -f "$f" ] || { bad "no such file"; continue; }
  # npm test runs every test/*.mjs through test/run.mjs, except run.mjs and adapters.mjs.
  case "${f#./}" in test/run.mjs|test/adapters.mjs) bad "test/run.mjs skips this file, so npm test never runs it";; test/*/*) bad "npm test runs only files directly in test/";; test/*.mjs) ;; *) bad "npm test runs only test/*.mjs";; esac
  if hits=$(grep -nE '/mnt/data/|/home/[a-z]|/Users/[A-Za-z]|~/\.config|\.config/ask-kit|temet/kit/|\.local/state/ask-kit' "$f"); then
    bad "names a real machine path (use a temp dir or test/fixtures/):"$'\n'"$hits"
  fi
  if hits=$(grep -noE 'https?://[A-Za-z0-9.-]+' "$f" | grep -vE '://(127\.0\.0\.1|localhost|\[::1\]|([A-Za-z0-9-]+\.)*example\.(com|org|net)|[A-Za-z0-9.-]+\.invalid)$'); then
    bad "names an outside host (use 127.0.0.1, example.com or .invalid):"$'\n'"$hits"
  fi

  home=$(mktemp -d)
  mkdir -p "$home/tmp"
  run="node $(printf %q "$f")"
  [ $isolate = 1 ] && cmd=(unshare -rn sh -c "ip link set lo up 2>/dev/null; $run") || cmd=(sh -c "$run")
  out=$(env -i PATH="$PATH" HOME="$home" TMPDIR="$home/tmp" LANG=C.UTF-8 timeout "$limit" "${cmd[@]}" 2>&1)
  code=$?
  if [ $code = 124 ]; then
    bad "did not exit within ${limit}s: close MCP clients and servers you opened, then end with console.log(\"ok\"); process.exit(0)"
  elif [ $code != 0 ]; then
    bad "exit $code with no network and an empty home:"$'\n'"$(printf '%s\n' "$out" | tail -15)"
  elif [ "$(printf '%s\n' "$out" | tail -1)" != "ok" ]; then
    bad "passed but its last line is not \"ok\""
  fi
  if [ -e "$home/.config/ask-kit" ] || [ -e "$home/.local/state/ask-kit" ]; then
    bad "wrote to the home's ask-kit config or state: set ASK_KIT_CONFIG and ASK_KIT_STATE to a temp dir before importing anything from src/ (and pass them to child servers)"
  fi
  rm -rf "$home"
  [ $fails = "$before" ] && echo "ok   $f"
done

[ $fails = 0 ] || { echo "$fails problem(s)"; exit 1; }
