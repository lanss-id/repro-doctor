# status-api

A one-route HTTP service.

## Contract

The platform's load balancer requires:

- The service listens on the port given in the `PORT` environment variable. `3000` is only the fallback for local development.
- `GET /health` returns `200` with the JSON body `{"status":"ok"}`.
- Any other path returns `404`.

## Commands

- `npm run build` compiles TypeScript into `dist/`.
- `npm start` boots the service.
- `npm run check` builds and then probes the health route the way the load balancer does.

`npm run check` is failing, and the load balancer marks every instance unhealthy.
