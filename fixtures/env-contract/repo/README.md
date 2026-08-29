# report-service

Loads its configuration from the environment.

## Environment contract

See `.env.example`.

- `PORT` is required and must be a positive integer. When it is missing or not a number, `loadConfig` throws an error that names the variable.
- `REPORT_PREFIX` is optional and defaults to `report`.

Deployment sets `PORT`. It does not set anything else.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm run check` builds and then exercises the environment contract.

`npm run check` is failing.
