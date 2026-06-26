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
 * Which ambient bed is playing. `menu` is the slow noir tension pad (front-of-game / splash);
 * `match` is a lighter, more UP-TEMPO groove (a soft pulse + brighter arp) for live play in the
 * facility; `club` is a driving SYNTHWAVE club bed (four-on-the-floor + a pulsing synth bassline)
 * for the neon nightclub level. `beach` is a SUNNY tropical bed (warm major pads + a breezy
 * marimba-ish arp + light percussion) for the Manhattan-beach level; `lounge` is a smoky jazzy-spy
 * bed (relaxed swung groove, dim/dusky voicing); `tension` is a slow suspense bed (a dissonant,
 * pulse-light stalking drone). All sit at the same low MUSIC_GAIN — the "mood" comes from
 * voicing/tempo/brightness, not volume.
 */
export type AmbientVariant = 'menu' | 'match' | 'club' | 'beach' | 'lounge' | 'tension';

/**
 * Map a content-pack THEME string to the in-match ambient bed to play. The single source of
 * truth for the game's theme→track wiring (main.ts uses this). Pure + DOM-free so it can be
 * unit-tested in the Node gate. Unknown themes fall back to the neutral facility groove.
 */
export function ambientForTheme(theme: string): AmbientVariant {
  switch (theme) {
    case 'nightclub':
      return 'club';
    case 'beach':
      return 'beach';
    case 'research_facility':
      return 'match';
    default:
      return 'match';
  }
}

/**
 * Plain data labelling each ambient bed by what it's FOR — drives the preview's Soundtracks
 * player so the owner can audition every track. Order: front-of-game first, then the in-match
 * beds, then the extra mood beds.
 */
export const SOUNDTRACKS: ReadonlyArray<{ variant: AmbientVariant; label: string }> = [
  { variant: 'menu', label: 'Splash / Menu' },
  { variant: 'match', label: 'Facility' },
  { variant: 'club', label: 'Neon Club' },
  { variant: 'beach', label: 'Manhattan Beach' },
  { variant: 'lounge', label: 'Jazzy Lounge' },
  { variant: 'tension', label: 'Suspense' },
];

/** Per-variant voicing of the ambient bed. Shapes the drone, the lowpass LFO, and the arpeggio. */
interface AmbientConfig {
  /** Drone partials (Hz) — a detuned saw stack. */
  partials: number[];
  /** Per-voice gain in the stack. */
  voiceGain: number;
  /** Lowpass centre + resonance the LFO breathes around. */
  filterFreq: number;
  filterQ: number;
  /** LFO sweep rate (Hz) and depth (Hz) on the lowpass cutoff. */
  lfoRate: number;
  lfoDepth: number;
  /** Pad fade-in (seconds) — kept short so the bed is audible quickly on the splash. */
  fadeIn: number;
  /** Sparse arpeggio voicing: the note pool, re-arm window, gain, and tail length. */
  arpScale: number[];
  arpMinMs: number;
  arpVarMs: number;
  arpGain: number;
  arpTail: number;
  /** Tempo (BPM) for the rhythmic groove, or null for a beatless pad (the menu bed). */
  bpm: number | null;
  /** Optional synthwave bassline: one root note (Hz) per beat, cycled — drives the club pulse. */
  bass?: number[];
  /**
   * Optional oscillator type for the drone partials (default 'sawtooth'). The beach/lounge beds
   * use 'triangle'/'sine' for a warmer, less buzzy pad than the noir saw stack.
   */
  padType?: OscillatorType;
  /**
   * Arp voicing flavour. 'triangle' (default) is the existing soft pluck; 'marimba' swaps in a
   * percussive sine-pluck with a fast tail (the breezy steel-drum/marimba twinkle for the beach).
   */
  arpVoice?: 'triangle' | 'marimba';
  /**
   * Groove style for the rhythmic beat: 'club' (default — four-on-the-floor kick + offbeat hat),
   * or 'beachy' (a light, laid-back kick + soft shaker on the offbeat, no driving pulse).
   */
  groove?: 'club' | 'beachy';
}

