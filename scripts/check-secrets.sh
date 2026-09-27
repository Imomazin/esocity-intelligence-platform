#!/usr/bin/env bash
# Lightweight pre-commit / CI secret scan over files tracked (or about to be tracked) by git.
# Complements — does not replace — GitHub secret scanning / push protection.
# Allowed: placeholders in upper case (USER:PASSWORD) and values containing "local_only"
# (throwaway docker-compose credentials documented as such).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

patterns=(
  'AKIA[0-9A-Z]{16}'                                   # AWS access key id
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'                 # PEM private keys
  'gh[pousr]_[A-Za-z0-9]{36,}'                         # GitHub tokens
  'github_pat_[A-Za-z0-9_]{40,}'
  'sk_(live|test)_[A-Za-z0-9]{16,}'                    # Stripe
  'sk-(ant|proj)-[A-Za-z0-9_-]{20,}'                   # LLM provider keys
  'xox[baprs]-[A-Za-z0-9-]{10,}'                       # Slack
  'AIza[0-9A-Za-z_-]{35}'                              # Google API key
  'postgres(ql)?://[^:/[:space:]"'"'"']+:[^@[:space:]"'"'"']+@'   # connection string with password
  'rediss?://[^:/[:space:]]*:[^@[:space:]]+@'
)

files=$(git ls-files --cached --others --exclude-standard | grep -vE '(^|/)(pnpm-lock\.yaml|parity\.json)$|\.(png|ico|jpg|woff2?)$' || true)
[ -z "$files" ] && { echo "No files to scan."; exit 0; }

found=0
for pattern in "${patterns[@]}"; do
  matches=$(echo "$files" | tr '\n' '\0' | xargs -0 grep -nIE -- "$pattern" 2>/dev/null \
    | grep -vE 'USER:PASSWORD|local_only|check-secrets\.sh' || true)
  if [ -n "$matches" ]; then
    echo "Possible secret matching /$pattern/:"
    echo "$matches" | sed 's/^/  /'
    found=1
  fi
done

tracked_env=$(echo "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)
if [ -n "$tracked_env" ]; then
  echo "Environment files must not be committed:"
  echo "$tracked_env" | sed 's/^/  /'
  found=1
fi

if [ "$found" -ne 0 ]; then
  echo "Secret scan FAILED."
  exit 1
fi
echo "Secret scan passed ($(echo "$files" | wc -l | tr -d ' ') files)."
