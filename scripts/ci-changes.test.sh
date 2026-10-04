#!/usr/bin/env bash
# Pins scripts/ci-changes.sh: which pull requests run `build`, that the job
# reads the answer, and that only a readable pull request diff can skip it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${here}/.." && pwd)"
classifier="${here}/ci-changes.sh"
failed=0

check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "ok: $1"
  else
    echo "FAIL: $1: expected $3, got $2"
    failed=1
  fi
}

# runs <description> <expected> <path>...
runs() {
  local what="$1" want="$2"
  shift 2
  if (($# == 0)); then
    check "${what}" "$(: | bash "${classifier}" -)" "${want}"
  else
    check "${what}" "$(printf '%s\0' "$@" | bash "${classifier}" -)" "${want}"
  fi
}

# What needs no CI.
runs "the agent instructions" false AGENTS.md CLAUDE.md
runs "the readme and the licence" false README.md LICENSE
runs "skills and agent settings" false .agents/skills/x/SKILL.md .claude/settings.json .codex/config.toml .githooks/pre-push
runs "a script inside an agent directory" false .agents/skills/x/helper.py
runs "documentation" false docs/guide.md
runs "the issue and pull request templates" false .github/ISSUE_TEMPLATE/bug.yml .github/PULL_REQUEST_TEMPLATE.md

# What must run.
runs "a source file" true src/marfa.ts
runs "a test" true test/keys.test.ts
runs "an asset the extension packages" true assets/icon.png
runs "Markdown the extension may package" true assets/notes.md CHANGELOG.md
runs "the manifest" true package.json
runs "the lockfile" true package-lock.json
runs "the version guard" true scripts/check-withmarfa-versions.cjs
runs "the classifier" true scripts/ci-changes.sh
runs "a workflow" true .github/workflows/ci.yml
runs "Dependabot's settings" true .github/dependabot.yml
runs "the AI tool definitions" true ai.yaml
runs "a path no rule names" true tools/new.ts
runs "a look-alike of an agent directory" true agents/notes.md
runs "an agent file beside source" true AGENTS.md src/marfa.ts
runs "an empty change" true

# The gate on the job, read from the workflow.
workflow="${root}/.github/workflows/ci.yml"
gate="if: \${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.code != 'false') }}"
check "build reads the answer" "$(grep -cF "${gate}" "${workflow}")" 1
check "build keeps its job id, which is its check name" "$(grep -cE '^  build:$' "${workflow}")" 1
check "build has no name that would change the check" "$(awk '/^  build:$/{f=1;next} /^  [a-z]/{f=0} f&&/^    name:/' "${workflow}" | wc -l | tr -d ' ')" 0
check "the classifier runs in CI" "$(grep -cF "run: bash scripts/ci-changes.sh" "${workflow}")" 1
check "the classifier's own test runs in CI" "$(grep -cF "run: bash scripts/ci-changes.test.sh" "${workflow}")" 1
# Only the push trigger may filter: build is required on pull requests.
pr_block="$(awk '/^  pull_request:/{f=1;print;next} /^  [a-z]/{f=0} f' "${workflow}")"
check "the pull request trigger filters no paths" "$(printf '%s' "${pr_block}" | grep -cE 'paths')" 0
for dir in .agents .claude .codex .githooks; do
  check "the push trigger ignores ${dir}" "$(grep -cF "'${dir}/**'" "${workflow}")" 1
done

# As CI runs it, against a repository with real commits.
repo="$(mktemp -d)"
trap 'rm -rf "${repo}"' EXIT
git_in() { git -C "${repo}" -c user.email=fixture@example.invalid -c user.name=Fixture -c commit.gpgsign=false "$@"; }
git_in init -q
mkdir -p "${repo}/src" "${repo}/.agents/skills"
echo code >"${repo}/src/marfa.ts"
echo skill >"${repo}/.agents/skills/skill.md"
echo rules >"${repo}/AGENTS.md"
git_in add -A
git_in commit -q -m base
base="$(git_in rev-parse HEAD)"

commit_change() { # commit_change <message>
  git_in add -A
  git_in commit -q -m "$1"
  git_in rev-parse HEAD
}

echo reworded >>"${repo}/AGENTS.md"
echo reworded >>"${repo}/.agents/skills/skill.md"
instructions="$(commit_change "agent words")"

echo changed >>"${repo}/src/marfa.ts"
source_change="$(commit_change "source")"

git_in mv src/marfa.ts .agents/skills/marfa.ts
moved_out="$(commit_change "move source into an agent directory")"

git_in mv .agents/skills/skill.md src/skill.md
moved_in="$(commit_change "move a skill out of an agent directory")"

ci() { # ci <event> <base> <head>
  local output="${repo}/output"
  : >"${output}"
  (cd "${repo}" && GITHUB_EVENT_NAME="$1" BASE="$2" HEAD="$3" GITHUB_OUTPUT="${output}" bash "${classifier}" >/dev/null)
  cat "${output}"
}

check "an instruction-only pull request skips the job" "$(ci pull_request "${base}" "${instructions}")" code=false
check "a source change runs it" "$(ci pull_request "${instructions}" "${source_change}")" code=true
check "source moved into an agent directory runs it, for the deletion" "$(ci pull_request "${source_change}" "${moved_out}")" code=true
check "a skill moved out of an agent directory runs it, for the addition" "$(ci pull_request "${moved_out}" "${moved_in}")" code=true
check "a mixed range runs it" "$(ci pull_request "${base}" "${moved_in}")" code=true
check "an unreadable diff runs it" "$(ci pull_request invalid "${instructions}")" code=true
check "a missing head runs it" "$(ci pull_request "${base}" "")" code=true
check "an unknown commit runs it" "$(ci pull_request 1111111111111111111111111111111111111111 "${instructions}" 2>/dev/null)" code=true
check "an identical pair runs it, as an empty diff" "$(ci pull_request "${instructions}" "${instructions}")" code=true
check "a push runs it" "$(ci push "${base}" "${instructions}")" code=true
check "a manual run runs it" "$(ci workflow_dispatch "${base}" "${instructions}")" code=true

exit "${failed}"
