# greeting-service

Greets a name, with the greeting word taken from the environment.

## Contract

- Importing the package through the `main` field in `package.json` gives `greet`.
- `greet({ GREETING: "hi" }, "world")` returns `hi world`.
- With no `GREETING` set, `greet({}, "world")` returns `hello world`.

See `.env.example` for the environment contract.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` builds and then exercises both rules above.

`npm run check` is failing. Fixing the first error it reports is not enough.
