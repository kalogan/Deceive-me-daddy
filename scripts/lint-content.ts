// Content-data lint (PROJECT_BRIEF §5). Validates every authored content pack against
// the SAME schema the server + preview harness use. Reused, never forked.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ContentPackSchema } from '../packages/shared/src/schema/contentPack';

const packsDir = fileURLToPath(new URL('../packages/content/packs/', import.meta.url));

let failures = 0;
let count = 0;

for (const file of readdirSync(packsDir).filter((f) => f.endsWith('.json'))) {
  count += 1;
  const raw: unknown = JSON.parse(readFileSync(packsDir + file, 'utf8'));
  const result = ContentPackSchema.safeParse(raw);
  if (result.success) {
    console.log(`  ✓ ${file}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${file}`);
    for (const issue of result.error.issues) {
      console.error(`      ${issue.path.join('.')}: ${issue.message}`);
    }
  }
}

console.log(`content packs: ${count}, failures: ${failures}`);
if (failures > 0) process.exit(1);
