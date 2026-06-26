/// <reference types="vite/client" />

// Build-time env the client reads (Vite replaces `import.meta.env.*` at build). Only
// `VITE_`-prefixed vars are exposed to the bundle.
interface ImportMetaEnv {
  /**
   * Absolute Colyseus endpoint (e.g. `wss://deceive-me-daddy.fly.dev`). Set on the static
   * host (Vercel) so the client connects to the deployed Fly server. Unset when the Fly app
   * serves the client itself (same-origin connect) or in local dev (localhost:2567).
   */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
