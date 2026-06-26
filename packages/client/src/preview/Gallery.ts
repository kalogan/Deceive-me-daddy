// The ASSET GALLERY (preview-only). A turntable row of every art asset — the four tier
// avatars (walking in place so the rig animation reads) plus the props — with a live config
// panel to recolour the clearance tiers, tune the prop glow, and scale the avatars, then
// export the tweaked values as JSON. It builds from the SAME art kit the game uses
// (render/avatar + art/props), so what you tune here is exactly what ships (PROJECT_BRIEF §4.5).
import * as THREE from 'three';
import { CLEARANCE_TIERS, TIER_COLOR, type ClearanceTier } from '@deceive/shared';
import { AVATAR_HEIGHT, buildAvatarBody } from '../render/avatar';
import type { AudioEngine, SfxKind } from '../audio/AudioEngine';
import {
  buildArcadeCabinet,
  buildBarCounter,
  buildBriefcase,
  buildCeilingDuct,
  buildDais,
  buildDancefloor,
  buildDjBooth,
  buildDoorFrame,
  buildFireplace,
  buildFloorDecal,
  buildGlassPartition,
  buildGlobePendant,
  buildHangingSign,
  buildHazardStripe,
  buildKeycardReader,
  buildLabBench,
  buildLoungeSet,
  buildMonstera,
  buildNeonSign,
  buildNeonStrip,
  buildPalm,
  buildPatioSet,
  buildPinball,
  buildPlanter,
  buildPlanterBox,
  buildRailing,
  buildRingTrack,
  buildServerRack,
  buildSpeakerStack,
  buildSpotLight,
  buildTerminal,
  buildVaultPodium,
  buildVelvetRope,
  buildWallClock,
  buildWallMonitor,
  buildWallSconce,
  type ArtProp,
} from '../art/props';

/** Content-pack tier colours are hex strings; the art builders take numeric colours. */
function hexNum(s: string): number {
  return new THREE.Color(s).getHex();
}

const SPACING = 2.6; // metres between assets along the row
const TURNTABLE = 0.5; // radians/sec the row slowly rotates
const AVATAR_DEMO_SPEED = 3; // fed to the rig so the gallery avatars walk in place

/** Every SFX the engine can play — surfaced as preview buttons so you can audition each. */
const SFX_KINDS: SfxKind[] = [
  'fire',
  'hit',
  'reveal',
  'disguise',
  'intel',
  'keycard',
  'vaultOpen',
  'win',
  'downed',
  'revive',
  'ability',
];

interface GalleryItem {
  group: THREE.Group;
  label: string;
  dispose(): void;
  animate?: (dt: number, speed: number) => void;
}

/** A material that should follow a tier's colour as the user edits it. */
interface TierMat {
  material: THREE.MeshStandardMaterial;
  tier: ClearanceTier;
}
/** An emissive material whose intensity scales with the glow slider (base remembered). */
interface GlowMat {
  material: THREE.MeshStandardMaterial;
  base: number;
}

export class Gallery {
  private readonly root = new THREE.Group();
  private readonly items: GalleryItem[] = [];
  private readonly tierMats: TierMat[] = [];
  private readonly glowMats: GlowMat[] = [];
  private readonly avatarGroups: THREE.Group[] = [];
  private readonly panel: HTMLDivElement;

  // Live config state (exported as JSON).
  private readonly colors: Record<ClearanceTier, string> = { ...TIER_COLOR };
  private glow = 1;
  private avatarScale = 1;

  private ambientOn = false;

  constructor(
    scene: THREE.Scene,
    private readonly host: HTMLElement,
    private readonly audio: AudioEngine,
  ) {
    this.buildRow();
    scene.add(this.root);
    this.root.visible = false;
    this.panel = this.buildPanel();
  }

  // --- build the asset row ---------------------------------------------------------------

