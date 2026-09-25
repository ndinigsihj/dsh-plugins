#!/usr/bin/env bash
# Ticket 10 shared helpers for the evidence scripts.
#
# Host anchor: the dsh package whose install provides the host under test.
# T10_ANCHOR overrides; otherwise derive it from the global npm install, with
# the machine-local fallback recorded in the ticket evidence.
t10_anchor() {
  if [ -n "${T10_ANCHOR:-}" ]; then printf '%s\n' "$T10_ANCHOR"; return; fi
  local prefix candidate
  prefix="$(npm prefix -g 2>/dev/null || true)"
  candidate="${prefix:+$prefix/lib/node_modules/@deepseek-ai/dsh/package.json}"
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then printf '%s\n' "$candidate"; return; fi
  printf '%s\n' "/Users/vito/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/package.json"
}

# Run one probe process against a probe home.
#   t10_probe <probe-home> <read|write> <ids-file> <out-file>
# PROBE_SCRIPT must point at 10-probe-open.mjs.
t10_probe() {
  local home="$1" mode="$2" ids="$3" out="$4" anchor
  anchor="$(t10_anchor)"
  T10_HOME="$home" T10_PROFILE=t10 T10_ANCHOR="$anchor" DSH_HOME="$home" \
    node "$PROBE_SCRIPT" "$mode" "$ids" > "$out"
}
