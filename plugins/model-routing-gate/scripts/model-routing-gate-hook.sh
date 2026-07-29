#!/bin/sh
# Resolve the hook runtime without changing the host environment.
# Priority: explicit plugin override, Volta, NVM, then PATH.

set -eu

case "$0" in
  */*) script_dir=${0%/*} ;;
  *) script_dir=. ;;
esac
script_dir=$(CDPATH= cd "$script_dir" && pwd)
entrypoint="$script_dir/model-routing-gate.mjs"

healthy_node() {
  [ -n "${1:-}" ] && [ -x "$1" ] || return 1
  node_version=$("$1" -p 'process.versions.node' </dev/null 2>/dev/null) || return 1
  case "$node_version" in
    *[!0-9.]* | *..* | .* | *.) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  set -- $node_version
  IFS=$old_ifs
  [ "$#" -eq 3 ] || return 1
  for version_part in "$@"; do
    case "$version_part" in
      0 | [1-9] | [1-9][0-9]*) ;;
      *) return 1 ;;
    esac
  done
  [ "$1" -ge 20 ] 2>/dev/null
}

run_node() {
  if healthy_node "$1"; then
    node_runtime=$1
    shift
    exec "$node_runtime" "$entrypoint" "$@"
  fi
}

if [ -n "${MODEL_ROUTING_GATE_NODE:-}" ]; then
  run_node "$MODEL_ROUTING_GATE_NODE" "$@"
fi

if [ -n "${VOLTA_HOME:-}" ]; then
  run_node "$VOLTA_HOME/bin/node" "$@"
fi
run_node "${HOME:-}/.volta/bin/node" "$@"

if [ -n "${NVM_BIN:-}" ]; then
  run_node "$NVM_BIN/node" "$@"
fi

path_node=$(command -v node 2>/dev/null || true)
if [ -n "$path_node" ]; then
  run_node "$path_node" "$@"
fi

printf '%s\n' 'model-routing-gate: no healthy Node runtime available' >&2
exit 127
