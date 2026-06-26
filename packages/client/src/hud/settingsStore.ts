// PURE-ish, DOM-free SETTINGS persistence for the menu's Settings screen. The serialisation +
// validation logic is pure and unit-tested; the localStorage read/write is wrapped in a thin,
// try/catch'd accessor so absent/corrupt/blocked storage degrades to sane defaults rather than
// throwing (Safari private mode, quota, JSON garbage). Menu.ts imports this to seed its sliders/
// checkboxes on build and to save on every change.
//
// Kept out of `menu/` so the *parsing* can be unit-tested without importing the DOM-touching
// Menu. The Storage handle is injected so tests can pass a tiny in-memory fake (no jsdom).

/** The persisted player settings. All values already validated/clamped on the way out of `parseSettings`. */
export interface PersistedSettings {
  /** Music-bus volume, 0..1. */
  musicVolume: number;
  /** SFX-bus volume, 0..1. */
  sfxVolume: number;
  /** Master mute toggle. */
  muted: boolean;
  /** Invert the strafe (left/right) axis. */
  invertStrafe: boolean;
}

/** The defaults applied when nothing is stored (or storage is unreadable/corrupt). */
export const DEFAULT_SETTINGS: PersistedSettings = {
  musicVolume: 0.6,
  sfxVolume: 0.6,
  muted: false,
  invertStrafe: false,
};

/** The single localStorage key the settings blob lives under. */
export const SETTINGS_KEY = 'deceive.settings.v1';

/** Clamp an unknown value to a 0..1 volume, falling back to `fallback` if it isn't a finite number. */
function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/** Coerce an unknown value to a boolean, falling back to `fallback` if it isn't one. */
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Parse a raw JSON string (as read from storage) into validated settings. PURE.
 *
 * Resilient by construction: a null/empty/corrupt string, a non-object, or any missing/ill-typed
 * field falls back FIELD-BY-FIELD to DEFAULT_SETTINGS — so a partial or garbage blob never throws
 * and never yields out-of-range values. Volumes are clamped to 0..1.
 */
export function parseSettings(raw: string | null): PersistedSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof obj !== 'object' || obj === null) return { ...DEFAULT_SETTINGS };
  const o = obj as Record<string, unknown>;
  return {
    musicVolume: clampVolume(o.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVolume(o.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    muted: asBool(o.muted, DEFAULT_SETTINGS.muted),
    invertStrafe: asBool(o.invertStrafe, DEFAULT_SETTINGS.invertStrafe),
  };
}

/** Serialise validated settings to the JSON string stored under SETTINGS_KEY. PURE. */
export function serializeSettings(settings: PersistedSettings): string {
  return JSON.stringify(settings);
}

/**
 * Load settings from a Storage-like handle (e.g. `localStorage`), resilient to a throwing or
 * absent store. A null handle, or any thrown error reading it, yields DEFAULT_SETTINGS.
 */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null): PersistedSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persist settings to a Storage-like handle, swallowing any error (private-mode/quota/blocked
 * storage must never crash the menu). Returns true on a successful write, false otherwise.
 */
export function saveSettings(
  storage: Pick<Storage, 'setItem'> | null,
  settings: PersistedSettings,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, serializeSettings(settings));
    return true;
  } catch {
    return false;
  }
}
