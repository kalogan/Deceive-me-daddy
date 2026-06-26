// Procedural audio for the spy-noir client (self-contained — NO external asset files).
//
// Everything you hear is SYNTHESISED at runtime with the Web Audio API: oscillators, noise
// buffers, biquad filters, and gain ADSR envelopes. That keeps the client a single bundle
// (no audio downloads, no licensing) and lets the soundtrack react to gameplay frame-by-frame.
//
// Two responsibilities:
//   1. An evolving, LOW-volume ambient drone (the noir "tension pad") that loops for the whole
//      session — a few detuned oscillators run through a lowpass that a slow LFO opens/closes,
//      plus a sparse, randomised arpeggio so it never feels static.
//   2. One-shot SFX (`playSfx`), one bespoke synth per gameplay event (fire, hit, reveal, …).
//
// Browsers SUSPEND an AudioContext until a user gesture, so this class lazy-inits: the context
// and graph are only built on the first `resume()` (call it from a click/keydown handler).
// Until then every method is a safe no-op, so wiring order in main.ts doesn't matter.
//
// Browser-only (it touches `AudioContext`/`window`), so it must NEVER be imported by a Node
// gate test. Only main.ts imports it, and main.ts isn't imported by any test — keep it that way.
import type { SfxKind } from './audioEvents';

export type { SfxKind } from './audioEvents';

/** Master ceiling so the whole mix can never clip the user's ears. */
const MASTER_GAIN = 0.6;
/** The ambient drone sits well under the SFX so events always read over the bed. */
const MUSIC_GAIN = 0.18;
/** SFX bus gain — punchy but headroom-safe under the master ceiling. */
const SFX_GAIN = 0.5;

/**
 * Wraps a single `AudioContext` with a master gain and two sub-buses (music + sfx) so the
 * ambient bed and the one-shot effects can be balanced (and muted) independently.
 *
 * Lifecycle: construct cheaply (no context yet) → `resume()` on the first user gesture builds
 * and unlocks the graph → `startAmbient()` to bring up the bed → `playSfx()` per event →
 * `dispose()` tears the whole context down.
 */
export class AudioEngine {
  /** The audio graph, or null until the first `resume()` (browsers block pre-gesture). */
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  /** Live nodes of the running ambient bed; null while ambient is stopped. */
  private ambient: { nodes: AudioScheduledSourceNode[]; arpTimer: number | null } | null = null;

  /** User mute toggle (M key). Held independently of the lazy-init so it survives a resume. */
  private muted = false;