const AMBIENT: Record<AmbientVariant, AmbientConfig> = {
  // Slow, glacial noir pad — A-minor-ish, dark, no pulse.
  menu: {
    partials: [55, 55.4, 82.5, 110, 164.8], // A1 + detune + E2 + A2 + E3
    voiceGain: 0.16,
    filterFreq: 420,
    filterQ: 6,
    lfoRate: 0.06,
    lfoDepth: 260,
    fadeIn: 1.2, // was 4s — start sooner on the splash.
    arpScale: [220, 261.63, 329.63, 392, 440, 523.25],
    arpMinMs: 2500,
    arpVarMs: 4000,
    arpGain: 0.06,
    arpTail: 1.6,
    bpm: null,
  },
  // Brighter, lifted bed with a soft pulse — a C/G-major shimmer over a gentle groove.
  match: {
    partials: [65.41, 98, 130.81, 196], // C2 + G2 + C3 + G3 — open, brighter than the menu drone
    voiceGain: 0.12,
    filterFreq: 760,
    filterQ: 3,
    lfoRate: 0.14,
    lfoDepth: 420,
    fadeIn: 0.7,
    arpScale: [392, 440, 523.25, 587.33, 659.25, 783.99], // G4 A4 C5 D5 E5 G5 — major pentatonic lift
    arpMinMs: 700,
    arpVarMs: 900,
    arpGain: 0.05,
    arpTail: 0.85,
    bpm: 104,
  },
  // Synthwave club bed for the neon nightclub: a dark, neon-bright A-minor groove over a driving
  // four-on-the-floor kick + offbeat hats + a pulsing per-beat synth BASS line. The arp twinkles
  // fast and bright over the top. Classic retro-club energy, still under the SFX in the mix.
  club: {
    partials: [55, 82.5, 110, 164.8], // A1 + E2 + A2 + E3 — a moody minor stack
    voiceGain: 0.1,
    filterFreq: 900,
    filterQ: 4,
    lfoRate: 0.2,
    lfoDepth: 520,
    fadeIn: 0.6,
    arpScale: [440, 523.25, 659.25, 880, 987.77, 1046.5], // A5-ish bright minor-pentatonic sparkle
    arpMinMs: 360,
    arpVarMs: 480,
    arpGain: 0.045,
    arpTail: 0.5,
    bpm: 120,
    // A1 A1 F1 G1 — the iconic descending synthwave bass walk (one root per beat, looped).
    bass: [55, 55, 43.65, 49],
  },
  // Sunny tropical beach bed (Manhattan-beach level): a bright D-MAJOR open pad (warm triangle
  // partials, no buzz) over a relaxed, laid-back groove (~96 bpm) with a SOFT kick + a light
  // offbeat shaker, and a breezy high marimba/steel-drum-ish arpeggio twinkling on a major
  // pentatonic. Cheerful and warm, NOT dark — the brightness comes from the major voicing + the
  // wide-open lowpass, still under the SFX in the mix.
  beach: {
    partials: [73.42, 110, 146.83, 220], // D2 + A2 + D3 + A3 — open major fifths, airy
    voiceGain: 0.11,
    filterFreq: 1100,
    filterQ: 1.5,
    lfoRate: 0.1,
    lfoDepth: 380,
    fadeIn: 0.8,
    // D4 E4 F#4 A4 B4 D5 — D major pentatonic, the breezy steel-drum twinkle up top.
    arpScale: [587.33, 659.25, 739.99, 880, 987.77, 1174.66],
    arpMinMs: 520,
    arpVarMs: 620,
    arpGain: 0.055,
    arpTail: 0.7,
    bpm: 96,
    padType: 'triangle',
    arpVoice: 'marimba',
    groove: 'beachy',
  },
  // Jazzy-spy lounge bed: a smoky, dim/dusky bed in a minor-ish key over a relaxed, swung-feeling
  // slow groove (~84 bpm). Warm sine pads, a soft walking-ish bass, and a sparse, mellow arp in a
  // lower register — cool and noir-cocktail, distinct from the bright facility/beach beds.
  lounge: {
    partials: [65.41, 98, 116.54, 146.83], // C2 + G2 + Bb2 + D3 — a warm minor-7 colour
    voiceGain: 0.12,
    filterFreq: 560,
    filterQ: 4,
    lfoRate: 0.09,
    lfoDepth: 240,
    fadeIn: 0.9,
    // C4 Eb4 G4 Bb4 C5 — a smoky minor-7 arp, mid register, mellow.
    arpScale: [261.63, 311.13, 392, 466.16, 523.25],
    arpMinMs: 900,
    arpVarMs: 1100,
    arpGain: 0.05,
    arpTail: 1.1,
    bpm: 84,
    padType: 'sine',
    // C2 C2 Ab1 Bb1 — a soft lounge walk under the swung groove.
    bass: [65.41, 65.41, 51.91, 58.27],
    groove: 'club',
  },
  // Suspense bed: a slow, stalking minor-second drone with a near-beatless, sparse pulse-light
  // groove (~70 bpm) and a tense, infrequent high arp. Dissonant + dark — clearly different from
  // every other bed, for a "you're being hunted" tension moment.
  tension: {
    partials: [55, 58.27, 87.31, 110], // A1 + Bb1 (minor-2nd clash) + F2 + A2 — uneasy
    voiceGain: 0.13,
    filterFreq: 360,
    filterQ: 8,
    lfoRate: 0.05,
    lfoDepth: 300,
    fadeIn: 1.4,
    // Bb4 C5 Eb5 F5 — a tense, unresolved cluster up top.
    arpScale: [466.16, 523.25, 622.25, 698.46],
    arpMinMs: 1800,
    arpVarMs: 2600,
    arpGain: 0.05,
    arpTail: 1.4,
    bpm: 70,
    // A1 each beat — a slow, ominous heartbeat pulse (no walk).
    bass: [55],
    groove: 'club',
  },
};

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

  /** Live nodes of the running ambient bed; null while ambient is stopped. `variant` lets a
   * second `startAmbient(v)` no-op when the requested bed already plays, or crossfade to the
   * other one (menu noir ↔ upbeat match groove) when it differs. `beatTimer` is the match
   * groove's rhythmic scheduler (null for the menu bed, which has no beat). */
  private ambient: {
    nodes: AudioScheduledSourceNode[];
    arpTimer: number | null;
    beatTimer: number | null;
    variant: AmbientVariant;
  } | null = null;

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
   * Set the ambient-bed (music) volume, 0..1, by riding the music-bus gain. Wired live to the
   * Settings "Music volume" slider. Clamped to [0,1] and scaled by the bus's headroom-safe
   * ceiling so a 100% slider never exceeds the mix budget. Guards a not-yet-built graph like
   * setMuted does — a no-op before the first resume() leaves the slider value to take effect
   * once the graph exists (the slider re-applies on every input).
   */
  setMusicVolume(v: number): void {
    const gain = Math.max(0, Math.min(1, v)) * MUSIC_GAIN;
    if (this.musicBus && this.ctx) {
      const now = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(now);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
      this.musicBus.gain.linearRampToValueAtTime(gain, now + 0.05); // short ramp, no click.
    }
  }

  /**
   * Set the one-shot SFX volume, 0..1, by riding the sfx-bus gain. Wired live to the Settings
   * "SFX volume" slider. Clamped to [0,1] and scaled by the bus ceiling; guards nulls exactly
   * like setMusicVolume/setMuted so calling it pre-resume is a safe no-op.
   */
  setSfxVolume(v: number): void {
    const gain = Math.max(0, Math.min(1, v)) * SFX_GAIN;
    if (this.sfxBus && this.ctx) {
      const now = this.ctx.currentTime;
      this.sfxBus.gain.cancelScheduledValues(now);
      this.sfxBus.gain.setValueAtTime(this.sfxBus.gain.value, now);
      this.sfxBus.gain.linearRampToValueAtTime(gain, now + 0.05);
    }
  }

  /**
   * Start (or switch to) an evolving ambient bed. Pass `'menu'` for the slow noir splash pad or
   * `'match'` for the lighter up-tempo groove. Calling it with the variant that's ALREADY playing
   * is a no-op (so repeated gestures won't stack drones); calling it with the OTHER variant
   * crossfades — the current bed fades out (stopAmbient's 0.6s release) while the new one fades
   * in. Loops until `stopAmbient`/`dispose`.
   */
  startAmbient(variant: AmbientVariant = 'menu'): void {
    if (!this.ctx || !this.musicBus) return;
    if (this.ambient) {
      if (this.ambient.variant === variant) return; // already on this bed.
      this.stopAmbient(); // crossfade: release the old bed, then build the new one below.
    }
    const cfg = AMBIENT[variant];
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // A slow LFO that breathes the lowpass cutoff open and closed — the source of the "evolving"
    // feeling. Drives the filter frequency around the variant's centre.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cfg.filterFreq;
    filter.Q.value = cfg.filterQ;
    filter.connect(this.musicBus);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = cfg.lfoRate;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = cfg.lfoDepth;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start(now);

    // A small detuned oscillator stack (the drone) for a warm bed under the arp/groove.
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, now);
    padGain.gain.linearRampToValueAtTime(1, now + cfg.fadeIn); // short fade-in, no click.
    padGain.connect(filter);

    const oscNodes: AudioScheduledSourceNode[] = [];
    const padType = cfg.padType ?? 'sawtooth';
    for (const hz of cfg.partials) {
      const osc = ctx.createOscillator();
      osc.type = padType;
      osc.frequency.value = hz;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = cfg.voiceGain;
      osc.connect(voiceGain).connect(padGain);
      osc.start(now);
      oscNodes.push(osc);
    }

    // Sparse randomised arpeggio: pluck a soft note from the variant's scale above the drone so
    // the bed shimmers. The match bed re-arms far quicker (a near-steady twinkle) than the menu's.
    const scheduleArp = (): void => {
      if (!this.ctx || !this.musicBus) return;
      const t = this.ctx.currentTime;
      const hz = cfg.arpScale[Math.floor(Math.random() * cfg.arpScale.length)] ?? 440;
      if (cfg.arpVoice === 'marimba') {
        this.synthMarimba(this.ctx, this.musicBus, t, hz, cfg.arpGain, cfg.arpTail);
        return;
      }
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(cfg.arpGain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.arpTail); // soft tail.
      o.connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + cfg.arpTail + 0.1);
    };
    const armArp = (): void => {
      const delay = cfg.arpMinMs + Math.random() * cfg.arpVarMs;
      arpTimer = window.setTimeout(() => {
        scheduleArp();
        armArp();
      }, delay);
    };
    let arpTimer: number | null = null;
    armArp();

    // A rhythmic groove: a soft kick on the beat + an off-beat hat, and — for the synthwave club
    // bed — a pumping 8th-note synth BASS walking the variant's progression. Low in the mix, it
    // gives live play a pulse the slow menu pad lacks. The menu bed (bpm null) stays beatless.
    let beatTimer: number | null = null;
    if (cfg.bpm !== null) {
      const beatMs = 60000 / cfg.bpm;
      const bass = cfg.bass;
      const beachy = cfg.groove === 'beachy';
      let beatIndex = 0;
      beatTimer = window.setInterval(() => {
        if (!this.ctx || !this.musicBus) return;
        const t = this.ctx.currentTime;
        const half = beatMs / 2000; // seconds to the off-beat
        if (beachy) {
          // Laid-back tropical groove: a soft kick on every OTHER beat + a light shaker on the
          // offbeat — relaxed, never driving. No synth bass (the warm pad carries the bottom).
          if (beatIndex % 2 === 0) this.synthKick(this.ctx, this.musicBus, t);
          this.synthShaker(this.ctx, this.musicBus, t + half);
        } else {
          this.synthKick(this.ctx, this.musicBus, t); // four-on-the-floor pulse
          this.synthHat(this.ctx, this.musicBus, t + half); // off-beat tick
          if (bass && bass.length > 0) {
            const root = bass[beatIndex % bass.length] ?? bass[0] ?? 55;
            // 8th-note pulse: the root on the beat AND the off-beat — the driving club bassline.
            this.synthBass(this.ctx, this.musicBus, t, root);
            this.synthBass(this.ctx, this.musicBus, t + half, root);
          }
        }
        beatIndex += 1;
      }, beatMs);
    }

    this.ambient = { nodes: [...oscNodes, lfo], arpTimer, beatTimer, variant };
  }

  /** A soft, low kick for the match groove (sine thump → resonant decay). Low gain on the bed. */
  private synthKick(ctx: AudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** A quiet closed hi-hat tick (highpassed noise) for the match groove's off-beats. */
  private synthHat(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.04);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.05);
  }

  /** A punchy synthwave bass note (detuned saw pair → resonant lowpass, quick pluck envelope).
   * Drives the club bed's pumping 8th-note bassline. Low gain — it sits under the kick. */
  private synthBass(ctx: AudioContext, out: AudioNode, t: number, hz: number): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(620, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.18); // a little filter pluck.
    lp.Q.value = 7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    lp.connect(g).connect(out);
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      osc.detune.value = detune; // a touch of width on the bass.
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  }

  /** A breezy marimba/steel-drum-ish pluck (a sine fundamental + a soft octave overtone, fast
   * percussive decay) for the beach bed's high arpeggio. Warm and bright, not buzzy. */
  private synthMarimba(
    ctx: AudioContext,
    out: AudioNode,
    t: number,
    hz: number,
    gain: number,
    tail: number,
  ): void {
    // Two partials: the fundamental (sine) + a quieter octave (triangle) for a wooden shimmer.
    for (const [mult, type, mix] of [
      [1, 'sine', 1],
      [2, 'triangle', 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * mix, t + 0.006); // quick percussive attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + tail); // fast wooden decay
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + tail + 0.05);
    }
  }

  /** A soft maraca/shaker tick (short highpassed noise, gentler than the club hat) for the
   * laid-back beach groove's offbeats. */
  private synthShaker(ctx: AudioContext, out: AudioNode, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); // soft swell — a shaker, not a tick
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(hp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.07);
  }

  /** Fade out and stop the ambient bed (idempotent — no-op if nothing is playing). */
  stopAmbient(): void {
    if (!this.ctx || !this.ambient) return;
    const now = this.ctx.currentTime;
    if (this.ambient.arpTimer !== null) window.clearTimeout(this.ambient.arpTimer);
    if (this.ambient.beatTimer !== null) window.clearInterval(this.ambient.beatTimer);
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
      case 'uiTick':
        this.synthUiTick(ctx, out, t);
        break;
    }
  }

  /**
   * A short, soft footstep tick — a low filtered-noise scuff with a snap envelope, played on the
   * SFX bus. Self-contained (no SfxKind union member, not part of `deriveAudioEvents`): main.ts
   * triggers it directly from the frame loop at a cadence proportional to the local player's
   * planar speed (see footstepCadence.ts). Safe no-op before `resume()`. Kept quiet so a steady
   * walk never fatigues over the bed/SFX.
   */
  playFootstep(): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const out = this.sfxBus;
    const t = ctx.currentTime;

    // A short burst of noise through a lowpass — a muffled "scuff" rather than a click.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.05); // close down = soft thud.
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.004); // soft — well under the gameplay SFX.
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.08);
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

  /** 'uiTick' — a very light, short blip for menu-option feedback. Tiny + high so it reads as a
   * crisp "tick" without intruding: a fast triangle pip with a snap envelope. */
  private synthUiTick(ctx: AudioContext, out: AudioNode, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, t);
    osc.frequency.exponentialRampToValueAtTime(1480, t + 0.04); // a subtle upward pip.
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.004); // light — well under the SFX bus.
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.08);
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
