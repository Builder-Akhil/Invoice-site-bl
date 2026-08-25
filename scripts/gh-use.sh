#!/usr/bin/env bash
# Stay logged into several GitHub accounts. Switch with one command — no logout.
#
#   ./scripts/gh-use.sh                  who is active
#   ./scripts/gh-use.sh Builder-Akhil    switch to that account
#   ./scripts/gh-use.sh login            add another account (keeps the others)
#   ./scripts/gh-use.sh logout USER      drop one account
#
# Identities (commit name + email per GitHub user) live in:
#   ~/.config/gh-identities
# Edit that file when you add an account. Switching sets THIS repo's git
# user.name / user.email so the hangar (this project) uses the right captain,
# without changing your global git identity.

set -euo pipefail

IDENTITIES="${GH_IDENTITIES:-$HOME/.config/gh-identities}"

ensure_identities() {
  mkdir -p "$(dirname "$IDENTITIES")"
  if [[ ! -f "$IDENTITIES" ]]; then
    cat > "$IDENTITIES" <<'EOF'
# github_login | git_name | git_email
# One row per GitHub account. Switching applies name/email to this repo only.
Builder-Akhil|Akhil Kumar Alampally|akhil@buildablelabs.com
AkhilKumar-Git|Akhil Kumar Alampally|ai.exploreverse@gmail.com
EOF
  fi
}

apply_identity() {
  local user="$1"
  local line name email
  ensure_identities
  line="$(grep -v '^[[:space:]]*#' "$IDENTITIES" | awk -F'|' -v u="$user" '$1 == u { print; exit }')"
  if [[ -z "${line}" ]]; then
    echo "No git name/email for ${user} in ${IDENTITIES} — commits will use your global git identity."
    echo "Add a line: ${user}|Your Name|you@email.com"
    return 0
  fi
  name="$(printf '%s' "$line" | cut -d'|' -f2)"
  email="$(printf '%s' "$line" | cut -d'|' -f3)"
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git config user.name "$name"
    git config user.email "$email"
    echo "This repo will commit as: ${name} <${email}>"
  fi
}

cmd="${1:-who}"

case "$cmd" in
  who|--who|-w)
    gh auth status
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo
      echo "This repo commits as: $(git config user.name) <$(git config user.email)>"
    fi
    ;;
  login|add)
    echo "Add a GitHub account. Existing accounts stay logged in."
    echo "In the browser, sign in as the account you want to ADD (for this project: Builder-Akhil)."
    gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git
    ensure_identities
    active="$(gh api user --jq .login)"
    apply_identity "$active"
    echo
    echo "Active account: ${active}"
    echo "Later, switch with:  ./scripts/gh-use.sh ${active}"
    ;;
  logout)
    user="${2:-}"
    if [[ -z "$user" ]]; then
      echo "Usage: $0 logout GITHUB_USERNAME"
      exit 1
    fi
    gh auth logout --hostname github.com --user "$user"
    ;;
  *)
    user="$cmd"
    gh auth switch --hostname github.com --user "$user"
    gh auth setup-git
    apply_identity "$user"
    echo "Active GitHub account: ${user}"
    ;;
esac
