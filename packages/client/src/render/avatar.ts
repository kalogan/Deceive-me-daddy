// The shared greybox avatar body — one capsule + a small nose for facing. Used by BOTH
// WorldView (players) and NpcView (the crowd) so a disguised player is rendered with the
// EXACT same mesh as the NPCs they blend among (PROJECT_BRIEF §1 — "anyone could be the
// spy"). Forking the body between the two would leak a tell, so it lives here once.
import * as THREE from 'three';

export const AVATAR_RADIUS = 0.4;
export const AVATAR_HEIGHT = 1.8;

export interface AvatarBody {
  group: THREE.Group;
  body: THREE.Mesh;
  /** The shared material — colour it by tier; the nose reuses it for a uniform look. */
  material: THREE.MeshStandardMaterial;
}

/** Build a fresh, white avatar body. Caller adds it to a scene/group + colours by tier. */
export function buildAvatarBody(): AvatarBody {
  const group = new THREE.Group();

  const geometry = new THREE.CapsuleGeometry(
    AVATAR_RADIUS,
    AVATAR_HEIGHT - AVATAR_RADIUS * 2,
    4,
    12,
  );
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const body = new THREE.Mesh(geometry, material);
  body.castShadow = true;
  group.add(body);

  // A small nose so the avatar's facing is readable in greybox.
  const noseGeo = new THREE.ConeGeometry(0.12, 0.3, 8);
  const nose = new THREE.Mesh(noseGeo, material);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, AVATAR_HEIGHT * 0.15, AVATAR_RADIUS + 0.12);
  group.add(nose);

  return { group, body, material };
}
