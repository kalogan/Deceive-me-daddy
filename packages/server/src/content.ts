// Server-side content loading (Phase 2). Round 1 loads a single hardcoded map pack; a
// multi-pack loader + matchmaking map selection is a later slice. Validated with the SAME
// ContentPackSchema the preview harness uses — same bytes, same validate, different source.
import { ContentPackSchema, type ContentPack } from '@deceive/shared';
import rawFacilityAlpha from '../../content/packs/facility_alpha.json';

export const FACILITY_ALPHA: ContentPack = ContentPackSchema.parse(rawFacilityAlpha);
