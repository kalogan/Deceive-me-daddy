// Server entry point (slice 1.1). This is the ONLY file that binds a socket — kept out
// of index.ts so importing the package (tests, tooling) never opens a port (the
// "zombie-gate" hang). Run with `pnpm --filter @deceive/server dev` (tsx src/main.ts).
import { Server } from 'colyseus';
import { MatchRoom } from './rooms/MatchRoom';

const port = Number(process.env.PORT) || 2567;

const gameServer = new Server();
gameServer.define('match', MatchRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[@deceive/server] match server listening on :${port}`);
  })
  .catch((err: unknown) => {
    console.error('[@deceive/server] failed to start', err);
    process.exitCode = 1;
  });
