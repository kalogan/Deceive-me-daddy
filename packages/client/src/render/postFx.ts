// Post-processing for the stylised spy look (art engine, slice 2). An EffectComposer chain:
//   RenderPass → UnrealBloomPass (emissive glow) → OutputPass (tone-map + colour-space).
// Only bright/emissive things bloom (the reveal halo, invulnerable gold, the package, crumbs)
// thanks to a high threshold, so the scene reads cinematic without washing out.
//
// Pure WebGL glue (no unit test — verified by the headless screenshot smoke); kept a thin
// module so main.ts just calls render()/setSize()/dispose().
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostFx {
  /** Render the scene through the post chain (replaces renderer.render). */
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Build the post-processing chain for (renderer, scene, camera). */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): PostFx {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // (resolution, strength, radius, threshold). High threshold → only genuinely bright/
  // emissive surfaces glow; modest strength keeps it stylised, not blown out.
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.62, 0.6, 0.82);
  composer.addPass(bloom);

  // Final tone-map (renderer.toneMapping) + colour-space conversion.
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    setSize: (w, h) => {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    dispose: () => composer.dispose(),
  };
}
