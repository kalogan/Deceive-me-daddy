// The content-pack schema (PROJECT_BRIEF §2b). A map is authored as DATA and flows
// through this SAME schema into both the server and the preview harness — never forked.
// Schema changes ship a golden fixture + forward migration (PROJECT_BRIEF §4.4).
import { z } from 'zod';
import { CLEARANCE_TIERS } from '../clearance';

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3Tuple = z.infer<typeof Vec3Schema>;

const ClearanceTierSchema = z.enum(CLEARANCE_TIERS);

/** A bounded volume gated by a required clearance tier. */
export const ZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  requiredClearance: ClearanceTierSchema,
  bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
});
export type Zone = z.infer<typeof ZoneSchema>;

/** A door between two zones. Opens via disguise tier, a matching keycard, or intel. */
export const DoorSchema = z.object({
  id: z.string().min(1),
  position: Vec3Schema,
  connects: z.tuple([z.string().min(1), z.string().min(1)]),
  requiredClearance: ClearanceTierSchema,
  keycardColor: ClearanceTierSchema.optional(),
  intelToUnlock: z.number().int().nonnegative().default(0),
});
export type Door = z.infer<typeof DoorSchema>;

export const NpcRoutineSchema = z.object({
  kind: z.enum(['patrol', 'idle', 'wander', 'work']),
  waypoints: z.array(Vec3Schema).default([]),
});
export type NpcRoutine = z.infer<typeof NpcRoutineSchema>;

/** A crowd NPC of a given tier, with a home zone + routine players blend into. */
export const NpcSpawnSchema = z.object({
  id: z.string().min(1),
  tier: ClearanceTierSchema,
  homeZone: z.string().min(1),
  routine: NpcRoutineSchema,
});
export type NpcSpawn = z.infer<typeof NpcSpawnSchema>;

/** A color-coded keycard that grants access to its tier's doors. */
export const KeycardSchema = z.object({
  id: z.string().min(1),
  color: ClearanceTierSchema,
  position: Vec3Schema,
});
export type Keycard = z.infer<typeof KeycardSchema>;

/** A tier-specific social interaction spot. Matching it bleeds suspicion. */
export const SocialSpotSchema = z.object({
  id: z.string().min(1),
  tier: ClearanceTierSchema,
  action: z.enum(['water_plants', 'patrol_post', 'sit', 'drink', 'inspect']),
  position: Vec3Schema,
});
export type SocialSpot = z.infer<typeof SocialSpotSchema>;

/** Intel source (terminal/NPC) — spent to unlock doors + open the vault. */
export const IntelNodeSchema = z.object({
  id: z.string().min(1),
  position: Vec3Schema,
  zoneId: z.string().min(1),
  intelValue: z.number().int().positive(),
});
export type IntelNode = z.infer<typeof IntelNodeSchema>;

/** The heist objective: gather intel -> open vault -> secure package -> extract. */
export const ObjectiveSchema = z.object({
  vaultZoneId: z.string().min(1),
  packagePosition: Vec3Schema,
  intelRequiredToOpenVault: z.number().int().positive(),
  extractionPoints: z.array(Vec3Schema).min(1),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const SpawnPointSchema = z.object({
  position: Vec3Schema,
  team: z.number().int().min(0).max(3).optional(),
});
export type SpawnPoint = z.infer<typeof SpawnPointSchema>;

export const ContentPackSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  theme: z.string().min(1),
  zones: z.array(ZoneSchema).min(1),
  doors: z.array(DoorSchema).default([]),
  npcs: z.array(NpcSpawnSchema).default([]),
  keycards: z.array(KeycardSchema).default([]),
  socialSpots: z.array(SocialSpotSchema).default([]),
  intelNodes: z.array(IntelNodeSchema).default([]),
  objective: ObjectiveSchema,
  spawnPoints: z.array(SpawnPointSchema).min(1),
});
export type ContentPack = z.infer<typeof ContentPackSchema>;
