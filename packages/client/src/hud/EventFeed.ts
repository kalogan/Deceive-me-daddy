// The match EVENT FEED (a plain fixed DOM list, NOT Three): a small scrolling log of recent
// events for the LOCAL player ("Collected intel", "Vault opened", "Downed", …). Lines are
// pushed from the pure deriveMatchEvents diff in main.ts and AUTO-EXPIRE after a few seconds.
//
// Authority (PROJECT_BRIEF §3/§4.2): display-only. PHONE-FIRST: pinned BOTTOM-LEFT, above the
// left stick's thumb zone but out of the bottom-right action cluster; pointer-transparent.
import type { FeedKind } from './matchEvents';

/** How long (ms) a feed line stays before it expires + is removed. */
const ENTRY_TTL_MS = 4500;
/** Fade-out duration (ms) — matches the CSS transition below. */
const FADE_MS = 350;
/** Max simultaneous lines kept on screen (oldest evicted) so the feed never grows unbounded. */
const MAX_ENTRIES = 5;

/** Per-kind accent colour so each event reads at a glance (echoes the HUD palette). */
const FEED_COLOR: Record<FeedKind, string> = {
  'Collected intel': '#9b8cff',
  'Picked up keycard': '#ffe08a',
  'Vault opened': '#3fffd0',
  'Grabbed the package': '#ffcf3f',
  'You were revealed': '#ff5a5a',
  Downed: '#ff5a5a',
  Revived: '#7fe3ff',
};

interface Entry {
  el: HTMLDivElement;
  /** Wall-clock ms at which this line expires. */
  expiresAt: number;
  /** Pending removal timer id (set once the fade starts), or null. */
  removeTimer: number | null;
}

export class EventFeed {
  private readonly root: HTMLDivElement;
  private readonly entries: Entry[] = [];

  constructor(parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.id = 'event-feed';
    Object.assign(root.style, {
      position: 'fixed',
      left: '12px',
      bottom: '92px', // clear of the bottom edge / left-stick thumb zone on phones.
      display: 'flex',
      flexDirection: 'column-reverse', // newest at the bottom, older drifting up.
      gap: '4px',
      maxWidth: '220px',
      font: '700 12px/1.3 ui-monospace, monospace',
      letterSpacing: '0.02em',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '8',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(root);
    this.root = root;
  }

  /** Push a new feed line. It fades in, lives ENTRY_TTL_MS, then fades out + is removed. */
  push(kind: FeedKind): void {
    const el = document.createElement('div');
    el.textContent = kind;
    Object.assign(el.style, {
      color: FEED_COLOR[kind],
      background: 'rgba(0, 0, 0, 0.5)',
      padding: '3px 8px',
      borderRadius: '5px',
      opacity: '0',
      transition: `opacity ${FADE_MS}ms linear`,
      whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.append(el);
    // Fade in on the next frame (after layout) so the transition runs.
    void el.offsetWidth;
    el.style.opacity = '1';

    const entry: Entry = { el, expiresAt: performance.now() + ENTRY_TTL_MS, removeTimer: null };
    this.entries.push(entry);

    // Evict the oldest if we're over the cap.
    while (this.entries.length > MAX_ENTRIES) {
      const oldest = this.entries.shift();
      if (oldest) this.remove(oldest);
    }
  }

  /** Expire any lines past their TTL. Called each frame from the loop (cheap — usually a no-op). */
  update(): void {
    const now = performance.now();
    for (const entry of this.entries) {
      if (entry.removeTimer === null && now >= entry.expiresAt) this.remove(entry);
    }
  }

  /** Fade a line out, then drop it from the list + the DOM. Idempotent per entry. */
  private remove(entry: Entry): void {
    if (entry.removeTimer !== null) return;
    entry.el.style.opacity = '0';
    entry.removeTimer = window.setTimeout(() => {
      entry.el.remove();
      const i = this.entries.indexOf(entry);
      if (i >= 0) this.entries.splice(i, 1);
    }, FADE_MS);
  }

  dispose(): void {
    for (const entry of this.entries) {
      if (entry.removeTimer !== null) window.clearTimeout(entry.removeTimer);
      entry.el.remove();
    }
    this.entries.length = 0;
    this.root.remove();
  }
}
