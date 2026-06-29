// The corner MINIMAP / radar overlay (a 2D <canvas>, NOT Three). Top-down north-up view of the
// match: the local player (with facing), teammates, the objective package, the vault, extraction
// points, and intel nodes as distinct dots/icons. Static markers come from the content pack;
// dynamic ones (players, the live package) from the latest snapshot each frame.
//
// All projection MATH is the PURE, tested minimapModel; this file only paints. Authority
// (PROJECT_BRIEF §3/§4.2): display-only — it reads the server's snapshot + the authored pack.
//
// PHONE-FIRST: a compact square pinned TOP-RIGHT, clear of the awareness HUD (top-left), the
// top-center timer, the left stick, the right look-drag, and the bottom-right action cluster.
import { DEFAULT_FLOOR_HEIGHT, floorOfY, type ContentPack, type NetMatchState } from '@deceive/shared';
import {
  clampToMinimap,
  packWorldBounds,
  projectToMinimap,
  type WorldBounds,
} from './minimapModel';

/** CSS pixel side of the square minimap. Small so it never crowds a phone screen. */
const SIZE = 132;

/** Marker palette — echoes the HUD/menu accents so the map reads consistently. */
const COLOR = {
  self: '#7fe3ff', // cyan — the local player (matches the menu accent)
  teammate: '#3fae62', // green — allies
  package: '#ffcf3f', // gold — the objective package
  vault: '#ff5a5a', // red — the vault marker
  extract: '#3fffd0', // teal — extraction points
  intel: '#9b8cff', // violet — intel nodes
  stairs: '#ffffff', // white — connectors (the way up/down to another floor)
  grid: 'rgba(255,255,255,0.10)',
  frame: 'rgba(255,255,255,0.22)',
  badge: 'rgba(230,238,255,0.92)',
  bg: 'rgba(8, 10, 16, 0.62)',
} as const;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly dpr: number;
  private bounds: WorldBounds;
  /** Cached static-marker projections (vault/extracts/intel) — recomputed only when the pack changes. */
  private pack: ContentPack | null = null;
  /** Multi-floor geometry so the map shows only the local player's current storey. */
  private floorHeight = DEFAULT_FLOOR_HEIGHT;
  private floorCount = 1;

  constructor(parent: HTMLElement = document.body) {
    const canvas = document.createElement('canvas');
    canvas.id = 'minimap';
    this.dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = SIZE * this.dpr;
    canvas.height = SIZE * this.dpr;
    Object.assign(canvas.style, {
      position: 'fixed',
      right: '12px',
      top: '52px',
      width: `${SIZE}px`,
      height: `${SIZE}px`,
      borderRadius: '8px',
      background: COLOR.bg,
      border: `1px solid ${COLOR.frame}`,
      boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '8',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(canvas);

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bounds = packWorldBounds(null);
  }

  /** Adopt the authored pack so the map scales to its world bounds + draws its static markers. */
  setPack(pack: ContentPack | null): void {
    this.pack = pack;
    this.bounds = packWorldBounds(pack);
    this.floorHeight = pack?.floorHeight ?? DEFAULT_FLOOR_HEIGHT;
    this.floorCount = pack ? pack.zones.reduce((n, z) => Math.max(n, (z.floor ?? 0) + 1), 1) : 1;
  }

  /** Repaint the radar from the latest snapshot. Cheap enough to call every frame. */
  update(state: NetMatchState, localPlayerId: string): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);

    this.drawGrid(ctx);

    // Which storey the local player is on — the map shows only THIS floor so the two levels don't
    // overlap into an unreadable smear (single-floor packs: always 0).
    const local = state.players[localPlayerId];
    const floor = local ? floorOfY(local.y, this.floorHeight) : 0;
    const onFloor = (y: number): boolean => floorOfY(y, this.floorHeight) === floor;

    const pack = this.pack;
    if (pack) {
      // Vault marker — centre of the vault zone, only when it's on the shown floor.
      const vault = pack.zones.find((z) => z.id === pack.objective.vaultZoneId);
      if (vault && (vault.floor ?? 0) === floor) {
        const vx = (vault.bounds.min[0] + vault.bounds.max[0]) / 2;
        const vz = (vault.bounds.min[2] + vault.bounds.max[2]) / 2;
        this.dot(ctx, vx, vz, COLOR.vault, 4, 'square');
      }
      for (const ep of pack.objective.extractionPoints) {
        if (onFloor(ep[1])) this.dot(ctx, ep[0], ep[2], COLOR.extract, 3.5, 'diamond');
      }
      for (const node of pack.intelNodes) {
        if (onFloor(node.position[1])) this.dot(ctx, node.position[0], node.position[2], COLOR.intel, 2.6, 'circle');
      }
      // Connectors that touch this floor — the way up/down — so you can find the stairs/vent.
      for (const c of pack.connectors ?? []) {
        if (c.fromFloor !== floor && c.toFloor !== floor) continue;
        const cx = (c.footprint.min[0] + c.footprint.max[0]) / 2;
        const cz = (c.footprint.min[1] + c.footprint.max[1]) / 2;
        this.dot(ctx, cx, cz, COLOR.stairs, 3, 'square');
      }
    }

    // The live objective package (loose or carried) — shown when it's on this floor.
    const obj = state.objective;
    if (onFloor(obj.packageY)) this.dot(ctx, obj.packageX, obj.packageZ, COLOR.package, 3.2, 'circle');

    // Players: the local one with a facing wedge, teammates (same floor) as plain dots, others
    // ignored (you don't see rival positions on your own radar — they're disguised in the crowd).
    for (const id of Object.keys(state.players)) {
      const p = state.players[id];
      if (!p) continue;
      if (id === localPlayerId) continue;
      if (local && p.team === local.team && onFloor(p.y)) {
        this.dot(ctx, p.x, p.z, COLOR.teammate, 2.8, 'circle');
      }
    }
    if (local) this.drawSelf(ctx, local.x, local.z, local.yaw);

    // Floor badge (multi-floor maps only) so you always know which level the map is showing.
    if (this.floorCount > 1) this.drawBadge(ctx, `L${floor + 1}`);

    ctx.restore();
  }

  /** A small "L1/L2" floor badge in the minimap's top-left corner. */
  private drawBadge(ctx: CanvasRenderingContext2D, label: string): void {
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = 'rgba(8,10,16,0.7)';
    ctx.fillRect(3, 3, w, 15);
    ctx.fillStyle = COLOR.badge;
    ctx.fillText(label, 7, 5);
  }

  /** A faint cross-hair grid so motion across the map reads. */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();
  }

  /** Paint a single marker at a world position, clamped to the map square so it can't escape. */
  private dot(
    ctx: CanvasRenderingContext2D,
    worldX: number,
    worldZ: number,
    color: string,
    r: number,
    shape: 'circle' | 'square' | 'diamond',
  ): void {
    const p = clampToMinimap(projectToMinimap(worldX, worldZ, this.bounds, SIZE), SIZE);
    ctx.fillStyle = color;
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'square') {
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  }

  /** The local player: a cyan triangle pointing along its facing (yaw). */
  private drawSelf(ctx: CanvasRenderingContext2D, worldX: number, worldZ: number, yaw: number): void {
    const p = clampToMinimap(projectToMinimap(worldX, worldZ, this.bounds, SIZE), SIZE);
    // Forward at yaw θ is (sin θ, cos θ) in world; +Z maps DOWN on the map, so screen forward is
    // (sin θ, cos θ) directly (down is +y). Build a small arrowhead around the centre.
    const fx = Math.sin(yaw);
    const fy = Math.cos(yaw);
    const px = -fy; // perpendicular (right hand)
    const py = fx;
    const tip = 6;
    const back = 3.4;
    ctx.fillStyle = COLOR.self;
    ctx.beginPath();
    ctx.moveTo(p.x + fx * tip, p.y + fy * tip);
    ctx.lineTo(p.x - fx * back + px * back, p.y - fy * back + py * back);
    ctx.lineTo(p.x - fx * back - px * back, p.y - fy * back - py * back);
    ctx.closePath();
    ctx.fill();
  }

  dispose(): void {
    this.canvas.remove();
  }
}
