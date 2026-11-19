#!/usr/bin/env bash
# Run `kit test` (real model calls) from this checkout against the installed kits without
# touching the live ~/.config/ask-kit. `kit test` asks through `ask-kit ask`, which starts
# `serve`, and `serve` rewrites the config folder's AGENTS.md with the running checkout's paths;
# from a clone or worktree that points every agent's guide at a temporary folder. Here the config
# folder is a scratch folder of symlinks to the live files, so the kits, backends and keys are the
# installed ones and the guide is written into the scratch folder.
#
#   bash .claude/skills/ask-kit-kit-test/scripts/kit-test.sh <kit> --backends a,b [--only id,id] [--out file.json]
#
# Run from the repository root. ASK_KIT_STATE passes through (default: the live state folder,
# where per-question journals land as <kit>/kittest-<kit>-<time>-<backend>-<id>.jsonl).
set -u
[ $# -ge 1 ] || { echo "usage: kit-test.sh <kit> --backends a,b [--only id,id] [--out file.json]" >&2; exit 2; }
[ -f bin/ask-kit.mjs ] || { echo "run from the ask-kit repository root" >&2; exit 2; }
live=${XDG_CONFIG_HOME:-$HOME/.config}/ask-kit
[ -f "$live/config.json" ] || { echo "no installed config at $live" >&2; exit 2; }
cfg=$(mktemp -d "${TMPDIR:-/tmp}/ask-kit-kittest-XXXXXX")
trap 'rm -rf "$cfg"' EXIT
for f in config.json keys.env installed.json kits domains; do
  [ -e "$live/$f" ] && ln -s "$live/$f" "$cfg/$f"
done
before=$(sha256sum "$live/AGENTS.md" 2>/dev/null)
ASK_KIT_CONFIG=$cfg node bin/ask-kit.mjs kit test "$@"
code=$?
[ "$before" = "$(sha256sum "$live/AGENTS.md" 2>/dev/null)" ] || echo "warn: $live/AGENTS.md changed during the run" >&2
exit $code
