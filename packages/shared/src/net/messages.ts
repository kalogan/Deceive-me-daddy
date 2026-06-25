// Network message contracts (PROJECT_BRIEF §3). Authoritative state itself is synced via
// the Colyseus schema (added in the server slice); these are the discrete client->server
// intents and server->client events. Server is authoritative — inputs are requests only.

import type { GadgetKind } from '../schema/agents';

/** Client -> server: the player's input for a tick. Server validates + simulates. */
export interface PlayerInput {
  seq: number; // client input sequence for light local prediction
  moveX: number; // -1..1
  moveZ: number; // -1..1
  yaw: number; // facing, radians
  running: boolean;
  jumping: boolean;
}

export type ClientMessage =
  | { t: 'input'; input: PlayerInput }
  | { t: 'take_disguise'; targetNpcId: string }
  | { t: 'interact'; targetId: string } // door / intel / social spot / package
  | { t: 'use_gadget'; gadget: GadgetKind }
  | { t: 'fire' }
  | { t: 'revive'; targetPlayerId: string };

export type ServerEvent =
  | { t: 'revealed'; playerId: string; untilMs: number }
  | { t: 'cover_blown'; playerId: string }
  | { t: 'disguise_taken'; playerId: string; tier: string }
  | { t: 'holo_crumb'; position: [number, number, number]; expiresMs: number }
  | { t: 'objective'; stage: 'intel' | 'vault_open' | 'package_taken' | 'extracted'; team: number }
  | { t: 'match_over'; winningTeam: number };
