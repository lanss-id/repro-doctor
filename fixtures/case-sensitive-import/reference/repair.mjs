// Reference repair for case-sensitive-import: match the import specifier to the
// real, lowercase path on disk.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();
const indexPath = path.join(repo, 'src/index.ts');
const source = readFileSync(indexPath, 'utf8');
writeFileSync(indexPath, source.replace('./Utils/Format.js', './utils/format.js'), 'utf8');
