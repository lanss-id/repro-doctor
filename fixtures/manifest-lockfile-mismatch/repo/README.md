# widget-kit

Labels widgets for display.

## Dependencies

The only dependency is `@fixture/strings`, vendored at `vendor/strings` and installed through a `file:` reference. There is no network access in CI, so installs run with `npm ci --offline`.

## Contract

- `label("hello world")` returns `Hello World`.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` installs from the lockfile, builds, and calls the package.

`npm run check` fails at the install step.
