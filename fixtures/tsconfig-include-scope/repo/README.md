# catalog-service

Prices a small catalog.

## Layout

- `src/app` holds the entry point.
- `src/lib` holds shared code that the app imports. Both directories are part of the build.

## Contract

- Importing the package through the `main` field in `package.json` gives `describeCatalog`.
- `describeCatalog([{sku:"a",priceCents:100},{sku:"b",priceCents:250}])` returns `2 item(s), 350 cents`.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` builds and then imports the package through its entry point.

The build is failing.
