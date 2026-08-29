// Reference repair for manifest-lockfile-mismatch: write the lockfile entries
// that match the manifest. The content is the same as `npm install
// --package-lock-only --offline` produces for this tree, written literally so
// the repair does not depend on npm's behaviour at repair time.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();

const lockfile = {
  name: 'widget-kit',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'widget-kit',
      version: '1.0.0',
      dependencies: {
        '@fixture/strings': 'file:vendor/strings',
      },
    },
    'node_modules/@fixture/strings': {
      resolved: 'vendor/strings',
      link: true,
    },
    'vendor/strings': {
      name: '@fixture/strings',
      version: '1.0.0',
    },
  },
};

writeFileSync(
  path.join(repo, 'package-lock.json'),
  `${JSON.stringify(lockfile, null, 2)}\n`,
  'utf8',
);