  private buildRow(): void {
    const cells: Array<() => GalleryItem> = [];

    // Four tier avatars (walking in place) — each a distinct civilian whose tier shows as the
    // small accent (armband/sash/visor), the shipping art direction. `material` is the accent.
    let tierSeed = 0;
    for (const tier of CLEARANCE_TIERS) {
      cells.push(() => {
        const a = buildAvatarBody({ seed: 0x9e3779b1 + tierSeed++ * 0x85ebca77 });
        a.setTier(hexNum(TIER_COLOR[tier]));
        a.group.position.y = AVATAR_HEIGHT / 2; // lift so the feet rest on the floor
        // The live tier picker edits the accent material (a.material) directly.
        this.tierMats.push({ material: a.material, tier });
        this.avatarGroups.push(a.group);
        return { group: a.group, label: `Agent · ${tier}`, dispose: a.dispose, animate: a.animate };
      });
    }

    // A small row of VARIED civilians so the owner can review the crowd's variety in /preview.
    // No tier accent override — they show the default civilian accent; the point is the variety.
    const CIVILIAN_SEEDS = [11, 137, 9001, 424242] as const;
    for (const seed of CIVILIAN_SEEDS) {
      cells.push(() => {
        const a = buildAvatarBody({ seed });
        a.group.position.y = AVATAR_HEIGHT / 2;
        this.avatarGroups.push(a.group);
        return { group: a.group, label: `Civilian · ${seed}`, dispose: a.dispose, animate: a.animate };
      });
    }

    // Props. We know each builder's material layout (we own art/props), so we tag the tier +
    // glow materials explicitly for the live config.
    cells.push(() => this.propItem(buildTerminal(), 'Intel terminal', { glow: [1] }));
    cells.push(() =>
      this.propItem(buildKeycardReader(hexNum(TIER_COLOR.security)), 'Keycard reader', {
        tier: { security: [1] },
        glow: [1],
      }),
    );
    cells.push(() => this.propItem(buildVaultPodium(), 'Vault podium', { glow: [1] }));
    cells.push(() => this.propItem(buildBriefcase(), 'Package (briefcase)', { glow: [0] }));
    cells.push(() =>
      this.propItem(buildDoorFrame(hexNum(TIER_COLOR.staff), true), 'Door frame', {
        tier: { staff: [0, 1, 2] },
        glow: [0, 1, 2],
      }),
    );

    // Facility set-dressing kit. We tag every emissive material to the glow slider so the
    // whole HQ palette tunes together (these props have no tier-following colour).
    cells.push(() => this.glowItem(buildServerRack(), 'Server rack'));
    cells.push(() => this.glowItem(buildLabBench(), 'Lab bench'));
    cells.push(() => this.glowItem(buildGlassPartition(), 'Glass partition'));
    cells.push(() => this.glowItem(buildWallMonitor(), 'Wall monitor'));
    cells.push(() => this.glowItem(buildCeilingDuct(), 'Ceiling duct'));
    cells.push(() => this.glowItem(buildHazardStripe(), 'Hazard stripe'));

    // Neon nightclub kit — emissive-heavy, all tuned by the glow slider.
    cells.push(() => this.glowItem(buildDancefloor(8, 6), 'Dancefloor'));
    cells.push(() => this.glowItem(buildNeonStrip(4), 'Neon strip'));
    cells.push(() => this.glowItem(buildNeonSign(), 'Neon sign'));
    cells.push(() => this.glowItem(buildBarCounter(), 'Bar counter'));
    cells.push(() => this.glowItem(buildSpeakerStack(), 'Speaker stack'));
    cells.push(() => this.glowItem(buildDjBooth(), 'DJ booth'));
    cells.push(() => this.glowItem(buildSpotLight(), 'Par-can light'));
    cells.push(() => this.glowItem(buildVelvetRope(), 'Velvet rope'));

    // Quality pass 2 — GREENERY (the biggest richness lever). Plants have no emissive, so
    // they show as plain cells (no glow tagging), reviewed purely for shape/lushness.
    cells.push(() => this.plainItem(buildPlanter(), 'Planter'));
    cells.push(() => this.plainItem(buildPalm(3.2), 'Palm'));
    cells.push(() => this.plainItem(buildMonstera(1.1), 'Monstera'));
    cells.push(() => this.plainItem(buildPlanterBox(2.4), 'Planter box'));

    // Quality pass 2 — warm/practical FIXTURES (emissive → glow-tunable).
    cells.push(() => this.glowItem(buildGlobePendant(), 'Globe pendant'));
    cells.push(() => this.glowItem(buildWallSconce(), 'Wall sconce'));
    cells.push(() => this.glowItem(buildFireplace(), 'Fireplace'));
    cells.push(() => this.glowItem(buildWallClock(), 'Wall clock'));
    cells.push(() => this.glowItem(buildHangingSign(), 'Hanging sign'));

    // Quality pass 2 — characterful DECOR.
    cells.push(() => this.plainItem(buildLoungeSet(), 'Lounge set'));
    cells.push(() => this.glowItem(buildArcadeCabinet(), 'Arcade cabinet'));
    cells.push(() => this.glowItem(buildPinball(), 'Pinball'));
    cells.push(() => this.glowItem(buildPatioSet(), 'Patio set'));

    // Quality pass 2 — ARCHITECTURE + hero centrepiece + FLOOR DECALS.
    cells.push(() => this.glowItem(buildRailing(4), 'Railing'));
    cells.push(() => this.glowItem(buildDais(2.4), 'Central dais'));
    cells.push(() => this.glowItem(buildRingTrack(3.5, 3), 'Ring track'));
    cells.push(() => this.glowItem(buildFloorDecal('target', 3.5), 'Floor rug (target)'));
    cells.push(() => this.glowItem(buildFloorDecal('stripes', 3.5), 'Floor stripes'));
    cells.push(() => this.glowItem(buildFloorDecal('grid', 3.5), 'Floor tile-grid'));

    const span = (cells.length - 1) * SPACING;
    cells.forEach((make, i) => {
      const item = make();
      item.group.position.x = i * SPACING - span / 2;
      this.root.add(item.group);
      this.items.push(item);
    });
  }

