// Boot-import check (gate step). Loads the server's socket/room modules under the REAL
// Node/tsx loader — NOT vite — so CJS/ESM interop errors that vitest masks are caught.
//
// Why this exists: `colyseus` is CommonJS with no `exports` map. `import { Room } from
// 'colyseus'` typechecks and even passes under vitest (vite's esbuild resolves the named
// export), but throws at runtime under Node ("does not provide an export named 'Room'").
// The whole gate was green while the server could not boot. This step closes that gap by
// importing the real modules the way the running server does.
import { MatchRoom } from '../packages/server/src/rooms/MatchRoom';
import { MatchState, PlayerSchema } from '../packages/server/src/state/MatchState';

if (typeof MatchRoom !== 'function') {
  console.error('[check-boot] MatchRoom did not load as a class');
  process.exit(1);
}
if (typeof MatchState !== 'function' || typeof PlayerSchema !== 'function') {
  console.error('[check-boot] colyseus schema classes did not load');
  process.exit(1);
}
console.log('[check-boot] OK — server room + schema modules load under the Node loader');
