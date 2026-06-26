// The preview-harness entry (preview.html points here). Backend-free: it mounts the
// REAL MapView over file-loaded content packs — no server, no Colyseus, no sim net code.
//
// Responsibilities are ONLY the inspection scaffolding: renderer + orbit camera + rAF
// loop + resize. The actual map rendering is the REAL MapView, driven by PreviewApp.
import * as THREE from 'three';
import { PreviewApp } from './PreviewApp';

function mount(): { renderer: THREE.WebGLRenderer; app: HTMLElement } {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app mount point missing from preview.html');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);
  return { renderer, app };
}

function start(): void {
  const { renderer, app } = mount();

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );

  const preview = new PreviewApp(camera, renderer, app);
  const scene = preview.getScene();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const frame = () => {
    requestAnimationFrame(frame);
    preview.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}

start();
