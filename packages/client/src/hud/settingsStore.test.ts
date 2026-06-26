// Unit tests for the PURE settings parse/serialise + the resilient Storage accessors. No DOM /
// real localStorage here — a tiny in-memory fake stands in (and a throwing fake proves resilience).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  type PersistedSettings,
} from './settingsStore';

/** A minimal in-memory Storage-like for the accessor tests. */
function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe('parseSettings', () => {
  it('returns defaults for null / empty / non-JSON input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full valid settings object', () => {
    const s: PersistedSettings = {
      musicVolume: 0.3,
      sfxVolume: 0.8,
      muted: true,
      invertStrafe: true,
    };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  it('fills missing fields from defaults (partial blob)', () => {
    expect(parseSettings('{"muted":true}')).toEqual({
      ...DEFAULT_SETTINGS,
      muted: true,
    });
  });

  it('clamps out-of-range volumes to 0..1', () => {
    const s = parseSettings('{"musicVolume":5,"sfxVolume":-2}');
    expect(s.musicVolume).toBe(1);
    expect(s.sfxVolume).toBe(0);
  });

  it('falls back per-field on wrong types', () => {
    const s = parseSettings('{"musicVolume":"loud","muted":"yes"}');
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.muted).toBe(DEFAULT_SETTINGS.muted);
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns defaults for a null store', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it('persists and reloads through a fake store', () => {
    const store = fakeStorage();
    const s: PersistedSettings = {
      musicVolume: 0.25,
      sfxVolume: 0.9,
      muted: true,
      invertStrafe: false,
    };
    expect(saveSettings(store, s)).toBe(true);
    expect(loadSettings(store)).toEqual(s);
  });

  it('is resilient to a throwing store (returns defaults / false, no throw)', () => {
    const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, DEFAULT_SETTINGS)).toBe(false);
  });
});
