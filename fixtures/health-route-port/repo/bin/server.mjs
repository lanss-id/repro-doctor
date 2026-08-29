// Boots the HTTP server around the compiled application module.
import { createServer } from 'node:http';

const { handle, resolvePort } = await import(new URL('../dist/app.js', import.meta.url).href);
const port = resolvePort(process.env);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const result = handle(url.pathname);
  response.writeHead(result.status, { 'content-type': 'application/json' });
  response.end(result.body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on ${port}`);
});
