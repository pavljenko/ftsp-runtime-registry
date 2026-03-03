#!/usr/bin/env bash
set -euo pipefail

OWNER="${1:-pavljenko}"
REPO="${2:-ftsp-runtime-registry}"
VISIBILITY="${3:-public}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is required"
  exit 1
fi

payload=$(cat <<JSON
{
  "name": "${REPO}",
  "private": $( [[ "$VISIBILITY" == "private" ]] && echo true || echo false ),
  "description": "FTSP runtime registry (wasm assets + signed manifests)",
  "has_issues": true,
  "has_wiki": false,
  "auto_init": false
}
JSON
)

curl -sS -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/user/repos" \
  -d "$payload" >/tmp/create_repo_response.json

if rg -q '"full_name"\s*:\s*"' /tmp/create_repo_response.json; then
  echo "Repository created:"
  cat /tmp/create_repo_response.json | rg '"full_name"|"html_url"'
else
  echo "Repository creation response:"
  cat /tmp/create_repo_response.json
  exit 1
fi
