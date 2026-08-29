# amount-formatter

Formats money amounts for display.

## Contract

- The package is published as ESM and must stay ESM: `"type": "module"` in `package.json` is part of its public interface, because consumers import it with `import`.
- `describeTotal(12.5)` returns `total $12.50`.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` builds and then loads the built entry point.

The build passes. `npm run check` does not.
