// PURE event derivation for the "match feel" HUD layer: diff two match snapshots and decide
// which transient BANNERS (full-width stingers) and EVENT-FEED entries (the bottom-left log)
// to surface this frame. Mirrors the style of `audio/audioEvents.ts` `deriveAudioEvents` —
// it diffs only the LOCAL player + the shared objective between prev and next and emits a
// list of typed events. DOM-free + side-effect-free, so it runs in the Node gate.
//
// Authority (PROJECT_BRIEF §3/§4.2): the wire state is the server's word; this only decides
// what to SHOW. It owns no gameplay truth.
import type { NetMatchState } from '@deceive/shared';

/**
 * The transient full-width BANNERS fired on key match transitions. These are GLOBAL/objective
 * moments worth a big stinger — distinct from the per-player feed lines below. The string is the
 * banner's display text.
 */
export type BannerKind = 'VAULT OPEN' | 'PACKAGE STOLEN' | 'PACKAGE DROPPED';

/**
 * The EVENT-FEED lines for the local player's bottom-left log. Each is a short, already-readable
 * phrase (the feed renders it verbatim). Distinct from banners: these are the player's own
 * running commentary, banners are the big shared beats.
 */
export type FeedKind =
  | 'Collected intel'
  | 'Picked up keycard'
  | 'Disguise acquired'
  | 'Vault opened'
  | 'Grabbed the package'
  | 'You were revealed'
  | 'Downed'
  | 'Revived';

/** What a single snapshot diff surfaces: zero or more banners + zero or more feed lines. */
export interface MatchEvents {
  banners: BannerKind[];
  feed: FeedKind[];
}

/** An empty result (the first frame, or a frame with no relevant change). */
const NONE: MatchEvents = { banners: [], feed: [] };

/**
 * Derive the banners + feed lines to surface this frame by diffing the LOCAL player + the
 * objective between two snapshots. PURE.
 *
 * On the FIRST frame (`prev === null`) it returns empty lists — there's no prior state to diff,
 * so spawn values never blip (same guard as `deriveAudioEvents`). Player-scoped diffs only run
 * once the local player exists in BOTH snapshots (mid-join safe).
 *
 * Banner triggers (objective-global):
 *   - vaultOpen false → true            ⇒ 'VAULT OPEN'
 *   - packageHolderId '' → non-empty    ⇒ 'PACKAGE STOLEN'  (someone grabbed it)
 *   - packageHolderId non-empty → ''    ⇒ 'PACKAGE DROPPED' (carrier lost / dropped it)
 *
 * Feed triggers (local player), mirroring the audio diff's transitions:
 *   - intel increased                   ⇒ 'Collected intel'
 *   - heldKeycard → non-empty           ⇒ 'Picked up keycard'
 *   - vaultOpen false → true            ⇒ 'Vault opened'
 *   - carrying false → true             ⇒ 'Grabbed the package'
 *   - phase → 'revealed' (from hidden)  ⇒ 'You were revealed'
 *   - phase → 'downed'                  ⇒ 'Downed'
 *   - phase downed/out → 'blended'      ⇒ 'Revived'
 */
export function deriveMatchEvents(
  prev: NetMatchState | null,
  next: NetMatchState,
  localPlayerId: string,
): MatchEvents {
  if (prev === null) return NONE;

  const banners: BannerKind[] = [];
  const feed: FeedKind[] = [];

  const before = prev.players[localPlayerId];
  const after = next.players[localPlayerId];

  if (before && after) {
    // Collected intel (count went up; a spend that lowers it shouldn't blip).
    if (after.intel > before.intel) feed.push('Collected intel');

    // Picked up a keycard: the held tier changed to a NON-empty value.
    if (after.heldKeycard !== before.heldKeycard && after.heldKeycard !== '') {
      feed.push('Picked up keycard');
    }

    // Grabbed the package: started carrying this frame.
    if (after.carrying && !before.carrying) feed.push('Grabbed the package');

    // Cover blown: transitioned INTO 'revealed' from a still-hidden phase.
    if (
      after.phase === 'revealed' &&
      (before.phase === 'blended' || before.phase === 'suspicious')
    ) {
      feed.push('You were revealed');
    }

    // Went down (entered 'downed' from any other phase).
    if (after.phase === 'downed' && before.phase !== 'downed') feed.push('Downed');

    // Revived: back to 'blended' from being downed or out.
    if (
      after.phase === 'blended' &&
      (before.phase === 'downed' || before.phase === 'out')
    ) {
      feed.push('Revived');
    }
  }

  // Objective diffs are global (always present in both snapshots).
  if (next.objective.vaultOpen && !prev.objective.vaultOpen) {
    banners.push('VAULT OPEN');
    feed.push('Vault opened');
  }
  if (prev.objective.packageHolderId === '' && next.objective.packageHolderId !== '') {
    banners.push('PACKAGE STOLEN');
  }
  if (prev.objective.packageHolderId !== '' && next.objective.packageHolderId === '') {
    banners.push('PACKAGE DROPPED');
  }

  return { banners, feed };
}