  /** Wrap an ArtProp as a GalleryItem, registering its tier-following + glow materials. */
  private propItem(
    prop: ArtProp,
    label: string,
    roles: { tier?: Partial<Record<ClearanceTier, number[]>>; glow?: number[] },
  ): GalleryItem {
    for (const [tier, idxs] of Object.entries(roles.tier ?? {})) {
      for (const i of idxs ?? []) {
        const m = prop.materials[i];
        if (m) this.tierMats.push({ material: m, tier: tier as ClearanceTier });
      }
    }
    for (const i of roles.glow ?? []) {
      const m = prop.materials[i];
      if (m) this.glowMats.push({ material: m, base: m.emissiveIntensity });
    }
    return { group: prop.group, label, dispose: prop.dispose };
  }

  /**
   * Wrap an ArtProp whose colours are NOT tier-following (the themed set dressing), tagging
   * every emissive material to the glow slider so the whole prop tunes with it.
   */
  private glowItem(prop: ArtProp, label: string): GalleryItem {
    for (const m of prop.materials) {
      if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) {
        this.glowMats.push({ material: m, base: m.emissiveIntensity });
      }
    }
    return { group: prop.group, label, dispose: prop.dispose };
  }

  /** Wrap an ArtProp with no tier-following / emissive materials to tag (e.g. greenery). */
  private plainItem(prop: ArtProp, label: string): GalleryItem {
    return { group: prop.group, label, dispose: prop.dispose };
  }

  // --- live config panel -----------------------------------------------------------------

  private buildPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'preview-panel';
    Object.assign(panel.style, {
      display: 'none',
      maxWidth: '260px',
      position: 'fixed',
      right: '12px',
      top: '12px',
      left: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.className = 'preview-title';
    title.textContent = 'Asset Gallery';
    panel.appendChild(title);

    // Tier colour pickers.
    for (const tier of CLEARANCE_TIERS) {
      const row = document.createElement('label');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        margin: '5px 0',
        fontSize: '13px',
      } satisfies Partial<CSSStyleDeclaration>);
      const input = document.createElement('input');
      input.type = 'color';
      input.value = TIER_COLOR[tier];
      input.addEventListener('input', () => {
        this.colors[tier] = input.value;
        this.applyTierColor(tier, input.value);
      });
      const name = document.createElement('span');
      name.textContent = tier;
      row.append(input, name);
      panel.appendChild(row);
    }

    panel.appendChild(this.slider('Prop glow', 0, 2, 0.05, this.glow, (v) => {
      this.glow = v;
      this.applyGlow();
    }));
    panel.appendChild(this.slider('Avatar scale', 0.6, 1.6, 0.02, this.avatarScale, (v) => {
      this.avatarScale = v;
      for (const g of this.avatarGroups) g.scale.setScalar(v);
    }));

    // Audio: ambient toggle + a grid of SFX preview buttons (audition every sound here).
    panel.appendChild(this.buildAudioSection());

    // Export.
    const out = document.createElement('textarea');
    Object.assign(out.style, {
      width: '100%',
      height: '92px',
      marginTop: '8px',
      fontSize: '11px',
      fontFamily: 'ui-monospace, monospace',
      background: 'rgba(0,0,0,0.4)',
      color: '#cde',
      border: '1px solid rgba(255,255,255,0.15)',
      borderRadius: '4px',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const btn = document.createElement('button');
    btn.textContent = 'Export config JSON';
    Object.assign(btn.style, { marginTop: '8px', width: '100%', cursor: 'pointer' } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener('click', () => {
      out.style.display = 'block';
      out.value = JSON.stringify(
        { tierColors: this.colors, propGlow: this.glow, avatarScale: this.avatarScale },
        null,
        2,
      );
      out.select();
    });
    panel.append(btn, out);

    this.host.appendChild(panel);
    return panel;
  }

  /** Ambient on/off + a grid of one-shot SFX preview buttons. */
  private buildAudioSection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.margin = '10px 0 2px';
    const head = document.createElement('div');
    head.textContent = 'Audio';
    head.style.fontSize = '13px';
    head.style.marginBottom = '4px';
    wrap.appendChild(head);

    const ambient = document.createElement('button');
    ambient.textContent = '▶ Ambient';
    ambient.style.cursor = 'pointer';
    ambient.style.marginRight = '6px';
    ambient.addEventListener('click', () => {
      this.audio.resume(); // the click itself is a valid unlock gesture
      this.ambientOn = !this.ambientOn;
      if (this.ambientOn) this.audio.startAmbient();
      else this.audio.stopAmbient();
      ambient.textContent = this.ambientOn ? '■ Ambient' : '▶ Ambient';
    });
    wrap.appendChild(ambient);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '4px',
      marginTop: '6px',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const kind of SFX_KINDS) {
      const b = document.createElement('button');
      b.textContent = kind;
      b.style.cursor = 'pointer';
      b.style.fontSize = '11px';
      b.addEventListener('click', () => {
        this.audio.resume();
        this.audio.playSfx(kind);
      });
      grid.appendChild(b);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.margin = '8px 0 2px';
    row.style.fontSize = '13px';
    const head = document.createElement('div');
    head.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = '100%';
    input.addEventListener('input', () => onChange(Number(input.value)));
    row.append(head, input);
    return row;
  }

  private applyTierColor(tier: ClearanceTier, hex: string): void {
    const c = new THREE.Color(hex);
    for (const tm of this.tierMats) {
      if (tm.tier !== tier) continue;
      tm.material.color.copy(c);
      if (tm.material.emissive.getHex() !== 0) tm.material.emissive.copy(c);
    }
  }

  private applyGlow(): void {
    for (const gm of this.glowMats) gm.material.emissiveIntensity = gm.base * this.glow;
  }

  // --- lifecycle -------------------------------------------------------------------------

  /** Show/hide the gallery (and its panel). */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.panel.style.display = visible ? 'block' : 'none';
  }

  /** Frame the orbit camera to look along the whole asset row (pulled back to fit its span). */
  frame(camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update(): void }): void {
    // The row is centred on x=0 and spans (n-1)*SPACING; pull the camera back far enough that
    // even the outermost assets stay in frame as the kit grows.
    const span = Math.max((this.items.length - 1) * SPACING, 12);
    const dist = span * 0.62 + 6;
    controls.target.set(0, 0.8, 0);
    camera.position.set(0, span * 0.22 + 3, dist);
    camera.lookAt(0, 0.8, 0);
    controls.update();
  }

  /** Spin each asset on its own turntable + walk the avatars. `dt` seconds. */
  update(dt: number): void {
    if (!this.root.visible) return;
    for (const item of this.items) {
      item.group.rotation.y += TURNTABLE * dt;
      item.animate?.(dt, AVATAR_DEMO_SPEED);
    }
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.panel.remove();
    this.root.removeFromParent();
  }
}
