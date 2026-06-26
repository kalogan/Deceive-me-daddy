// The PROP-MODEL REGISTRY (preview-only). Pure DATA: a list of external glTF/GLB *environment props*
// the Props preview tab can load, scale-normalise + spin to evaluate real imported set-dressing against
// our hand-built procedural geometry. This is the sibling of render/assetModels (characters); the same
// modular seam, but for set pieces. Extend it by dropping a `.glb` under public/props and adding an
// entry — the Props tab picks it up automatically. NOTHING here is imported by the GAME (main.ts /
// WorldView / NpcView); it rides ONLY behind preview.html.
//
// Honest note on sourcing: the sandbox proxy blocks the good CC0 kit CDNs (kenney.nl / quaternius.com),
// so this starter set is what is reachable on GitHub today — a handful of CC0/CC-BY vehicles + a
// stylised diorama. It proves the import + placement pipeline; swap in a proper kit the same way.

export interface PropModelDef {
  /** Stable unique id (used by the picker + `propModelById`). */
  readonly id: string;
  /** Human-friendly name shown in the picker + info panel. */
  readonly name: string;
  /** Served URL of the GLB/glTF. `public/` is copied into `dist/`, so '/props/x.glb' resolves. */
  readonly url: string;
  /** Licence tag (e.g. 'CC0', 'CC-BY 4.0') — shown so attribution is visible in the harness. */
  readonly license: string;
  /** Full attribution line (author / source) — shown in the info panel + CREDITS.md. */
  readonly credit: string;
  /** Normalise so the prop's bounding-box height equals this many metres on stage (default 2). */
  readonly displayHeight?: number;
  /** Short note on where the prop could be used in our maps (shown in the inspector). */
  readonly usage?: string;
}

/** Default staged height (metres) when a def omits `displayHeight`. Keeps the gallery uniform. */
export const PROP_DEFAULT_HEIGHT = 2;

/**
 * The available environment props. The reachable starter set (see the file header): all redistributable
 * (CC0 / CC-BY 4.0), each credited. ADD A PROP by appending an entry + dropping the file under
 * public/props.
 */
export const PROP_MODELS: readonly PropModelDef[] = [
  {
    id: 'littlest-tokyo',
    name: 'Littlest Tokyo',
    url: '/props/LittlestTokyo.glb',
    license: 'CC-BY 4.0',
    credit: 'LittlestTokyo.glb — by Glen Fox (CC-BY 4.0), via the three.js examples.',
    displayHeight: 2.6,
    usage: 'A dense animated diorama — a neon-district set piece / skybox centrepiece.',
  },
  {
    id: 'delivery-truck',
    name: 'Delivery Truck',
    url: '/props/CesiumMilkTruck.glb',
    license: 'CC-BY 4.0',
    credit: 'CesiumMilkTruck.glb — © 2017 Cesium (CC-BY 4.0), via the Khronos glTF Sample Assets.',
    displayHeight: 2.0,
    usage: 'A low-poly delivery truck (animated wheels) — facility loading dock / street dressing.',
  },
  {
    id: 'kenney-truck',
    name: 'Truck (Kenney)',
    url: '/props/KenneyTruck.glb',
    license: 'CC0',
    credit: 'KenneyTruck.glb — Kenney Car Kit by Kenney (kenney.nl), CC0.',
    displayHeight: 1.7,
    usage: 'CC0 vehicle for parking lots / the beach car park.',
  },
  {
    id: 'kenney-van',
    name: 'Van (Kenney)',
    url: '/props/KenneyVan.glb',
    license: 'CC0',
    credit: 'KenneyVan.glb — Kenney Car Kit by Kenney (kenney.nl), CC0.',
    displayHeight: 1.7,
    usage: 'CC0 vehicle — a surveillance / catering van near a facility entrance.',
  },
  {
    id: 'toy-car',
    name: 'Toy Car',
    url: '/props/ToyCar.glb',
    license: 'CC0',
    credit: 'ToyCar.glb — © 2020 Public (CC0), via the Khronos glTF Sample Assets.',
    displayHeight: 1.4,
    usage: 'A detailed CC0 prop — a desk toy / shelf dressing inside the facility.',
  },
];

/** Look up a registered prop by id. Returns undefined on a miss (pure, no THREE/DOM). */
export function propModelById(id: string): PropModelDef | undefined {
  return PROP_MODELS.find((m) => m.id === id);
}

/** The attribution/info line for a prop. Pure, data-in / data-out (mirrors the Models tab). */
export function propInfoLine(def: PropModelDef): string {
  return `${def.name} — ${def.license}. ${def.credit}`;
}
