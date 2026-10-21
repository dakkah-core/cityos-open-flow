#!/usr/bin/env bash
set -euo pipefail

if [ "$GITHUB_REF" != "refs/heads/main" ]; then
  echo "npm publication requires a main branch commit." >&2
  exit 1
fi

for attempt in {1..120}; do
  run="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow ci.yaml \
    --branch main --event push --commit "$GITHUB_SHA" --limit 1 \
    --json databaseId,status,conclusion \
    --jq 'if length == 0 then empty else .[0] | [.databaseId, .status, .conclusion] | @tsv end')"
  if [ -n "$run" ]; then
    read -r run_id status conclusion <<< "$run"
    if [ "$status" = "completed" ]; then
      if [ "$conclusion" != "success" ]; then
        echo "CI run $run_id finished with $conclusion. Publication stopped." >&2
        exit 1
      fi
      echo "CI passed: https://github.com/$GITHUB_REPOSITORY/actions/runs/$run_id (commit $GITHUB_SHA)"
      exit 0
    fi
    echo "Waiting for CI run $run_id ($status) for commit $GITHUB_SHA."
  elif [ "$attempt" -ge 6 ]; then
    echo "No main push CI run found for $GITHUB_SHA. Publication stopped." >&2
    exit 1
  else
    echo "CI has not appeared for $GITHUB_SHA; retrying."
  fi
  if [ "$attempt" -lt 120 ]; then sleep 10; fi
done

echo "CI did not complete within 20 minutes. Publication stopped." >&2
exit 1
