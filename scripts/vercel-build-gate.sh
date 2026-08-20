#!/usr/bin/env bash
set -uo pipefail

WATCH_PATHS="${BUILD_GATE_WATCH_PATHS:-.}"
READY_LABEL="${BUILD_GATE_READY_LABEL:-preview}"
BLOCK_LABEL="${BUILD_GATE_BLOCK_LABEL:-no-preview}"

announce() { echo "[build-gate] $*" >&2; }
build() { announce "BUILD - $1"; exit 1; }
skip() { announce "SKIP - $1"; exit 0; }

if [ "${VERCEL_ENV:-}" = "production" ]; then
	build "production deployment"
fi

REPO_OWNER="${VERCEL_GIT_REPO_OWNER:-}"
REPO_SLUG="${VERCEL_GIT_REPO_SLUG:-}"
if [ -z "$REPO_OWNER" ] || [ -z "$REPO_SLUG" ]; then
	build "system environment variables are not exposed to this build so pull request state is unreadable, failing open"
fi

PR_ID="${VERCEL_GIT_PULL_REQUEST_ID:-}"
if [ -z "$PR_ID" ]; then
	skip "branch has no open pull request, nothing to preview yet"
fi

if [ -z "${BUILD_GATE_GITHUB_TOKEN:-}" ]; then
	build "BUILD_GATE_GITHUB_TOKEN is unset so pull request state cannot be read, failing open"
fi

if ! PR_JSON="$(curl -sS --max-time 15 \
	-H "Authorization: Bearer ${BUILD_GATE_GITHUB_TOKEN}" \
	-H "Accept: application/vnd.github+json" \
	-H "X-GitHub-Api-Version: 2022-11-28" \
	"https://api.github.com/repos/${REPO_OWNER}/${REPO_SLUG}/pulls/${PR_ID}")"; then
	build "GitHub API unreachable, failing open"
fi

if [ -z "$PR_JSON" ]; then
	build "GitHub API returned an empty response, failing open"
fi

VERDICT="$(
	PR_JSON="$PR_JSON" READY_LABEL="$READY_LABEL" BLOCK_LABEL="$BLOCK_LABEL" node -e '
	try {
		const pr = JSON.parse(process.env.PR_JSON);
		const wellFormed =
			pr &&
			typeof pr.draft === "boolean" &&
			Number.isInteger(pr.number) &&
			pr.number > 0 &&
			Array.isArray(pr.labels) &&
			pr.labels.every((label) => label && typeof label.name === "string");
		if (!wellFormed) {
			console.log("unknown:pull request payload was not a complete pull request");
			process.exit(0);
		}
		const labels = pr.labels.map((label) => label.name.toLowerCase());
		if (labels.includes(process.env.BLOCK_LABEL.toLowerCase())) {
			console.log(`skip:pull request ${pr.number} carries the ${process.env.BLOCK_LABEL} label`);
		} else if (labels.includes(process.env.READY_LABEL.toLowerCase())) {
			console.log(`build:pull request ${pr.number} carries the ${process.env.READY_LABEL} label`);
		} else if (pr.draft) {
			console.log(`skip:pull request ${pr.number} is still a draft, mark it ready for review to start previews`);
		} else {
			console.log(`build:pull request ${pr.number} is ready for review`);
		}
	} catch (error) {
		console.log(`unknown:${error.message}`);
	}
	'
)"

REASON="$(printf '%s' "$VERDICT" | cut -d: -f2-)"
case "$(printf '%s' "$VERDICT" | cut -d: -f1)" in
skip) skip "$REASON" ;;
build) announce "gate passed, $REASON" ;;
*) build "pull request state could not be evaluated, failing open" ;;
esac

BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE_SHA" ]; then
	build "no diff base supplied, cannot tell which paths changed"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
	build "not inside a git work tree, cannot tell which paths changed"
fi

if ! git -C "$REPO_ROOT" cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
	build "diff base ${BASE_SHA} is not in this clone, cannot tell which paths changed"
fi

read -r -a WATCH_ARRAY <<<"$WATCH_PATHS"
if git -C "$REPO_ROOT" diff --quiet "$BASE_SHA" HEAD -- "${WATCH_ARRAY[@]}"; then
	skip "no changes under '${WATCH_PATHS}' since ${BASE_SHA}"
fi

build "changes under '${WATCH_PATHS}' since ${BASE_SHA}"
