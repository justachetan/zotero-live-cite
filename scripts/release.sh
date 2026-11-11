#!/usr/bin/env bash
# Publishes the version in package.json to both install channels:
#
#   1. a GitHub release "v<version>" with the .vsix attached
#      (used by the `gh release download` install command), and
#   2. the `vsix` branch, which holds only the latest .vsix as
#      zotero-live-cite.vsix (used by the git-only install command).
#
# Run from a clean main that is pushed. Rerunning for a version that already
# has a release replaces that release's .vsix.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi
git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "HEAD is not origin/main; push (or check out main) first." >&2
  exit 1
fi

version=$(node -p 'require("./package.json").version')
vsix="zotero-live-cite-$version.vsix"
rm -f zotero-live-cite-*.vsix
npm run package

# 1. GitHub release, tagged at the commit the .vsix was built from.
if gh release view "v$version" >/dev/null 2>&1; then
  echo "Release v$version exists; replacing its .vsix."
  gh release upload "v$version" "$vsix" --clobber
else
  gh release create "v$version" "$vsix" --target "$(git rev-parse HEAD)" --title "v$version" --generate-notes
fi

# 2. The `vsix` branch. The commit is built with plumbing commands so the
#    working tree and current branch are never touched: store the files as
#    blobs, make a tree of them, and commit it on top of the branch's tip.
blob=$(git hash-object -w "$vsix")
readme=$(git hash-object -w --stdin <<EOF
# Zotero Live Cite: packaged extension

This branch holds only the latest packaged extension, \`zotero-live-cite.vsix\`
(version $version), for the git-only install command. Source code and install
instructions are on the \`main\` branch.
EOF
)
tree=$(printf '100644 blob %s\tREADME.md\n100644 blob %s\tzotero-live-cite.vsix\n' "$readme" "$blob" | git mktree)
if git fetch --quiet origin vsix 2>/dev/null; then
  commit=$(git commit-tree "$tree" -p FETCH_HEAD -m "Package v$version")
else
  commit=$(git commit-tree "$tree" -m "Package v$version")
fi
git push --quiet origin "$commit:refs/heads/vsix"
echo "Published v$version: GitHub release and vsix branch ($commit)."
