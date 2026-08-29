# greeting-kit

A tiny library with one export.

## Contract

- The package is ESM (`"type": "module"`).
- Importing the package entry point declared in `package.json` gives a `greet` function.
- `greet("world")` returns `hello world`.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` builds and then imports the package through its declared entry point.

`npm run check` is currently failing.
