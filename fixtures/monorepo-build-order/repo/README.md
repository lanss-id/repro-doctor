# pricing-monorepo

Two packages: `packages/core` holds the pricing rules, `packages/app` uses them.

## Build

`npm run build` compiles every package in the order listed in `build.order.json`. `packages/app` imports the compiled output of `packages/core`, so the order matters.

## Contract

- `quote(1000)` returns `900 cents`, a ten percent discount.

## Commands

- `npm run build` builds all packages.
- `npm run check` builds and then calls the app package.

A clean build fails.
