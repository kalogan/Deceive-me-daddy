// Server entry point (slice 1.1 + deploy). This is the ONLY file that binds a socket — kept
// out of index.ts so importing the package (tests, tooling) never opens a port (the
// "zombie-gate" hang). Run with `pnpm --filter @deceive/server dev` (tsx src/main.ts).
//
// In production (the Fly app) this ONE process serves BOTH halves on a single port:
//   - HTTP: the built static client (packages/client/dist) via sirv.
//   - WebSocket: the authoritative Colyseus `match` room (ws upgrade on the same server).
// So `https://<app>.fly.dev` serves the game AND its same-origin `wss://` endpoint — no CORS,
// one machine, one URL. A static host (Vercel) can also serve the client and point its
// `VITE_SERVER_URL` at this server's `wss://` endpoint.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { MatchRoom } from './rooms/MatchRoom';
import { DuelRoom } from './rooms/DuelRoom';

// `colyseus` is CommonJS with no `exports` map — load the Server value via createRequire
// (named ESM import throws at runtime). See MatchRoom.ts for the full note.
const nodeRequire = createRequire(import.meta.url);
const { Server } = nodeRequire('colyseus') as typeof import('colyseus');

const port = Number(process.env.PORT) || 2567;

// Where the built client lives. Default resolves to packages/client/dist relative to this
// file; override with CLIENT_DIR. Missing (e.g. local ws-only dev with a separate vite
// server) → the HTTP side just 404s; the websocket server still runs.
const clientDir =
  process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../client/dist/', import.meta.url));
const haveClient = existsSync(clientDir);
// `single: true` falls back to index.html for non-file routes (SPA deep-links/refresh).
const serveStatic = haveClient ? sirv(clientDir, { single: true }) : null;

const httpServer = createServer((req, res) => {
  if (serveStatic) {
    serveStatic(req, res, () => {
      res.statusCode = 404;
      res.end('Not Found');
    });
  } else {
    res.statusCode = 404;
    res.end('client build not found (run: pnpm --filter @deceive/client build)');
  }
});

// Attach Colyseus to our HTTP server so the ws upgrade shares the single port.
const gameServer = new Server({ server: httpServer });
gameServer.define('match', MatchRoom);
gameServer.define('duel', DuelRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[@deceive/server] match server listening on :${port}`);
    console.log(
      `[@deceive/server] static client: ${haveClient ? clientDir : 'NOT FOUND (ws-only)'}`,
    );
  })
  .catch((err: unknown) => {
    console.error('[@deceive/server] failed to start', err);
    process.exitCode = 1;
  });
