#!/usr/bin/env bash
# Whether a pull request's changes can affect `build`.
#
#   scripts/ci-changes.sh     # in CI: writes code=true|false to GITHUB_OUTPUT
#   scripts/ci-changes.sh -   # prints the answer for NUL-separated paths on stdin
#
# `build` is a required check, so the workflow's pull request trigger carries
# no `paths` filter: a filtered-out workflow leaves the check pending, where a
# job skipped by `if:` satisfies it. The push trigger is not required by
# anything and filters by path in the workflow itself.
#
# Every uncertain case answers true: a path no rule names, an empty diff, a
# diff that cannot be read, and any event other than a pull request.
# `scripts/ci-changes.test.sh` pins the rules.
set -euo pipefail

# Whether one changed path can affect the job. A path no rule names can.
affects() {
  case "$1" in
    # Root files are named one by one rather than matched with `*.md`, so
    # Markdown the extension packages or validates would still build.
    AGENTS.md | CLAUDE.md | README.md | LICENSE) return 1 ;;
    .agents/* | .claude/* | .codex/* | .githooks/* | docs/*) return 1 ;;
    .github/ISSUE_TEMPLATE/* | .github/PULL_REQUEST_TEMPLATE.md) return 1 ;;
    *) return 0 ;;
  esac
}

# Reads NUL-separated paths and prints true when any can affect the job.
answer() {
  local path seen=false
  while IFS= read -r -d '' path; do
    seen=true
    if affects "${path}"; then
      echo true
      return
    fi
  done
  # An empty diff cannot be told apart from one that was not read.
  if [[ "${seen}" == true ]]; then echo false; else echo true; fi
}

if [[ "${1:-}" == - ]]; then
  answer
  exit
fi

code=true
if [[ "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
  list="$(mktemp)"
  trap 'rm -f "${list}"' EXIT
  if [[ "${BASE:-}" =~ ^[0-9a-f]{40}$ && "${HEAD:-}" =~ ^[0-9a-f]{40}$ ]] &&
    git diff --name-only --no-renames -z "${BASE}...${HEAD}" -- >"${list}"; then
    code="$(answer <"${list}")"
  else
    echo "Could not classify the change; running the job."
  fi
else
  echo "Event '${GITHUB_EVENT_NAME:-}' is not classified; running the job."
fi
echo "code=${code}"
echo "code=${code}" >>"${GITHUB_OUTPUT:-/dev/null}"