  /**
   * Build (once) and resume the AudioContext. Safe to call repeatedly — subsequent calls just
   * re-resume a context the browser may have auto-suspended. Must be invoked from a user-gesture
   * handler the first time, or the browser keeps the context suspended and nothing is audible.
   */
  resume(): void {
    if (!this.ctx) {
      // Lazily construct the context + bus graph on first unlock. `webkitAudioContext` is the
      // legacy Safari name; fall back to it so the soundtrack works there too.
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // No Web Audio (very old browser) — stay a silent no-op.
      const ctx = new Ctor();

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);

      const musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_GAIN;
      musicBus.connect(master);

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = SFX_GAIN;
      sfxBus.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
    }
    // A context can start (or later become) 'suspended'; resume returns a promise we don't await.
    void this.ctx.resume();
  }

  /** Mute/unmute the entire mix by riding the master gain (keeps the graph running). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      // Short ramp instead of a hard set so toggling mute never clicks.
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + 0.05);
    }
  }

  /**
   * Start the evolving ambient noir bed. Idempotent — calling it while ambient already plays is
   * a no-op (so a second user gesture won't stack two drones). Loops until `stopAmbient`/`dispose`.
   */
  startAmbient(): void {
    if (!this.ctx || !this.musicBus || this.ambient) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // A slow LFO that breathes the lowpass cutoff open and closed — the source of the "evolving"
    // feeling. Drives the filter frequency around a low centre so the pad never gets bright/harsh.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 6;
    filter.connect(this.musicBus);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06; // ~16s sweep — glacial, cinematic.
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 260; // sweep ±260Hz around the 420Hz centre.
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start(now);

    // A small detuned oscillator stack (a minor-ish drone) for a warm, slightly uneasy bed.
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, now);
    padGain.gain.linearRampToValueAtTime(1, now + 4); // slow fade-in, no click.
    padGain.connect(filter);

    const partials = [55, 55.4, 82.5, 110, 164.8]; // A1 root + detune + fifth + octave + E3.
    const oscNodes: AudioScheduledSourceNode[] = [];
    for (const hz of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.16;
      osc.connect(voiceGain).connect(padGain);
      osc.start(now);
      oscNodes.push(osc);
    }

    // Sparse randomised arpeggio: occasionally pluck a soft note from a pentatonic set, far above
    // the drone, so the bed shimmers and evolves rather than sitting on one chord forever.
    const arpScale = [220, 261.63, 329.63, 392, 440, 523.25];
    const scheduleArp = (): void => {
      if (!this.ctx || !this.musicBus) return;
      const t = this.ctx.currentTime;
      const hz = arpScale[Math.floor(Math.random() * arpScale.length)] ?? 440;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6); // long, soft tail.
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + 1.7);
    };
    // Re-arm at an irregular interval so the arpeggio never falls into a steady rhythm.
    const armArp = (): void => {
      const delay = 2500 + Math.random() * 4000;
      arpTimer = window.setTimeout(() => {
        scheduleArp();
        armArp();
      }, delay);
    };
    let arpTimer: number | null = null;
    armArp();

    this.ambient = { nodes: [...oscNodes, lfo], arpTimer };
  }

  /** Fade out and stop the ambient bed (idempotent — no-op if nothing is playing). */
  stopAmbient(): void {
    if (!this.ctx || !this.ambient) return;
    const now = this.ctx.currentTime;
    if (this.ambient.arpTimer !== null) window.clearTimeout(this.ambient.arpTimer);
    for (const node of this.ambient.nodes) {
      try {
        node.stop(now + 0.6); // let voices fall silent rather than cutting (no click).
      } catch {
        // Already stopped — ignore.
      }
    }
    this.ambient = null;
  }

  /**
   * Play a one-shot effect. Each `kind` builds its own short-lived graph onto the sfx bus and
   * cleans itself up when its envelope finishes. Safe no-op before `resume()`.
   */
  playSfx(kind: SfxKind): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const out = this.sfxBus;
    const t = ctx.currentTime;
    switch (kind) {
      case 'fire':
        this.synthFire(ctx, out, t);
        break;
      case 'hit':
        this.synthHit(ctx, out, t);
        break;
      case 'reveal':
        this.synthReveal(ctx, out, t);
        break;
      case 'disguise':
        this.synthDisguise(ctx, out, t);
        break;
      case 'intel':
        this.synthIntel(ctx, out, t);
        break;
      case 'keycard':
        this.synthKeycard(ctx, out, t);
        break;
      case 'vaultOpen':
        this.synthVaultOpen(ctx, out, t);
        break;
      case 'win':
        this.synthWin(ctx, out, t);
        break;
      case 'downed':
        this.synthDowned(ctx, out, t);
        break;
      case 'revive':
        this.synthRevive(ctx, out, t);
        break;
      case 'ability':
        this.synthAbility(ctx, out, t);
        break;
    }
  }

  /** Stop ambient, kill every node, and close the context. The engine becomes inert. */
  dispose(): void {
    this.stopAmbient();
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.ambient = null;
  }

  // --- Synthesis helpers -------------------------------------------------------------------
  // Each builds a tiny one-shot graph: source(s) → gain (with an ADSR envelope) → out. Gains
  // always ramp from ~0 and decay to a tiny floor (exponentialRamp can't hit 0) so there are no
  // clicks. Oscillators are stopped just after their tail so the graph is garbage-collected.

  /** A short buffer of white noise — the raw material for filtered "zap"/"whoosh" textures. */
  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** 'fire' — a sharp, bright filtered-noise zap with a fast snap envelope. */
  private synthFire(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.2); // pitch-down sweep = "pew".
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.25);
  }

  /** 'hit' — a short low thud: a fast pitch-dropping sine plus a noise transient. */
  private synthHit(ctx: AudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.3);

    // A short noise click layered on top for the "impact" snap.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(lp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.07);
  }

  /** 'reveal' — an alarm sting: two harsh detuned tones pulsing twice (cover blown!). */
  private synthReveal(ctx: AudioContext, out: AudioNode, t: number): void {
    const g = ctx.createGain();
    g.connect(out);
    // Two short pulses, the classic alarm "bwa-bwa".
    for (let i = 0; i < 2; i++) {
      const on = t + i * 0.18;
      g.gain.setValueAtTime(0.0001, on);
      g.gain.exponentialRampToValueAtTime(0.8, on + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, on + 0.15);
    }
    for (const hz of [440, 466]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz; // a tense minor-second clash.
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.4);
    }
  }

  /** 'disguise' — a soft upward shimmer/whoosh of filtered noise (slipping into a new identity). */
  private synthDisguise(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + 0.5); // rising sweep = "whoosh up".
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.62);
  }

  /** 'intel' — a bright two-note positive blip (you grabbed something useful). */
  private synthIntel(ctx: AudioContext, out: AudioNode, t: number): void {
    const notes = [659.25, 987.77]; // E5 → B5, a clean rising perfect fifth.
    notes.forEach((hz, i) => {
      const on = t + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, on);
      g.gain.exponentialRampToValueAtTime(0.4, on + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, on + 0.12);
      osc.connect(g).connect(out);
      osc.start(on);
      osc.stop(on + 0.14);
    });
  }

  /** 'keycard' — a terse mechanical click + blip (a reader accepting a card). */
  private synthKeycard(ctx: AudioContext, out: AudioNode, t: number): void {
    // Click: ultra-short filtered noise.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(hp).connect(cg).connect(out);
    src.start(t);
    src.stop(t + 0.04);
    // Blip: a single confirming tone right after.
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(out);
    osc.start(t + 0.04);
    osc.stop(t + 0.16);
  }

  /** 'vaultOpen' — a heavy resonant boom + low chord (a great door swinging wide). */
  private synthVaultOpen(ctx: AudioContext, out: AudioNode, t: number): void {
    // The boom: a deep sine dropping through a resonant lowpass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 8;
    lp.connect(out);
    const chord = [55, 82.5, 110]; // A1, E2, A2 — a hollow, powerful open-fifth stack.
    for (const hz of chord) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hz * 1.5, t);
      osc.frequency.exponentialRampToValueAtTime(hz, t + 0.4); // settle down into the chord.
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      osc.connect(g).connect(lp);
      osc.start(t);
      osc.stop(t + 1.45);
    }
  }

  /** 'win' — a quick triumphant major arpeggio (your team extracted!). */
  private synthWin(ctx: AudioContext, out: AudioNode, t: number): void {
    const arp = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — a C-major fanfare.
    arp.forEach((hz, i) => {
      const on = t + i * 0.11;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, on);
      g.gain.exponentialRampToValueAtTime(0.5, on + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, on + 0.5); // ring out, longer on the last note.
      osc.connect(g).connect(out);
      osc.start(on);
      osc.stop(on + 0.55);
    });
  }

  /** 'downed' — a bleak descending low tone (you've gone down). */
  private synthDowned(ctx: AudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.9); // a long sinking glissando.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.05);
  }

  /** 'revive' — a hopeful rising chime (an ally pulled you back up). */
  private synthRevive(ctx: AudioContext, out: AudioNode, t: number): void {
    const notes = [329.63, 440, 587.33]; // E4 A4 D5 — a clean rising lift.
    notes.forEach((hz, i) => {
      const on = t + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, on);
      g.gain.exponentialRampToValueAtTime(0.45, on + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, on + 0.45);
      osc.connect(g).connect(out);
      osc.start(on);
      osc.stop(on + 0.5);
    });
  }

  /** 'ability' — a tech whoosh: rising filtered noise + a synthy sweep (Expertise engaged). */
  private synthAbility(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 4;
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.3, t + 0.15);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.52);

    // A synth sweep under the noise for a "powering up" body.
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.4);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.25, t + 0.05);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.5);
  }
}
