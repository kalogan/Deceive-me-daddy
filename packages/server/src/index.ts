// @deceive/server — the authoritative game server (PROJECT_BRIEF §3). Owns the world
// state, steps sim-core each tick, validates client inputs, and broadcasts the schema
// state. This barrel is SIDE-EFFECT-FREE: it never binds a socket (see main.ts), so
// importing it in tests/tooling can't open a port or hang the process.
export { MatchRoom, isValidInput } from './rooms/MatchRoom';
export { MatchState, PlayerSchema } from './state/MatchState';
export { syncWorldToState } from './state/sync';
export { applyMovementInput, assignTeam } from './rooms/applyInput';
