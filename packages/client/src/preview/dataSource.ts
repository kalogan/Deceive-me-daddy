// THE SEAM (PROJECT_BRIEF §8 / PREVIEW_HARNESS §B). Content packs flow into the preview
// through the SAME `ContentPackSchema` the server validates with — same bytes, same
// validate, different SOURCE (files here; a fetch in prod). Never a forked "preview"
// data shape.
//
// `loadPacksFromRecord` is PURE (no Vite, no DOM) so it's unit-testable in a node env.
// `loadAllPacks` is the thin Vite-only wrapper that feeds it the globbed files.
import { ContentPackSchema, type ContentPack } from '@deceive/shared';

/**
 * Validate every raw value in `record` against the REAL schema. Invalid artifacts are
 * skipped + reported (console.error), never thrown — one malformed pack must not blank
 * the whole gallery (fail-soft per artifact). Returns only the packs that parse, sorted
 * by id for a stable picker order.
 */
export function loadPacksFromRecord(record: Record<string, unknown>): ContentPack[] {
  const packs: ContentPack[] = [];
  for (const [key, raw] of Object.entries(record)) {
    const result = ContentPackSchema.safeParse(raw);
    if (result.success) {
      packs.push(result.data);
    } else {
      console.error(
        `[preview] skipping invalid content pack "${key}": ${result.error.message}`,
      );
    }
  }
  return packs.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Enumerate every authored pack under packages/content. `import.meta.glob` is Vite-only
 * (resolved at build time) so it lives OUT of the pure function — tests never touch it.
 * Zero-wiring (PREVIEW_HARNESS §3.3): dropping a new *.json in content/packs makes it
 * appear automatically, no per-pack registration.
 */
export function loadAllPacks(): ContentPack[] {
  const record = import.meta.glob('../../../content/packs/*.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
  return loadPacksFromRecord(record);
}
