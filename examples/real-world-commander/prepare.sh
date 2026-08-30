#!/usr/bin/env bash
# Rebuilds the broken commander tree this example runs against.
#
# Nothing about the fault or the oracle is written here. The script pins an
# upstream commit, restores the line upstream itself had before it fixed the
# bug, and holds upstream's own regression test out of the tree the agent sees.
# Every edit below is printed as a diff at the end so you can check that claim
# instead of taking it.
set -euo pipefail

# commander at the tip of its default branch when this example was built.
readonly UPSTREAM=https://github.com/tj/commander.js
readonly PINNED_SHA=ba6d13ddb4243e5913367734f8c159089ffe7834
# The upstream commit that fixed this bug. Its parent is what we restore.
readonly FIX_COMMIT=68199e64b31851839c03dff1567a81d7714baa08

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target="${1:-$here/repo}"

if [[ -e "$target" ]]; then
  echo "refusing to overwrite $target; remove it first" >&2
  exit 1
fi

echo "cloning commander at $PINNED_SHA"
git clone --quiet --no-checkout "$UPSTREAM" "$target.git-tmp"
git -C "$target.git-tmp" checkout --quiet "$PINNED_SHA"
mkdir -p "$target"
git -C "$target.git-tmp" archive "$PINNED_SHA" | tar -x -C "$target"

# A second, untouched extract, kept only long enough to print the diff below.
pristine="$(mktemp -d)"
git -C "$target.git-tmp" archive "$PINNED_SHA" | tar -x -C "$pristine"
rm -rf "$target.git-tmp"

echo "restoring the pre-fix implementation from $FIX_COMMIT^"
node - "$target" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];

// lib/command.js, exactly as upstream had it before PR #2350.
const commandPath = path.join(repo, 'lib/command.js');
const command = readFileSync(commandPath, 'utf8');
const fixed = `    this._outputConfiguration = {
      ...this._outputConfiguration,
      ...configuration,
    };
`;
const beforeTheFix = `    Object.assign(this._outputConfiguration, configuration);
`;
if (!command.includes(fixed)) {
  throw new Error('lib/command.js is not in the shape this example pins; the SHA may be wrong');
}
writeFileSync(commandPath, command.replace(fixed, beforeTheFix), 'utf8');

// Hold upstream's regression test out of the visible tree. It becomes the
// oracle, which is the only reason it is removed here.
const testPath = path.join(repo, 'tests/command.configureOutput.test.js');
const tests = readFileSync(testPath, 'utf8');
const marker = "  test('when configureOutput after copyInheritedSettings then original unchanged'";
const start = tests.indexOf(marker);
if (start === -1) {
  throw new Error('the held-out regression test is not where this example expects it');
}
const close = tests.indexOf('  });\n', tests.indexOf('getOutHelpWidth(), 80);', start));
const end = close + '  });\n'.length + 1;
writeFileSync(testPath, tests.slice(0, start) + tests.slice(end), 'utf8');
JS

echo
echo "what this script changed, in full:"
diff -ru "$pristine" "$target" || true
rm -rf "$pristine"

echo
echo "commander's own test suite, which passes while the bug is present."
echo "It needs no npm install: the tests run on Node's built-in runner and the"
echo "package has no runtime dependencies, so the whole suite runs inside a"
echo "sandbox with no network at all."
( cd "$target" && node --test 2>&1 | grep -E "^. (tests|pass|fail)" | sed 's/^/  /' )

echo
echo "the hidden oracle, which does not:"
REPO_DIR="$target" node "$here/oracle/oracle.mjs" || true

echo
echo "ready. Point Repro Doctor at it:"
echo "  npm run doctor -- diagnose $target --mode advanced \\"
echo "    --oracle-dir $here/oracle \\"
echo "    --check-command \"node --test\" \\"
echo "    --max-tool-calls 25"
echo
echo "--check-command matters here. The check script commander ships runs eslint"
echo "and prettier, which report on whether its devDependencies are installed"
echo "rather than on whether the library works. node --test is the question"
echo "worth asking, and both modes get the same one."
